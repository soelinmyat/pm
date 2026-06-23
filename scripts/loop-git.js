#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { DEFAULT_LOOP_CONFIG, loadLoopConfig } = require("./loop-config.js");

const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
];

function cleanGitEnv() {
  const env = { ...process.env };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) {
    delete env[key];
  }
  return env;
}

function runGit(args, cwd, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: cleanGitEnv(),
  }).trim();
}

function findGitRoot(startDir) {
  try {
    const out = runGit(["rev-parse", "--show-toplevel"], startDir);
    return out || null;
  } catch {
    return null;
  }
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function leaseFileName(cardId, stage) {
  const safeStage = sanitizeId(stage || "work");
  const safeCard = sanitizeId(cardId);
  if (!safeCard) throw new Error("lease requires a card id");
  return `${safeStage}-${safeCard}.json`;
}

function leasePath(pmDir, cardId, stage) {
  return path.join(pmDir, "loop", "leases", leaseFileName(cardId, stage));
}

function nowIso(now = new Date()) {
  return now.toISOString();
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON at ${filePath}: ${err.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function isLeaseExpired(lease, now = new Date()) {
  if (!lease || !lease.expires_at) return true;
  const expiresAt = Date.parse(lease.expires_at);
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt <= now.getTime();
}

function listLeaseFiles(pmDir) {
  const dir = path.join(pmDir, "loop", "leases");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function listLeases(pmDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const leases = [];
  for (const filePath of listLeaseFiles(pmDir)) {
    let lease;
    try {
      lease = readJsonFile(filePath);
    } catch (err) {
      leases.push({
        filePath,
        valid_json: false,
        expired: true,
        error: err.message,
      });
      continue;
    }
    leases.push({
      ...lease,
      filePath,
      valid_json: true,
      expired: isLeaseExpired(lease, now),
    });
  }
  return leases;
}

function activeLeaseFor(pmDir, cardId, stage, options = {}) {
  const leases = listLeases(pmDir, options);
  return (
    leases.find(
      (lease) =>
        lease.valid_json &&
        !lease.expired &&
        lease.card_id === cardId &&
        (!stage || lease.stage === stage)
    ) || null
  );
}

function buildLease(input, config = DEFAULT_LOOP_CONFIG, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ttl = Number(config.budgets && config.budgets.lease_ttl_minutes) || 45;
  const cardId = input.cardId || input.card_id;
  const stage = input.stage || "work";
  if (!cardId) throw new Error("lease requires cardId");

  return {
    version: 1,
    card_id: cardId,
    stage,
    holder: input.holder || os.hostname(),
    runtime: input.runtime || config.default_runtime || "codex",
    source_path: input.sourcePath || input.source_path || "",
    claimed_at: nowIso(now),
    expires_at: nowIso(addMinutes(now, ttl)),
    run_id: input.runId || input.run_id || "",
  };
}

function canClaimLease(pmDir, input, options = {}) {
  const existing = activeLeaseFor(pmDir, input.cardId || input.card_id, input.stage, options);
  if (existing) {
    return {
      ok: false,
      reason: "active-lease",
      lease: existing,
    };
  }
  return { ok: true };
}

function prepareLease(pmDir, input, config = DEFAULT_LOOP_CONFIG, options = {}) {
  const claimable = canClaimLease(pmDir, input, options);
  if (!claimable.ok) return claimable;

  const lease = buildLease(input, config, options);
  const filePath = leasePath(pmDir, lease.card_id, lease.stage);
  if (fs.existsSync(filePath)) {
    const existing = readJsonFile(filePath);
    if (!isLeaseExpired(existing, options.now instanceof Date ? options.now : new Date())) {
      return {
        ok: false,
        reason: "active-lease",
        lease: existing,
        filePath,
      };
    }
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      lease,
      filePath,
    };
  }

  writeJsonAtomic(filePath, lease);
  return {
    ok: true,
    lease,
    filePath,
  };
}

function ensureGitSyncReady(gitRoot, pmDir) {
  const remote = runGit(["remote"], gitRoot);
  if (!remote) throw new Error("git sync required for loop mutation, but no remote is configured");

  try {
    runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], gitRoot);
  } catch {
    throw new Error("git sync required for loop mutation, but the branch has no upstream");
  }

  const loopRel = path.relative(gitRoot, path.join(pmDir, "loop")) || ".";
  const status = runGit(["status", "--porcelain", "--", loopRel], gitRoot);
  if (status) {
    throw new Error(
      `pm/loop has uncommitted changes; sync or commit before claiming a lease:\n${status}`
    );
  }
}

function stagedNames(gitRoot, relPath) {
  const out = runGit(["diff", "--cached", "--name-only", "--", relPath], gitRoot);
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}

function claimLease(pmDir, input, config = DEFAULT_LOOP_CONFIG, options = {}) {
  const gitRoot = options.gitRoot || findGitRoot(pmDir);
  if (!gitRoot) throw new Error(`Cannot find git root for ${pmDir}`);

  if (config.sync_required_for_mutation !== false && !options.allowUnsynced) {
    ensureGitSyncReady(gitRoot, pmDir);
  }

  if (!options.skipPull) {
    runGit(["pull", "--rebase"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
  }

  const prepared = prepareLease(pmDir, input, config, options);
  if (!prepared.ok) return prepared;

  const relPath = path.relative(gitRoot, prepared.filePath);
  runGit(["add", "--", relPath], gitRoot);

  const staged = stagedNames(gitRoot, relPath);
  if (staged.length !== 1 || staged[0] !== relPath) {
    throw new Error(`lease claim must stage exactly ${relPath}; staged: ${staged.join(", ")}`);
  }

  const msg = `pm loop lease ${prepared.lease.card_id} ${prepared.lease.stage}`;
  runGit(["commit", "-m", msg, "--", relPath], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });

  if (!options.skipPush) {
    runGit(["push"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
  }

  return {
    ...prepared,
    gitRoot,
    committed: true,
    pushed: !options.skipPush,
  };
}

function parseArgs(argv) {
  const args = {
    action: argv[0] || "list",
    pmDir: path.join(process.cwd(), "pm"),
    cardId: "",
    stage: "work",
    holder: os.hostname(),
    sourcePath: "",
    dryRun: false,
    skipPull: false,
    skipPush: false,
    allowUnsynced: false,
  };

  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--pm-dir" && argv[index + 1]) {
      args.pmDir = path.resolve(argv[++index]);
    } else if (arg === "--card-id" && argv[index + 1]) {
      args.cardId = argv[++index];
    } else if (arg === "--stage" && argv[index + 1]) {
      args.stage = argv[++index];
    } else if (arg === "--holder" && argv[index + 1]) {
      args.holder = argv[++index];
    } else if (arg === "--source-path" && argv[index + 1]) {
      args.sourcePath = argv[++index];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--skip-pull") {
      args.skipPull = true;
    } else if (arg === "--skip-push") {
      args.skipPush = true;
    } else if (arg === "--allow-unsynced") {
      args.allowUnsynced = true;
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.action === "list") {
      process.stdout.write(`${JSON.stringify(listLeases(args.pmDir), null, 2)}\n`);
      return;
    }

    if (args.action === "claim") {
      const config = loadLoopConfig(args.pmDir);
      const result = args.dryRun
        ? prepareLease(
            args.pmDir,
            {
              cardId: args.cardId,
              stage: args.stage,
              holder: args.holder,
              sourcePath: args.sourcePath,
            },
            config,
            { dryRun: true }
          )
        : claimLease(
            args.pmDir,
            {
              cardId: args.cardId,
              stage: args.stage,
              holder: args.holder,
              sourcePath: args.sourcePath,
            },
            config,
            {
              skipPull: args.skipPull,
              skipPush: args.skipPush,
              allowUnsynced: args.allowUnsynced,
            }
          );
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.ok ? 0 : 2);
      return;
    }

    throw new Error(`Unknown action: ${args.action}`);
  } catch (err) {
    process.stderr.write(`loop-git: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  activeLeaseFor,
  buildLease,
  canClaimLease,
  claimLease,
  cleanGitEnv,
  ensureGitSyncReady,
  findGitRoot,
  isLeaseExpired,
  leaseFileName,
  leasePath,
  listLeases,
  prepareLease,
  runGit,
  sanitizeId,
  writeJsonAtomic,
};

if (require.main === module) {
  main();
}
