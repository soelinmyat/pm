"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runRepositoryGates } = require("../scripts/repository-gate-runner");

test("invokes installed pre-push hook once with repeated commands and faithful Git input", () => {
  const calls = [];
  const plan = {
    plan_digest: "x",
    targeted_commands: ["mobile", "shared"],
    complete_commands: ["mobile", "shared"],
    hook: "/repo/.git/hooks/pre-push",
    remote: { name: "origin", url: "git@example/x", stdin: "refs/heads/x a refs/heads/x b\n" },
    candidate_push: { permitted: true },
  };
  const result = runRepositoryGates(plan, "targeted", {
    verifyDigest: () => true,
    preflight: () => ({ status: "verified", identity: {} }),
    spawnSync: (file, args, opts) => {
      calls.push({ file, args, opts });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls[0].args, [
    "origin",
    "git@example/x",
    "--command",
    "mobile",
    "--command",
    "shared",
  ]);
  assert.equal(calls[0].opts.input, plan.remote.stdin);
  assert.equal(calls[0].opts.shell, false);
});

test("stale preflight blocks before hook execution", () => {
  let ran = false;
  const result = runRepositoryGates(
    { plan_digest: "x", targeted_commands: ["x"], hook: "/hook", remote: {} },
    "targeted",
    {
      verifyDigest: () => true,
      preflight: () => ({ status: "blocked", issues: [{ message: "PATH changed" }] }),
      spawnSync: () => {
        ran = true;
      },
    }
  );
  assert.equal(result.status, "blocked");
  assert.equal(ran, false);
});

test("unclear manager contract selects comprehensive real-push fallback", () => {
  let fallback = 0;
  const result = runRepositoryGates(
    { plan_digest: "x", targeted_commands: ["x"], adapter: { supported: false } },
    "targeted",
    {
      verifyDigest: () => true,
      comprehensivePush: () => {
        fallback++;
        return { status: "comprehensive" };
      },
    }
  );
  assert.equal(result.status, "comprehensive");
  assert.equal(fallback, 1);
});
