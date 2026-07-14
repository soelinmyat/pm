"use strict";

/**
 * D2 assertion manifest.
 * stub_boundaries: []
 * prose_reference: Groom intake delegates tier eligibility to the canonical tier-gating reference.
 * adjudicated: step-file-path: skills/groom/steps/01-intake.md, line-range: 17-22
 * additive_cost: 0 (content assertions use direct filesystem reads)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const INTAKE = path.join(ROOT, "skills", "groom", "steps", "01-intake.md");
const TIER = path.join(ROOT, "skills", "groom", "references", "tier-gating.md");

test("Groom intake delegates deterministic tier eligibility to one reference", () => {
  const intake = fs.readFileSync(INTAKE, "utf8");
  assert.match(intake, /tier eligibility/i);
  assert.match(intake, /tier-gating\.md/);
  assert.match(intake, /agent.*not provider-locked/i);
  assert.match(intake, /groom-session\.js init/);
});

test("Groom tier contract preserves integrity while varying depth", () => {
  const tier = fs.readFileSync(TIER, "utf8");
  for (const name of ["quick", "standard", "full", "agent"]) {
    assert.match(tier, new RegExp(`\\b${name}\\b`, "i"));
  }
  assert.match(tier, /approval/i);
  assert.match(tier, /provider-neutral|provider neutral/i);
  assert.doesNotMatch(tier, /claude-only|refuse under codex/i);
});
