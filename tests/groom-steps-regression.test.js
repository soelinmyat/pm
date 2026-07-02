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

test("groom steps: all step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("groom", pmDir, PLUGIN_ROOT);

    // 10 primary co-pilot steps + 2 agent-tier variant steps (PM-233):
    // 01a-intake-agent, 04a-synthesis. Since v1.9 the review gates (05, 08)
    // carry agent-tier parameter blocks instead of variant files, and the
    // bar raiser runs concurrently inside step 08.
    assert.equal(
      steps.length,
      12,
      `Expected 12 steps (10 primary + 2 agent variants), got ${steps.length}`
    );

    // Verify each step has a valid order and non-empty body
    for (let i = 0; i < steps.length; i++) {
      assert.ok(steps[i].order > 0, `Step ${i} should have positive order`);
      assert.ok(steps[i].body.trim().length > 0, `Step ${i} body should not be empty`);
      assert.equal(steps[i].enabled, true, `Step ${i} should be enabled by default`);
      assert.equal(steps[i].source, "default", `Step ${i} source should be "default"`);
    }

    // Verify order is strictly increasing — agent variants slot in via
    // decimal order (1.1, 4.1, 5.1, 8.1) so the sequence stays monotonic
    // when both co-pilot and agent steps are loaded together.
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

    // Co-pilot tiers (quick / standard / full) run a contiguous 11-step
    // sequence. Agent tier (PM-233) inserts variant steps that replace
    // specific co-pilot steps via `applies_to: [agent]`. The variants
    // appear in load order between their co-pilot siblings:
    //   01 → 01a → 02 → 03 → 04 → 04a → 05 → 06 → 07 → 08 → 10 → 11
    const expectedNames = [
      "Intake",
      "Intake (agent)",
      "Strategy Check",
      "Research",
      "Scope",
      "Synthesis (agent)",
      "Scope Review",
      "Design",
      "Draft Proposal",
      "Team Review",
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
  const groomSkillPath = path.join(PLUGIN_ROOT, "skills", "groom", "SKILL.md");

  assert.ok(fs.existsSync(tierGatingPath), "tier-gating.md should exist in references/");
  assert.ok(fs.existsSync(groomSkillPath), "groom SKILL.md should exist");

  const tierGatingContent = fs.readFileSync(tierGatingPath, "utf8");
  const skillContent = fs.readFileSync(groomSkillPath, "utf8");

  // Tier-gating.md covers selection logic, KB-maturity cap, and research routing.
  const tierGatingKeywords = [
    "quick",
    "standard",
    "full",
    "groom_tier",
    "HARD-GATE",
    "kb_maturity_tier",
  ];
  for (const kw of tierGatingKeywords) {
    assert.ok(tierGatingContent.includes(kw), `tier-gating.md should contain "${kw}"`);
  }

  // The tier -> steps matrix is inlined in SKILL.md so the happy path is visible.
  const skillMatrixKeywords = ["scope-review", "team-review", "bar-raiser"];
  for (const kw of skillMatrixKeywords) {
    assert.ok(skillContent.includes(kw), `groom/SKILL.md should contain "${kw}" (tier matrix)`);
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
          ["quick", "standard", "full", "agent"].includes(tier),
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
    assert.ok(
      !prompt.includes("Step 8: Team Review"),
      "quick tier should NOT include Team Review (which carries the concurrent bar raiser)"
    );
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
      "standard tier should NOT include Team Review (which carries the concurrent bar raiser)"
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

    // Full tier includes every primary step (step 9 was absorbed into step 8's
    // concurrent wave in v1.9, so its number is a deliberate gap)
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]) {
      assert.ok(prompt.includes(`Step ${i}:`), `full tier should include Step ${i}`);
    }
    assert.ok(prompt.includes("Bar Raiser"), "full tier runs the bar raiser inside step 8");
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
    for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]) {
      assert.ok(promptNoTier.includes(`Step ${i}:`), `no-tier prompt should include Step ${i}`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 11: Proposal section consistency — proposal-format.md is the authority
//
// The doc itself declares its contract twice in two parseable forms: the
// "Section name discipline" table (the contract) and the ```markdown
// template block (the canonical body shape). The point of the test is to
// catch drift BETWEEN those two views — not to mirror them in a hardcoded
// list that has to be hand-patched on every template refresh.
// ---------------------------------------------------------------------------

test("groom steps: proposal-format.md template and discipline table agree", () => {
  const proposalFormatPath = path.join(
    PLUGIN_ROOT,
    "skills",
    "groom",
    "references",
    "proposal-format.md"
  );
  const lines = fs.readFileSync(proposalFormatPath, "utf8").split("\n");

  // 1. Extract the H2 headings from the ```markdown template block. The block
  //    contains nested fences (mermaid, yaml) so a non-greedy regex stops at
  //    the wrong place — walk lines and track fence depth instead.
  const startIdx = lines.findIndex((l) => l.trim() === "```markdown");
  assert.notEqual(startIdx, -1, "must contain a ```markdown template block");

  let depth = 1; // the ```markdown line itself opens depth 1
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith("```")) continue;
    // Bare ``` closes the innermost fence; ```<lang> opens a nested one.
    depth += t === "```" ? -1 : 1;
    if (depth === 0) {
      endIdx = i;
      break;
    }
  }
  assert.notEqual(endIdx, -1, "```markdown template block must be closed");

  const templateH2 = lines
    .slice(startIdx + 1, endIdx)
    .filter((l) => /^## /.test(l))
    .map((l) => l.replace(/^## /, "").trim());

  // 2. Parse the "Section name discipline" table — rows look like
  //    | I | Problem & Context | `problem` |
  //    The doc explicitly names this table as the contract: "H2 headings in
  //    the markdown MUST be the twelve Roman-numeralled names below."
  const tableRowRe = /^\|\s*([IVX]+)\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$/;
  const tableRows = lines
    .map((l) => l.match(tableRowRe))
    .filter(Boolean)
    .map((m) => ({ roman: m[1], heading: m[2].trim(), anchor: m[3] }));

  assert.ok(
    tableRows.length >= 1,
    "Section name discipline table must be present with at least one row"
  );

  // 3. TL;DR sits before Section I with no Roman numeral — explicitly called
  //    out in the doc as not-a-section. The template's first H2 must be it.
  assert.equal(
    templateH2[0],
    "TL;DR",
    "first H2 in the template must be TL;DR (the elevator pitch, before Section I)"
  );

  // 4. After TL;DR, the template's H2s must match the discipline table row-
  //    for-row, in order. Drift in either file fails the test loudly.
  const expectedFromTable = tableRows.map((r) => `${r.roman}. ${r.heading}`);
  assert.deepEqual(
    templateH2.slice(1),
    expectedFromTable,
    "template H2 headings (after TL;DR) must match the Section name discipline table, in order"
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
