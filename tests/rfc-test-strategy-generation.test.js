"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Issue 2 regression tests: Generation prompt requires Test Strategy +
// reads test-layers.md. Validates ACs from RFC Issue 2, D6, D7.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const GENERATION_PATH = path.join(
  PLUGIN_ROOT,
  "skills",
  "rfc",
  "steps",
  "02-rfc-generation.md"
);

// ---------------------------------------------------------------------------
// AC1: Phase 1 prompt references test-layers.md at the correct path
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: Phase 1 prompt reads skills/dev/test-layers.md", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");
  assert.ok(
    content.includes("skills/dev/test-layers.md"),
    "Phase 1 prompt must reference skills/dev/test-layers.md"
  );
  // AC1 also requires the path is NOT the phantom path
  assert.ok(
    !content.includes("skills/dev/references/test-layers.md"),
    "Must NOT reference the phantom path skills/dev/references/test-layers.md"
  );
});

// ---------------------------------------------------------------------------
// AC2: Prompt links rfc-template.md as canonical schema source (D7)
// rather than restating all five subsection names inline
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: Phase 1 prompt references rfc-template.md as canonical schema (D7)", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");

  // Extract the Phase 1 prompt block (between ```text and ```)
  const promptStart = content.indexOf("```text");
  const promptEnd = content.indexOf("```", promptStart + 7);
  const promptBlock = content.slice(promptStart, promptEnd);

  assert.ok(
    promptBlock.includes("rfc-template.md"),
    "Phase 1 prompt must reference rfc-template.md for the canonical subsection schema"
  );
  assert.ok(
    promptBlock.includes("canonical") || promptBlock.includes("subsection schema"),
    "Phase 1 prompt must indicate rfc-template.md is the canonical/schema source"
  );
});

// ---------------------------------------------------------------------------
// AC3: Design-worker path is NOT modified; comment present (D6)
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: design-worker comment about Test Strategy ownership (D6)", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");
  assert.ok(
    content.includes("Test Strategy is owned by the parent RFC generator"),
    "Must have comment noting Test Strategy is owned by the parent RFC generator"
  );
  assert.ok(
    content.includes("design workers do not emit Test hooks"),
    "Comment must note that design workers do not emit Test hooks"
  );
});

// ---------------------------------------------------------------------------
// AC4: RFC_COMPLETE payload unchanged (no new fields)
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: RFC_COMPLETE payload has only original fields", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");
  const promptStart = content.indexOf("```text");
  const promptEnd = content.indexOf("```", promptStart + 7);
  const promptBlock = content.slice(promptStart, promptEnd);

  // Extract lines after RFC_COMPLETE
  const rcIdx = promptBlock.indexOf("RFC_COMPLETE");
  assert.ok(rcIdx > -1, "Phase 1 prompt must contain RFC_COMPLETE");

  const afterRc = promptBlock.slice(rcIdx);
  const lines = afterRc.split("\n").filter((l) => l.startsWith("- "));

  // Original fields: slug, path, summary, issues
  const fieldNames = lines.map((l) => l.match(/^- (\w+):/)?.[1]).filter(Boolean);
  assert.deepEqual(
    fieldNames,
    ["slug", "path", "summary", "issues"],
    "RFC_COMPLETE payload must have only the original four fields"
  );
});

// ---------------------------------------------------------------------------
// AC5: grep for test-layers.md returns a match
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: grep test-layers.md returns at least one match", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");
  const matches = content.match(/test-layers\.md/g);
  assert.ok(matches, "Must contain at least one reference to test-layers.md");
  assert.ok(
    matches.length >= 1,
    `Expected at least 1 match for test-layers.md, got ${matches.length}`
  );
});

// ---------------------------------------------------------------------------
// AC6: Cross-file consistency — prompt links template OR lists all five
// subsection names. Per D7, linking is preferred.
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: cross-file consistency — prompt links rfc-template.md for subsections (D7)", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");

  // Extract the Phase 1 prompt block
  const promptStart = content.indexOf("```text");
  const promptEnd = content.indexOf("```", promptStart + 7);
  const promptBlock = content.slice(promptStart, promptEnd);

  // The five canonical subsection names from D1 (same as in rfc-test-strategy-template.test.js)
  const SUBSECTIONS = [
    "Test levels in scope",
    "New test infrastructure",
    "Regression surface",
    "Verification commands",
    "Open test questions",
  ];

  // D7 preferred approach: link the template rather than restate
  const linksTemplate = promptBlock.includes("rfc-template.md");

  if (!linksTemplate) {
    // Fallback: if not linking, all five must appear verbatim
    const missing = SUBSECTIONS.filter((s) => !promptBlock.includes(s));
    assert.equal(
      missing.length,
      0,
      `Prompt does not link rfc-template.md and is missing subsections: ${missing.join(", ")}`
    );
  }

  // Either way, confirm at least one approach is satisfied
  assert.ok(
    linksTemplate || SUBSECTIONS.every((s) => promptBlock.includes(s)),
    "Phase 1 prompt must either link rfc-template.md or list all five subsection names"
  );
});

// ---------------------------------------------------------------------------
// Test Strategy requirements block and per-issue Test hooks instruction
// ---------------------------------------------------------------------------

test("02-rfc-generation.md: Phase 1 prompt has Test Strategy requirements block", () => {
  const content = fs.readFileSync(GENERATION_PATH, "utf8");
  const promptStart = content.indexOf("```text");
  const promptEnd = content.indexOf("```", promptStart + 7);
  const promptBlock = content.slice(promptStart, promptEnd);

  assert.ok(
    promptBlock.includes("Test Strategy"),
    "Phase 1 prompt must mention Test Strategy"
  );
  assert.ok(
    promptBlock.includes("Test hooks"),
    "Phase 1 prompt must instruct worker to include per-issue Test hooks"
  );
});
