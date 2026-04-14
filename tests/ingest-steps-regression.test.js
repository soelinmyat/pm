"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 A-4
//
// Validates that extracting ingest SKILL.md flow into step files preserves
// all critical instructions. The step loader reads the shipped defaults (no
// user overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original flow appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 5 step files exist and load
// ---------------------------------------------------------------------------

test("ingest steps: all 5 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);

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

test("ingest steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);

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
  // Step 1: Intake
  "source_type",
  "manifest.json",
  "faster_whisper",
  "transcribe.py",
  "column mapping",

  // Step 2: Normalize
  "normalize",
  "source_path",
  "PII",
  "portable source labels",
  "speaker_role",

  // Step 3: Synthesize
  "HARD-GATE",
  "synthesize",
  "hot-index.js",
  "problem clusters",
  "source_origin",
  "evidence_count",
  "evidence_type",
  "validate.js",

  // Step 4: Route Insights
  "insight-routing",
  "routing pass",

  // Step 5: Report
  "themes created or updated",
  "parse warnings",
  "$pm-strategy",
  "$pm-groom",
];

test("ingest steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);
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

test("ingest steps: step names match expected beats", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);
    const names = steps.map((s) => s.name);

    assert.deepEqual(names, ["Intake", "Normalize", "Synthesize", "Route Insights", "Report"]);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: Reference files exist and are referenced from steps
// ---------------------------------------------------------------------------

test("ingest steps: audio-pipeline reference is referenced from step content", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    // The normalize step should reference the audio-pipeline reference file
    assert.ok(
      prompt.includes("audio-pipeline.md"),
      "Step content should reference audio-pipeline.md"
    );

    // Verify the reference file actually exists
    const refPath = path.join(PLUGIN_ROOT, "skills", "ingest", "references", "audio-pipeline.md");
    assert.ok(fs.existsSync(refPath), `Reference file should exist at ${refPath}`);
  } finally {
    cleanup();
  }
});

test("ingest steps: mixed-origin-rules reference is referenced from step content", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ingest", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    // The synthesize step should reference the mixed-origin-rules reference file
    assert.ok(
      prompt.includes("mixed-origin-rules.md"),
      "Step content should reference mixed-origin-rules.md"
    );

    // Verify the reference file actually exists
    const refPath = path.join(
      PLUGIN_ROOT,
      "skills",
      "ingest",
      "references",
      "mixed-origin-rules.md"
    );
    assert.ok(fs.existsSync(refPath), `Reference file should exist at ${refPath}`);
  } finally {
    cleanup();
  }
});
