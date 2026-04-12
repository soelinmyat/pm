"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 A-3
//
// Validates that extracting setup SKILL.md flow into step files preserves
// all critical instructions. The step loader reads the shipped defaults (no
// user overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original flow appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "setup-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 3 step files exist and load
// ---------------------------------------------------------------------------

test("setup steps: all 3 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("setup", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 3, `Expected 3 steps, got ${steps.length}`);

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

test("setup steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("setup", pmDir, PLUGIN_ROOT);

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
  // Step 1: Parse Args
  "enable",
  "disable",
  "linear",
  "ahrefs",
  "separate-repo",
  "config.json",

  // Step 2: Update Config
  "config_schema",
  "pm_repo",
  "source_repo",
  "integrations.linear.enabled",
  "integrations.seo.provider",
  "Linear enable extras",

  // Step 3: Confirm
  "pm:start",
];

test("setup steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("setup", pmDir, PLUGIN_ROOT);
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
// AC 4: Step names match expected beats
// ---------------------------------------------------------------------------

test("setup steps: step names match expected beats", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("setup", pmDir, PLUGIN_ROOT);
    const names = steps.map((s) => s.name);

    assert.deepEqual(names, ["Parse Args", "Update Config", "Confirm"]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: Separate-repo reference file exists and is referenced from steps
// ---------------------------------------------------------------------------

test("setup steps: separate-repo reference is referenced from step content", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("setup", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    // The parse-args step should reference the separate-repo reference file
    assert.ok(
      prompt.includes("separate-repo.md"),
      "Step content should reference separate-repo.md"
    );

    // Verify the reference file actually exists
    const refPath = path.join(PLUGIN_ROOT, "skills", "setup", "references", "separate-repo.md");
    assert.ok(fs.existsSync(refPath), `Reference file should exist at ${refPath}`);
  } finally {
    cleanup();
  }
});
