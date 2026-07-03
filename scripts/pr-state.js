#!/usr/bin/env node
"use strict";

// pr-state.js — resolve a branch's GitHub pull-request state with a retry
// wrapper around `gh`, hardened against the transient 5xx / gateway / timeout
// failures that intermittently break field commands.
//
// Shared by:
//   - hooks/reconcile-merged (SessionStart stale-issue reconciliation)
//   - skills/dev/references/multi-task-dispatch.md crash recovery (a crashed
//     subprocess whose PR already merged on GitHub should be treated as done)
//
// Prints one of MERGED | OPEN | CLOSED | NONE | UNKNOWN to stdout and exits 0.
// Callers MUST fail safe: treat anything other than MERGED as "not merged".

const childProcess = require("node:child_process");

// Transient failures worth retrying: 5xx, gateway errors, timeouts, dropped
// connections. Deliberately excludes 4xx (auth, not-found) — those are stable.
const TRANSIENT =
  /HTTP 5\d\d|\b50[234]\b|Bad Gateway|Gateway Time-?out|Service Unavailable|tim(?:e|ed) ?out|timeout|connection reset|connection refused|EOF|temporary failure|could not resolve host/i;

function isTransientGhError(stderr) {
  return TRANSIENT.test(String(stderr || ""));
}

function defaultRunGh(args) {
  try {
    const stdout = childProcess.execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
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
  const { runGh = defaultRunGh, retries = 3, backoffMs = 1000, sleep = defaultSleep } = options;
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

function getPrState(branch, options = {}) {
  const res = runGhWithRetry(["pr", "view", branch, "--json", "state", "--jq", ".state"], options);
  if (res.code === 0) {
    const state = String(res.stdout || "").trim();
    return state || "NONE";
  }
  if (NO_PR.test(res.stderr)) {
    return "NONE";
  }
  // Auth error, persistent 5xx, or anything else we could not resolve — fail
  // safe. Callers must never treat UNKNOWN as merged.
  return "UNKNOWN";
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--branch") {
      options.branch = argv[i + 1];
      i += 1;
    }
  }
  return options;
}

function main() {
  const { branch } = parseArgs(process.argv.slice(2));
  if (!branch) {
    process.stderr.write("pr-state: --branch <branch> is required\n");
    process.exit(2);
  }
  // Retry backoff is overridable so tests can exercise the retry path quickly.
  const backoffMs = Number(process.env.PM_PR_STATE_BACKOFF_MS);
  const options = Number.isFinite(backoffMs) && backoffMs >= 0 ? { backoffMs } : {};
  process.stdout.write(`${getPrState(branch, options)}\n`);
}

module.exports = { getPrState, runGhWithRetry, isTransientGhError };

if (require.main === module) {
  main();
}
