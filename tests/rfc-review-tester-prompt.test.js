"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Issue 4 regression tests: @tester reviewer scoped blocking prompt.
// Validates that 03-rfc-review.md's @tester block contains the required
// scoping strings: "Test Strategy", "test-layers.md", and "Test hooks".
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const REVIEW_PATH = path.join(
  PLUGIN_ROOT,
  "skills",
  "rfc",
  "steps",
  "03-rfc-review.md"
);

// ---------------------------------------------------------------------------
// Helper: extract the @tester prompt block from 03-rfc-review.md
// ---------------------------------------------------------------------------

function getTesterBlock() {
  const content = fs.readFileSync(REVIEW_PATH, "utf8");
  const testerStart = content.indexOf("**Review as @tester");
  assert.ok(testerStart > -1, "@tester reviewer block must exist in 03-rfc-review.md");

  const staffStart = content.indexOf("**Review as @staff-engineer");
  assert.ok(staffStart > -1, "@staff-engineer block must exist after @tester");
  assert.ok(staffStart > testerStart, "@staff-engineer must come after @tester");

  return content.slice(testerStart, staffStart);
}

// ---------------------------------------------------------------------------
// AC3a: @tester block contains "Test Strategy"
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: prompt contains 'Test Strategy'", () => {
  const block = getTesterBlock();
  assert.ok(
    block.includes("Test Strategy"),
    "@tester prompt must contain 'Test Strategy'"
  );
});

// ---------------------------------------------------------------------------
// AC3b: @tester block contains "test-layers.md"
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: prompt contains 'test-layers.md'", () => {
  const block = getTesterBlock();
  assert.ok(
    block.includes("test-layers.md"),
    "@tester prompt must contain 'test-layers.md'"
  );
});

// ---------------------------------------------------------------------------
// AC3c: @tester block contains "Test hooks"
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: prompt contains 'Test hooks'", () => {
  const block = getTesterBlock();
  assert.ok(
    block.includes("Test hooks"),
    "@tester prompt must contain 'Test hooks'"
  );
});

// ---------------------------------------------------------------------------
// AC1d: @tester prompt explicitly limits scope (does not review architecture
// or code quality)
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: prompt limits scope to test concerns only", () => {
  const block = getTesterBlock();
  assert.ok(
    block.includes("Do NOT review architecture"),
    "@tester prompt must explicitly exclude architecture review"
  );
});

// ---------------------------------------------------------------------------
// AC2: Dispatch shape unchanged — still 3 parallel reviewers
// ---------------------------------------------------------------------------

test("03-rfc-review.md: dispatch shape has exactly 3 standard reviewers", () => {
  const content = fs.readFileSync(REVIEW_PATH, "utf8");
  const adversarial = content.includes("**Review as @adversarial-engineer");
  const tester = content.includes("**Review as @tester");
  const staff = content.includes("**Review as @staff-engineer");

  assert.ok(adversarial, "@adversarial-engineer reviewer must exist");
  assert.ok(tester, "@tester reviewer must exist");
  assert.ok(staff, "@staff-engineer reviewer must exist");

  // Verify the order: adversarial, tester, staff
  const advIdx = content.indexOf("**Review as @adversarial-engineer");
  const testIdx = content.indexOf("**Review as @tester");
  const staffIdx = content.indexOf("**Review as @staff-engineer");
  assert.ok(advIdx < testIdx, "@adversarial-engineer should come before @tester");
  assert.ok(testIdx < staffIdx, "@tester should come before @staff-engineer");
});

// ---------------------------------------------------------------------------
// AC2: @tester is documented as BLOCKING
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: documented as BLOCKING reviewer", () => {
  const block = getTesterBlock();
  assert.ok(
    block.includes("BLOCKING"),
    "@tester reviewer must be documented as BLOCKING"
  );
});

// ---------------------------------------------------------------------------
// Structural: @tester prompt references the five subsection names
// ---------------------------------------------------------------------------

test("03-rfc-review.md @tester: prompt references all five Test Strategy subsections", () => {
  const block = getTesterBlock();
  const subsections = [
    "Test levels in scope",
    "New test infrastructure",
    "Regression surface",
    "Verification commands",
    "Open test questions",
  ];

  const missing = subsections.filter((s) => !block.includes(s));
  assert.equal(
    missing.length,
    0,
    `@tester prompt is missing subsection references: ${missing.join(", ")}`
  );
});
