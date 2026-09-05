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

test("RFC runtime profiles enforce Astra identity and supported effort", () => {
  assert.throws(
    () =>
      resolveRfcProfile({
        runtime: "codex",
        profile: "gpt-5.6-sol-high",
        model: "gpt-6-astra",
      }),
    /requires an explicitly selected named base profile/
  );
  assert.throws(
    () =>
      resolveRfcProfile({
        runtime: "codex",
        profile: "gpt-6-astra-high",
        model: "gpt-5.6-sol",
      }),
    /cannot override model identity/
  );
  assert.equal(
    resolveRfcProfile({
      runtime: "codex",
      profile: "gpt-6-astra-high",
      reasoning: "ultra",
    }).reasoning,
    "ultra"
  );
  assert.throws(
    () =>
      resolveRfcProfile({
        runtime: "codex",
        profile: "gpt-6-astra-high",
        reasoning: "extreme",
      }),
    /effort must be one of low, medium, high, xhigh, max, ultra/
  );
});
