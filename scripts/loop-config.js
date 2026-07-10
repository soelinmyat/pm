#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseCliArgs } = require("./loop-args.js");

const DEFAULT_LOOP_CONFIG = Object.freeze({
  version: 2,
  enabled: true,
  mode: "git",
  scheduler: "manual",
  default_runtime: "codex",
  sync_required_for_mutation: true,
  wip_limits: {
    shipping: 3,
    implementing: 1,
    research: 1,
  },
  autonomy: {
    status: true,
    research: true,
    draft_rfc: false,
    start_dev: false,
    open_pr: true,
    merge_pr: false,
  },
  budgets: {
    max_runs_per_day: 12,
    max_ship_cycles_per_day: 24,
    max_runtime_seconds_per_run: 5400,
    max_runtime_seconds_per_ship_cycle: 1800,
    lease_ttl_minutes: 45,
    max_attempts_per_stage: 3,
  },
  scheduler_interval_minutes: 30,
  preflight: {
    probe_timeout_seconds: 60,
    quarantine_ttl_seconds: 3600,
    service_checks: [],
  },
  worker: {
    engine: "",
    engine_bin: "",
    engine_args: [],
    claude_permission_mode: "acceptEdits",
    codex_sandbox: "workspace-write",
    codex_add_dirs: [],
    bootstrap_files: [],
    bootstrap_required_files: [],
    bootstrap_command: "",
    keep_workspace: false,
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return clone(base);
  const merged = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function configPath(pmDir) {
  return path.join(pmDir, "loop", "config.json");
}

function loadLoopConfig(pmDir) {
  const filePath = configPath(pmDir);
  if (!fs.existsSync(filePath)) {
    return clone(DEFAULT_LOOP_CONFIG);
  }

  let userConfig;
  try {
    userConfig = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Invalid loop config JSON at ${filePath}: ${err.message}`);
  }

  // Well-formed JSON of the wrong type (array / number / string / bool) would
  // otherwise deep-merge to permissive DEFAULTS silently — replacing an
  // operator's conservative caps with the wide-open ones. Reject it so every
  // caller (worker, install, the situation router) sees a real error.
  if (!isPlainObject(userConfig)) {
    throw new Error(`Loop config at ${filePath} must be a JSON object`);
  }

  return normalizeLoopConfig(deepMerge(DEFAULT_LOOP_CONFIG, userConfig));
}

function normalizeLoopConfig(config) {
  const normalized = deepMerge(DEFAULT_LOOP_CONFIG, config);
  for (const key of ["wip_limits", "autonomy", "budgets", "preflight", "worker"]) {
    if (!isPlainObject(normalized[key])) {
      normalized[key] = clone(DEFAULT_LOOP_CONFIG[key]);
    } else {
      normalized[key] = deepMerge(DEFAULT_LOOP_CONFIG[key], normalized[key]);
    }
  }
  validateLoopConfig(normalized);
  return normalized;
}

function assertCanonicalEngineArgs(extraArgs) {
  for (const arg of extraArgs) {
    const text = String(arg);
    if (
      text === "--sandbox" ||
      text.startsWith("--sandbox=") ||
      text === "-s" ||
      text.startsWith("-s=")
    ) {
      throw new Error("worker.engine_args must not contain --sandbox; use worker.codex_sandbox");
    }
    if (text === "--add-dir" || text.startsWith("--add-dir=")) {
      throw new Error("worker.engine_args must not contain --add-dir; use worker.codex_add_dirs");
    }
  }
}

function validateLoopConfig(config) {
  if (![1, 2].includes(config.version)) {
    throw new Error(
      `Unsupported loop config version ${JSON.stringify(config.version)}; expected 1 or 2`
    );
  }

  if (!Array.isArray(config.worker.engine_args)) {
    throw new Error("worker.engine_args must be an array");
  }
  assertCanonicalEngineArgs(config.worker.engine_args);

  if (
    !["read-only", "workspace-write", "danger-full-access"].includes(config.worker.codex_sandbox)
  ) {
    throw new Error(
      "worker.codex_sandbox must be exactly one of read-only, workspace-write, danger-full-access"
    );
  }

  for (const key of ["bootstrap_files", "bootstrap_required_files", "codex_add_dirs"]) {
    if (!Array.isArray(config.worker[key])) {
      throw new Error(`worker.${key} must be an array`);
    }
  }
  if (!Array.isArray(config.preflight.service_checks)) {
    throw new Error("preflight.service_checks must be an array");
  }
  for (const [index, check] of config.preflight.service_checks.entries()) {
    if (
      (typeof check === "string" && !check.trim()) ||
      (typeof check !== "string" &&
        (!isPlainObject(check) || typeof check.command !== "string" || !check.command.trim()))
    ) {
      throw new Error(`preflight.service_checks[${index}] must be a command string or object`);
    }
  }
  return config;
}

function executionConfig(config) {
  // The exact-plan contract covers every resolved field that can affect
  // selection, prompting, preflight, claim, or execution. Hashing the complete
  // normalized config prevents a newly added behavior dial from being omitted.
  return normalizeLoopConfig(config);
}

function executionConfigHash(config) {
  return sha256(JSON.stringify(stableValue(executionConfig(config))));
}

function resolvedConfigRequiresLocalApproval(resolved) {
  const worker = resolved.worker;
  const engine = worker.engine || resolved.default_runtime || "codex";
  return Boolean(
    engine !== "codex" ||
    worker.engine_bin ||
    worker.engine_args.length > 0 ||
    worker.bootstrap_command ||
    worker.codex_add_dirs.length > 0 ||
    worker.codex_sandbox === "danger-full-access" ||
    worker.claude_permission_mode === "bypassPermissions" ||
    resolved.preflight.service_checks.length > 0
  );
}

function requiresLocalApproval(config) {
  return resolvedConfigRequiresLocalApproval(executionConfig(config));
}

function hostConfigPath(pmStateDir) {
  return path.join(pmStateDir, "loop-host.json");
}

function readHostConfig(pmStateDir) {
  const filePath = hostConfigPath(pmStateDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch (err) {
    throw new Error(`Invalid loop host config JSON at ${filePath}: ${err.message}`);
  }
}

function approveExecutionConfig(pmStateDir, config, options = {}) {
  const filePath = hostConfigPath(pmStateDir);
  const hash = executionConfigHash(config);
  const value = {
    schema_version: 1,
    approved_execution_config_hash: hash,
    approved_at: (options.now instanceof Date ? options.now : new Date()).toISOString(),
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, filePath);
  return value;
}

function loadTrustedLoopConfig(pmDir, pmStateDir) {
  const config = loadLoopConfig(pmDir);
  const resolved = executionConfig(config);
  const hash = sha256(JSON.stringify(stableValue(resolved)));
  if (resolvedConfigRequiresLocalApproval(resolved)) {
    const host = readHostConfig(pmStateDir);
    if (!host || host.approved_execution_config_hash !== hash) {
      throw new Error(
        `Loop execution config requires local approval for ${hash}. ` +
          `Run loop-config.js --pm-dir ${JSON.stringify(pmDir)} --pm-state-dir ${JSON.stringify(pmStateDir)} --approve-host`
      );
    }
  }
  return { ...config, execution_config_hash: hash };
}

function ensureLoopDirs(pmDir) {
  for (const child of ["events", "leases", "session-snapshots"]) {
    fs.mkdirSync(path.join(pmDir, "loop", child), { recursive: true });
  }
}

function initLoopConfig(pmDir, options = {}) {
  ensureLoopDirs(pmDir);
  const filePath = configPath(pmDir);
  if (fs.existsSync(filePath) && !options.force) {
    return {
      created: false,
      filePath,
      config: loadLoopConfig(pmDir),
    };
  }

  fs.writeFileSync(filePath, `${JSON.stringify(DEFAULT_LOOP_CONFIG, null, 2)}\n`);
  return {
    created: true,
    filePath,
    config: clone(DEFAULT_LOOP_CONFIG),
  };
}

function parseArgs(argv) {
  const defaults = {
    pmDir: path.join(process.cwd(), "pm"),
    init: false,
    force: false,
    approveHost: false,
    pmStateDir: "",
    format: "json",
  };
  const { args } = parseCliArgs(
    argv,
    {
      "--pm-dir": { key: "pmDir", type: "string" },
      "--init": { key: "init", type: "boolean" },
      "--force": { key: "force", type: "boolean" },
      "--approve-host": { key: "approveHost", type: "boolean" },
      "--pm-state-dir": { key: "pmStateDir", type: "string" },
      "--format": { key: "format", type: "string" },
    },
    defaults
  );
  args.pmDir = path.resolve(args.pmDir);
  args.pmStateDir = args.pmStateDir
    ? path.resolve(args.pmStateDir)
    : path.join(path.dirname(args.pmDir), ".pm");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.init) {
      const result = initLoopConfig(args.pmDir, { force: args.force });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (args.approveHost) {
      const config = loadLoopConfig(args.pmDir);
      const approval = approveExecutionConfig(args.pmStateDir, config);
      process.stdout.write(`${JSON.stringify(approval, null, 2)}\n`);
      return;
    }

    const config = loadLoopConfig(args.pmDir);
    if (args.format === "path") {
      process.stdout.write(`${configPath(args.pmDir)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    }
  } catch (err) {
    process.stderr.write(`loop-config: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_LOOP_CONFIG,
  approveExecutionConfig,
  assertCanonicalEngineArgs,
  configPath,
  deepMerge,
  ensureLoopDirs,
  executionConfig,
  executionConfigHash,
  hostConfigPath,
  initLoopConfig,
  loadLoopConfig,
  loadTrustedLoopConfig,
  normalizeLoopConfig,
  readHostConfig,
  requiresLocalApproval,
  sha256,
  stableValue,
  validateLoopConfig,
};

if (require.main === module) {
  main();
}
