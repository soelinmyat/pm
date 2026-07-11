"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const contract = fs.readFileSync(
  path.join(ROOT, "skills", "rfc", "references", "review-contract.md"),
  "utf8"
);
const step = fs.readFileSync(path.join(ROOT, "skills", "rfc", "steps", "03-rfc-review.md"), "utf8");

test("RFC review contract preserves the blocking Test Strategy lens", () => {
  for (const phrase of [
    "test-strategy",
    "test-layers.md",
    "Test Strategy",
    "Test hook",
    "regression surface",
    "verification commands",
    "open questions",
  ]) {
    assert.match(contract, new RegExp(phrase, "i"), `missing ${phrase}`);
  }
  assert.match(contract, /Missing, vague, invented.*blocking/i);
});

test("RFC review requires three structured lenses but adapts process count", () => {
  for (const lens of ["architecture-risk", "test-strategy", "maintainability"]) {
    assert.match(contract, new RegExp(`\`${lens}\``));
    assert.match(step, new RegExp(`\`${lens}\``));
  }
  assert.match(contract, /one reviewer may return all three/i);
  assert.match(contract, /independent reviewers in parallel/i);
  assert.match(contract, /The lenses are mandatory; the process count is adaptive/);
});

test("RFC review verdict is strict JSON-shaped and cannot imply approval", () => {
  for (const field of ["lens", "artifact_hash", "verdict", "blocking", "advisory"]) {
    assert.match(contract, new RegExp(`"${field}"`));
  }
  assert.match(contract, /Praise, narrative summaries, and silence are not verdicts/);
  assert.match(contract, /awaiting approval.*never approved/i);
  assert.doesNotMatch(step, /status: approved/);
});
