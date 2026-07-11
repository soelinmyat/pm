"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { buildWorkerPrompt, countWords } = require("../scripts/dev-prompt");

function validInput(overrides = {}) {
  return {
    outcome: "Implement phase-local prompt assembly.",
    scope: ["Edit the prompt builder."],
    exclusions: ["Do not ship."],
    inputs: ["RFC issue 3"],
    context: "Node.js plugin repository.",
    phaseContract: "Implement only the active phase. FUTURE_SHIP_TOKEN must not be present.",
    acceptanceCriteria: ["The prompt contains nine sections."],
    repositoryRules: ["Use apply_patch for edits."],
    authority: { localWrites: true, commit: false, merge: false },
    evidence: ["Targeted tests pass."],
    stopConditions: ["A product decision is missing."],
    resultSchema: { schema_version: 1, status: "passed|blocked|failed|noop" },
    ...overrides,
  };
}

const HEADINGS = [
  "Outcome",
  "Scope and exclusions",
  "Inputs and context",
  "Acceptance criteria",
  "Applicable repository rules",
  "Authorized actions",
  "Required evidence",
  "Stop conditions",
  "Result schema",
];

test("buildWorkerPrompt: renders the nine canonical sections exactly once", () => {
  const result = buildWorkerPrompt(
    validInput({ phaseContract: "# Phase\n\n## Nested worker guidance\n\nImplement it." })
  );

  for (const heading of HEADINGS) {
    const matches = result.prompt.match(new RegExp(`^## ${heading}$`, "gm")) || [];
    assert.equal(matches.length, 1, heading);
  }
  assert.equal((result.prompt.match(/^## /gm) || []).length, 9);
  assert.match(result.prompt, /^### Nested worker guidance$/m);
  assert.deepEqual(result.sections, HEADINGS);
});

test("buildWorkerPrompt: reports exact UTF-8 byte and word counts", () => {
  const result = buildWorkerPrompt(validInput({ outcome: "Ship café safely." }));

  assert.equal(result.metrics.bytes, Buffer.byteLength(result.prompt, "utf8"));
  assert.equal(result.metrics.words, countWords(result.prompt));
  assert.ok(result.metrics.words > 0);
});

test("buildWorkerPrompt: formats authority explicitly, including denied actions", () => {
  const result = buildWorkerPrompt(validInput());

  assert.match(result.prompt, /localWrites: allowed/);
  assert.match(result.prompt, /commit: denied/);
  assert.match(result.prompt, /merge: denied/);
});

test("buildWorkerPrompt: includes only the supplied active phase contract", () => {
  const result = buildWorkerPrompt(
    validInput({
      phaseContract: "ACTIVE_IMPLEMENT_TOKEN",
      futurePhaseContracts: ["FUTURE_SHIP_TOKEN", "FUTURE_RETRO_TOKEN"],
    })
  );

  assert.match(result.prompt, /ACTIVE_IMPLEMENT_TOKEN/);
  assert.doesNotMatch(result.prompt, /FUTURE_SHIP_TOKEN|FUTURE_RETRO_TOKEN/);
});

test("buildWorkerPrompt: validates required fields instead of emitting vague placeholders", () => {
  assert.throws(() => buildWorkerPrompt(validInput({ outcome: " " })), /outcome is required/);
  assert.throws(
    () => buildWorkerPrompt(validInput({ acceptanceCriteria: [] })),
    /acceptanceCriteria must contain at least one item/
  );
});

test("countWords: handles empty and repeated whitespace", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  one\n\ttwo   three "), 3);
});

test("CLI writes the bounded prompt atomically with private permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-prompt-"));
  try {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "prompt.md");
    fs.writeFileSync(inputPath, JSON.stringify(validInput()));
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "..", "scripts", "dev-prompt.js"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(outputPath, "utf8"), /^## Outcome/m);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.ok(JSON.parse(result.stdout).words > 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
