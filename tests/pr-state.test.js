"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PR_STATE = path.join(ROOT, "scripts", "pr-state.js");
const {
  getPrState,
  getPrInfo,
  inspectPullRequest,
  verifyPullRequest,
  reconcileCrashedTask,
  runGhWithRetry,
  isTransientGhError,
} = require("../scripts/pr-state.js");

// A fake gh runner factory: returns queued results in order, recording calls.
function fakeGh(results) {
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    const next = results[Math.min(calls.length - 1, results.length - 1)];
    return typeof next === "function" ? next(args) : next;
  };
  return { runGh, calls };
}

const noSleep = () => {};

test("getPrState returns the PR state when gh succeeds", () => {
  const { runGh, calls } = fakeGh([{ code: 0, stdout: "MERGED", stderr: "" }]);
  const state = getPrState("feat/x", { runGh, sleep: noSleep });
  assert.equal(state, "MERGED");
  assert.equal(calls.length, 1, "one gh call, no retries on success");
  assert.deepEqual(calls[0], ["pr", "view", "feat/x", "--json", "state", "--jq", ".state"]);
});

test("getPrState returns NONE when no PR exists for the branch", () => {
  const { runGh } = fakeGh([
    { code: 1, stdout: "", stderr: 'no pull requests found for branch "feat/x"' },
  ]);
  assert.equal(getPrState("feat/x", { runGh, sleep: noSleep }), "NONE");
});

test("getPrState retries on a transient 5xx and succeeds on a later attempt", () => {
  const { runGh, calls } = fakeGh([
    { code: 1, stdout: "", stderr: "HTTP 502: Bad Gateway (https://api.github.com/...)" },
    { code: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" },
    { code: 0, stdout: "OPEN", stderr: "" },
  ]);
  const state = getPrState("feat/x", { runGh, sleep: noSleep });
  assert.equal(state, "OPEN");
  assert.equal(calls.length, 3, "retried twice before the success");
});

test("getPrState returns UNKNOWN when transient failures never clear", () => {
  const { runGh, calls } = fakeGh([{ code: 1, stdout: "", stderr: "504 Gateway Timeout" }]);
  const state = getPrState("feat/x", { runGh, sleep: noSleep, retries: 3 });
  assert.equal(state, "UNKNOWN", "persistent 5xx must fail safe to UNKNOWN, never MERGED");
  assert.equal(calls.length, 3, "exhausted all 3 attempts");
});

test("runGhWithRetry does NOT retry a non-transient error (e.g. auth)", () => {
  const { runGh, calls } = fakeGh([
    { code: 1, stdout: "", stderr: "gh auth login required (HTTP 401)" },
  ]);
  const res = runGhWithRetry(["pr", "view"], { runGh, sleep: noSleep, retries: 3 });
  assert.equal(res.code, 1);
  assert.equal(calls.length, 1, "auth failures are not retried");
});

test("isTransientGhError recognizes 5xx / gateway / timeout, rejects 4xx", () => {
  assert.equal(isTransientGhError("HTTP 502: Bad Gateway"), true);
  assert.equal(isTransientGhError("503 Service Unavailable"), true);
  assert.equal(isTransientGhError("Gateway Time-out"), true);
  assert.equal(isTransientGhError("request timed out"), true);
  assert.equal(isTransientGhError("HTTP 404: Not Found"), false);
  assert.equal(isTransientGhError("no pull requests found"), false);
});

test("CLI prints the resolved state using a stubbed gh on PATH", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-state-cli-"));
  try {
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir);
    // Stub gh: echo MERGED regardless of args.
    const stub = ["#!/usr/bin/env bash", 'echo "MERGED"'].join("\n");
    const stubPath = path.join(binDir, "gh");
    fs.writeFileSync(stubPath, stub);
    fs.chmodSync(stubPath, 0o755);

    const out = childProcess.execFileSync("node", [PR_STATE, "--branch", "feat/x"], {
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
    });
    assert.match(out.trim(), /^MERGED$/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- Finding 2: gh hang is transient, not a silent success ---

test("a gh timeout is treated as transient and exhausts to UNKNOWN", () => {
  const { runGh, calls } = fakeGh([
    { code: 1, stdout: "", stderr: "gh timed out after 30000ms (SIGTERM)" },
  ]);
  assert.equal(getPrState("feat/x", { runGh, sleep: noSleep }), "UNKNOWN");
  assert.equal(calls.length, 3, "a hang must be retried, never accepted as a result");
});

test("CLI retries then reports UNKNOWN when gh hangs past the timeout", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pr-state-timeout-"));
  try {
    const binDir = path.join(tmp, "bin");
    fs.mkdirSync(binDir);
    // Stub gh: sleep far longer than the timeout so execFileSync kills it.
    const stub = ["#!/usr/bin/env bash", "sleep 5"].join("\n");
    const stubPath = path.join(binDir, "gh");
    fs.writeFileSync(stubPath, `${stub}\n`);
    fs.chmodSync(stubPath, 0o755);

    const out = childProcess.execFileSync("node", [PR_STATE, "--branch", "feat/x"], {
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
        PM_GH_TIMEOUT_MS: "150",
        PM_PR_STATE_BACKOFF_MS: "5",
      },
      encoding: "utf8",
    });
    assert.match(out.trim(), /^UNKNOWN$/, "a hung gh must resolve to UNKNOWN, not hang forever");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- getPrInfo: the richer fields the crash-recovery gate needs ---

function ghInfo(obj, calls) {
  return (args = []) => {
    if (calls) calls.push(args);
    if (args[0] === "api") {
      const files = (obj.files || []).map((entry) => ({
        filename: entry.filename || entry.path,
        ...(entry.previous_filename ? { previous_filename: entry.previous_filename } : {}),
        status: entry.status || "modified",
      }));
      return { code: 0, stdout: JSON.stringify({ files }), stderr: "" };
    }
    return { code: 0, stdout: JSON.stringify(obj), stderr: "" };
  };
}

test("getPrInfo returns state, mergedAt, number, headRefOid", () => {
  const info = getPrInfo("feat/x", {
    runGh: ghInfo({
      state: "MERGED",
      mergedAt: "2026-07-03T11:00:00Z",
      number: 42,
      headRefOid: "abc123",
    }),
    sleep: noSleep,
  });
  assert.deepEqual(info, {
    state: "MERGED",
    mergedAt: "2026-07-03T11:00:00Z",
    number: 42,
    headRefOid: "abc123",
  });
});

test("getPrInfo returns NONE (nulls) when no PR exists", () => {
  const { runGh } = fakeGh([{ code: 1, stdout: "", stderr: "no pull requests found for branch" }]);
  assert.deepEqual(getPrInfo("feat/x", { runGh, sleep: noSleep }), {
    state: "NONE",
    mergedAt: null,
    number: null,
    headRefOid: null,
  });
});

function remotePr(overrides = {}) {
  return {
    state: "OPEN",
    createdAt: "2026-07-03T10:01:00Z",
    mergedAt: null,
    mergeCommit: null,
    number: 42,
    url: "https://github.com/openai/pm/pull/42",
    baseRefName: "main",
    baseRefOid: "f".repeat(40),
    headRefName: "loop/pm-108",
    headRefOid: "a".repeat(40),
    changedFiles: 0,
    files: [],
    ...overrides,
  };
}

function resultPr(overrides = {}) {
  return {
    type: "pull-request",
    repo: "openai/pm",
    number: 42,
    url: "https://github.com/openai/pm/pull/42",
    base: "main",
    head: "loop/pm-108",
    head_oid: "a".repeat(40),
    created_at: "2026-07-03T10:01:00Z",
    ...overrides,
  };
}

function verify(artifact, remote, overrides = {}) {
  let runGh;
  let calls;
  if (remote instanceof Array) {
    ({ runGh, calls } = fakeGh(remote));
  } else {
    calls = [];
    runGh = ghInfo(remote, calls);
  }
  const checked = verifyPullRequest(artifact, {
    requiredState: "OPEN",
    expectedRepo: "openai/pm",
    expectedBase: "main",
    expectedHead: "loop/pm-108",
    expectedHeadOid: "a".repeat(40),
    dispatchedAt: "2026-07-03T10:00:00Z",
    runGh,
    sleep: noSleep,
    ...overrides,
  });
  return { checked, calls };
}

test("repository-pinned OPEN verification matches repo, number/url, base, head/OID, and recency", () => {
  const { checked, calls } = verify(resultPr(), remotePr());
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.state, "OPEN");
  assert.deepEqual(calls[0].slice(0, 6), ["pr", "view", "42", "--repo", "openai/pm", "--json"]);
  assert.match(calls[0][6], /state,createdAt,mergedAt,mergeCommit,number,url/);
  assert.match(calls[0][6], /baseRefName,baseRefOid/);
  assert.match(calls[0][6], /headRefName,headRefOid/);
  assert.match(calls[0][6], /changedFiles/);
  assert.deepEqual(calls[1], [
    "api",
    `repos/openai/pm/compare/${"f".repeat(40)}...${"a".repeat(40)}`,
  ]);
});

test("repository-pinned verification fails closed when GitHub returns an incomplete file list", () => {
  const files = Array.from({ length: 100 }, (_, index) => ({ path: `scripts/file-${index}.js` }));
  const { checked } = verify(resultPr(), remotePr({ changedFiles: 101, files }));
  assert.equal(checked.ok, false);
  assert.match(checked.reason, /file list.*incomplete/i);
});

test("repository-pinned verification rejects worker-owned PM, lease, recovery, event, and ledger paths", () => {
  for (const protectedPath of [
    "pm/backlog/pm-108.md",
    "pm/loop/leases/dev-pm-108.json",
    "pm/loop/recovery/loop-run.json",
    "pm/loop/events/loop-run.json",
    ".pm/loop-runs/loop-run.json",
    ".dev-lifecycle-stage",
  ]) {
    const { checked } = verify(
      resultPr(),
      remotePr({ changedFiles: 1, files: [{ path: protectedPath }] })
    );
    assert.equal(checked.ok, false, protectedPath);
    assert.match(checked.reason, /protected.*path/i);
    assert.deepEqual(checked.protectedPaths, [protectedPath]);
  }
});

test("repository-pinned verification rejects a rename from a protected path", () => {
  const { checked } = verify(
    resultPr(),
    remotePr({
      changedFiles: 1,
      files: [
        {
          path: "archive/pm-108.md",
          previous_filename: "pm/backlog/pm-108.md",
          status: "renamed",
        },
      ],
    })
  );
  assert.equal(checked.ok, false, JSON.stringify(checked));
  assert.match(checked.reason, /protected.*path/i);
  assert.deepEqual(checked.protectedPaths, ["pm/backlog/pm-108.md"]);
});

test("repository-pinned verification rejects metadata/file-list TOCTOU", () => {
  const first = remotePr();
  const moved = remotePr({ headRefOid: "b".repeat(40) });
  let calls = 0;
  const checked = inspectPullRequest(resultPr(), {
    expectedRepo: "openai/pm",
    expectedBase: "main",
    dispatchedAt: "2026-07-03T10:00:00Z",
    sleep: noSleep,
    runGh(args) {
      calls += 1;
      if (args[0] === "api") return ghInfo(first)(args);
      return { code: 0, stdout: JSON.stringify(calls === 1 ? first : moved), stderr: "" };
    },
  });
  assert.equal(checked.ok, false, JSON.stringify(checked));
  assert.match(checked.reason, /changed during verification|UNKNOWN/i);
  assert.equal(calls, 3);
});

test("repository-pinned verification requires an authoritative expected base", () => {
  const checked = inspectPullRequest(resultPr(), {
    expectedRepo: "openai/pm",
    expectedBase: "",
    dispatchedAt: "2026-07-03T10:00:00Z",
    runGh: ghInfo(remotePr()),
    sleep: noSleep,
  });
  assert.equal(checked.ok, false);
  assert.match(checked.reason, /base.*unresolved/i);
});

test("reconcile inspection accepts only repository-pinned OPEN or MERGED identity and returns merge evidence", () => {
  const stored = resultPr();
  const open = inspectPullRequest(stored, {
    expectedRepo: "openai/pm",
    expectedBase: "main",
    dispatchedAt: "2026-07-03T10:00:00Z",
    runGh: ghInfo(remotePr()),
    sleep: noSleep,
  });
  assert.equal(open.ok, true, JSON.stringify(open));
  assert.equal(open.state, "OPEN");

  const merged = inspectPullRequest(stored, {
    expectedRepo: "openai/pm",
    expectedBase: "main",
    dispatchedAt: "2026-07-03T10:00:00Z",
    runGh: ghInfo(
      remotePr({
        state: "MERGED",
        mergedAt: "2026-07-03T10:10:00Z",
        mergeCommit: { oid: "b".repeat(40) },
      })
    ),
    sleep: noSleep,
  });
  assert.equal(merged.ok, true, JSON.stringify(merged));
  assert.equal(merged.state, "MERGED");
  assert.deepEqual(merged.merge, {
    merge_sha: "b".repeat(40),
    merged_at: "2026-07-03T10:10:00Z",
  });

  const unknown = inspectPullRequest(stored, {
    expectedRepo: "openai/pm",
    expectedBase: "main",
    dispatchedAt: "2026-07-03T10:00:00Z",
    runGh: () => ({ code: 1, stdout: "", stderr: "HTTP 502 Bad Gateway" }),
    sleep: noSleep,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.state, "UNKNOWN");
});

test("OPEN verification fails closed for every identity or recency mismatch", () => {
  const cases = [
    [resultPr({ repo: "other/pm" }), remotePr(), /repository mismatch/],
    [resultPr(), remotePr({ number: 99 }), /number mismatch/],
    [resultPr(), remotePr({ url: "https://github.com/openai/pm/pull/99" }), /URL mismatch/],
    [resultPr(), remotePr({ baseRefName: "develop" }), /base mismatch/],
    [resultPr(), remotePr({ headRefName: "loop/old" }), /head mismatch/],
    [resultPr(), remotePr({ headRefOid: "b".repeat(40) }), /head OID mismatch/],
    [resultPr(), remotePr({ createdAt: "2026-07-03T09:59:00Z" }), /predates dispatch/],
    [resultPr(), remotePr({ state: "CLOSED" }), /required OPEN/],
  ];

  for (const [artifact, remote, expected] of cases) {
    const { checked } = verify(artifact, remote);
    assert.equal(checked.ok, false, JSON.stringify(checked));
    assert.match(checked.reason, expected);
  }
});

test("repository-pinned MERGED verification pins merge SHA/time after dispatch", () => {
  const artifact = resultPr({
    merge_sha: "b".repeat(40),
    merged_at: "2026-07-03T10:10:00Z",
  });
  const { checked } = verify(
    artifact,
    remotePr({
      state: "MERGED",
      mergedAt: "2026-07-03T10:10:00Z",
      mergeCommit: { oid: "b".repeat(40) },
    }),
    { requiredState: "MERGED" }
  );
  assert.equal(checked.ok, true, JSON.stringify(checked));

  for (const remote of [
    remotePr({
      state: "MERGED",
      mergedAt: "2026-07-03T09:59:00Z",
      mergeCommit: { oid: "b".repeat(40) },
    }),
    remotePr({
      state: "MERGED",
      mergedAt: "2026-07-03T10:10:00Z",
      mergeCommit: { oid: "c".repeat(40) },
    }),
  ]) {
    assert.equal(
      verify(artifact, remote, { requiredState: "MERGED" }).checked.ok,
      false,
      JSON.stringify(remote)
    );
  }
});

test("ship verification uses the original creation dispatch and current merge dispatch", () => {
  const artifact = resultPr({
    merge_sha: "b".repeat(40),
    merged_at: "2026-07-03T11:01:00Z",
  });
  const { checked } = verify(
    artifact,
    remotePr({
      state: "MERGED",
      mergedAt: "2026-07-03T11:01:00Z",
      mergeCommit: { oid: "b".repeat(40) },
    }),
    {
      requiredState: "MERGED",
      dispatchedAt: "2026-07-03T11:00:00Z",
      createdAfter: "2026-07-03T10:00:00Z",
      mergedAfter: "2026-07-03T11:00:00Z",
    }
  );
  assert.equal(checked.ok, true, JSON.stringify(checked));
});

test("NONE and UNKNOWN never pass repository-pinned verification", () => {
  const none = verify(resultPr(), [
    { code: 1, stdout: "", stderr: "no pull requests found for branch" },
  ]).checked;
  assert.equal(none.ok, false);
  assert.equal(none.state, "NONE");

  const unknown = verify(resultPr(), [
    { code: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" },
  ]).checked;
  assert.equal(unknown.ok, false);
  assert.equal(unknown.state, "UNKNOWN");
});

// --- Finding 1: crash reconciliation must not advance on a stale merged PR ---

const DISPATCH = "2026-07-03T10:00:00Z";
const AFTER = "2026-07-03T11:00:00Z";
const BEFORE = "2026-07-03T09:00:00Z";

function fakeGit(headSha) {
  return (args) => {
    if (args[0] === "rev-parse" && args[1] === "HEAD") {
      return { code: 0, stdout: headSha, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
}

test("reconcile advances only when THIS work merged after dispatch", () => {
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    runGh: ghInfo({ state: "MERGED", mergedAt: AFTER, number: 42, headRefOid: "sha-new" }),
    runGit: fakeGit("sha-new"),
    sleep: noSleep,
  });
  assert.equal(res.advance, true);
  assert.equal(res.prNumber, 42);
});

test("reconcile does NOT advance when the merge predates dispatch (reused slug, old PR)", () => {
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    // Old PR for a reused slug: merged BEFORE this task was dispatched.
    runGh: ghInfo({ state: "MERGED", mergedAt: BEFORE, number: 7, headRefOid: "sha-old" }),
    runGit: fakeGit("sha-new"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false, "must not advance past unmerged work");
  assert.match(res.reason, /predates-dispatch/);
});

test("reconcile does NOT advance when the merged PR's head is not this worktree's HEAD", () => {
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    // Merged after dispatch, but it's a DIFFERENT PR (head OID != our HEAD):
    // e.g. a same-slug PR from elsewhere. Our new local commits are unmerged.
    runGh: ghInfo({ state: "MERGED", mergedAt: AFTER, number: 9, headRefOid: "sha-other" }),
    runGit: fakeGit("sha-ours"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false, "identity mismatch must halt, not advance");
  assert.match(res.reason, /not-this-work/);
});

test("reconcile does NOT advance when the PR is not merged", () => {
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    runGh: ghInfo({ state: "OPEN", mergedAt: null, number: 9, headRefOid: "sha" }),
    runGit: fakeGit("sha"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false);
  assert.match(res.reason, /not-merged/);
});

test("reconcile does NOT advance when GitHub is unreachable (UNKNOWN)", () => {
  const { runGh } = fakeGh([{ code: 1, stdout: "", stderr: "HTTP 502: Bad Gateway" }]);
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    runGh,
    runGit: fakeGit("sha"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false, "UNKNOWN must never be treated as merged");
});

test("reconcile does NOT advance without a dispatch time (cannot verify recency)", () => {
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: undefined,
    runGh: ghInfo({ state: "MERGED", mergedAt: AFTER, number: 42, headRefOid: "sha" }),
    runGit: fakeGit("sha"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false);
});

test("getPrInfo surfaces headRefOid for a MERGED, branch-deleted PR (gh retains it)", () => {
  // The entire stale-slug scenario has the old head branch already deleted.
  // Real `gh pr view --json headRefOid` still returns the recorded OID on the
  // merged PR object after deletion. Pin the shape here so a future gh change
  // that drops the field can't silently disable the identity gate.
  const info = getPrInfo("feat/x", {
    runGh: ghInfo({
      state: "MERGED",
      mergedAt: AFTER,
      number: 7,
      headRefOid: "old-branch-tip-sha",
    }),
    sleep: noSleep,
  });
  assert.equal(info.headRefOid, "old-branch-tip-sha", "headRefOid must survive branch deletion");
  assert.ok(info.headRefOid, "the identity gate depends on a non-null headRefOid");
});

test("reconcile halts a reused slug whose deleted-branch PR head != current HEAD", () => {
  // Old PR for the reused slug merged after this task's dispatch (recency
  // passes) but its recorded headRefOid is the OLD, now-deleted branch tip —
  // not this worktree's new commits. Identity mismatch → halt, do not advance.
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    runGh: ghInfo({
      state: "MERGED",
      mergedAt: AFTER,
      number: 7,
      headRefOid: "old-branch-tip-sha",
    }),
    runGit: fakeGit("our-new-head-sha"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false, "a stale merged PR must never advance past this work");
  assert.match(res.reason, /not-this-work/);
});

test("reconcile halts when worktree HEAD is AHEAD of the merged PR's headRefOid", () => {
  // The subprocess pushed a tip, that PR merged, then it committed MORE locally
  // and crashed. headRefOid (pushed tip) != HEAD (pushed + extra) → conservative
  // halt: we cannot prove the extra commits merged, so do not advance.
  const res = reconcileCrashedTask({
    branch: "feat/x",
    worktree: "/wt",
    dispatchedAt: DISPATCH,
    runGh: ghInfo({ state: "MERGED", mergedAt: AFTER, number: 9, headRefOid: "pushed-tip-sha" }),
    runGit: fakeGit("pushed-tip-sha-plus-extra-commits"),
    sleep: noSleep,
  });
  assert.equal(res.advance, false, "HEAD ahead of the merged tip must halt, not advance");
  assert.match(res.reason, /not-this-work/);
});
