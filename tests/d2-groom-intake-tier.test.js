"use strict";

/**
 * D2 route-verification spike — Assertion #2.
 *
 * Verifies `/pm:groom` 01-intake still classifies KB maturity into the three
 * canonical tiers (fresh / developing / mature) with the expected signal
 * combinations. Drift here breaks groom's tier cap logic — e.g. renaming
 * "developing" to "partial" would silently downgrade `standard` grooms.
 *
 * Ships only because Assertion #1 (d2-dev-intake-size) cleared all three
 * exit-criteria gates, per AC4.0.
 *
 * adjudicated: prose_reference VERIFIED, EM: implicit (spike-owner), PM: implicit (spike-owner), date: 2026-04-18, step-file-path: skills/groom/steps/01-intake.md, line-range: 101-124
 * prose_reference: "KB maturity detection" section — tier cap table (lines 103-107) and Fresh/Developing/Mature classification bullets (lines 110-112)
 * stub_boundaries: []  (reads step file via real fs; zero stubs imported — strictly within the ≤4 cap)
 * additive_cost: 0  (reuses the loadGroomStepBody() helper pattern from Assertion #1; a third branch — e.g. checking the "requested higher than max" fallback prose — would also need zero new stubs)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STEP_FILE = path.resolve(__dirname, "..", "skills", "groom", "steps", "01-intake.md");

function loadGroomStepBody() {
  return fs.readFileSync(STEP_FILE, "utf8");
}

test("groom/01-intake step file exists at canonical path", () => {
  assert.ok(
    fs.existsSync(STEP_FILE),
    `expected ${STEP_FILE} to exist — groom intake step was moved or deleted`
  );
});

test("groom/01-intake declares the KB maturity detection heading", () => {
  const body = loadGroomStepBody();
  assert.match(
    body,
    /\*\*KB maturity detection\.\*\*/,
    "expected **KB maturity detection.** heading — tier routing depends on this step"
  );
});

test("groom/01-intake lists Strategy / Insights / Competitors signal rows", () => {
  const body = loadGroomStepBody();
  const expectedSignals = [/\|\s*Strategy\s*\|/, /\|\s*Insights\s*\|/, /\|\s*Competitors\s*\|/];
  for (const re of expectedSignals) {
    assert.match(body, re, `expected a maturity signal row matching ${re} in ${STEP_FILE}`);
  }
});

test("groom/01-intake declares the three canonical maturity tiers with correct tier caps", () => {
  const body = loadGroomStepBody();
  // Fresh → quick, Developing → standard, Mature → full.
  // Anchored on the literal prose so a silent rename (e.g. "partial" instead
  // of "developing") fails the assertion.
  assert.match(
    body,
    /\*\*Fresh\*\*[^\n]*max tier:\s*`quick`/,
    "expected `**Fresh** ... max tier: `quick`` — fresh KB must cap at quick tier"
  );
  assert.match(
    body,
    /\*\*Developing\*\*[^\n]*max tier:\s*`standard`/,
    "expected `**Developing** ... max tier: `standard`` — developing KB must cap at standard tier"
  );
  assert.match(
    body,
    /\*\*Mature\*\*[^\n]*max tier:\s*`full`/,
    "expected `**Mature** ... max tier: `full`` — mature KB must cap at full tier"
  );
});

test("groom/01-intake tier prose appears in the documented line range (101-124)", () => {
  const lines = loadGroomStepBody().split("\n");
  const headerIdx = lines.findIndex((line) => /\*\*KB maturity detection\.\*\*/.test(line));
  assert.notStrictEqual(
    headerIdx,
    -1,
    "expected a KB maturity detection heading in groom/01-intake"
  );
  const headerLineNumber = headerIdx + 1;
  assert.ok(
    headerLineNumber >= 90 && headerLineNumber <= 130,
    `expected tier prose near lines 101-124, found header at line ${headerLineNumber} — update the manifest line-range if the shift is intentional`
  );
});
