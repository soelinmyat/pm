const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildLaunch, extractResult, validateWorkerResult } = require("../scripts/dev-runtime");

const schemaPath = path.join(
  __dirname,
  "..",
  "skills",
  "dev",
  "references",
  "worker-result.schema.json"
);

describe("dev runtime adapters", () => {
  it("builds Codex launch and resume argv arrays with safe defaults", () => {
    const initial = buildLaunch({
      provider: "codex",
      worktree: "/tmp/work tree",
      schemaPath,
      lastMessagePath: "/tmp/run/last.json",
    });
    assert.equal(initial.command, "codex");
    assert.deepEqual(initial.args.slice(0, 4), ["exec", "--model", "gpt-5.6-sol", "-c"]);
    assert.ok(initial.args.includes('model_reasoning_effort="high"'));
    assert.ok(initial.args.includes('approval_policy="never"'));
    assert.ok(initial.args.includes("workspace-write"));
    assert.ok(initial.args.includes("--json"));
    assert.ok(initial.args.includes("--output-schema"));
    assert.ok(!initial.args.includes("--full-auto"));
    assert.ok(!initial.args.includes("danger-full-access"));

    const resumed = buildLaunch({
      provider: "codex",
      resumeId: "thread-123",
      schemaPath,
      lastMessagePath: "/tmp/run/last.json",
    });
    assert.deepEqual(resumed.args.slice(0, 3), ["exec", "resume", "thread-123"]);
    assert.ok(!resumed.args.includes("-C"), "Codex resume retains its original cwd");
    assert.ok(!resumed.args.includes("--sandbox"), "Codex resume retains its original sandbox");
  });

  it("builds Claude launch and resume argv arrays with Opus xhigh and auto permissions", () => {
    const initial = buildLaunch({
      provider: "claude",
      sessionId: "11111111-1111-4111-8111-111111111111",
      schemaPath,
    });
    assert.equal(initial.command, "claude");
    assert.deepEqual(initial.args.slice(0, 5), [
      "-p",
      "--model",
      "claude-opus-4-8",
      "--effort",
      "xhigh",
    ]);
    assert.ok(initial.args.includes("auto"));
    assert.ok(initial.args.includes("stream-json"));
    assert.ok(initial.args.includes("--json-schema"));
    assert.ok(!initial.args.includes("--dangerously-skip-permissions"));

    const resumed = buildLaunch({
      provider: "claude",
      resumeId: "11111111-1111-4111-8111-111111111111",
      schemaPath,
    });
    assert.deepEqual(resumed.args.slice(0, 3), [
      "-p",
      "--resume",
      "11111111-1111-4111-8111-111111111111",
    ]);
    assert.ok(!resumed.args.includes("--session-id"));
  });

  it("emits an inline execution package with the same root-owned authority", () => {
    const inline = buildLaunch({
      provider: "inline",
      prompt: "implement",
      schemaPath,
    });
    assert.equal(inline.profile.model, "inherit");
    assert.equal(inline.authority.externalEffects, false);
    assert.deepEqual(inline.authority.denied, ["push", "open-pr", "merge", "tracker-update"]);
  });

  it("extracts resumable identities and structured results from provider streams", () => {
    const codexEvents = [
      JSON.stringify({ type: "thread.started", thread_id: "codex-thread" }),
      JSON.stringify({ type: "turn.completed" }),
    ].join("\n");
    const codex = extractResult({
      provider: "codex",
      events: codexEvents,
      lastMessage: JSON.stringify(validCompleted("codex")),
    });
    assert.equal(codex.resumeId, "codex-thread");
    assert.equal(codex.result.status, "completed");

    const claudeEvents = [
      JSON.stringify({ type: "system", session_id: "claude-session" }),
      JSON.stringify({
        type: "result",
        session_id: "claude-session",
        structured_output: validCompleted("claude"),
      }),
    ].join("\n");
    const claude = extractResult({ provider: "claude", events: claudeEvents });
    assert.equal(claude.resumeId, "claude-session");
    assert.equal(claude.result.status, "completed");
  });

  it("does not report missing or malformed results as success", () => {
    assert.throws(() => extractResult({ provider: "codex", events: "" }), /missing/);
    assert.throws(() => validateWorkerResult({ status: "completed" }), /schema_version/);
    assert.throws(() => validateWorkerResult({ status: "blocked" }), /schema_version/);
    assert.throws(
      () =>
        validateWorkerResult(
          {
            status: "merged",
            issue_id: "PM-1",
            pr: "1",
            merge_sha: "abc",
            files_changed: 1,
          },
          { allowLegacyMerged: true }
        ),
      /integer pr/
    );
  });

  it("fails closed when a probed CLI lacks required adapter capabilities", () => {
    assert.throws(
      () =>
        buildLaunch({
          provider: "codex",
          worktree: "/tmp/worktree",
          schemaPath,
          lastMessagePath: "/tmp/last.json",
          capabilities: {
            provider: "codex",
            structuredOutput: false,
            eventStream: true,
            safePermissions: true,
            resume: true,
          },
        }),
      /missing required capabilities: structuredOutput/
    );
  });

  it("loads a strict JSON schema while preserving adapter-only legacy merged results", () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    assert.equal(schema.$id, "pm.dev.worker-result.v1");
    assert.equal(schema.additionalProperties, false);
    assert.doesNotThrow(() => validateWorkerResult(validCompleted("codex")));
    assert.doesNotThrow(() =>
      validateWorkerResult(
        {
          status: "merged",
          issue_id: "PM-1.1",
          pr: 1,
          merge_sha: "abc",
          files_changed: 1,
        },
        { allowLegacyMerged: true }
      )
    );
  });
});

function validCompleted(provider) {
  return {
    schema_version: 1,
    work_unit_id: "unit-1",
    status: "completed",
    summary: "tests pass",
    commit: "abc123",
    files_changed: 1,
    evidence: [{ kind: "test", exit_code: 0 }],
    blocker: null,
    runtime: { provider },
  };
}
