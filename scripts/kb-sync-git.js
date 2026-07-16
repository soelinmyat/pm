"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { runGit } = require("./loop-git.js");
const { writeJsonAtomic } = require("./lib/atomic-file.js");
const {
  runOperationalEffect,
  sharedGitRepositorySerialization,
} = require("./lib/operational-effect-journal.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runGitSafe(args, cwd) {
  try {
    return { ok: true, output: runGit(args, cwd, { timeout: 30000 }) };
  } catch (err) {
    const detail = err.stderr || err.message || String(err);
    return { ok: false, output: "", error: String(detail).trim() };
  }
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function isGitRepo(pmDir) {
  const topLevel = runGitSafe(["rev-parse", "--show-toplevel"], pmDir);
  if (!topLevel.ok || !topLevel.output) return false;
  const canonical = (value) => {
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return canonical(topLevel.output) === canonical(pmDir);
}

function hasRemote(pmDir) {
  if (!isGitRepo(pmDir)) return false;
  const result = runGitSafe(["remote"], pmDir);
  return result.ok && result.output.length > 0;
}

function getRemoteUrl(pmDir) {
  if (!hasRemote(pmDir)) return null;
  const upstream = resolveUpstream(pmDir);
  const remotes = runGitSafe(["remote"], pmDir);
  const remote = upstream.ok
    ? upstream.remote
    : remotes.ok && remotes.output.split("\n").includes("origin")
      ? "origin"
      : remotes.output.split("\n")[0];
  if (!remote) return null;
  const result = runGitSafe(["remote", "get-url", remote], pmDir);
  return result.ok ? result.output : null;
}

function currentBranch(pmDir) {
  const result = runGitSafe(["symbolic-ref", "--quiet", "--short", "HEAD"], pmDir);
  if (!result.ok || !result.output) {
    return {
      ok: false,
      error:
        "Knowledge-base repository is in detached HEAD state. Check out a branch, then retry sync.",
    };
  }
  return { ok: true, branch: result.output };
}

function resolveUpstream(pmDir) {
  const current = currentBranch(pmDir);
  if (!current.ok) return current;
  const remote = runGitSafe(["config", "--get", `branch.${current.branch}.remote`], pmDir);
  const merge = runGitSafe(["config", "--get", `branch.${current.branch}.merge`], pmDir);
  if (!remote.ok || !remote.output || !merge.ok || !merge.output) {
    return {
      ok: false,
      branch: current.branch,
      error:
        `Current branch '${current.branch}' has no upstream. ` +
        "Run `git push --set-upstream <remote> <branch>` or `/pm:sync setup`, then retry.",
    };
  }
  if (remote.output === "." || !merge.output.startsWith("refs/heads/")) {
    return {
      ok: false,
      branch: current.branch,
      error:
        `Current branch '${current.branch}' does not track a remote branch. ` +
        "Configure a remote upstream with `git push --set-upstream <remote> <branch>`, then retry.",
    };
  }
  const remoteUrl = runGitSafe(["remote", "get-url", remote.output], pmDir);
  if (!remoteUrl.ok) {
    return {
      ok: false,
      branch: current.branch,
      error: `Configured upstream remote '${remote.output}' is unavailable. Run \`/pm:sync setup\` to repair it.`,
    };
  }
  const remoteBranch = merge.output.slice("refs/heads/".length);
  return {
    ok: true,
    branch: current.branch,
    remote: remote.output,
    remoteBranch,
    ref: `${remote.output}/${remoteBranch}`,
    remoteUrl: remoteUrl.output,
  };
}

function parentRepositoryOwnership(pmDir) {
  const topLevel = runGitSafe(["rev-parse", "--show-toplevel"], pmDir);
  if (!topLevel.ok || !topLevel.output) return { owned: false };
  const parentRoot = fs.realpathSync(topLevel.output);
  const target = fs.realpathSync(pmDir);
  if (parentRoot === target) return { owned: false };
  const relative = path.relative(parentRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return { owned: false };
  const tracked = runGitSafe(["ls-files", "--", relative.split(path.sep).join("/")], parentRoot);
  return { owned: tracked.ok && Boolean(tracked.output), parentRoot };
}

function validateRemoteUrl(remoteUrl) {
  return (
    typeof remoteUrl === "string" &&
    remoteUrl.length > 0 &&
    remoteUrl.length <= 2048 &&
    remoteUrl.trim() === remoteUrl &&
    !remoteUrl.startsWith("-") &&
    !/[\0\r\n]/.test(remoteUrl)
  );
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
  if (!validateRemoteUrl(remoteUrl)) {
    return { ok: false, error: "remote URL contains unsupported or unsafe characters" };
  }

  if (!fs.existsSync(pmDir)) {
    return { ok: false, error: `pm directory does not exist: ${pmDir}` };
  }

  // If pm/ has content but no git, init and push
  if (!isGitRepo(pmDir)) {
    const ownership = parentRepositoryOwnership(pmDir);
    if (ownership.owned) {
      return {
        ok: false,
        error:
          `pm/ is owned by the parent Git repository at ${ownership.parentRoot}; ` +
          "refusing to create an ambiguous nested repository. Keep same-repo ownership, or run `/pm:setup separate-repo` before configuring sync.",
      };
    }
    const init = runGitSafe(["init"], pmDir);
    if (!init.ok) return { ok: false, error: `git init failed: ${init.error}` };

    const checkout = runGitSafe(["checkout", "-b", opts.branch || "main"], pmDir);
    if (!checkout.ok) return { ok: false, error: `branch creation failed: ${checkout.error}` };
  }

  const current = currentBranch(pmDir);
  if (!current.ok) return { ok: false, error: current.error };
  const branch = current.branch;

  // Set or update remote
  if (hasRemote(pmDir)) {
    const setRemote = runGitSafe(["remote", "set-url", "origin", remoteUrl], pmDir);
    if (!setRemote.ok) {
      return { ok: false, error: `git remote set-url failed: ${setRemote.error}` };
    }
  } else {
    const addRemote = runGitSafe(["remote", "add", "origin", remoteUrl], pmDir);
    if (!addRemote.ok) return { ok: false, error: `git remote add failed: ${addRemote.error}` };
  }

  // Create .gitignore for pm-internal files and common OS/IDE noise that shouldn't sync
  const gitignorePath = path.join(pmDir, ".gitignore");
  const createdGitignore = !fs.existsSync(gitignorePath);
  if (createdGitignore) {
    fs.writeFileSync(
      gitignorePath,
      ["*.local-conflict", ".DS_Store", "Thumbs.db", ".trash/", ".idea/", ".vscode/", ""].join("\n")
    );
  }

  // Initial commit if no commits yet
  const hasCommits = runGitSafe(["rev-parse", "HEAD"], pmDir);
  if (!hasCommits.ok) {
    const add = runGitSafe(["add", "-A"], pmDir);
    if (!add.ok) return { ok: false, error: `initial add failed: ${add.error}` };
    const commit = runGitSafe(["commit", "-m", "Initial KB commit"], pmDir);
    if (!commit.ok && !commit.error.includes("nothing to commit")) {
      return { ok: false, error: `initial commit failed: ${commit.error}` };
    }
  } else if (createdGitignore) {
    const addIgnore = runGitSafe(["add", "--", ".gitignore"], pmDir);
    if (!addIgnore.ok) return { ok: false, error: `git add .gitignore failed: ${addIgnore.error}` };
    const commitIgnore = runGitSafe(
      ["commit", "-m", "Configure KB sync ignores", "--", ".gitignore"],
      pmDir
    );
    if (!commitIgnore.ok) {
      return { ok: false, error: `gitignore commit failed: ${commitIgnore.error}` };
    }
  }

  // Push — set upstream
  const pushResult = runGitSafe(["push", "-u", "origin", branch], pmDir);
  if (!pushResult.ok) {
    // Might be empty remote — try without upstream tracking
    const pushRetry = runGitSafe(["push", "--set-upstream", "origin", branch], pmDir);
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

  if (!validateRemoteUrl(remoteUrl)) {
    return { ok: false, error: "remote URL contains unsupported or unsafe characters" };
  }

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

  const cloneCwd = path.dirname(pmDir);
  const cloneResult = runGitSafe(["clone", "--branch", branch, "--", remoteUrl, pmDir], cloneCwd);
  if (!cloneResult.ok) {
    // Branch might not exist yet — try without --branch
    const cloneRetry = runGitSafe(["clone", "--", remoteUrl, pmDir], cloneCwd);
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

  const upstream = resolveUpstream(pmDir);
  if (!upstream.ok) return { ok: false, committed: 0, error: upstream.error };

  // Stage all changes
  const add = runGitSafe(["add", "-A"], pmDir);
  if (!add.ok) return { ok: false, committed: 0, error: `git add failed: ${add.error}` };

  // Check if there's anything to commit
  const diff = runGitSafe(["diff", "--cached", "--numstat"], pmDir);
  const changedFiles = diff.ok && diff.output ? diff.output.split("\n").length : 0;

  if (changedFiles === 0) {
    // Nothing to commit — still push in case there are unpushed commits
    const pushResult = pushWithAutoRebase(pmDir);
    if (!pushResult.ok) {
      return { ok: false, committed: 0, error: pushResult.error };
    }
    return { ok: true, committed: 0 };
  }

  // Commit
  const timestamp = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
  const commitResult = runGitSafe(["commit", "-m", `kb: sync ${timestamp}`], pmDir);
  if (!commitResult.ok) {
    return { ok: false, committed: 0, error: `commit failed: ${commitResult.error}` };
  }

  // Push (auto-pull-rebase on non-fast-forward)
  const pushResult = pushWithAutoRebase(pmDir);
  if (!pushResult.ok) {
    return { ok: false, committed: changedFiles, error: pushResult.error };
  }

  return { ok: true, committed: changedFiles };
}

/**
 * Push to the current branch's configured upstream. If the push is rejected because remote has new commits,
 * automatically pull --rebase and retry once. This makes push idempotent
 * against concurrent commits from another machine.
 */
function pushWithAutoRebase(pmDir) {
  const upstream = resolveUpstream(pmDir);
  if (!upstream.ok) return { ok: false, error: upstream.error };
  const pushArgs = ["push", upstream.remote, `HEAD:refs/heads/${upstream.remoteBranch}`];
  const first = runGitSafe(pushArgs, pmDir);
  if (first.ok || first.error.includes("Everything up-to-date")) {
    return { ok: true };
  }

  const isNonFF =
    /non-fast-forward|rejected|fetch first|tip of your current branch is behind/i.test(first.error);
  if (!isNonFF) {
    return { ok: false, error: `push failed: ${first.error}` };
  }

  // Remote has new commits — rebase our local commits on top, then retry.
  const rebase = runGitSafe(
    ["pull", "--rebase", "--autostash", upstream.remote, upstream.remoteBranch],
    pmDir
  );
  if (!rebase.ok) {
    runGitSafe(["rebase", "--abort"], pmDir);
    return { ok: false, error: `push rejected; auto-rebase failed: ${rebase.error}` };
  }

  const second = runGitSafe(pushArgs, pmDir);
  if (!second.ok && !second.error.includes("Everything up-to-date")) {
    return { ok: false, error: `push failed after rebase: ${second.error}` };
  }
  return { ok: true };
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

  const upstream = resolveUpstream(pmDir);
  if (!upstream.ok) return { ok: false, updated: 0, error: upstream.error };

  // --autostash: git stashes uncommitted changes, rebases, then pops automatically.
  // Cleaner than manual stash/pop and handles untracked files via .gitignore.
  const pullResult = runGitSafe(
    ["pull", "--rebase", "--autostash", upstream.remote, upstream.remoteBranch],
    pmDir
  );
  if (!pullResult.ok) {
    runGitSafe(["rebase", "--abort"], pmDir);
    return { ok: false, updated: 0, error: `pull failed: ${pullResult.error}` };
  }

  let updated = 0;
  const match = pullResult.output.match(/(\d+) files? changed/);
  if (match) updated = parseInt(match[1], 10);

  return { ok: true, updated };
}

// ---------------------------------------------------------------------------
// Sync — pull first, then push
// ---------------------------------------------------------------------------

/**
 * Bidirectional sync for the default /pm:sync path.
 * Pulling first prevents a local push from racing or overwriting remote work
 * created on another machine.
 *
 * @param {string} pmDir
 * @returns {{ ok: boolean, downloaded: number, uploaded: number, errors: string[], error?: string }}
 */
function sync(pmDir) {
  const pullResult = pull(pmDir);
  if (!pullResult.ok) {
    return {
      ok: false,
      downloaded: pullResult.updated || 0,
      uploaded: 0,
      errors: [pullResult.error],
      error: pullResult.error,
    };
  }

  const pushResult = push(pmDir);
  if (!pushResult.ok) {
    return {
      ok: false,
      downloaded: pullResult.updated || 0,
      uploaded: pushResult.committed || 0,
      errors: [pushResult.error],
      error: pushResult.error,
    };
  }

  return {
    ok: true,
    downloaded: pullResult.updated || 0,
    uploaded: pushResult.committed || 0,
    errors: [],
  };
}

// ---------------------------------------------------------------------------
// Status — report sync state
// ---------------------------------------------------------------------------

/**
 * @param {string} pmDir
 * This is deliberately a local observation. Refreshing remote-tracking refs is
 * a network mutation and belongs to an explicit sync route, never status.
 * @returns {{ ok: boolean, remote?: string, branch?: string, uncommitted?: number, ahead?: number, behind?: number, observation?: string, refresh_action?: string, error?: string }}
 */
function status(pmDir) {
  if (!isGitRepo(pmDir)) {
    return { ok: false, error: "pm/ is not a git repo. Run `/pm:sync` to set up." };
  }

  const upstream = resolveUpstream(pmDir);
  if (!upstream.ok) return { ok: false, error: upstream.error };
  const remote = upstream.remoteUrl;
  const branch = upstream.branch;

  // Uncommitted changes
  const statusResult = runGitSafe(["status", "--porcelain"], pmDir);
  const uncommitted =
    statusResult.ok && statusResult.output ? statusResult.output.split("\n").length : 0;

  // Ahead/behind relative to the last locally observed remote-tracking ref.
  const abResult = runGitSafe(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], pmDir);
  let ahead = 0;
  let behind = 0;
  if (abResult.ok && abResult.output) {
    const parts = abResult.output.split(/\s+/);
    behind = parseInt(parts[0], 10) || 0;
    ahead = parseInt(parts[1], 10) || 0;
  }

  return {
    ok: true,
    remote,
    branch,
    upstream: upstream.ref,
    uncommitted,
    ahead,
    behind,
    observation: "local-refs-only",
    refresh_action: "/pm:sync",
  };
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

  writeJsonAtomic(path.join(dotPmDir, "sync-status.json"), status, {
    fileMode: 0o600,
    directoryMode: 0o700,
  });
}

function bindSyncStatusToEffect(dotPmDir, mode, effectResult, routeStatus) {
  const statusPath = path.join(dotPmDir, "sync-status.json");
  const errors = routeStatus?.errors?.length
    ? routeStatus.errors
    : effectResult.state === "verified"
      ? []
      : [effectResult.recovery?.reason || `${mode} effect is ${effectResult.state}`];
  const status = {
    lastSync: new Date().toISOString(),
    mode,
    backend: "git",
    uploaded: routeStatus?.uploaded || 0,
    downloaded: routeStatus?.downloaded || 0,
    errors,
    ok: effectResult.state === "verified",
    effect_id: effectResult.effect_id,
    effect_state: effectResult.state,
    verified_receipt: effectResult.verified_receipt || null,
    recovery: effectResult.recovery,
  };
  writeJsonAtomic(statusPath, status, { fileMode: 0o600, directoryMode: 0o700 });
  return status;
}

const SYNC_AUTHORITY = Object.freeze({
  setup: "configure_sync",
  clone: "configure_sync",
  sync: "sync_knowledge_base",
  push: "push_knowledge_base",
  pull: "pull_knowledge_base",
});

function localGitState(pmDir) {
  if (!isGitRepo(pmDir)) {
    return {
      repository: "absent",
      head: null,
      upstream: null,
      branch: null,
      worktree_sha256: sha256("absent"),
      remote_url_sha256: null,
    };
  }
  const head = runGitSafe(["rev-parse", "HEAD"], pmDir);
  const upstream = runGitSafe(["rev-parse", "@{upstream}"], pmDir);
  const branch = currentBranch(pmDir);
  const worktree = runGitSafe(["status", "--porcelain"], pmDir);
  const remoteUrl = getRemoteUrl(pmDir);
  return {
    repository: "present",
    head: head.ok ? head.output : null,
    upstream: upstream.ok ? upstream.output : null,
    branch: branch.ok ? branch.branch : null,
    worktree_sha256: sha256(worktree.ok ? worktree.output : "unreadable"),
    remote_url_sha256: remoteUrl ? sha256(remoteUrl) : null,
  };
}

function syncObservation(mode, pmDir, expectedRemoteHash) {
  const state = localGitState(pmDir);
  if (state.repository !== "present") {
    return { state: "absent", safe_to_retry: true, reason: "knowledge base repo is absent" };
  }
  if (expectedRemoteHash && state.remote_url_sha256 !== expectedRemoteHash) {
    return { state: "absent", safe_to_retry: true, reason: "configured remote differs" };
  }
  if (!state.head || !state.upstream) {
    return { state: "absent", safe_to_retry: true, reason: "git upstream is not established" };
  }
  const clean = state.worktree_sha256 === sha256("");
  const aligned = state.head === state.upstream;
  const verified = mode === "pull" ? aligned : aligned && clean;
  if (!verified) {
    return {
      state: "absent",
      safe_to_retry: true,
      reason: clean ? "local and observed upstream refs differ" : "worktree has pending changes",
    };
  }
  return {
    state: "verified",
    receipt: {
      mode,
      head: state.head,
      upstream: state.upstream,
      branch: state.branch,
      worktree_clean: clean,
      remote_url_sha256: state.remote_url_sha256,
    },
  };
}

function refreshRemoteForRecovery(pmDir) {
  if (!isGitRepo(pmDir)) return { ok: false, error: "knowledge base repo is absent" };
  if (!hasRemote(pmDir)) return { ok: false, error: "knowledge base remote is absent" };
  const upstream = resolveUpstream(pmDir);
  if (!upstream.ok) return { ok: false, error: upstream.error };
  const result = runGitSafe(["fetch", upstream.remote, upstream.remoteBranch], pmDir);
  return result.ok ? { ok: true } : { ok: false, error: `recovery fetch failed: ${result.error}` };
}

function unchangedLocalMutationSurface(before, after) {
  if (!before || !after) return false;
  return ["repository", "head", "branch", "worktree_sha256", "remote_url_sha256"].every(
    (field) => before[field] === after[field]
  );
}

function mutationStatus(mode, result) {
  return {
    mode,
    uploaded: result.uploaded ?? result.committed ?? 0,
    downloaded: result.downloaded ?? result.updated ?? 0,
    errors: result.errors || (result.error ? [result.error] : []),
    ok: result.ok,
  };
}

/** Execute one action-specific, replay-safe knowledge-base mutation. */
function runSyncEffect(options) {
  const mode = options.mode || "sync";
  if (!Object.hasOwn(SYNC_AUTHORITY, mode)) throw new Error(`unsupported sync effect: ${mode}`);
  const pmDir = path.resolve(options.pmDir);
  const dotPmDir = path.resolve(options.dotPmDir);
  const remoteUrl = options.remoteUrl || null;
  if ((mode === "setup" || mode === "clone") && !validateRemoteUrl(remoteUrl)) {
    throw new Error("setup and clone effects require a valid remote URL");
  }
  const configuredRemoteUrl = remoteUrl || getRemoteUrl(pmDir);
  const expectedRemoteHash = configuredRemoteUrl ? sha256(configuredRemoteUrl) : null;
  const configuredUpstream = isGitRepo(pmDir) ? resolveUpstream(pmDir) : null;
  const serialization = sharedGitRepositorySerialization(pmDir);
  let before;
  const recovery = {
    code: "inspect-sync-effect",
    command: mode === "sync" ? "/pm:sync" : `/pm:sync ${mode}`,
  };
  const operations = {
    setup,
    clone,
    sync,
    push,
    pull,
    refreshRemoteForRecovery,
    ...(options.operations || {}),
  };
  const requiresFreshRemoteObservation = mode === "pull" || mode === "sync";
  let mutationStarted = false;
  let routeStatus = null;

  const effectResult = runOperationalEffect({
    pmStateDir: dotPmDir,
    workflow: "sync",
    effect: `${mode}-knowledge-base`,
    authorityAction: SYNC_AUTHORITY[mode],
    authorityActions: options.authorityActions,
    serializationRoot: serialization.root,
    serializationScope: serialization.scope,
    target: {
      backend: "git",
      repository: "pm-knowledge-base",
      remote_url_sha256: expectedRemoteHash,
    },
    intent: {
      mode,
      branch: configuredUpstream?.ok ? configuredUpstream.branch : null,
      upstream: configuredUpstream?.ok ? configuredUpstream.ref : null,
    },
    precondition() {
      before = localGitState(pmDir);
      return before;
    },
    recovery,
    lockTimeoutMs: options.lockTimeoutMs,
    observe({ journal, recovery: recovering }) {
      if (requiresFreshRemoteObservation && !mutationStarted) {
        if (recovering && ["attempting", "ambiguous", "blocked"].includes(journal.state)) {
          const refresh = operations.refreshRemoteForRecovery(pmDir);
          if (!refresh.ok) {
            return {
              state: "ambiguous",
              reason: refresh.error || "interrupted sync outcome could not refresh Git state",
            };
          }
          const observed = syncObservation(mode, pmDir, expectedRemoteHash);
          if (observed.state === "verified") return observed;
          const afterRefresh = localGitState(pmDir);
          if (unchangedLocalMutationSurface(journal.precondition, afterRefresh)) {
            return {
              state: "absent",
              safe_to_retry: true,
              reason:
                "fresh Git observation proved the interrupted attempt left local state unchanged",
            };
          }
          return {
            state: "ambiguous",
            reason:
              "fresh Git observation found local changes from the interrupted sync; inspect before retry",
          };
        }
        return {
          state: "absent",
          safe_to_retry: true,
          reason: "this request has not refreshed the remote-tracking ref",
        };
      }
      return syncObservation(mode, pmDir, expectedRemoteHash);
    },
    mutate() {
      mutationStarted = true;
      const result = remoteUrl ? operations[mode](pmDir, remoteUrl) : operations[mode](pmDir);
      routeStatus = mutationStatus(mode, result);
      if (!result.ok) {
        return {
          ambiguous: true,
          reason: result.error || (result.errors || []).join("; ") || `${mode} failed`,
          recoveryEvidence: {
            code: "sync-operation-indeterminate",
            reason: result.error || (result.errors || []).join("; ") || `${mode} failed`,
          },
        };
      }
    },
  });
  const statusRecord = bindSyncStatusToEffect(dotPmDir, mode, effectResult, routeStatus);
  return {
    ...effectResult,
    mode,
    ok: effectResult.state === "verified",
    errors: statusRecord.errors,
    ...(statusRecord.errors?.length ? { error: statusRecord.errors.join("; ") } : {}),
  };
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
  const sameRepoPmDir = path.resolve(projectDir, "pm");
  const usesConfiguredPmRepo = path.resolve(pmContentDir) !== sameRepoPmDir;

  // Prefer the pm-content dir if it is itself a git repo. Otherwise fall back
  // to its parent only for an explicitly resolved separate-repo layout.
  // A same-repo consumer project commonly has its own `.git` beside `pm/`;
  // treating that source repo as the KB repo would reconfigure its remote.
  let pmDir = pmContentDir;
  if (usesConfiguredPmRepo && !isGitRepo(pmContentDir) && isGitRepo(path.dirname(pmContentDir))) {
    pmDir = path.dirname(pmContentDir);
  }

  return { pmDir, dotPmDir: pmStateDir };
}

if (require.main === module) {
  const mode = process.argv[2] || "sync";
  const remoteUrl = process.argv[3];
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
  const { pmDir, dotPmDir } = resolveCliPaths(projectDir);

  if (mode === "setup" || mode === "clone") {
    if (!remoteUrl) {
      process.stderr.write(`Usage: kb-sync-git.js ${mode} <remote-url>\n`);
      process.exit(1);
    }
    const result = runSyncEffect({
      mode,
      pmDir,
      dotPmDir,
      remoteUrl,
      authorityActions: [SYNC_AUTHORITY[mode]],
    });
    process.stdout.write(JSON.stringify({ ...result, mode }, null, 2) + "\n");
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  } else if (mode === "sync") {
    const result = runSyncEffect({
      mode,
      pmDir,
      dotPmDir,
      authorityActions: [SYNC_AUTHORITY[mode]],
    });
    if (!result.ok) {
      process.stderr.write((result.error || result.errors.join("; ")) + "\n");
      process.exit(1);
    }
  } else if (mode === "push") {
    const result = runSyncEffect({
      mode,
      pmDir,
      dotPmDir,
      authorityActions: [SYNC_AUTHORITY[mode]],
    });
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  } else if (mode === "pull") {
    const result = runSyncEffect({
      mode,
      pmDir,
      dotPmDir,
      authorityActions: [SYNC_AUTHORITY[mode]],
    });
    if (!result.ok) {
      process.stderr.write(result.error + "\n");
      process.exit(1);
    }
  } else if (mode === "status") {
    const result = status(pmDir);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stderr.write(
      "Usage: kb-sync-git.js [sync|push|pull|status|setup <remote-url>|clone <remote-url>]\n"
    );
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
  validateRemoteUrl,
  setup,
  clone,
  sync,
  push,
  pull,
  status,
  writeSyncStatus,
  runSyncEffect,
  localGitState,
  SYNC_AUTHORITY,
  resolveCliPaths,
};
