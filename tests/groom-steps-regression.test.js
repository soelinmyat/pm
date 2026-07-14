"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

const ROOT = path.resolve(__dirname, "..");
const EXPECTED = [
  "Intake",
  "Research",
  "Scope",
  "Synthesis",
  "Design",
  "Draft",
  "Review",
  "Presentation",
  "Approval",
  "Handoff",
  "Retro",
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "groom-v2-steps-"));
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(pmDir);
  return { pmDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("Groom v2 loads one ordered provider-neutral phase sequence", () => {
  const fx = fixture();
  try {
    const steps = loadWorkflow("groom", fx.pmDir, ROOT);
    assert.deepEqual(
      steps.map((step) => step.name),
      EXPECTED
    );
    assert.deepEqual(
      steps.map((step) => step.order),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
    );
    for (const step of steps) {
      assert.equal(step.enabled, true);
      assert.equal(step.source, "default");
      assert.ok(step.description.length > 0);
      assert.match(step.body, /## Goal/);
      assert.match(step.body, /## How/);
      assert.match(step.body, /## Done-when/);
    }
  } finally {
    fx.cleanup();
  }
});

test("Groom v2 tier filtering changes depth but preserves integrity phases", () => {
  const fx = fixture();
  try {
    const steps = loadWorkflow("groom", fx.pmDir, ROOT);
    const names = (tier) => {
      const prompt = buildPrompt(steps, { tier });
      return EXPECTED.filter((name) => prompt.includes(`: ${name}`));
    };
    assert.deepEqual(names("quick"), [
      "Intake",
      "Research",
      "Scope",
      "Draft",
      "Approval",
      "Handoff",
      "Retro",
    ]);
    assert.deepEqual(names("standard"), [
      "Intake",
      "Research",
      "Scope",
      "Synthesis",
      "Design",
      "Draft",
      "Review",
      "Approval",
      "Handoff",
      "Retro",
    ]);
    assert.deepEqual(names("full"), EXPECTED);
    assert.deepEqual(names("agent"), EXPECTED);
  } finally {
    fx.cleanup();
  }
});

test("Groom v2 prompt carries source, approval, review-question, and handoff invariants", () => {
  const fx = fixture();
  try {
    const prompt = buildPrompt(loadWorkflow("groom", fx.pmDir, ROOT), { tier: "full" });
    for (const required of [
      "groom-session.js",
      "proposal-render.js",
      "proposal-check.js",
      "canonical proposal JSON",
      "question coverage",
      "approval audit",
      "hash/revision-bound",
      "RFC/Dev",
      "idempotent effect receipt",
    ]) {
      assert.ok(prompt.toLowerCase().includes(required.toLowerCase()), `missing ${required}`);
    }
    assert.doesNotMatch(prompt, /claude-only|exactly three reviewers|maintain.*html.*by hand/i);
  } finally {
    fx.cleanup();
  }
});

test("Groom v2 has no agent-only duplicate steps or stale phases directory", () => {
  const stepDir = path.join(ROOT, "skills", "groom", "steps");
  assert.equal(fs.existsSync(path.join(ROOT, "skills", "groom", "phases")), false);
  assert.equal(
    fs.readdirSync(stepDir).some((name) => /\d+a-/.test(name)),
    false
  );
});

test("Groom proposal format declares canonical JSON and generated projections", () => {
  const text = fs.readFileSync(
    path.join(ROOT, "skills", "groom", "references", "proposal-format.md"),
    "utf8"
  );
  assert.match(text, /canonical.*\.json/i);
  assert.match(text, /generated.*HTML/i);
  assert.match(text, /generated.*Markdown/i);
  assert.match(text, /approval/i);
});

test("Groom review and approval steps close the canonical lifecycle mechanically", () => {
  const review = fs.readFileSync(
    path.join(ROOT, "skills", "groom", "steps", "07-review.md"),
    "utf8"
  );
  const approval = fs.readFileSync(
    path.join(ROOT, "skills", "groom", "steps", "09-approval.md"),
    "utf8"
  );

  assert.match(review, /review\.status: passed/i);
  assert.match(review, /draft` to `reviewed/i);
  assert.match(review, /proposal-check\.js --projections/i);
  assert.match(approval, /review:quick-integrity/i);
  assert.match(approval, /draft → reviewed/i);
  assert.match(approval, /reviewed` to `approved/i);
  assert.match(approval, /exact approved bytes/i);
  assert.match(approval, /session decision ID\/hash/i);
});
