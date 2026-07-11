"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MAX_PROMPT_BYTES, MAX_SECTION_BYTES, buildRfcPrompt } = require("../scripts/rfc-prompt");

function packet(overrides = {}) {
  return {
    objective: "Generate an RFC for safe session recovery",
    acceptance_criteria: ["Approval is explicit", "Review binds to artifact hash"],
    phase: "generation",
    repository: { cwd: "/repo", branch: "feature/rfc" },
    inputs: { proposal: "/pm/backlog/recovery.md" },
    artifact_contract: { html: "/pm/backlog/rfcs/recovery.html", schema_version: 3 },
    constraints: ["Preserve stable HTML hooks"],
    authority: { local_writes: true, external_effects: false },
    required_evidence: ["artifact-validation"],
    result_contract: { schema: "rfc-phase-result-v1" },
    ...overrides,
  };
}

test("RFC prompt contains a bounded current-phase packet without future workflow prose", () => {
  const prompt = buildRfcPrompt(packet());

  for (const heading of [
    "## Objective",
    "## Acceptance Criteria",
    "## Active Phase",
    "## Repository",
    "## Inputs",
    "## Artifact Contract",
    "## Constraints",
    "## Authority",
    "## Required Evidence",
    "## Result Contract",
  ]) {
    assert.equal(prompt.split(heading).length - 1, 1, `${heading} should appear exactly once`);
  }
  assert.doesNotMatch(
    prompt,
    /Linear issue creation|Wait for user approval|Continue to implementation/
  );
  assert.doesNotMatch(prompt, /GPT-5\.6|Opus|Claude|Codex/);
});

test("RFC prompt validates required fields", () => {
  assert.throws(() => buildRfcPrompt({ phase: "generation" }), /objective/);
});

test("RFC prompt rejects named oversized sections and an oversized total packet", () => {
  assert.throws(
    () => buildRfcPrompt(packet({ inputs: "x".repeat(MAX_SECTION_BYTES + 1) })),
    /section inputs.*limit/
  );
  const nearLimit = "x".repeat(Math.floor(MAX_PROMPT_BYTES / 10));
  assert.throws(
    () =>
      buildRfcPrompt(
        packet(
          Object.fromEntries(
            [
              "objective",
              "acceptance_criteria",
              "phase",
              "repository",
              "inputs",
              "artifact_contract",
              "constraints",
              "authority",
              "required_evidence",
              "result_contract",
            ].map((field) => [field, nearLimit])
          )
        )
      ),
    /RFC prompt is .* limit/
  );
});
