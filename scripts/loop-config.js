#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { parseCliArgs } = require("./loop-args.js");
const { writeJsonAtomic } = require("./lib/atomic-file.js");
const { runOperationalEffect } = require("./lib/operational-effect-journal.js");

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
    lease_ttl_seconds: 7200,
    max_attempts_per_stage: 3,
    max_identical_no_progress: 1,
  },
  claim_envelope: {
    branch_promotion_seconds: 120,
    bootstrap_recheck_seconds: 300,
    shutdown_grace_seconds: 30,
    remote_stop_poll_seconds: 30,
    artifact_verification_seconds: 120,
    pm_finalization_seconds: 180,
    workspace_cleanup_seconds: 120,
    scheduler_overlap_margin_seconds: 300,
    cas_attempts: 3,
  },
  scheduler_interval_minutes: 30,
  preflight: {
    probe_timeout_seconds: 60,
    quarantine_ttl_seconds: 3600,
    service_checks: [],
  },
  canary: {
    evidence_ttl_seconds: 86400,
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

  return normalizeLoopConfig(userConfig);
}

function normalizeLoopConfig(config) {
  const input = isPlainObject(config) ? clone(config) : {};
  if (isPlainObject(input.budgets) && Object.hasOwn(input.budgets, "lease_ttl_minutes")) {
    if (Object.hasOwn(input.budgets, "lease_ttl_seconds")) {
      throw new Error(
        "budgets must not set both lease_ttl_minutes and lease_ttl_seconds; migrate to seconds"
      );
    }
    input.budgets.lease_ttl_seconds = Number(input.budgets.lease_ttl_minutes) * 60;
    delete input.budgets.lease_ttl_minutes;
  }

  const normalized = deepMerge(DEFAULT_LOOP_CONFIG, input);
  for (const key of [
    "wip_limits",
    "autonomy",
    "budgets",
    "claim_envelope",
    "preflight",
    "canary",
    "worker",
  ]) {
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

const CLAIM_PHASE_WEIGHTS = Object.freeze({
  branch_promotion_seconds: 1,
  bootstrap_recheck_seconds: 1,
  shutdown_grace_seconds: 1,
  artifact_verification_seconds: 1,
  // Dispatch, claimed-card snapshot, recovery checkpoint, and final push are
  // independently bounded PM transactions on the normal claimed-run path.
  pm_finalization_seconds: 4,
  workspace_cleanup_seconds: 1,
});

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function exactCronIntervalMinutes(value, label = "scheduler_interval_minutes") {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer exact cron interval`);
  }
  const subHourly = value <= 60 && 60 % value === 0;
  const hourly =
    value > 60 && value % 60 === 0 && value <= 1440 && (value === 1440 || 24 % (value / 60) === 0);
  if (!subHourly && !hourly) {
    throw new Error(
      `${label} must be an exact cron interval that divides an hour or a 24-hour day`
    );
  }
  return value;
}

function leaseTtlSeconds(config) {
  const budgets = isPlainObject(config && config.budgets) ? config.budgets : {};
  if (Number.isFinite(Number(budgets.lease_ttl_seconds))) {
    return Number(budgets.lease_ttl_seconds);
  }
  if (Number.isFinite(Number(budgets.lease_ttl_minutes))) {
    return Number(budgets.lease_ttl_minutes) * 60;
  }
  return DEFAULT_LOOP_CONFIG.budgets.lease_ttl_seconds;
}

function claimEnvelopeSeconds(config, stage = "dev") {
  const envelope = config && config.claim_envelope;
  if (!isPlainObject(envelope)) {
    throw new Error("claim_envelope must be an object");
  }
  const phaseSeconds = Object.entries(CLAIM_PHASE_WEIGHTS).reduce((total, [field, weight]) => {
    const seconds = positiveInteger(Number(envelope[field]), `claim_envelope.${field}`);
    return total + seconds * weight;
  }, 0);
  const runtimeField =
    stage === "ship" || stage === "review"
      ? "max_runtime_seconds_per_ship_cycle"
      : "max_runtime_seconds_per_run";
  const runtime = positiveInteger(
    Number(config.budgets && config.budgets[runtimeField]),
    `budgets.${runtimeField}`
  );
  return phaseSeconds + runtime;
}

function configExposure(config) {
  const devEnvelope = claimEnvelopeSeconds(config, "dev");
  const shipEnvelope = claimEnvelopeSeconds(config, "ship");
  const longestEnvelope = Math.max(devEnvelope, shipEnvelope);
  const margin = Number(config.claim_envelope.scheduler_overlap_margin_seconds);
  const ttl = leaseTtlSeconds(config);
  const warnings = [];
  if (config.autonomy && config.autonomy.merge_pr === true) {
    warnings.push(
      "Merge autonomy is enabled: verified pull requests may merge without a human stop."
    );
  }
  const worker = config.worker || {};
  if (worker.codex_sandbox === "danger-full-access") {
    warnings.push(
      "Codex danger-full-access is a broad host permission grant, not capability isolation."
    );
  }
  if (
    Array.isArray(worker.engine_args) &&
    worker.engine_args.includes("--dangerously-bypass-approvals-and-sandbox")
  ) {
    warnings.push(
      "Codex dangerously-bypass-approvals-and-sandbox disables approval and sandbox controls."
    );
  }
  if (worker.engine_bin) {
    warnings.push(
      "A custom engine binary runs with host-user permissions outside Codex/Claude sandbox controls."
    );
  }
  if (worker.claude_permission_mode === "bypassPermissions") {
    warnings.push("Claude bypassPermissions is a broad host permission grant.");
  }
  if (Array.isArray(worker.codex_add_dirs) && worker.codex_add_dirs.length > 0) {
    warnings.push("Extra Codex writable directories broaden engine host exposure.");
  }
  return {
    claim_envelope_seconds: { dev: devEnvelope, ship: shipEnvelope },
    maximum_daily_claim_envelope_seconds:
      devEnvelope * Number(config.budgets.max_runs_per_day) +
      shipEnvelope * Number(config.budgets.max_ship_cycles_per_day),
    lease_ttl_seconds: ttl,
    minimum_ttl_seconds: longestEnvelope + margin + 1,
    ttl_margin_seconds: ttl - (longestEnvelope + margin),
    warnings,
  };
}

function formatConfigExposure(exposure) {
  if (!exposure) return "";
  return [
    `Maximum daily claim envelope: ${exposure.maximum_daily_claim_envelope_seconds}s.`,
    `Lease TTL: ${exposure.lease_ttl_seconds}s (minimum ${exposure.minimum_ttl_seconds}s; margin ${exposure.ttl_margin_seconds}s).`,
    ...exposure.warnings.map((warning) => `WARNING: ${warning}`),
  ].join("\n");
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

  const ttl = positiveInteger(leaseTtlSeconds(config), "budgets.lease_ttl_seconds");
  for (const field of ["max_runs_per_day", "max_ship_cycles_per_day"]) {
    positiveInteger(Number(config.budgets[field]), `budgets.${field}`);
  }
  positiveInteger(
    Number(config.budgets.max_identical_no_progress),
    "budgets.max_identical_no_progress"
  );
  positiveInteger(Number(config.canary.evidence_ttl_seconds), "canary.evidence_ttl_seconds");
  exactCronIntervalMinutes(config.scheduler_interval_minutes);
  const devEnvelope = claimEnvelopeSeconds(config, "dev");
  const shipEnvelope = claimEnvelopeSeconds(config, "ship");
  const envelope = Math.max(devEnvelope, shipEnvelope);
  const margin = positiveInteger(
    Number(config.claim_envelope.scheduler_overlap_margin_seconds),
    "claim_envelope.scheduler_overlap_margin_seconds"
  );
  positiveInteger(Number(config.claim_envelope.cas_attempts), "claim_envelope.cas_attempts");
  positiveInteger(
    Number(config.claim_envelope.remote_stop_poll_seconds),
    "claim_envelope.remote_stop_poll_seconds"
  );
  if (ttl <= envelope + margin) {
    throw new Error(
      `budgets.lease_ttl_seconds (${ttl}) must be greater than claim envelope (${envelope}) ` +
        `plus scheduler overlap margin (${margin}); increase the TTL or lower bounded phase times`
    );
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
  writeJsonAtomic(filePath, value, { fileMode: 0o600, directoryMode: 0o700 });
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
  for (const child of ["events", "leases", "recovery", "session-snapshots"]) {
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

  writeJsonAtomic(filePath, DEFAULT_LOOP_CONFIG);
  return {
    created: true,
    filePath,
    config: clone(DEFAULT_LOOP_CONFIG),
  };
}

function fileHash(filePath) {
  return fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : "absent";
}

function runLoopConfigEffect(options) {
  const action = options.action;
  if (!["init", "approve-host"].includes(action)) {
    throw new Error(`unsupported loop config effect: ${action}`);
  }
  const pmDir = path.resolve(options.pmDir);
  const pmStateDir = path.resolve(options.pmStateDir);
  const loopConfigPath = configPath(pmDir);
  const approvalPath = hostConfigPath(pmStateDir);
  const force = options.force === true;
  const authorityAction = action === "init" ? "configure_loop" : "approve_loop_host";
  const recovery = { code: "inspect-loop-config-effect", command: "/pm:loop status" };

  if (action === "init") {
    const currentHash = fileHash(loopConfigPath);
    const desiredHash =
      currentHash !== "absent" && !force
        ? currentHash
        : sha256(`${JSON.stringify(DEFAULT_LOOP_CONFIG, null, 2)}\n`);
    const observe = () => {
      const observedHash = fileHash(loopConfigPath);
      if (observedHash !== desiredHash) {
        return { state: "absent", safe_to_retry: true, reason: "loop config is not initialized" };
      }
      const config = loadLoopConfig(pmDir);
      return {
        state: "verified",
        receipt: {
          config_sha256: observedHash,
          execution_config_hash: executionConfigHash(config),
        },
      };
    };
    return runOperationalEffect({
      pmStateDir,
      workflow: "loop",
      effect: "initialize-loop-config",
      authorityAction,
      authorityActions: options.authorityActions,
      target: { file: "pm/loop/config.json", config_sha256: desiredHash },
      intent: { action, force },
      precondition: { config_sha256: currentHash },
      recovery,
      observe,
      mutate() {
        initLoopConfig(pmDir, { force });
        return { receipt: observe().receipt };
      },
    });
  }

  const config = loadLoopConfig(pmDir);
  const desiredApprovalHash = executionConfigHash(config);
  const beforeHash = fileHash(approvalPath);
  const observe = () => {
    let host;
    try {
      host = readHostConfig(pmStateDir);
    } catch (error) {
      return { state: "ambiguous", reason: error.message };
    }
    if (!host || host.approved_execution_config_hash !== desiredApprovalHash) {
      return { state: "absent", safe_to_retry: true, reason: "host approval is absent or stale" };
    }
    return {
      state: "verified",
      receipt: {
        approved_execution_config_hash: desiredApprovalHash,
        host_config_sha256: fileHash(approvalPath),
      },
    };
  };
  return runOperationalEffect({
    pmStateDir,
    workflow: "loop",
    effect: "approve-loop-host",
    authorityAction,
    authorityActions: options.authorityActions,
    target: { file: ".pm/loop-host.json", execution_config_hash: desiredApprovalHash },
    intent: { action, execution_config_hash: desiredApprovalHash },
    precondition: { host_config_sha256: beforeHash },
    recovery,
    observe,
    mutate() {
      approveExecutionConfig(pmStateDir, config, options);
      return { receipt: observe().receipt };
    },
  });
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
      const result = runLoopConfigEffect({
        action: "init",
        pmDir: args.pmDir,
        pmStateDir: args.pmStateDir,
        force: args.force,
        authorityActions: ["configure_loop"],
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    if (args.approveHost) {
      const approval = runLoopConfigEffect({
        action: "approve-host",
        pmDir: args.pmDir,
        pmStateDir: args.pmStateDir,
        authorityActions: ["approve_loop_host"],
      });
      process.stdout.write(`${JSON.stringify(approval, null, 2)}\n`);
      return;
    }

    const config = loadLoopConfig(args.pmDir);
    if (args.format === "path") {
      process.stdout.write(`${configPath(args.pmDir)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
      const exposure = configExposure(config);
      process.stderr.write(`${formatConfigExposure(exposure)}\n`);
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
  claimEnvelopeSeconds,
  configExposure,
  configPath,
  deepMerge,
  ensureLoopDirs,
  exactCronIntervalMinutes,
  executionConfig,
  executionConfigHash,
  formatConfigExposure,
  hostConfigPath,
  initLoopConfig,
  loadLoopConfig,
  loadTrustedLoopConfig,
  leaseTtlSeconds,
  normalizeLoopConfig,
  readHostConfig,
  requiresLocalApproval,
  runLoopConfigEffect,
  sha256,
  stableValue,
  validateLoopConfig,
};

if (require.main === module) {
  main();
}
