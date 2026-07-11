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
// AC 1: All 10 phase-local step files exist and load.
// ---------------------------------------------------------------------------

test("dev steps: all 10 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 10, `Expected 10 steps, got ${steps.length}`);

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
  "command -v gh",
  "source_dir",
  "memory.md",
  'dev-session.js" route',
  "risk-routing.md",
  "git worktree add",
  "AGENTS.md",
  "pm:groom",
  "analyzeWorkUnits",
  "pm:review",
  "session.routing.review_mode",
  "scripts/dev-gate-check.js",
  "git worktree remove",
  "Status Updates",
  "status: done",
  "Auto-Extract Learnings",
  "knowledge-writeback.js",
  "dev-sessions/{slug}/session.json",
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
    const subSkills = ["pm:groom", "pm:review"];
    for (const skill of subSkills) {
      assert.ok(prompt.includes(skill), `Sub-skill reference "${skill}" should be in output`);
    }
    // tdd, debugging, subagent-dev are now references, not sub-skills
    const implementation = steps.find((step) => step.phase === "implementation");
    const demotedRefs = ["tdd.md", "subagent-dev.md", "implementation-flow.md"];
    for (const ref of demotedRefs) {
      assert.ok(
        implementation.requires.includes(ref),
        `Implementation metadata should require "${ref}" just in time`
      );
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// AC 5: ${CLAUDE_PLUGIN_ROOT} template variables used for references
// ---------------------------------------------------------------------------

test("dev steps: active commands use ${CLAUDE_PLUGIN_ROOT} while references are metadata", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const writebackReference = path.join(PLUGIN_ROOT, "references", "knowledge-writeback.md");
    assert.ok(
      fs.existsSync(writebackReference),
      "knowledge-writeback.md should exist in references/"
    );

    assert.ok(prompt.includes(`\${CLAUDE_PLUGIN_ROOT}`));
    assert.ok(prompt.includes("knowledge-writeback.md"));
    const implementation = steps.find((step) => step.phase === "implementation");
    assert.ok(implementation.requires.includes("implementation-flow.md"));
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

test("dev steps: worktree cleanup remains in the phase-local Ship step", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("dev", pmDir, PLUGIN_ROOT);
    const ship = steps.find((s) => s.phase === "ship");
    assert.ok(ship, "Ship phase should exist");
    assert.ok(
      ship.body.includes("git worktree remove") || ship.body.includes("Worktree Cleanup"),
      "Ship step should contain worktree cleanup content"
    );
  } finally {
    cleanup();
  }
});
