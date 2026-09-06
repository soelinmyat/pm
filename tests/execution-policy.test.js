"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { selectExecutionProfile, saveExecutionPolicy } = require("../scripts/lib/execution-policy");
const { resolveProfile } = require("../scripts/dev-runtime");
const { resolveRfcProfile } = require("../scripts/lib/rfc-runtime-profile");
const { resolveGroomProfile } = require("../scripts/lib/groom-runtime-profile");
const data = require("../skills/dev/references/model-profiles.json");
const { validateRegisteredPolicy } = require("../scripts/pm-execution-policy");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-policy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ".pm", "execution-policy.json");
  const policy = {
    schema_version: 1,
    defaults: { codex: { model: "gpt-6-astra", effort: "high" } },
    workflows: { review: { codex: { model: "gpt-6-astra", effort: "xhigh" } } },
  };
  saveExecutionPolicy(file, policy);
  return { root, file, policy, env: { HOME: root } };
}

test("explicit policy resolves equivalent named profiles across Dev, RFC and Groom", (t) => {
  const { root, env } = fixture(t);
  const outputs = [
    resolveProfile({ provider: "codex", sourceDir: root, env }),
    resolveRfcProfile({ runtime: "codex", sourceDir: root, env }),
    resolveGroomProfile({ runtime: "codex", sourceDir: root, env }),
  ];
  for (const value of outputs) {
    assert.equal(value.model, "gpt-6-astra");
    assert.equal(value.effort || value.reasoning, "high");
  }
  assert.equal(
    selectExecutionProfile({ data, provider: "codex", workflow: "review", sourceDir: root, env })
      .effort,
    "xhigh"
  );
  assert.equal(
    resolveProfile({ provider: "codex", profileName: "codex-workhorse", sourceDir: root, env })
      .model,
    "gpt-5.6-sol"
  );
});

test("policy does not override inline inheritance, and malformed policy fails closed", (t) => {
  const { root, file, env } = fixture(t);
  assert.equal(
    selectExecutionProfile({ data, provider: "inline", workflow: "dev", sourceDir: root, env }),
    null
  );
  fs.writeFileSync(file, '{"schema_version":2}');
  assert.throws(
    () =>
      selectExecutionProfile({ data, provider: "codex", workflow: "dev", sourceDir: root, env }),
    /schema_version/
  );
});

test("policy rejects permissions, invalid efforts and unknown model identities", (t) => {
  const { root, file, policy, env } = fixture(t);
  assert.throws(
    () => saveExecutionPolicy(file, { ...policy, authority: { merge: true } }),
    /unknown/
  );
  policy.defaults.codex.effort = "none";
  assert.throws(() => saveExecutionPolicy(file, policy), /reasoning/);
  policy.defaults.codex = { model: "unknown-model", effort: "high" };
  saveExecutionPolicy(file, policy);
  assert.throws(
    () =>
      selectExecutionProfile({ data, provider: "codex", workflow: "dev", sourceDir: root, env }),
    /unsupported/
  );
});

test("explicit policy file absence and symlink are errors, not workhorse fallback", (t) => {
  const { root, file } = fixture(t);
  const link = path.join(root, "policy-link.json");
  fs.symlinkSync(file, link);
  for (const policyFile of [link, path.join(root, "absent.json")])
    assert.throws(
      () =>
        selectExecutionProfile({
          data,
          provider: "codex",
          workflow: "dev",
          sourceDir: root,
          env: { PM_EXECUTION_POLICY_FILE: policyFile },
        }),
      /regular file|not found/
    );
});

test("saving validates the effective selection against every affected workflow registry", () => {
  const value = {
    schema_version: 1,
    defaults: { claude: { model: "claude-fable-5", effort: "high" } },
    workflows: {},
  };
  assert.throws(
    () => validateRegisteredPolicy(value),
    /unsupported claude model claude-fable-5 for rfc/
  );
  value.defaults = {};
  value.workflows.dev = { claude: { model: "claude-fable-5", effort: "high" } };
  assert.equal(validateRegisteredPolicy(value), value);
});
