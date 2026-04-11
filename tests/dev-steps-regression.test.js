"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for Issue 2 (PM-170)
//
// Validates that extracting dev-flow.md into step files preserves all critical
// instructions. The step loader reads the shipped defaults (no user overrides)
// and builds a concatenated prompt. We assert that critical keywords from the
// original dev-flow.md appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

// We create a fake pmDir that has no user overrides — this forces the loader
// to read only the shipped defaults in skills/dev/steps/.
const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dev-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// AC 1: All 11 step files exist and load
// ---------------------------------------------------------------------------

test("dev steps: all 11 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);

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

test("dev steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);

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
// AC 4 + AC 6: Output quality regression — critical instructions preserved
// ---------------------------------------------------------------------------

// Critical instruction keywords from dev-flow.md that MUST appear in the
// concatenated output. Organized by the stage they originate from.
const CRITICAL_KEYWORDS = [
  // Stage 0.5: Tool Check
  "command -v gh",
  "GitHub CLI",

  // Stage 0.7: Source Repo Access Check
  "source_dir",
  "source code indicators",
  "package.json",
  "Cargo.toml",

  // Stage 1: Intake
  "Load learnings",
  "memory.md",
  "Classify size",
  "Confirm size with user",

  // Stage Routing by Size table
  "Worktree",
  "RFC check",
  "RFC generation",
  "Simplify",
  "Design critique",
  "Verification gate",

  // Stage 2: Workspace
  "git worktree add",
  "Worktree environment prep",
  "Workspace verification",
  "AGENTS.md",

  // Stage 2.5: RFC Check / Groom Readiness
  "rfc-approved",
  "backlog/{slug}.md",
  "pm:groom",
  "KB maturity",
  "kb_maturity",

  // Stage 3: RFC Generation
  "RFC_COMPLETE",
  "writing-rfcs.md",
  "splitting-patterns.md",
  "rfc-reference.html",
  "rfc-template.md",

  // Stage 4: RFC Review — @persona references resolve to persona body content,
  // so we check for the resolved persona names rather than the @reference syntax
  "Adversarial Engineer",
  "Staff Engineer",
  "cross-cutting-review-prompts.md",
  "Handling findings",
  "Blocking issues",

  // Stage 5: Implementation
  "implementation-flow.md",
  "pm:simplify",
  "pm:tdd",
  "merge-loop",

  // Stage 6: Worktree Cleanup (folded into 10-ship.md)
  "git worktree remove",
  "Leftover worktrees",

  // Stage 7: Retro
  "Compound Learning",
  "memory.md",
  "50 entries",

  // Status Updates
  "Status Updates",
  "status: done",

  // Continuous Execution
  "Continuous Execution",
  "HARD-RULE",

  // Multi-task
  "task_count",
  "Sequential execution",

  // State file
  "dev-sessions",
  "single source of truth",
];

test("dev steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
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
// AC 3: Sub-skill invocations preserved (not replaced by personas)
// ---------------------------------------------------------------------------

test("dev steps: sub-skill invocations use Invoke pm:{skill} syntax", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    // These sub-skill references must be preserved
    const subSkills = ["pm:groom", "pm:simplify", "pm:tdd"];
    for (const skill of subSkills) {
      assert.ok(prompt.includes(skill), `Sub-skill reference "${skill}" should be in output`);
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: ${CLAUDE_PLUGIN_ROOT} template variables used for references
// ---------------------------------------------------------------------------

test("dev steps: reference paths use ${CLAUDE_PLUGIN_ROOT} template variable", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const references = ["writing-rfcs.md", "splitting-patterns.md", "implementation-flow.md"];

    for (const ref of references) {
      // Find the reference and verify it uses ${CLAUDE_PLUGIN_ROOT}
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
// AC 7: Stage mapping — folded stages
// ---------------------------------------------------------------------------

test("dev steps: Stage 0.7 content folded into 01-tool-check", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const toolCheck = steps.find((s) => s.order === 1);
    assert.ok(toolCheck, "Step with order 1 should exist");
    assert.ok(
      toolCheck.body.includes("Source Repo Access Check") || toolCheck.body.includes("source_dir"),
      "Tool check step should contain Source Repo Access Check content"
    );
  } finally {
    cleanup();
  }
});

test("dev steps: Stage 6 (Worktree Cleanup) folded into 10-ship", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const ship = steps.find((s) => s.order === 10);
    assert.ok(ship, "Step with order 10 should exist");
    assert.ok(
      ship.body.includes("git worktree remove") || ship.body.includes("Worktree Cleanup"),
      "Ship step should contain worktree cleanup content"
    );
  } finally {
    cleanup();
  }
});
