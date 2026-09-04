const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { resolveProfile } = require("../scripts/dev-runtime");
const { resolveModelProfile } = require("../scripts/lib/workflow-runtime/model-profile");

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

  it("requires Astra identity and effort to come from a compatible named profile", () => {
    assert.throws(
      () =>
        resolveProfile({
          provider: "codex",
          env: { PM_DEV_CODEX_MODEL: "gpt-6-astra" },
        }),
      /requires an explicitly selected named base profile/
    );
    assert.throws(
      () =>
        resolveProfile({
          provider: "codex",
          profileName: "codex-astra",
          overrides: { model: "gpt-5.6-sol" },
        }),
      /cannot override model identity/
    );
    assert.throws(
      () =>
        resolveProfile({
          provider: "codex",
          profileName: "codex-astra",
          env: { PM_DEV_CODEX_REASONING_EFFORT: "ultra" },
        }),
      /effort must be one of low, medium, high, xhigh, max/
    );
    assert.equal(
      resolveProfile({
        provider: "codex",
        profileName: "codex-astra",
        env: { PM_DEV_CODEX_REASONING_EFFORT: "xhigh" },
      }).effort,
      "xhigh"
    );

    assert.throws(
      () =>
        resolveModelProfile({
          data: {
            defaults: { codex: "future-astra-default" },
            profiles: {
              "future-astra-default": {
                provider: "codex",
                model: "gpt-6-astra",
                effort: "high",
              },
            },
          },
          provider: "codex",
        }),
      /explicitly selected named base profile/
    );
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
