"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 Issue A-6
//
// Validates that extracting research SKILL.md into step files preserves all
// critical instructions. The step loader reads the shipped defaults (no user
// overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original research SKILL.md appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "research-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 5 step files exist and load
// ---------------------------------------------------------------------------

test("research steps: all 5 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);

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

test("research steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);

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
  // Step 1: Note Digest
  "digest",
  "note/digest.md",
  "quick-capture notes",

  // Step 2: Mode Routing
  "mode routing",
  "mode-routing.md",
  "landscape",
  "competitor",
  "topic",

  // Step 3: Landscape Mode
  "landscape",
  "market overview",
  "Key Players",
  "Keyword Landscape",
  "Market Positioning Map",
  "positioning",
  "insights/business/landscape.md",

  // Step 4: Competitor Mode
  "HARD-GATE",
  "synthesis",
  "profile.md",
  "features.md",
  "api.md",
  "seo.md",
  "sentiment.md",
  "competitor-profiling.md",
  "evidence/competitors",

  // Step 5: Topic Mode
  "evidence/research",
  "source_origin",
  "insight-routing.md",
  "evidence/research/index.md",
  "evidence/research/log.md",
  "strategy.md",

  // SEO Provider (referenced from steps, detail in references/seo-provider.md)
  "ahrefs",
  "config.json",
  "seo-provider.md",
];

test("research steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);
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

test("research steps: step names match expected structure", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);

    const expectedNames = [
      "Note Digest",
      "Mode Routing",
      "Landscape Mode",
      "Competitor Mode",
      "Topic Mode",
    ];

    const actualNames = steps.map((s) => s.name);
    assert.deepEqual(actualNames, expectedNames, "Step names should match expected structure");
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: Reference paths use ${CLAUDE_PLUGIN_ROOT} template variable
// ---------------------------------------------------------------------------

test("research steps: reference paths use ${CLAUDE_PLUGIN_ROOT} template variable", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const references = [
      "mode-routing.md",
      "competitor-profiling.md",
      "insight-routing.md",
      "note/digest.md",
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
// AC 6: Three research modes each have their own step
// ---------------------------------------------------------------------------

test("research steps: three research modes exist as separate steps", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("research", pmDir, PLUGIN_ROOT);

    const landscapeStep = steps.find((s) => s.name === "Landscape Mode");
    const competitorStep = steps.find((s) => s.name === "Competitor Mode");
    const topicStep = steps.find((s) => s.name === "Topic Mode");

    assert.ok(landscapeStep, "Landscape Mode step should exist");
    assert.ok(competitorStep, "Competitor Mode step should exist");
    assert.ok(topicStep, "Topic Mode step should exist");

    // Verify each mode has unique content
    assert.ok(
      landscapeStep.body.includes("market overview"),
      "Landscape should reference market overview"
    );
    assert.ok(
      competitorStep.body.includes("HARD-GATE"),
      "Competitor should include HARD-GATE for synthesis"
    );
    assert.ok(
      topicStep.body.includes("evidence/research"),
      "Topic should write to evidence/research"
    );
  } finally {
    cleanup();
  }
});
