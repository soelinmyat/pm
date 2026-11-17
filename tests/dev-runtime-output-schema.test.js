"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  loadCanonicalSchema,
  buildCodexOutputSchema,
  decodeCodexResult,
  CODEX_RESULT_ENCODING,
} = require("../scripts/dev-runtime/output-schema");
const { classifyProviderFailure } = require("../scripts/dev-runtime/failure");
const canonicalPath = path.join(__dirname, "../skills/dev/references/worker-result.schema.json");

test("Codex transport preserves arbitrary canonical nested fields and conditional semantics", () => {
  const originalBytes = fs.readFileSync(canonicalPath);
  const canonical = loadCanonicalSchema(canonicalPath);
  const transport = buildCodexOutputSchema(canonical.schema);
  assert.deepEqual(Object.keys(transport.properties), ["result_json"]);
  assert.equal(Object.hasOwn(transport, "allOf"), false);
  const result = {
    schema_version: 1,
    work_unit_id: "unit",
    status: "blocked",
    summary: "External dependency",
    reason: "Unavailable",
    commit: null,
    files_changed: 0,
    evidence: [
      {
        kind: "test",
        exit_code: 1,
        command: "actual command",
        artifact: "private/log",
        custom: { retained: true },
      },
    ],
    blocker: { reason: "Unavailable", remediation: "Restore prerequisite" },
    runtime: { provider: "codex", model: "gpt-6-astra", arbitrary: { retained: true } },
  };
  const decoded = decodeCodexResult(
    JSON.stringify({ result_json: JSON.stringify(result) }),
    CODEX_RESULT_ENCODING
  );
  assert.deepEqual(canonical.validate(decoded), result);
  const invalid = {
    ...result,
    status: "completed",
    commit: "abc",
    blocker: null,
    evidence: [{ kind: "test", exit_code: 1 }],
  };
  assert.throws(() => canonical.validate(invalid), /canonical result schema rejected/);
  assert.deepEqual(fs.readFileSync(canonicalPath), originalBytes);
});

for (const input of [
  { result_json: "not json" },
  { result_json: "{}", extra: true },
  { result_json: {} },
  { status: "completed" },
  [],
  null,
]) {
  test(`Codex rejects malformed transport ${JSON.stringify(input)}`, () => {
    assert.throws(
      () => decodeCodexResult(JSON.stringify(input), CODEX_RESULT_ENCODING),
      /transport string|malformed/
    );
  });
}

test("captured custom schema constraints remain enforced after source schema changes", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-output-schema-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "custom.json");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "integer", minimum: 2 } },
    allOf: [{ properties: { value: { maximum: 4 } } }],
  };
  fs.writeFileSync(file, JSON.stringify(schema));
  const captured = loadCanonicalSchema(file);
  fs.writeFileSync(file, "{}");
  assert.throws(() => captured.validate({ value: 1 }), /rejected/);
  assert.throws(() => captured.validate({ value: 5 }), /rejected/);
  assert.deepEqual(captured.validate({ value: 3 }), { value: 3 });
});

test("last terminal provider error controls classification without model or telemetry false positives", () => {
  const events = [
    { type: "item.completed", item: { type: "agent_message", text: "usage limit reached" } },
    {
      type: "turn.failed",
      error: {
        message: JSON.stringify({
          error: { code: "invalid_json_schema", message: "Unsupported schema" },
          status: 400,
        }),
      },
    },
  ]
    .map((x) => JSON.stringify(x))
    .join("\n");
  assert.equal(
    classifyProviderFailure(events, "INFO rate_limit_remaining=0 quota=null"),
    "invalid-output-schema"
  );
  assert.equal(
    classifyProviderFailure(
      JSON.stringify({ type: "item.completed", item: { type: "error", message: "usage limit" } }),
      "INFO plan limits enabled; quota=null"
    ),
    null
  );
  assert.equal(
    classifyProviderFailure("", "You've hit your usage limit. Try again later."),
    "usage-limit"
  );
  assert.equal(
    classifyProviderFailure(
      JSON.stringify({ type: "result", is_error: true, result: "Rate limit exceeded" }),
      ""
    ),
    "usage-limit"
  );
  assert.equal(
    classifyProviderFailure(
      JSON.stringify({
        type: "turn.failed",
        error: { message: "Usage limit reached", status: 403 },
      }),
      "Usage limit reached"
    ),
    null
  );
});
