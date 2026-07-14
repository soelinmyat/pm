"use strict";

// Groom v2 agent-tier contract checks.
//
// These tests deliberately validate decision invariants rather than a model,
// provider, worker count, or persona topology. Execution mechanics may vary;
// evidence quality and coverage may not.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STEPS = path.join(ROOT, "skills", "groom", "steps");
const REFERENCES = path.join(ROOT, "skills", "groom", "references");

function readReference(file) {
  return fs.readFileSync(path.join(REFERENCES, file), "utf8");
}

test("agent tier has one provider-neutral intake and synthesis path", () => {
  const stepFiles = fs.readdirSync(STEPS).filter((file) => file.endsWith(".md"));
  const intake = fs.readFileSync(path.join(STEPS, "01-intake.md"), "utf8");

  assert.ok(!stepFiles.includes("01a-intake-agent.md"));
  assert.ok(!stepFiles.includes("04a-synthesis.md"));
  assert.match(intake, /agent.*not provider-locked/i);
  assert.doesNotMatch(intake, /refuse.*codex|claude-only/i);
});

test("agent eligibility uses explicit freshness and evidence thresholds", () => {
  const tier = readReference("tier-gating.md");

  assert.match(tier, /90 days/i);
  assert.match(tier, /at least three active hot insights/i);
  assert.match(tier, /at least two competitor profiles/i);
  assert.match(tier, /project-bounded citation or explicit assumption/i);
});

test("failed agent eligibility offers a recovery route without silent downgrade", () => {
  const tier = readReference("tier-gating.md");

  assert.match(tier, /offer `standard`/i);
  assert.match(tier, /pm:strategy/);
  assert.match(tier, /pm:research/);
  assert.match(tier, /do not silently downgrade/i);
});

test("runtime capability is probed rather than inferred from provider name", () => {
  const tier = readReference("tier-gating.md");

  assert.match(tier, /do not infer capability from a model\/provider name/i);
  assert.match(tier, /record actual runtime capability probes/i);
});

test("agent review adds citation integrity to full question coverage", () => {
  const tier = readReference("tier-gating.md");
  const questions = readReference("review-questions.md");

  assert.match(tier, /agent.*full plus sampled citation integrity/i);
  assert.match(questions, /Agent evidence question/);
  assert.match(questions, /Citation integrity/);
  assert.match(questions, /citations real, current, correctly attributed/i);
});

test("review correctness is independent of worker count and persona names", () => {
  const tier = readReference("tier-gating.md");
  const questions = readReference("review-questions.md");

  assert.match(tier, /Question coverage is authoritative/i);
  assert.match(tier, /Worker count and persona names are execution details/i);
  assert.match(questions, /Never encode correctness as a fixed worker count or persona list/i);
});

test("review results bind complete question coverage to a frozen revision", () => {
  const questions = readReference("review-questions.md");

  assert.match(questions, /frozen proposal revision\/hash/i);
  assert.match(questions, /no `blocking` answer remains/i);
  assert.match(questions, /disputes are explicitly resolved/i);
});
