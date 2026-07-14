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
