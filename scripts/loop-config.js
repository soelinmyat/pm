#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_LOOP_CONFIG = Object.freeze({
  version: 1,
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
    max_runtime_seconds_per_run: 2400,
    lease_ttl_minutes: 45,
    max_attempts_per_stage: 3,
  },
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

  return deepMerge(DEFAULT_LOOP_CONFIG, userConfig);
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
  const args = {
    pmDir: path.join(process.cwd(), "pm"),
    init: false,
    force: false,
    format: "json",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--pm-dir" && argv[index + 1]) {
      args.pmDir = path.resolve(argv[++index]);
    } else if (arg === "--init") {
      args.init = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--format" && argv[index + 1]) {
      args.format = argv[++index];
    }
  }

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
  configPath,
  deepMerge,
  ensureLoopDirs,
  initLoopConfig,
  loadLoopConfig,
};

if (require.main === module) {
  main();
}
