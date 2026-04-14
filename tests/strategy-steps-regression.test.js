"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 A-2
//
// Validates that extracting strategy SKILL.md flow into step files preserves
// all critical instructions. The step loader reads the shipped defaults (no
// user overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original flow appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "strategy-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 4 step files exist and load
// ---------------------------------------------------------------------------

test("strategy steps: all 4 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("strategy", pmDir, PLUGIN_ROOT);

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

test("strategy steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("strategy", pmDir, PLUGIN_ROOT);

    for (const step of steps) {
      // name should not be the raw filename stem (i.e. frontmatter name was set)
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
  // Step 1: Prerequisite Check
  "Prerequisite Check",
  "landscape.md",
  "landscape",

  // Step 2: Detect Existing Strategy
  "existing strategy",
  "STRATEGY.md",
  "PRODUCT.md",
  "PRD.md",
  "adopt",
  "start fresh",
  "Update Flow",
  "Surgical updates",

  // Step 3: Interview
  "interview",
  "interview-guide.md",
  "One question at a time",
  "landscape",
  "competitors",

  // Step 4: Write Strategy
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

test("strategy steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("strategy", pmDir, PLUGIN_ROOT);
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
// AC 4: Step names map to the 4 beats
// ---------------------------------------------------------------------------

test("strategy steps: step names match expected beats", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("strategy", pmDir, PLUGIN_ROOT);
    const names = steps.map((s) => s.name);

    assert.deepEqual(names, [
      "Prerequisite Check",
      "Detect Existing Strategy",
      "Interview",
      "Write Strategy",
    ]);
  } finally {
    cleanup();
  }
});
