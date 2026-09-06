"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveReviewProfile } = require("../scripts/review-target");
test("Review resolves policy but preserves explicit and persisted model identity", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-profile-"));
  try {
    fs.mkdirSync(path.join(root, ".pm"));
    fs.writeFileSync(
      path.join(root, ".pm/execution-policy.json"),
      JSON.stringify({
        schema_version: 1,
        defaults: { codex: { model: "gpt-6-astra", effort: "medium" } },
        workflows: {},
      })
    );
    const env = { HOME: root };
    assert.deepEqual(resolveReviewProfile({ env }, root), {
      name: "codex-astra",
      runtime: {
        provider: "codex",
        model: "gpt-6-astra",
        effort: "medium",
        external_effects: false,
      },
    });
    assert.equal(
      resolveReviewProfile({ env, profile: "codex-workhorse" }, root).runtime.model,
      "gpt-5.6-sol"
    );
    const execution = {
      runtime: "codex",
      profile: "codex-astra",
      model: "gpt-6-astra",
      reasoning: "high",
    };
    assert.equal(resolveReviewProfile({ env }, root, execution).runtime.effort, "high");
    fs.writeFileSync(
      path.join(root, ".pm/execution-policy.json"),
      JSON.stringify({
        schema_version: 1,
        defaults: { codex: { model: "gpt-6-astra", effort: "medium" } },
        workflows: { review: { codex: { model: "gpt-6-astra", effort: "xhigh" } } },
      })
    );
    assert.equal(resolveReviewProfile({ env }, root, execution).runtime.effort, "xhigh");
    const retained = {
      name: "codex-astra",
      runtime: { provider: "codex", model: "gpt-6-astra", effort: "high", external_effects: false },
    };
    assert.deepEqual(resolveReviewProfile({ env }, root, execution, retained), retained);
    assert.equal(
      resolveReviewProfile({ env, profile: "codex-workhorse" }, root, execution, retained).runtime
        .model,
      "gpt-5.6-sol"
    );
    const claude = {
      runtime: "claude",
      profile: "claude-workhorse",
      model: "claude-opus-4-8",
      reasoning: "xhigh",
    };
    assert.equal(resolveReviewProfile({ env }, root, claude).runtime.provider, "claude");
    fs.rmSync(path.join(root, ".pm/execution-policy.json"));

    assert.throws(
      () => resolveReviewProfile({ env }, root, { ...execution, model: "gpt-5.6-sol" }),
      /persisted Dev execution/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
