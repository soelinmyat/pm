"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("Think preserves conversational beats while publishing a bound decision companion", () => {
  const skill = read("skills/think/SKILL.md");
  for (const beat of [
    "Capture",
    "Ground",
    "Reframe",
    "Explore approaches",
    "Pressure-test",
    "Synthesize",
  ])
    assert.match(skill, new RegExp(beat, "i"));
  assert.match(skill, /thinking\/\{slug\}\.decision\.json/);
  assert.match(skill, /Groom owns the verified origin transition/i);
});

test("Ideate delegates ordering and conflict checks to the shared deterministic ranker", () => {
  const skill = read("skills/ideate/SKILL.md");
  assert.match(skill, /rank-ideas/);
  assert.match(skill, /non-goal conflicts block saving/i);
  assert.match(skill, /decision\.json/);
});

test("Strategy exposes stable tokens without expanding the interview ceremony", () => {
  const skill = read("skills/strategy/SKILL.md");
  assert.match(skill, /One question at a time/i);
  assert.match(skill, /strategy\.decision\.json/);
  assert.match(skill, /preserve the decision ID and unchanged tokens/i);
});

test("Features reconciles identity before review and writes both readers from one record", () => {
  const reference = read("skills/dev/references/features.md");
  assert.match(reference, /reconcile-features/);
  assert.match(reference, /Never write an ambiguous inventory/i);
  assert.match(reference, /Render `features\.md` from the approved in-memory record/);
  assert.match(reference, /features\.json/);
  assert.match(reference, /product-reasoning-quality-check/);
  assert.match(reference, /git ls-tree -r --name-only <commit>/);
  assert.match(reference, /git show <commit>:<path>/);
  assert.match(reference, /never from working-tree paths/i);
  assert.doesNotMatch(reference, /`pm\/product\/features\.(?:md|json)`/);
  assert.match(reference, /`\{pm_dir\}\/product\/features\.md`/);
  assert.match(reference, /`\{pm_dir\}\/product\/features\.json`/);
  const entry = read("skills/features/SKILL.md");
  assert.doesNotMatch(entry, /`pm\/product\/features\.(?:md|json)`/);
  assert.match(entry, /`\{pm_dir\}\/product\/features\.md`/);
  assert.match(entry, /`\{pm_dir\}\/product\/features\.json`/);
});

test("Groom consumes and closes Think or Ideate lineage only after approval", () => {
  const intake = read("skills/groom/steps/01-intake.md");
  const handoff = read("skills/groom/steps/10-handoff.md");
  assert.match(intake, /decision companion[\s\S]*origin lineage/i);
  assert.match(handoff, /atomic `promote` transition/);
  assert.match(handoff, /after the approved canonical proposal/i);
});

test("shared artifact reference keeps Markdown primary and machine fields portable", () => {
  const reference = read("references/product-reasoning.md");
  assert.match(reference, /Markdown remains the canonical human reader/);
  assert.match(reference, /Never publish absolute paths/);
  assert.match(reference, /relative to `\{pm_dir\}`/);
  assert.match(
    reference,
    /relative to `\{source_dir\}` at an exact Git commit or deterministic filesystem snapshot/
  );
  assert.match(reference, /confirmed decision has at least two materially distinct alternatives/i);
  assert.match(reference, /equal plausible matches[\s\S]*require user resolution/i);
  assert.match(reference, /score below 7\/10 is a quality failure/i);
});
