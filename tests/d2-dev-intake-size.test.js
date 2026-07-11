"use strict";

/**
 * D2 route-verification spike — risk-aware dev intake.
 * adjudicated: prose_reference VERIFIED, EM: implemented, PM: implemented, date: 2026-07-11, step-file-path: skills/dev/steps/02-intake.md, line-range: 21-34
 * prose_reference: Canonical size vocabulary and executable risk route in skills/dev/steps/02-intake.md:21-34
 * stub_boundaries: []
 * additive_cost: 0 (new risk branches reuse the pure dev-risk decision-table tests)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STEP_FILE = path.resolve(__dirname, "..", "skills", "dev", "steps", "02-intake.md");

test("dev intake preserves the canonical size vocabulary without making size the safety router", () => {
  const body = fs.readFileSync(STEP_FILE, "utf8");
  assert.match(body, /size \(`XS`–`XL`\)/);
  assert.match(body, /risk-routing\.md/);
  assert.match(body, /Kind affects readiness inputs, not safety gates/);
});

test("dev intake persists an executable route instead of a prose-only size table", () => {
  const body = fs.readFileSync(STEP_FILE, "utf8");
  assert.match(body, /dev-session\.js" route/);
  assert.match(body, /intake-facts\.json/);
  assert.match(body, /risk.*acceptance_criteria.*work_units/s);
  assert.match(body, /High-risk work uses full review regardless of kind or size/);
});
