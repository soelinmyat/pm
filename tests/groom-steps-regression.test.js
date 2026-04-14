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
  "backlog_path",
  "backlog",

  // Step 8: Team Review
  "team-review",
  "team_review",
  "team-reviewers.md",
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
  "knowledge-writeback.md",
  "knowledge-writeback.js",
  "--pm-dir",
  "artifactMode",
  "decision-record",
  "routeSuggestions",
  "route-selection.js",
  "durable decision writeback",
  "evidence/research/{topic-slug}-decisions.md",
  "insight-routing.md",
  "insight-routing.js",
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
      "frontmatter-schemas.md",
      "validate.js",
      "knowledge-writeback.md",
    ];

    const writebackReference = path.join(PLUGIN_ROOT, "references", "knowledge-writeback.md");
    assert.ok(
      fs.existsSync(writebackReference),
      "knowledge-writeback.md should exist in references/"
    );

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

test("groom steps: ideate extracted to standalone skill", () => {
  const ideateSkill = path.join(PLUGIN_ROOT, "skills", "ideate", "SKILL.md");
  const groomRefsDir = path.join(PLUGIN_ROOT, "skills", "groom", "references");

  assert.ok(
    fs.existsSync(ideateSkill),
    "ideate should exist as a standalone skill at skills/ideate/SKILL.md"
  );

  // Verify ideate.md is no longer in groom/references/
  assert.ok(
    !fs.existsSync(path.join(groomRefsDir, "ideate.md")),
    "ideate.md should NOT be in groom/references/ (extracted to standalone skill)"
  );
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

// ---------------------------------------------------------------------------
// AC 9: Every groom step declares applies_to in frontmatter
// ---------------------------------------------------------------------------

test("groom steps: every step has applies_to tier metadata", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);

    for (const step of steps) {
      assert.ok(
        Array.isArray(step.appliesTo) && step.appliesTo.length > 0,
        `Step "${step.name}" must declare applies_to in frontmatter`
      );
      for (const tier of step.appliesTo) {
        assert.ok(
          ["quick", "standard", "full"].includes(tier),
          `Step "${step.name}" has invalid tier "${tier}" in applies_to`
        );
      }
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 10: Tier filtering — buildPrompt respects applies_to
// ---------------------------------------------------------------------------

test("groom steps: buildPrompt filters steps by tier (quick)", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps, { tier: "quick" });

    // Quick tier should include these steps
    assert.ok(prompt.includes("Step 1: Intake"), "quick tier should include Intake");
    assert.ok(
      prompt.includes("Step 2: Strategy Check"),
      "quick tier should include Strategy Check"
    );
    assert.ok(prompt.includes("Step 3: Research"), "quick tier should include Research");
    assert.ok(prompt.includes("Step 4: Scope"), "quick tier should include Scope");
    assert.ok(
      prompt.includes("Step 7: Draft Proposal"),
      "quick tier should include Draft Proposal"
    );
    assert.ok(prompt.includes("Step 11: Link"), "quick tier should include Link");

    // Quick tier should NOT include these steps
    assert.ok(
      !prompt.includes("Step 5: Scope Review"),
      "quick tier should NOT include Scope Review"
    );
    assert.ok(!prompt.includes("Step 6: Design"), "quick tier should NOT include Design");
    assert.ok(!prompt.includes("Step 8: Team Review"), "quick tier should NOT include Team Review");
    assert.ok(!prompt.includes("Step 9: Bar Raiser"), "quick tier should NOT include Bar Raiser");
    assert.ok(!prompt.includes("Step 10: Present"), "quick tier should NOT include Present");
  } finally {
    cleanup();
  }
});

test("groom steps: buildPrompt filters steps by tier (standard)", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps, { tier: "standard" });

    // Standard adds scope-review and design
    assert.ok(prompt.includes("Step 5: Scope Review"), "standard tier should include Scope Review");
    assert.ok(prompt.includes("Step 6: Design"), "standard tier should include Design");

    // Standard should NOT include full-only steps
    assert.ok(
      !prompt.includes("Step 8: Team Review"),
      "standard tier should NOT include Team Review"
    );
    assert.ok(
      !prompt.includes("Step 9: Bar Raiser"),
      "standard tier should NOT include Bar Raiser"
    );
    assert.ok(!prompt.includes("Step 10: Present"), "standard tier should NOT include Present");
  } finally {
    cleanup();
  }
});

test("groom steps: buildPrompt filters steps by tier (full)", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps, { tier: "full" });

    // Full tier should include all 11 steps
    for (let i = 1; i <= 11; i++) {
      assert.ok(prompt.includes(`Step ${i}:`), `full tier should include Step ${i}`);
    }
  } finally {
    cleanup();
  }
});

test("groom steps: buildPrompt without tier returns all enabled steps (backward compat)", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const promptNoTier = buildPrompt(steps);

    // Without tier, all enabled steps are included (same as full)
    for (let i = 1; i <= 11; i++) {
      assert.ok(promptNoTier.includes(`Step ${i}:`), `no-tier prompt should include Step ${i}`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 11: Proposal section consistency — proposal-format.md is the authority
// ---------------------------------------------------------------------------

test("groom steps: proposal-format.md section names are consistent", () => {
  const proposalFormatPath = path.join(
    PLUGIN_ROOT,
    "skills",
    "groom",
    "references",
    "proposal-format.md"
  );
  const content = fs.readFileSync(proposalFormatPath, "utf8");

  // Extract ## section headers from the template block (between ``` markers)
  const templateMatch = content.match(/```markdown\n---[\s\S]*?---\n([\s\S]*?)```/);
  assert.ok(templateMatch, "proposal-format.md should contain a markdown template block");

  const templateBody = templateMatch[1];
  const sectionHeaders = templateBody
    .split("\n")
    .filter((line) => /^## /.test(line))
    .map((line) => line.replace(/^## /, "").trim());

  const expectedSections = [
    "Outcome",
    "Problem & Context",
    "Scope",
    "User Flows",
    "Wireframes",
    "Competitive Context",
    "Technical Feasibility",
    "Review Summary",
    "Resolved Questions",
    "Freshness Notes",
    "Success Metrics",
    "Next Steps",
  ];

  assert.deepEqual(
    sectionHeaders,
    expectedSections,
    "proposal-format.md template sections must match the expected canonical list"
  );
});

// ---------------------------------------------------------------------------
// AC 12: No stale phases/ references in active docs
// ---------------------------------------------------------------------------

test("groom steps: no stale phases/ references in active skill and reference files", () => {
  // Check groom skill files, groom references, dev steps, dev references, and shared references
  const dirsToCheck = [
    path.join(PLUGIN_ROOT, "skills", "groom", "steps"),
    path.join(PLUGIN_ROOT, "skills", "groom", "references"),
    path.join(PLUGIN_ROOT, "skills", "dev", "steps"),
    path.join(PLUGIN_ROOT, "skills", "dev", "references"),
    path.join(PLUGIN_ROOT, "references"),
    path.join(PLUGIN_ROOT, "commands"),
  ];

  const staleRefs = [];

  for (const dir of dirsToCheck) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      const filePath = path.join(dir, entry);
      const content = fs.readFileSync(filePath, "utf8");
      if (content.includes("skills/groom/phases/")) {
        staleRefs.push(`${dir}/${entry}`);
      }
    }
  }

  assert.equal(
    staleRefs.length,
    0,
    `Stale phases/ references found in:\n  ${staleRefs.join("\n  ")}`
  );
});

// ---------------------------------------------------------------------------
// AC 13: Intake step has shared initialization block
// ---------------------------------------------------------------------------

test("groom steps: intake step has shared initialization for all entry paths", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);
    const intakeStep = steps.find((s) => s.name === "Intake");
    assert.ok(intakeStep, "Intake step should exist");

    const body = intakeStep.body;

    // Must have both Phase A and Phase B
    assert.ok(
      body.includes("Phase A: Context Gathering"),
      "Intake must have Phase A: Context Gathering"
    );
    assert.ok(
      body.includes("Phase B: Shared Initialization"),
      "Intake must have Phase B: Shared Initialization"
    );

    // Phase B must include critical init steps
    const phaseBStart = body.indexOf("Phase B: Shared Initialization");
    assert.ok(phaseBStart > 0, "Phase B must exist in body");
    const phaseB = body.slice(phaseBStart);

    assert.ok(
      phaseB.includes("KB maturity detection"),
      "Phase B must include KB maturity detection"
    );
    assert.ok(phaseB.includes("Write initial state"), "Phase B must include state file writing");
    assert.ok(
      phaseB.includes("Feature inventory check"),
      "Phase B must include feature inventory check"
    );

    // No entry path should say "Skip to step 3" anymore
    assert.ok(
      !body.includes("Skip to step 3"),
      "No entry path should skip to step 3 — all paths must go through Phase B"
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 14: scope-validation.md handles missing strategy context
// ---------------------------------------------------------------------------

test("groom steps: scope-validation handles missing strategy context", () => {
  const scopeValPath = path.join(
    PLUGIN_ROOT,
    "skills",
    "groom",
    "references",
    "scope-validation.md"
  );
  const content = fs.readFileSync(scopeValPath, "utf8");

  assert.ok(
    content.includes("strategy_check.context` is NOT available"),
    "scope-validation.md must handle missing strategy context"
  );
  assert.ok(
    content.includes("strategy_context_available: false"),
    "scope-validation.md must write strategy_context_available: false when context is missing"
  );
});
