"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveRfcProfile } = require("../scripts/lib/rfc-runtime-profile");

test("RFC runtime profiles resolve the two workhorse defaults", () => {
  assert.deepEqual(resolveRfcProfile({ runtime: "codex" }), {
    profile: "gpt-5.6-sol-high",
    runtime: "codex",
    model: "gpt-5.6-sol",
    reasoning: "high",
    mode: "workspace-write",
  });
  assert.equal(resolveRfcProfile({ runtime: "claude" }).model, "claude-opus-4-8");
  assert.equal(resolveRfcProfile({ runtime: "claude" }).reasoning, "xhigh");
});

test("RFC runtime profiles reject provider/profile mismatch", () => {
  assert.throws(
    () => resolveRfcProfile({ runtime: "codex", profile: "claude-opus-4-8-xhigh" }),
    /unknown codex RFC profile/
  );
});
