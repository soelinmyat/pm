"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const guidance = fs.readFileSync(
  path.join(ROOT, "skills/ship/references/capability-guidance.md"),
  "utf8"
);

test("guidance classifies automatic, configurable, and unavailable capabilities", () => {
  assert.match(guidance, /automatic/i);
  assert.match(guidance, /configurable/i);
  assert.match(guidance, /unavailable/i);
  assert.match(guidance, /effect/i);
});

test("guidance is read-only and uses one comprehensive kill switch", () => {
  assert.match(guidance, /PM_DELIVERY_COMPREHENSIVE=1/);
  assert.equal(new Set(guidance.match(/PM_DELIVERY_[A-Z_]+/g)).size, 1);
  assert.match(guidance, /never mutate|must not mutate/i);
  assert.match(guidance, /separate explicit authority/i);
  assert.match(guidance, /zero consumer edits/i);
});
