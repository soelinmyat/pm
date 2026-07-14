"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  appendTransition,
  currentEvidenceRecords,
  hashResult,
  stableStringify,
} = require("../scripts/lib/workflow-runtime/records");
const { grantActions } = require("../scripts/lib/workflow-runtime/authority");
const { publishPrompt, renderSections } = require("../scripts/lib/workflow-runtime/prompt-packet");
const { resolveModelProfile } = require("../scripts/lib/workflow-runtime/model-profile");

test("workflow records are provider-neutral and byte-stable", () => {
  const value = { z: 1, a: { y: true, x: [2, "one"] } };
  assert.equal(stableStringify(value), '{"a":{"x":[2,"one"],"y":true},"z":1}');
  assert.equal(hashResult(value), hashResult({ a: { x: [2, "one"], y: true }, z: 1 }));

  const history = [];
  appendTransition(history, {
    priorPhase: "draft",
    nextPhase: "review",
    reason: "validated passed result",
    result: value,
    timestamp: "2026-07-14T00:00:00.000Z",
    runnerVersion: "2.0.0",
  });
  assert.deepEqual(history, [
    {
      prior_phase: "draft",
      next_phase: "review",
      reason: "validated passed result",
      result_hash: hashResult(value),
      timestamp: "2026-07-14T00:00:00.000Z",
      runner_version: "2.0.0",
    },
  ]);
});

test("current evidence uses original or recertified records consistently", () => {
  const original = [{ kind: "test", exit_code: 0 }];
  const verified = [{ kind: "review", exit_code: 0 }];
  const record = {
    commit: "old",
    records: original,
    verified_commit: "head",
    verified_at: "2026-07-14T00:00:00.000Z",
    verification_records: verified,
  };
  assert.equal(currentEvidenceRecords(record, "old"), original);
  assert.equal(currentEvidenceRecords(record, "head"), verified);
  assert.equal(currentEvidenceRecords(record, "other"), null);
});

test("authority grants are allowlisted, deduplicated, and immutable", () => {
  const authority = { push: false, merge: false };
  const log = [];
  const granted = grantActions({
    authority,
    log,
    actions: ["push", "push"],
    allowedActions: new Set(["push", "merge"]),
    reason: "User requested delivery",
    timestamp: "2026-07-14T00:00:00.000Z",
  });
  assert.deepEqual(authority, { push: false, merge: false });
  assert.deepEqual(log, []);
  assert.deepEqual(granted.authority, { push: true, merge: false });
  assert.deepEqual(granted.entry.actions, ["push"]);
  assert.throws(
    () => grantActions({ authority, log, actions: ["tag"], allowedActions: new Set(["push"]) }),
    /not grantable/
  );
});

test("prompt packet rendering is bounded and private atomic publication is exact", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prompt-packet-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompt = renderSections(
    [
      { title: "Objective", value: "Ship the boundary." },
      { title: "Evidence", value: ["tests", "report"] },
    ],
    { finalNewline: true, maxSectionBytes: 1024, maxPromptBytes: 4096 }
  );
  assert.equal(prompt, "## Objective\n\nShip the boundary.\n\n## Evidence\n\n- tests\n- report\n");
  const output = path.join(root, "prompt.md");
  publishPrompt(output, prompt);
  assert.equal(fs.readFileSync(output, "utf8"), prompt);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(root), ["prompt.md"]);
});

test("model profile resolution is data-injected and preserves explicit overrides", () => {
  const data = {
    defaults: { codex: "sol-high" },
    profiles: {
      "sol-high": { provider: "codex", model: "gpt-5.6-sol", effort: "high" },
    },
  };
  assert.deepEqual(
    resolveModelProfile({ data, provider: "codex", overrides: { effort: "xhigh" } }),
    {
      name: "sol-high",
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "xhigh",
    }
  );
  assert.throws(() => resolveModelProfile({ data, provider: "claude" }), /unknown runtime/);
});
