"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Regression test for pm:strategy (Phase C: steps/ collapsed into SKILL.md)
//
// The 4-beat strategy flow was folded from steps/*.md into a single
// self-contained SKILL.md during the ceremony strip. These assertions
// re-target the original step-file keyword coverage onto SKILL.md so the
// judgment kernels stay pinned: the grounding iron law, existing-doc
// detection + surgical update flow, the interview-guide pointer, and the
// full strategy-document structure.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function readSkill() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "strategy", "SKILL.md"), "utf8");
}

test("strategy: steps/ directory has been collapsed into SKILL.md", () => {
  const stepsDir = path.join(PLUGIN_ROOT, "skills", "strategy", "steps");
  assert.ok(!fs.existsSync(stepsDir), "strategy/steps/ should no longer exist");
});

test("strategy: the four beats are all named in SKILL.md", () => {
  const skill = readSkill();
  for (const beat of [
    "Prerequisite check",
    "Detect existing strategy",
    "Interview",
    "Write strategy",
  ]) {
    assert.ok(skill.includes(beat), `SKILL.md should name the "${beat}" beat`);
  }
});

const CRITICAL_KEYWORDS = [
  // Prerequisite check
  "landscape.md",
  "landscape",
  // Detect existing strategy
  "STRATEGY.md",
  "PRODUCT.md",
  "PRD.md",
  "adopt",
  "start fresh",
  "Update flow",
  "Surgical updates",
  // Interview
  "interview-guide.md",
  "One question at a time",
  "competitors",
  // Write strategy (document structure)
  "strategy.md",
  "ICP",
  "non-goals",
  "Value Prop",
  "Competitive Positioning",
  "Go-to-Market",
  "Priorities",
  "Success Metrics",
  "Non-Goals",
];

test("strategy: SKILL.md contains all critical instruction keywords", () => {
  const skill = readSkill();
  const missing = CRITICAL_KEYWORDS.filter((k) => !skill.includes(k));
  assert.equal(
    missing.length,
    0,
    `Missing critical keywords in strategy/SKILL.md:\n  ${missing.join("\n  ")}`
  );
});

test("strategy: grounding iron law is preserved", () => {
  const skill = readSkill();
  assert.match(skill, /Never write strategy from thin air/i);
  assert.match(skill, /grounded in explicit answers/i);
});

test("strategy: the interview guide reference file still exists", () => {
  const guide = path.join(PLUGIN_ROOT, "skills", "strategy", "references", "interview-guide.md");
  assert.ok(fs.existsSync(guide), "interview-guide.md must remain the interview authority");
});
