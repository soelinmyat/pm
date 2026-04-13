"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 Issue A-8
//
// Validates that migrating groom phases/ to step files preserves all
// critical instructions. The step loader reads the shipped defaults (no user
// overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original groom phases appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "groom-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 11 step files exist and load
// ---------------------------------------------------------------------------

test("groom steps: all 11 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 11, `Expected 11 steps, got ${steps.length}`);

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

test("groom steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);

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
  "intake",
  "What's the idea",
  "topic slug",
  "KB maturity",
  "kb_maturity_tier",
  "groom-sessions",
  "codebase_available",
  "product_features_available",

  // Step 2: Strategy Check
  "Strategy Check",
  "strategy_check",
  "HARD-GATE",
  "groom_tier",
  "non-goals",
  "ICP fit",

  // Step 3: Research
  "research",
  "pm:research",
  "inline assessment",
  "research_location",
  "stale_research",
  "freshness check",

  // Step 4: Scope
  "scope",
  "scope-validation.md",
  "10x filter",
  "in_scope",
  "out_of_scope",
  "filter_result",

  // Step 5: Scope Review
  "scope-review",
  "product manager",
  "competitive strategist",
  "engineering manager",
  "scope_review",
  "blocking_issues_fixed",

  // Step 6: Design
  "design",
  "Design Exploration",
  "Tailwind",
  "wireframe",
  "design system",
  "mockup",

  // Step 7: Draft Proposal
  "draft-proposal",
  "Feature-type detection",
  "Mermaid",
  "proposal_path",
  "backlog",

  // Step 8: Team Review
  "team-review",
  "team_review",
  "team-review-prompts.md",
  "Proposal quality",
  "Competitive positioning",
  "Technical feasibility",
  "Flow completeness",

  // Step 9: Bar Raiser
  "bar-raiser",
  "bar_raiser",
  "product director",
  "fresh eyes",
  "Send back to team",

  // Step 10: Present
  "present",
  "frontmatter-schemas.md",
  "type: backlog",
  "Resolved Questions",
  "Freshness Notes",

  // Step 11: Link
  "link",
  "linear_id",
  "validate.js",
  "retro extraction",
  "memory.md",
  "Grooming complete",
];

test("groom steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
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

test("groom steps: step names match expected structure", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);

    const expectedNames = [
      "Intake",
      "Strategy Check",
      "Research",
      "Scope",
      "Scope Review",
      "Design",
      "Draft Proposal",
      "Team Review",
      "Bar Raiser",
      "Present",
      "Link",
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

test("groom steps: reference paths use ${CLAUDE_PLUGIN_ROOT} template variable", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const references = [
      "scope-validation.md",
      "agent-runtime.md",
      "writing.md",
      "spec-document-reviewer-prompt.md",
      "frontmatter-schemas.md",
      "validate.js",
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
// AC 6: Orphan files moved to references
// ---------------------------------------------------------------------------

test("groom steps: ideate.md exists in references, not in steps", () => {
  const referencesDir = path.join(PLUGIN_ROOT, "skills", "groom", "references");
  const stepsDir = path.join(PLUGIN_ROOT, "skills", "groom", "steps");

  assert.ok(
    fs.existsSync(path.join(referencesDir, "ideate.md")),
    "ideate.md should exist in references/"
  );

  // Verify ideate.md is NOT in steps/
  const stepFiles = fs.readdirSync(stepsDir);
  assert.ok(!stepFiles.includes("ideate.md"), "ideate.md should NOT be in steps/");
});

// ---------------------------------------------------------------------------
// AC 7: Tier-gating reference exists
// ---------------------------------------------------------------------------

test("groom steps: tier-gating reference file exists with expected content", () => {
  const tierGatingPath = path.join(PLUGIN_ROOT, "skills", "groom", "references", "tier-gating.md");

  assert.ok(fs.existsSync(tierGatingPath), "tier-gating.md should exist in references/");

  const content = fs.readFileSync(tierGatingPath, "utf8");
  const expectedKeywords = [
    "quick",
    "standard",
    "full",
    "groom_tier",
    "HARD-GATE",
    "kb_maturity_tier",
    "scope-review",
    "team-review",
    "bar-raiser",
  ];

  for (const kw of expectedKeywords) {
    assert.ok(content.includes(kw), `tier-gating.md should contain "${kw}"`);
  }
});

// ---------------------------------------------------------------------------
// AC 8: phases/ directory no longer exists
// ---------------------------------------------------------------------------

test("groom steps: phases/ directory has been removed", () => {
  const phasesDir = path.join(PLUGIN_ROOT, "skills", "groom", "phases");
  assert.ok(!fs.existsSync(phasesDir), "phases/ directory should no longer exist");
});
