"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-227 Issue 3
//
// Validates that the rfc skill step files load correctly and contain all
// critical instructions. Mirrors the dev/groom regression test pattern.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rfc-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 4 phase-local step files exist and load
// ---------------------------------------------------------------------------

test("rfc steps: all 4 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("rfc", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 4, `Expected 4 steps, got ${steps.length}`);

    // Verify each step has a valid order and non-empty body
    for (let i = 0; i < steps.length; i++) {
      assert.ok(steps[i].order > 0, `Step ${i} should have positive order`);
      assert.ok(steps[i].body.trim().length > 0, `Step ${i} body should not be empty`);
      assert.equal(steps[i].enabled, true, `Step ${i} should be enabled by default`);
      assert.equal(steps[i].source, "default", `Step ${i} source should be "default"`);
    }

    // Verify order is strictly increasing
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i].order > steps[i - 1].order, `Steps should be in increasing order`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 2: Each step has valid frontmatter
// ---------------------------------------------------------------------------

test("rfc steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("rfc", pmDir, PLUGIN_ROOT);

    for (const step of steps) {
      assert.ok(
        !step.name.match(/^\d+-/),
        `Step "${step.name}" should have a human-readable name from frontmatter, not filename`
      );
      assert.ok(step.description.length > 0, `Step "${step.name}" should have a description`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 3: Critical keywords preserved in concatenated output
// ---------------------------------------------------------------------------

const CRITICAL_KEYWORDS = [
  // Step 1: Intake
  "size gate",
  "canonical session",
  "acceptance criteria",

  // Step 2: RFC Generation
  "writing-rfcs.md",
  "rfc-prompt.js",
  "sidecar_hash",

  // Step 3: RFC Review
  "architecture-risk",
  "test-strategy",
  "maintainability",
  "cross-cutting integration",
  "awaiting_approval",

  // Step 4: approval and handoff
  "rfc-session.js approve",
  "linear_create",
  "loop_approval",
  "pm:dev {slug}",
];

test("rfc steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("rfc", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const missing = [];
    for (const keyword of CRITICAL_KEYWORDS) {
      if (!prompt.includes(keyword)) {
        missing.push(keyword);
      }
    }

    assert.equal(
      missing.length,
      0,
      `Missing critical keywords in concatenated output:\n  ${missing.join("\n  ")}`
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 4: No stale {WORKTREE_PATH} references
// ---------------------------------------------------------------------------

test("rfc steps: no stale {WORKTREE_PATH} template references", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("rfc", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    assert.ok(
      !prompt.includes("{WORKTREE_PATH}"),
      "RFC steps should not contain {WORKTREE_PATH} — replaced with {CWD}"
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: Reference paths use ${CLAUDE_PLUGIN_ROOT} template variable
// ---------------------------------------------------------------------------

test("rfc steps: phase references are declared in requires metadata", () => {
  const generation = fs.readFileSync(
    path.join(PLUGIN_ROOT, "skills/rfc/steps/02-rfc-generation.md"),
    "utf8"
  );
  const review = fs.readFileSync(
    path.join(PLUGIN_ROOT, "skills/rfc/steps/03-rfc-review.md"),
    "utf8"
  );
  for (const ref of ["writing-rfcs.md", "splitting-patterns.md", "rfc-template.md"]) {
    assert.ok(generation.includes(ref), `Generation requires must include ${ref}`);
  }
  for (const ref of ["review-contract.md", "cross-cutting-reviewers.md", "test-layers.md"]) {
    assert.ok(review.includes(ref), `Review requires must include ${ref}`);
  }
});
