"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroomPrompt, MAX_SECTION_BYTES } = require("../scripts/groom-prompt");

function packet(overrides = {}) {
  return {
    objective: "Define a bounded proposal",
    decision_context: { tier: "standard", outcome: "Approve or reject scope" },
    phase: "scope",
    repository: { cwd: "/repo", branch: "feature/groom" },
    inputs: { evidence_refs: ["pm/research/users.md"] },
    proposal_contract: { schema: "proposal-v1", revision: 1 },
    questions: ["Is the scope coherent and minimal?"],
    constraints: ["Do not invent evidence"],
    authority: { local_writes: true, external_effects: false },
    required_evidence: ["scope"],
    result_contract: { schema: "groom-phase-result-v1" },
    ...overrides,
  };
}

test("Groom prompt is phase-local, provider-neutral, and question-oriented", () => {
  const prompt = buildGroomPrompt(packet());
  for (const heading of [
    "Objective",
    "Decision Context",
    "Active Phase",
    "Questions",
    "Result Contract",
  ]) {
    assert.equal(prompt.split(`## ${heading}`).length - 1, 1);
  }
  assert.doesNotMatch(prompt, /GPT|Claude|Opus|Codex|spawn exactly|three reviewers/i);
  assert.doesNotMatch(prompt, /approve automatically|continue to implementation/i);
});

test("Groom prompt rejects missing and oversized fields", () => {
  assert.throws(() => buildGroomPrompt({ phase: "scope" }), /objective/);
  assert.throws(
    () => buildGroomPrompt(packet({ inputs: "x".repeat(MAX_SECTION_BYTES + 1) })),
    /section inputs.*limit/
  );
});

test("Groom exposes exact component metrics while preserving its string API", () => {
  const { buildGroomPromptPacket } = require("../scripts/groom-prompt");
  const input = packet({ objective: "Investigate café imports" });
  const result = buildGroomPromptPacket(input);
  assert.equal(result.prompt, buildGroomPrompt(input));
  assert.equal(result.metrics.bytes, Buffer.byteLength(result.prompt, "utf8"));
  assert.equal(
    result.metrics.sections.reduce((sum, entry) => sum + entry.bytes, 0) + 21,
    result.metrics.bytes
  );
  assert.equal(
    result.metrics.sections.reduce((sum, entry) => sum + entry.words, 0),
    result.metrics.words
  );
});

test("Groom budgets are configurable and fail without truncating active gates", () => {
  const large = packet({ inputs: "é".repeat(9000) });
  assert.throws(() => buildGroomPrompt(large), /section inputs.*limit/);
  const prompt = buildGroomPrompt({ ...large, prompt_budget: { maxSectionBytes: 20000 } });
  assert.ok(prompt.includes(large.inputs));
  assert.match(prompt, /external_effects: false/);
  assert.match(prompt, /groom-phase-result-v1/);
  assert.throws(
    () => buildGroomPrompt(large, { maxPromptBytes: 10, maxSectionBytes: 20000 }),
    /Groom prompt.*limit/
  );
  assert.throws(
    () => buildGroomPrompt(packet({ prompt_budget: { maxPromptBytes: -1 } })),
    /positive safe integer/
  );
});

test("Groom packets omit unused future phases while retaining active approval constraints", () => {
  const prompt = buildGroomPrompt(
    packet({
      phase: "draft",
      constraints: ["Product approval requires an exact hash-bound audit."],
      future_phases: ["FUTURE_MERGE_MARKER"],
      unused_references: ["UNUSED_FULL_TIER_MARKER"],
    })
  );
  assert.doesNotMatch(prompt, /FUTURE_MERGE_MARKER|UNUSED_FULL_TIER_MARKER/);
  assert.match(prompt, /exact hash-bound audit/);
});
