"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 Issue A-7
//
// Validates that extracting refresh SKILL.md into step files preserves all
// critical instructions. The step loader reads the shipped defaults (no user
// overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original refresh SKILL.md appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 5 step files exist and load
// ---------------------------------------------------------------------------

test("refresh steps: all 5 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 5, `Expected 5 steps, got ${steps.length}`);

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

test("refresh steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);

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
  // Step 1: Mode Routing
  "mode-routing.md",
  "domain discovery",
  "consolidate",

  // Step 2: Audit
  "audit",
  "staleness",
  "hot-index.js",
  "Missing File Detection",
  "cost guardrail",
  "Ahrefs",

  // Step 3: Execute
  "Execute",
  "origin",
  "validate.js",
  "insight-routing.md",
  "Patch Rules",
  "Trust Levels",
  "Synthesis File Refresh",
  "competitor-profiling.md",
  "review-mining.md",

  // Step 4: Consolidation
  "consolidation",
  "Overlap detection",
  "Cross-domain tunnels",
  "Orphan lint",
  "Contradiction detection",
  "hot-index.js",
  "insight-rewrite-template.md",

  // Step 5: Summary
  "summary",
  "Refresh Complete",
  "source_origin",
];

test("refresh steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);
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
// AC 4: Step name mapping
// ---------------------------------------------------------------------------

test("refresh steps: step names match expected structure", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);

    const expectedNames = ["Mode Routing", "Audit", "Execute", "Consolidation", "Summary"];

    const actualNames = steps.map((s) => s.name);
    assert.deepEqual(actualNames, expectedNames, "Step names should match expected structure");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: Reference paths use ${CLAUDE_PLUGIN_ROOT} template variable
// ---------------------------------------------------------------------------

test("refresh steps: reference paths use ${CLAUDE_PLUGIN_ROOT} template variable", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const references = [
      "mode-routing.md",
      "staleness-thresholds.md",
      "origin-rules.md",
      "validate.js",
      "hot-index.js",
      "insight-routing.md",
    ];

    for (const ref of references) {
      assert.ok(
        prompt.includes(`\${CLAUDE_PLUGIN_ROOT}`) && prompt.includes(ref),
        `Reference "${ref}" should use \${CLAUDE_PLUGIN_ROOT} variable`
      );
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 6: Consolidation step contains all 7 internal sub-steps
// ---------------------------------------------------------------------------

test("refresh steps: consolidation step contains all 7 internal sub-steps", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("refresh", pmDir, PLUGIN_ROOT);
    const consolidation = steps.find((s) => s.name === "Consolidation");

    assert.ok(consolidation, "Consolidation step should exist");

    const internalSteps = [
      "Step 1: Load insight data",
      "Step 2: Overlap detection",
      "Step 3: Cross-domain tunnels",
      "Step 4: Orphan lint",
      "Step 5: Contradiction detection",
      "Step 6: Regenerate hot index",
      "Step 7: Final validation",
    ];

    for (const step of internalSteps) {
      assert.ok(
        consolidation.body.includes(step),
        `Consolidation should contain internal "${step}"`
      );
    }
  } finally {
    cleanup();
  }
});
