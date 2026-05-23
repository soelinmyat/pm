"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { normalizeStepName, STEP_NAME_PATTERN } = require(
  path.join(__dirname, "..", "scripts", "pm-log.js")
);

test("normalizeStepName: kebab-case input passes through unchanged", () => {
  for (const valid of ["draft", "team-review", "step-1", "ingest-step-3", "a", "0"]) {
    const result = normalizeStepName(valid);
    assert.equal(result.step, valid, `expected "${valid}" unchanged`);
    assert.equal(result.warning, null, `expected no warning for "${valid}"`);
  }
});

test("normalizeStepName: parenthetical suffix is stripped", () => {
  const result = normalizeStepName("implement (complete)");
  assert.equal(result.step, "implement");
  assert.match(result.warning, /not kebab-case/);
  assert.match(result.warning, /implement \(complete\)/);
});

test("normalizeStepName: narrative trailing text is stripped at first whitespace", () => {
  const result = normalizeStepName("retro all 3 issues done; issues 1+2 merged");
  assert.equal(result.step, "retro");
  assert.match(result.warning, /not kebab-case/);
});

test("normalizeStepName: uppercase letters are lowercased", () => {
  const result = normalizeStepName("Draft");
  assert.equal(result.step, "draft");
  assert.match(result.warning, /not kebab-case/);
});

test("normalizeStepName: missing/empty input returns 'unknown' with warning", () => {
  for (const bad of [undefined, null, "", 42, {}]) {
    const result = normalizeStepName(bad);
    assert.equal(result.step, "unknown");
    assert.ok(result.warning, `expected warning for ${JSON.stringify(bad)}`);
  }
});

test("normalizeStepName: leading hyphen cannot be normalized to a valid kebab-case token", () => {
  const result = normalizeStepName("-bad");
  assert.equal(result.step, "unknown");
  assert.match(result.warning, /could not be normalized/);
});

test("normalizeStepName: special chars stripped from head produce valid token", () => {
  const result = normalizeStepName("foo!@#bar");
  assert.equal(result.step, "foobar");
  assert.match(result.warning, /not kebab-case/);
});

test("STEP_NAME_PATTERN matches expected kebab-case shape", () => {
  assert.ok(STEP_NAME_PATTERN.test("draft"));
  assert.ok(STEP_NAME_PATTERN.test("step-1"));
  assert.ok(STEP_NAME_PATTERN.test("0"));
  assert.ok(!STEP_NAME_PATTERN.test("-draft"));
  assert.ok(!STEP_NAME_PATTERN.test("Draft"));
  assert.ok(!STEP_NAME_PATTERN.test("draft (complete)"));
  assert.ok(!STEP_NAME_PATTERN.test(""));
});
