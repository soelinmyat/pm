"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PR_STATE = path.join(ROOT, "scripts", "pr-state.js");
const { getPrState, runGhWithRetry, isTransientGhError } = require("../scripts/pr-state.js");

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
