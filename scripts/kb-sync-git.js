"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: "utf8",
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function runSafe(cmd, opts = {}) {
  try {
    return { ok: true, output: run(cmd, opts) };
  } catch (err) {
    return { ok: false, output: "", error: err.stderr || err.message || String(err) };
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isGitRepo(pmDir) {
  const gitDir = path.join(pmDir, ".git");
  try {
    return fs.statSync(gitDir).isDirectory();
  } catch {
    return false;
  }
}

function hasRemote(pmDir) {
  if (!isGitRepo(pmDir)) return false;
  const result = runSafe("git remote", { cwd: pmDir });
  return result.ok && result.output.length > 0;
}

function getRemoteUrl(pmDir) {
  if (!hasRemote(pmDir)) return null;
  const result = runSafe("git remote get-url origin", { cwd: pmDir });
  return result.ok ? result.output : null;
}

// ---------------------------------------------------------------------------
// Setup — initialize pm/ as a git repo and configure remote
// ---------------------------------------------------------------------------

/**
 * Initialize pm/ as a git repo with a remote.
 * @param {string} pmDir - path to pm/ directory
 * @param {string} remoteUrl - git remote URL
 * @param {object} [opts]
 * @param {string} [opts.branch] - branch name (default: "main")
 * @returns {{ ok: boolean, error?: string }}
 */
function setup(pmDir, remoteUrl, opts = {}) {
  const branch = opts.branch || "main";

  if (!fs.existsSync(pmDir)) {
    return { ok: false, error: `pm directory does not exist: ${pmDir}` };
  }

  // If pm/ has content but no git, init and push
  if (!isGitRepo(pmDir)) {
    const init = runSafe("git init", { cwd: pmDir });
    if (!init.ok) return { ok: false, error: `git init failed: ${init.error}` };

    runSafe(`git checkout -b ${branch}`, { cwd: pmDir });
  }

  // Set or update remote
  if (hasRemote(pmDir)) {
    runSafe(`git remote set-url origin ${remoteUrl}`, { cwd: pmDir });
  } else {
    const addRemote = runSafe(`git remote add origin ${remoteUrl}`, { cwd: pmDir });
    if (!addRemote.ok) return { ok: false, error: `git remote add failed: ${addRemote.error}` };
  }

  // Create .gitignore for pm-internal files that shouldn't sync
  const gitignorePath = path.join(pmDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*.local-conflict\n");
  }

  // Initial commit if no commits yet
  const hasCommits = runSafe("git rev-parse HEAD", { cwd: pmDir });
  if (!hasCommits.ok) {
    runSafe("git add -A", { cwd: pmDir });
    const commit = runSafe('git commit -m "Initial KB commit"', { cwd: pmDir });
    if (!commit.ok && !commit.error.includes("nothing to commit")) {
      return { ok: false, error: `initial commit failed: ${commit.error}` };
    }
  }

  // Push — set upstream
  const pushResult = runSafe(`git push -u origin ${branch}`, { cwd: pmDir });
  if (!pushResult.ok) {
    // Might be empty remote — try without upstream tracking
    const pushRetry = runSafe(`git push --set-upstream origin ${branch}`, { cwd: pmDir });
    if (!pushRetry.ok) {
      return { ok: false, error: `push failed: ${pushRetry.error}` };
    }
  }

  return { ok: true };
}

/**
 * Clone a remote repo into pm/.
 * Use when pm/ doesn't exist or is empty and the user is connecting to an existing repo.
 * @param {string} pmDir - target path for pm/
 * @param {string} remoteUrl - git remote URL
 * @param {object} [opts]
 * @param {string} [opts.branch] - branch name (default: "main")
 * @returns {{ ok: boolean, error?: string }}
 */
function clone(pmDir, remoteUrl, opts = {}) {
  const branch = opts.branch || "main";

  // If pmDir exists and has files, don't clobber
  if (fs.existsSync(pmDir)) {
    try {
      const entries = fs.readdirSync(pmDir);
      if (entries.length > 0) {
        return { ok: false, error: "pm/ already has content. Use setup instead of clone." };
      }
    } catch {
      // If we can't read it, let git clone fail naturally
    }
  }

  // Remove empty dir so git clone can create it
  if (fs.existsSync(pmDir)) {
    fs.rmdirSync(pmDir);
  }

  const cloneResult = runSafe(`git clone --branch ${branch} ${remoteUrl} ${pmDir}`);
  if (!cloneResult.ok) {
    // Branch might not exist yet — try without --branch
    const cloneRetry = runSafe(`git clone ${remoteUrl} ${pmDir}`);
    if (!cloneRetry.ok) {
      return { ok: false, error: `clone failed: ${cloneRetry.error}` };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Push — stage, commit, push
// ---------------------------------------------------------------------------

/**
 * @param {string} pmDir
 * @returns {{ ok: boolean, committed: number, error?: string }}
 */
function push(pmDir) {
  if (!isGitRepo(pmDir)) {
    return { ok: false, committed: 0, error: "pm/ is not a git repo. Run setup first." };
  }

  if (!hasRemote(pmDir)) {
    return { ok: false, committed: 0, error: "No remote configured. Run setup first." };
  }

  // Stage all changes
  runSafe("git add -A", { cwd: pmDir });

  // Check if there's anything to commit
  const diff = runSafe("git diff --cached --numstat", { cwd: pmDir });
  const changedFiles = diff.ok && diff.output ? diff.output.split("\n").length : 0;

  if (changedFiles === 0) {
    // Nothing to commit — still push in case there are unpushed commits
    const pushResult = runSafe("git push", { cwd: pmDir });
    if (!pushResult.ok && !pushResult.error.includes("Everything up-to-date")) {
      return { ok: false, committed: 0, error: `push failed: ${pushResult.error}` };
    }
    return { ok: true, committed: 0 };
  }

  // Commit
  const timestamp = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
  const commitResult = runSafe(`git commit -m "kb: sync ${timestamp}"`, { cwd: pmDir });
  if (!commitResult.ok) {
    return { ok: false, committed: 0, error: `commit failed: ${commitResult.error}` };
  }

  // Push
  const pushResult = runSafe("git push", { cwd: pmDir });
  if (!pushResult.ok) {
    return { ok: false, committed: changedFiles, error: `push failed: ${pushResult.error}` };
  }

  return { ok: true, committed: changedFiles };
}

// ---------------------------------------------------------------------------
// Pull — fetch and merge
// ---------------------------------------------------------------------------

/**
 * @param {string} pmDir
 * @returns {{ ok: boolean, updated: number, error?: string }}
 */
function pull(pmDir) {
  if (!isGitRepo(pmDir)) {
    return { ok: false, updated: 0, error: "pm/ is not a git repo. Run setup first." };
  }

  if (!hasRemote(pmDir)) {
    return { ok: false, updated: 0, error: "No remote configured. Run setup first." };
  }

  // Stash any uncommitted changes before pulling
  const stashResult = runSafe("git stash --include-untracked", { cwd: pmDir });
  const didStash = stashResult.ok && !stashResult.output.includes("No local changes");

  // Pull
  const pullResult = runSafe("git pull --rebase origin main", { cwd: pmDir });
  if (!pullResult.ok) {
    // Abort rebase if it failed mid-way
    runSafe("git rebase --abort", { cwd: pmDir });
    if (didStash) runSafe("git stash pop", { cwd: pmDir });
    return { ok: false, updated: 0, error: `pull failed: ${pullResult.error}` };
  }

  // Count updated files from pull output
  let updated = 0;
  const match = pullResult.output.match(/(\d+) files? changed/);
  if (match) updated = parseInt(match[1], 10);

  // Pop stash
  if (didStash) {
    const popResult = runSafe("git stash pop", { cwd: pmDir });
    if (!popResult.ok && popResult.error.includes("CONFLICT")) {
      return {
        ok: true,
        updated,
        error: "Pull succeeded but stash pop had conflicts. Resolve manually.",
      };
    }
  }

  return { ok: true, updated };
}

// ---------------------------------------------------------------------------
// Status — report sync state
// ---------------------------------------------------------------------------

/**
 * @param {string} pmDir
 * @returns {{ ok: boolean, remote?: string, branch?: string, uncommitted?: number, ahead?: number, behind?: number, error?: string }}
 */
function status(pmDir) {
  if (!isGitRepo(pmDir)) {
    return { ok: false, error: "pm/ is not a git repo. Run `/pm:sync` to set up." };
  }

  const remote = getRemoteUrl(pmDir) || "(none)";

  // Current branch
  const branchResult = runSafe("git branch --show-current", { cwd: pmDir });
  const branch = branchResult.ok ? branchResult.output : "unknown";

  // Uncommitted changes
  const statusResult = runSafe("git status --porcelain", { cwd: pmDir });
  const uncommitted =
    statusResult.ok && statusResult.output ? statusResult.output.split("\n").length : 0;

  // Ahead/behind — requires fetch first
  runSafe("git fetch origin --quiet", { cwd: pmDir });
  const abResult = runSafe(`git rev-list --left-right --count origin/${branch}...HEAD`, {
    cwd: pmDir,
  });
  let ahead = 0;
  let behind = 0;
  if (abResult.ok && abResult.output) {
    const parts = abResult.output.split(/\s+/);
    behind = parseInt(parts[0], 10) || 0;
    ahead = parseInt(parts[1], 10) || 0;
  }

  return { ok: true, remote, branch, uncommitted, ahead, behind };
}

// ---------------------------------------------------------------------------
// writeSyncStatus — persist result to .pm/sync-status.json (same format as server sync)
// ---------------------------------------------------------------------------

function writeSyncStatus(dotPmDir, result) {
  const status = {
    lastSync: new Date().toISOString(),
    mode: result.mode,
    backend: "git",
    uploaded: result.uploaded || 0,
    downloaded: result.downloaded || 0,
    errors: result.errors || [],
    ok: result.ok,
  };

  fs.mkdirSync(dotPmDir, { recursive: true });
  fs.writeFileSync(path.join(dotPmDir, "sync-status.json"), JSON.stringify(status, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the git repo to sync and the .pm state dir for CLI invocation.
 *
 * Supports both same-repo and separate-repo layouts:
 * - Same-repo: `{projectDir}/pm/` is its own git repo → sync that dir.
 * - Separate-repo nested: `{pm-repo-root}/pm/` holds content; `.git` lives at
 *   the pm-repo-root → sync the pm-repo-root.
 * - Separate-repo flat: content sits directly at `{pm-repo-root}/`; `.git` also
 *   at the root → sync the pm-repo-root.
 */
function resolveCliPaths(projectDir) {
  const { pmDir: pmContentDir, pmStateDir } = resolvePmPaths(projectDir);

  // Prefer the pm-content dir if it is itself a git repo. Otherwise fall back
  // to its parent (separate-repo layouts where the PM repo root holds `.git`).
  let pmDir = pmContentDir;
  if (!isGitRepo(pmContentDir) && isGitRepo(path.dirname(pmContentDir))) {
    pmDir = path.dirname(pmContentDir);
  }

  return { pmDir, dotPmDir: pmStateDir };
}

if (require.main === module) {
  const mode = process.argv[2];
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
  const { pmDir, dotPmDir } = resolveCliPaths(projectDir);

  if (mode === "push") {
    const result = push(pmDir);
    writeSyncStatus(dotPmDir, {
      mode: "push",
      uploaded: result.committed || 0,
      errors: result.error ? [result.error] : [],
      ok: result.ok,
    });
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  } else if (mode === "pull") {
    const result = pull(pmDir);
    writeSyncStatus(dotPmDir, {
      mode: "pull",
      downloaded: result.updated || 0,
      errors: result.error ? [result.error] : [],
      ok: result.ok,
    });
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  } else if (mode === "status") {
    const result = status(pmDir);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stderr.write("Usage: kb-sync-git.js <push|pull|status>\n");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  isGitRepo,
  hasRemote,
  getRemoteUrl,
  setup,
  clone,
  push,
  pull,
  status,
  writeSyncStatus,
  resolveCliPaths,
};
