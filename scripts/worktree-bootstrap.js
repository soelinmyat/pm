#!/usr/bin/env node
"use strict";

// worktree-bootstrap.js — copy gitignored-but-required files into a fresh
// worktree and run an optional bootstrap command, driven by the SAME
// `worker.bootstrap_files` / `worker.bootstrap_command` keys in
// pm/loop/config.json that the loop worker uses.
//
// This is the single source of truth for that "prime a fresh worktree" step.
// The loop worker (scripts/loop-worker.js) calls bootstrapWorktree() directly;
// the dev worktree flow (skills/dev) shells the CLI after `git worktree add`.
// Fresh worktrees miss env files and generated specs — the top recurring
// field failure — so both paths prime them identically.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { loadLoopConfig } = require("./loop-config.js");

const MAX_BUFFER = 32 * 1024 * 1024;
const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;

// Copy worker.bootstrap_files from gitRoot into worktree, then run
// worker.bootstrap_command in the worktree. Returns:
//   { ok: true, copied: [...] }                       on success
//   { ok: false, reason: "bootstrap-command-failed", error } on command failure
function bootstrapWorktree(gitRoot, worktree, worker = {}, options = {}) {
  const timeout = options.timeoutMs || BOOTSTRAP_TIMEOUT_MS;
  const maxBuffer = options.maxBuffer || MAX_BUFFER;

  const copied = [];
  for (const rel of worker.bootstrap_files || []) {
    const dest = path.join(worktree, rel);
    // Refuse anything that would write outside the worktree (e.g. "../x").
    const relToWorktree = path.relative(worktree, dest);
    if (relToWorktree.startsWith("..") || path.isAbsolute(relToWorktree)) {
      return {
        ok: false,
        reason: "bootstrap-file-outside-worktree",
        error: `refusing to write outside the worktree: ${rel}`,
      };
    }
    const source = path.join(gitRoot, rel);
    if (!fs.existsSync(source)) continue;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(source, dest, { recursive: true });
    } catch (err) {
      return {
        ok: false,
        reason: "bootstrap-copy-failed",
        error: String(err.message || err).slice(0, 2000),
      };
    }
    copied.push(rel);
  }

  if (worker.bootstrap_command) {
    const result = spawnSync("bash", ["-c", worker.bootstrap_command], {
      cwd: worktree,
      encoding: "utf8",
      timeout,
      maxBuffer,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        reason: "bootstrap-command-failed",
        error: (result.stderr || result.error?.message || "").slice(0, 2000),
      };
    }
  }

  return { ok: true, copied };
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--git-root") {
      options.gitRoot = argv[i + 1];
      i += 1;
    } else if (token === "--worktree") {
      options.worktree = argv[i + 1];
      i += 1;
    } else if (token === "--pm-dir") {
      options.pmDir = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

function main() {
  const { gitRoot, worktree, pmDir } = parseArgs(process.argv.slice(2));
  if (!gitRoot || !worktree || !pmDir) {
    process.stderr.write(
      "worktree-bootstrap: --git-root, --worktree, and --pm-dir are all required\n"
    );
    process.exit(2);
  }

  // Repos without a loop config get the frozen defaults (empty bootstrap_files,
  // empty bootstrap_command) — so this is a silent no-op there.
  const config = loadLoopConfig(pmDir);
  const worker = config.worker || {};

  const result = bootstrapWorktree(gitRoot, worktree, worker);
  if (!result.ok) {
    process.stderr.write(`worktree-bootstrap: ${result.reason}: ${result.error}\n`);
    process.exit(1);
  }
  if (result.copied.length) {
    process.stdout.write(`Bootstrapped worktree: copied ${result.copied.join(", ")}\n`);
  }
}

module.exports = { bootstrapWorktree };

if (require.main === module) {
  main();
}
