"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Regression test for pm:think (Phase C: steps/ collapsed into SKILL.md)
//
// The 6-beat workflow no longer lives in steps/*.md — it was folded into a
// single self-contained SKILL.md during the ceremony strip. These assertions
// re-target the original step-file keyword coverage onto SKILL.md so the
// judgment kernels stay pinned: the mandatory reframe, anti-sycophancy,
// grounding scope caps, pressure-test dimensions, and the synthesize +
// groom-promotion handoff.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function readSkill() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "think", "SKILL.md"), "utf8");
}

// ---------------------------------------------------------------------------
// The steps/ directory is gone — the workflow is inline in SKILL.md
// ---------------------------------------------------------------------------

test("think: steps/ directory has been collapsed into SKILL.md", () => {
  const stepsDir = path.join(PLUGIN_ROOT, "skills", "think", "steps");
  assert.ok(!fs.existsSync(stepsDir), "think/steps/ should no longer exist");
});

test("think: the six beats are all named in SKILL.md", () => {
  const skill = readSkill();
  for (const beat of [
    "Capture",
    "Ground",
    "Reframe",
    "Explore approaches",
    "Pressure-test",
    "Synthesize",
  ]) {
    assert.ok(skill.includes(beat), `SKILL.md should name the "${beat}" beat`);
  }
});

// ---------------------------------------------------------------------------
// Critical instruction keywords preserved (re-targeted from the step files)
// ---------------------------------------------------------------------------

const CRITICAL_KEYWORDS = [
  // Capture
  "clarifying question",
  "slug",
  // Ground
  "context to reframe",
  "kb-search.md",
  "2 insight files",
  // Reframe (the kernel: mandatory reframe + lenses)
  "Never skip the reframe",
  "Jobs to Be Done",
  "Must-have test",
  // Explore approaches
  "genuinely different",
  "the catch",
  // Pressure-test
  "Pressure-test",
  "feasibility",
  "dependencies",
  // Synthesize
  "Synthesize",
  "thinking artifact",
  "Did I capture it correctly",
  "status: promoted",
  "promoted_to",
  "pm:groom",
  "groom_tier: quick",
  "{pm_dir}/thinking/",
];

test("think: SKILL.md contains all critical instruction keywords", () => {
  const skill = readSkill();
  const missing = CRITICAL_KEYWORDS.filter((k) => !skill.includes(k));
  assert.equal(
    missing.length,
    0,
    `Missing critical keywords in think/SKILL.md:\n  ${missing.join("\n  ")}`
  );
});

// ---------------------------------------------------------------------------
// Anti-sycophancy + scope-discipline kernels stay explicit
// ---------------------------------------------------------------------------

test("think: anti-sycophancy kernel is preserved", () => {
  const skill = readSkill();
  assert.match(skill, /disagree openly|push back|Challenge the framing/i);
  assert.match(skill, /Verdicts first|recommendation, then explain/i);
});

test("think: research escalation cap is preserved", () => {
  const skill = readSkill();
  assert.match(skill, /At most 2 insight files \+ 2 web searches/i);
  assert.match(skill, /pm:research/);
});
