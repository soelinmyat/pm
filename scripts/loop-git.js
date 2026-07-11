#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const { parseCliArgs } = require("./loop-args.js");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { DEFAULT_LOOP_CONFIG, leaseTtlSeconds, loadLoopConfig } = require("./loop-config.js");

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
    // Bounds callers that run git off a request path (e.g. the board's async
    // kill-switch push / fetch); undefined leaves execFileSync unbounded.
    timeout: options.timeout,
  }).trim();
}

function readGitFile(commit, relativePath, cwd, options = {}) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
    env: cleanGitEnv(),
    timeout: options.timeout,
  });
}

function realpathForGit(targetPath) {
  const parts = [];
  let cursor = path.resolve(targetPath);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    parts.unshift(path.basename(cursor));
    cursor = parent;
  }

  let resolved = fs.existsSync(cursor) ? fs.realpathSync(cursor) : path.resolve(cursor);
  for (const part of parts) {
    resolved = path.join(resolved, part);
  }
  return resolved;
}

function gitRelativePath(gitRoot, targetPath) {
  const root = realpathForGit(gitRoot);
  const target = realpathForGit(targetPath);
  const rel = path.relative(root, target);
  if (!rel || rel === "") return ".";
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path ${targetPath} is outside git root ${gitRoot}`);
  }
  return rel;
}

function findGitRoot(startDir) {
  try {
    const out = runGit(["rev-parse", "--show-toplevel"], startDir);
    return out ? realpathForGit(out) : null;
  } catch {
    return null;
  }
}

function removeWorkspace(gitRoot, workspacePath, options = {}) {
  try {
    runGit(["worktree", "remove", "--force", workspacePath], gitRoot, {
      timeout: options.timeout,
    });
    return true;
  } catch {
    return false;
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

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new Error(`Invalid JSON at ${filePath}: ${err.message}`);
  }
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
  const ttl = leaseTtlSeconds(config);
  const cardId = input.cardId || input.card_id;
  const stage = input.stage || "work";
  if (!cardId) throw new Error("lease requires cardId");
  const runId = input.runId || input.run_id || `loop-${crypto.randomUUID()}`;

  return {
    version: 2,
    card_id: cardId,
    stage,
    holder: input.holder || os.hostname(),
    runtime: input.runtime || config.default_runtime || "codex",
    source_path: input.sourcePath || input.source_path || "",
    claimed_at: nowIso(now),
    expires_at: nowIso(addSeconds(now, ttl)),
    run_id: runId,
    phase: input.phase || "claimed",
    expected_card_revision: input.expectedCardRevision || input.expected_card_revision || "",
    config_fingerprint: input.configFingerprint || input.config_fingerprint || "",
    upstream_oid: input.upstreamOid || input.upstream_oid || "",
  };
}

function canClaimLease(pmDir, input, options = {}) {
  const existing = activeLeaseFor(pmDir, input.cardId || input.card_id, null, options);
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

  const loopRel = gitRelativePath(gitRoot, path.join(pmDir, "loop"));
  const status = runGit(["status", "--porcelain", "--", loopRel], gitRoot);
  if (status) {
    throw new Error(
      `pm/loop has uncommitted changes; sync or commit before claiming a lease:\n${status}`
    );
  }
}

function cleanupFailedLeaseCommit(gitRoot, relPath, commitHash) {
  const head = runGit(["rev-parse", "HEAD"], gitRoot);
  if (head !== commitHash) {
    return {
      cleaned: false,
      cleanup_error: `HEAD moved after lease commit (${head}); expected ${commitHash}`,
    };
  }

  runGit(["reset", "--soft", "HEAD~1"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
  runGit(["restore", "--staged", "--worktree", "--", relPath], gitRoot, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { cleaned: true };
}

function claimLease(pmDir, input, config = DEFAULT_LOOP_CONFIG, options = {}) {
  // Loaded lazily so loop-pm-transaction.js can reuse the low-level Git and
  // lease helpers above without a module-initialization cycle.
  const { claimRun } = require("./loop-pm-transaction.js");
  return claimRun(pmDir, input, config, options);
}

function parseArgs(argv) {
  const action = argv[0] && !argv[0].startsWith("--") ? argv[0] : "list";
  const optionArgv = action === argv[0] ? argv.slice(1) : argv;
  const defaults = {
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
  defaults.action = action;
  const { args, positionals } = parseCliArgs(
    optionArgv,
    {
      "--pm-dir": { key: "pmDir", type: "string" },
      "--card-id": { key: "cardId", type: "string" },
      "--stage": { key: "stage", type: "string" },
      "--holder": { key: "holder", type: "string" },
      "--source-path": { key: "sourcePath", type: "string" },
      "--dry-run": { key: "dryRun", type: "boolean" },
      "--skip-pull": { key: "skipPull", type: "boolean" },
      "--skip-push": { key: "skipPush", type: "boolean" },
      "--allow-unsynced": { key: "allowUnsynced", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.pmDir = path.resolve(args.pmDir);
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
  cleanupFailedLeaseCommit,
  ensureGitSyncReady,
  findGitRoot,
  gitRelativePath,
  isLeaseExpired,
  leaseFileName,
  leasePath,
  listLeases,
  prepareLease,
  readGitFile,
  removeWorkspace,
  runGit,
  sanitizeId,
  writeJsonAtomic,
};

if (require.main === module) {
  main();
}
