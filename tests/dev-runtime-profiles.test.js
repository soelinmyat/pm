const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveProfile } = require("../scripts/dev-runtime");

describe("dev runtime model profiles", () => {
  it("selects the two workhorse models without skill-text changes", () => {
    assert.deepEqual(resolveProfile({ provider: "codex" }), {
      name: "codex-workhorse",
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      sandbox: "workspace-write",
      approvalPolicy: "never",
      externalEffects: false,
    });
    assert.deepEqual(resolveProfile({ provider: "claude" }), {
      name: "claude-workhorse",
      provider: "claude",
      model: "claude-opus-4-8",
      effort: "xhigh",
      permissionMode: "auto",
      externalEffects: false,
    });
  });

  it("allows exact model and effort overrides through config or environment", () => {
    const profile = resolveProfile({
      provider: "codex",
      overrides: { model: "configured-model", effort: "xhigh" },
      env: {
        PM_DEV_CODEX_MODEL: "environment-model",
        PM_DEV_CODEX_REASONING_EFFORT: "medium",
      },
    });
    assert.equal(profile.model, "configured-model", "explicit config wins over environment");
    assert.equal(profile.effort, "xhigh");

    const environmentProfile = resolveProfile({
      provider: "claude",
      env: {
        PM_DEV_CLAUDE_MODEL: "claude-fable-5",
        PM_DEV_CLAUDE_EFFORT: "high",
      },
    });
    assert.equal(environmentProfile.model, "claude-fable-5");
    assert.equal(environmentProfile.effort, "high");
  });

  it("rejects broad permissions unless explicitly authorized", () => {
    assert.throws(
      () =>
        resolveProfile({
          provider: "codex",
          overrides: { sandbox: "danger-full-access" },
        }),
      /broad permission/
    );
    const authorized = resolveProfile({
      provider: "codex",
      overrides: { sandbox: "danger-full-access", allowBroadPermissions: true },
    });
    assert.equal(authorized.sandbox, "danger-full-access");
  });
});
