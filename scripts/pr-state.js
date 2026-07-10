#!/usr/bin/env node
"use strict";

// pr-state.js — resolve a branch's GitHub pull-request state with a retry
// wrapper around `gh`, hardened against the transient 5xx / gateway / timeout
// failures that intermittently break field commands, plus a crash-recovery
// reconciliation gate that will only treat a crashed task as "done" when the
// merged PR is provably THIS task's work.
//
// Used by:
//   - hooks/reconcile-merged (SessionStart stale-issue reconciliation) → state
//   - skills/dev/references/multi-task-dispatch.md crash recovery → reconcile
//
// Callers MUST fail safe: treat anything other than a positive result as "not
// merged" / "do not advance". UNKNOWN is never merged.

const childProcess = require("node:child_process");
const { protectedSourcePaths } = require("./loop-protection.js");

const GH_TIMEOUT_MS = 30_000;

// Transient failures worth retrying: 5xx, gateway errors, timeouts, dropped
// connections. Deliberately excludes 4xx (auth, not-found) — those are stable.
const TRANSIENT =
  /HTTP 5\d\d|\b50[234]\b|Bad Gateway|Gateway Time-?out|Service Unavailable|tim(?:e|ed) ?out|timeout|connection reset|connection refused|EOF|temporary failure|could not resolve host/i;

function isTransientGhError(stderr) {
  return TRANSIENT.test(String(stderr || ""));
}

function defaultRunGh(args, timeoutMs = GH_TIMEOUT_MS) {
  try {
    const stdout = childProcess.execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { code: 0, stdout: String(stdout).trim(), stderr: "" };
  } catch (err) {
    // A timeout surfaces as killed / SIGTERM / ETIMEDOUT. Without mapping it to
    // a transient stderr the retry wrapper is useless against a hang — so map
    // it explicitly so it retries, then falls through to UNKNOWN.
    const timedOut = err.killed === true || err.code === "ETIMEDOUT" || err.signal === "SIGTERM";
    return {
      code: typeof err.status === "number" ? err.status : 1,
      stdout: String(err.stdout || "").trim(),
      stderr: timedOut
        ? `gh timed out after ${timeoutMs}ms (${err.signal || err.code || "timeout"})`
        : String(err.stderr || err.message || ""),
    };
  }
}

// Synchronous sleep — a CLI has no event loop to yield to between attempts.
function defaultSleep(ms) {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

// Run `gh <args>` up to `retries` times, backing off between transient
// failures. Non-transient failures return immediately (no point retrying auth
// or 404). Returns the final { code, stdout, stderr }.
function runGhWithRetry(args, options = {}) {
  const {
    retries = 3,
    backoffMs = 1000,
    sleep = defaultSleep,
    timeoutMs = GH_TIMEOUT_MS,
  } = options;
  const runGh = options.runGh || ((a) => defaultRunGh(a, timeoutMs));
  let last = { code: 1, stdout: "", stderr: "no attempt made" };
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    last = runGh(args);
    if (last.code === 0) return last;
    if (!isTransientGhError(last.stderr)) return last;
    if (attempt < retries) sleep(backoffMs * attempt);
  }
  return last;
}

// "no pull requests found" is a normal answer, not an error.
const NO_PR = /no pull requests found|Could not resolve to a PullRequest|no open pull requests/i;

// Lean state-only query (used by reconcile-merged's advisory check).
function getPrState(branch, options = {}) {
  const res = runGhWithRetry(["pr", "view", branch, "--json", "state", "--jq", ".state"], options);
  if (res.code === 0) {
    return String(res.stdout || "").trim() || "NONE";
  }
  if (NO_PR.test(res.stderr)) {
    return "NONE";
  }
  // Auth error, persistent 5xx/timeout, or anything else we could not resolve
  // — fail safe. Callers must never treat UNKNOWN as merged.
  return "UNKNOWN";
}

const EMPTY_INFO = { state: "UNKNOWN", mergedAt: null, number: null, headRefOid: null };

// Rich query: everything the crash-recovery gate needs to prove identity and
// recency of a merge.
function getPrInfo(branch, options = {}) {
  const res = runGhWithRetry(
    ["pr", "view", branch, "--json", "state,mergedAt,number,headRefOid"],
    options
  );
  if (res.code === 0) {
    try {
      const obj = JSON.parse(res.stdout || "{}");
      return {
        state: obj.state || "NONE",
        mergedAt: obj.mergedAt || null,
        number: obj.number ?? null,
        headRefOid: obj.headRefOid || null,
      };
    } catch {
      return { ...EMPTY_INFO };
    }
  }
  if (NO_PR.test(res.stderr)) {
    return { state: "NONE", mergedAt: null, number: null, headRefOid: null };
  }
  return { ...EMPTY_INFO };
}

const PINNED_FIELDS =
  "state,createdAt,mergedAt,mergeCommit,number,url,baseRefName,headRefName,headRefOid,changedFiles";

function getPinnedPrFiles(repo, number, options = {}) {
  const res = runGhWithRetry(
    ["api", "--paginate", "--slurp", `repos/${repo}/pulls/${number}/files`],
    options
  );
  if (res.code !== 0) return { ok: false };
  try {
    const pages = JSON.parse(res.stdout || "[]");
    if (!Array.isArray(pages)) return { ok: false };
    const entries = pages.flatMap((page) => (Array.isArray(page) ? page : []));
    const paths = [];
    for (const entry of entries) {
      if (!entry || typeof entry.filename !== "string" || !entry.filename) {
        return { ok: false };
      }
      paths.push(entry.filename);
      if (entry.previous_filename !== undefined) {
        if (typeof entry.previous_filename !== "string" || !entry.previous_filename) {
          return { ok: false };
        }
        paths.push(entry.previous_filename);
      }
    }
    return { ok: true, count: entries.length, paths: [...new Set(paths)].sort() };
  } catch {
    return { ok: false };
  }
}

function getPinnedPrInfo(repo, number, options = {}) {
  const res = runGhWithRetry(
    ["pr", "view", String(number), "--repo", repo, "--json", PINNED_FIELDS],
    options
  );
  if (res.code === 0) {
    try {
      const obj = JSON.parse(res.stdout || "{}");
      const changed = getPinnedPrFiles(repo, number, options);
      if (!changed.ok) return { state: "UNKNOWN" };
      return {
        state: obj.state || "UNKNOWN",
        createdAt: obj.createdAt || null,
        mergedAt: obj.mergedAt || null,
        mergeSha: obj.mergeCommit && obj.mergeCommit.oid ? obj.mergeCommit.oid : null,
        number: obj.number ?? null,
        url: obj.url || null,
        baseRefName: obj.baseRefName || null,
        headRefName: obj.headRefName || null,
        headRefOid: obj.headRefOid || null,
        changedFiles: Number.isSafeInteger(obj.changedFiles) ? obj.changedFiles : null,
        fileCount: changed.count,
        files: changed.paths,
      };
    } catch {
      return { state: "UNKNOWN" };
    }
  }
  if (NO_PR.test(res.stderr)) return { state: "NONE" };
  return { state: "UNKNOWN" };
}

function failedVerification(reason, state = "UNKNOWN", pr = null) {
  return { ok: false, state, reason, pr };
}

function inspectPullRequest(artifact, options = {}) {
  const expectedRepo = options.expectedRepo;
  if (!artifact || artifact.repo !== expectedRepo) {
    return failedVerification("pull request repository mismatch");
  }
  if (!Number.isSafeInteger(artifact.number) || artifact.number < 1) {
    return failedVerification("pull request number is invalid");
  }
  const info = getPinnedPrInfo(expectedRepo, artifact.number, options);
  if (info.state === "NONE" || info.state === "UNKNOWN") {
    return failedVerification(`pull request verification returned ${info.state}`, info.state, info);
  }
  if (!new Set(["OPEN", "MERGED"]).has(info.state)) {
    return failedVerification(
      options.requiredState
        ? `pull request state ${info.state} does not match required ${options.requiredState}`
        : `pull request state ${info.state} is not OPEN or MERGED`,
      info.state,
      info
    );
  }
  if (info.number !== artifact.number) {
    return failedVerification("pull request number mismatch", info.state, info);
  }
  if (info.url !== artifact.url) {
    return failedVerification("pull request URL mismatch", info.state, info);
  }
  const expectedBase = options.expectedBase || artifact.base;
  const expectedHead = options.expectedHead || artifact.head;
  const expectedHeadOid = options.expectedHeadOid || artifact.head_oid;
  if (info.baseRefName !== artifact.base || info.baseRefName !== expectedBase) {
    return failedVerification("pull request base mismatch", info.state, info);
  }
  if (info.headRefName !== artifact.head || info.headRefName !== expectedHead) {
    return failedVerification("pull request head mismatch", info.state, info);
  }
  if (info.headRefOid !== artifact.head_oid || info.headRefOid !== expectedHeadOid) {
    return failedVerification("pull request head OID mismatch", info.state, info);
  }
  const creationDispatchMs = Date.parse(options.createdAfter || options.dispatchedAt);
  const createdMs = Date.parse(info.createdAt);
  if (
    !Number.isFinite(creationDispatchMs) ||
    !Number.isFinite(createdMs) ||
    createdMs <= creationDispatchMs
  ) {
    return failedVerification("pull request creation predates dispatch", info.state, info);
  }
  if (info.createdAt !== artifact.created_at) {
    return failedVerification("pull request creation timestamp mismatch", info.state, info);
  }
  if (!Number.isSafeInteger(info.changedFiles) || info.changedFiles !== info.fileCount) {
    return failedVerification(
      "pull request file list is incomplete and protected paths cannot be verified",
      info.state,
      info
    );
  }
  const protectedPaths = protectedSourcePaths(info.files);
  if (protectedPaths.length > 0) {
    return {
      ...failedVerification(
        `pull request touches protected worker-owned paths: ${protectedPaths.join(", ")}`,
        info.state,
        info
      ),
      protectedPaths,
    };
  }
  if (info.state === "MERGED") {
    const mergeDispatchMs = Date.parse(options.mergedAfter || options.dispatchedAt);
    const mergedMs = Date.parse(info.mergedAt);
    if (
      !Number.isFinite(mergeDispatchMs) ||
      !Number.isFinite(mergedMs) ||
      mergedMs <= mergeDispatchMs
    ) {
      return failedVerification("pull request merge predates dispatch", info.state, info);
    }
    if (!info.mergeSha)
      return failedVerification("pull request merge SHA is missing", info.state, info);
  }
  return {
    ok: true,
    state: info.state,
    pr: info,
    merge: info.state === "MERGED" ? { merge_sha: info.mergeSha, merged_at: info.mergedAt } : null,
  };
}

function verifyPullRequest(artifact, options = {}) {
  const checked = inspectPullRequest(artifact, options);
  if (!checked.ok) return checked;
  const requiredState = options.requiredState;
  if (checked.state !== requiredState) {
    return failedVerification(
      `pull request state ${checked.state} does not match required ${requiredState}`,
      checked.state,
      checked.pr
    );
  }
  if (requiredState === "MERGED") {
    if (checked.merge.merged_at !== artifact.merged_at) {
      return failedVerification("pull request merge timestamp mismatch", checked.state, checked.pr);
    }
    if (checked.merge.merge_sha !== artifact.merge_sha) {
      return failedVerification("pull request merge SHA mismatch", checked.state, checked.pr);
    }
  }
  return checked;
}

function defaultRunGit(args, cwd) {
  try {
    const stdout = childProcess.execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GH_TIMEOUT_MS,
    });
    return { code: 0, stdout: String(stdout).trim(), stderr: "" };
  } catch (err) {
    return {
      code: typeof err.status === "number" ? err.status : 1,
      stdout: String(err.stdout || "").trim(),
      stderr: String(err.stderr || err.message || ""),
    };
  }
}

// Decide whether a crashed subprocess's task is actually DONE. A crash leaves
// no result.json, but the PR may have merged before the process died. The
// danger: `gh pr view <branch>` resolves by head-ref NAME, so a reused slug can
// surface a PRIOR PR that was squash-merged and branch-deleted. Advancing on
// state=MERGED alone would skip real, unmerged work.
//
// Advance ONLY when ALL hold:
//   - state == MERGED
//   - mergedAt is strictly AFTER this task's dispatch time (rules out an older
//     PR for a reused slug)
//   - the merged PR's headRefOid equals this worktree's HEAD (proves the merge
//     is THIS task's exact commits — squash-safe, unlike an ancestor check,
//     since a squash discards the branch-tip commit from the default branch)
// Any failure → do not advance (caller halts the epic as crashed).
function reconcileCrashedTask(opts = {}) {
  const { branch, worktree, dispatchedAt } = opts;
  const runGit = opts.runGit || defaultRunGit;

  const info = getPrInfo(branch, opts);
  if (info.state !== "MERGED") {
    return { advance: false, reason: `pr-not-merged:${info.state}` };
  }

  const mergedMs = Date.parse(info.mergedAt);
  const dispatchedMs = Date.parse(dispatchedAt);
  if (!Number.isFinite(mergedMs) || !Number.isFinite(dispatchedMs) || mergedMs <= dispatchedMs) {
    return { advance: false, reason: "merge-predates-dispatch", mergedAt: info.mergedAt };
  }

  const head = runGit(["rev-parse", "HEAD"], worktree);
  const headSha = head.code === 0 ? head.stdout.trim() : "";
  if (!headSha || !info.headRefOid || info.headRefOid !== headSha) {
    return {
      advance: false,
      reason: "merged-pr-not-this-work",
      headRefOid: info.headRefOid,
      headSha,
    };
  }

  return { advance: true, prNumber: info.number, mergedAt: info.mergedAt };
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--branch") {
      options.branch = argv[i + 1];
      i += 1;
    } else if (token === "--worktree") {
      options.worktree = argv[i + 1];
      i += 1;
    } else if (token === "--dispatched-at") {
      options.dispatchedAt = argv[i + 1];
      i += 1;
    } else if (token.startsWith("--")) {
      // Unknown flag with a value — skip both to stay forgiving.
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) i += 1;
    } else {
      positionals.push(token);
    }
  }
  return { options, positionals };
}

// Retry/timeout are overridable via env so tests can exercise the slow paths.
function envOverrides() {
  const out = {};
  const backoffMs = Number(process.env.PM_PR_STATE_BACKOFF_MS);
  if (Number.isFinite(backoffMs) && backoffMs >= 0) out.backoffMs = backoffMs;
  const timeoutMs = Number(process.env.PM_GH_TIMEOUT_MS);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) out.timeoutMs = timeoutMs;
  return out;
}

function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  const overrides = envOverrides();

  if (positionals[0] === "reconcile") {
    if (!options.branch || !options.worktree) {
      process.stderr.write("pr-state reconcile: --branch and --worktree are required\n");
      process.exit(2);
    }
    const result = reconcileCrashedTask({ ...options, ...overrides });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  if (!options.branch) {
    process.stderr.write("pr-state: --branch <branch> is required\n");
    process.exit(2);
  }
  process.stdout.write(`${getPrState(options.branch, overrides)}\n`);
}

module.exports = {
  getPrState,
  getPrInfo,
  getPinnedPrInfo,
  inspectPullRequest,
  verifyPullRequest,
  reconcileCrashedTask,
  runGhWithRetry,
  isTransientGhError,
};

if (require.main === module) {
  main();
}
