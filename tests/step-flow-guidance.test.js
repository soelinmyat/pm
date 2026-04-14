"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { loadWorkflow } = require("../scripts/step-loader");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "step-flow-guidance-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return {
    pmDir,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

// All skills that have step files
const SKILLS = [
  "dev",
  "groom",
  "ideate",
  "ingest",
  "note",
  "refresh",
  "research",
  "rfc",
  "setup",
  "ship",
  "start",
  "strategy",
  "sync",
  "think",
  "using-pm",
];

// Patterns that count as mid-step advancement language
const MID_STEP_PATTERNS = [
  /\*\*Advance:\*\*/i,
  /advance to step/i,
  /proceed to step/i,
  /continue to step/i,
  /skip to step/i,
  /proceed to (?:the )?next step/i,
  /proceed (?:directly )?to/i,
  /advance (?:directly )?to/i,
  /return here/i,
  /<HARD-GATE>/,
  /do NOT proceed/i,
  /do not proceed/i,
  /wait for .* before/i,
  /before advancing/i,
  /may the workflow advance/i,
];

// Patterns that count as final-step next-action language
const FINAL_STEP_PATTERNS = [
  /next:?\s+run/i,
  /run [`']?\/pm:/i,
  /run [`']?pm:/i,
  /w(?:hat|hich) would you like/i,
  /want to/i,
  /options?:/i,
  /\(a\)/i,
  /proceed to/i,
  /grooming complete/i,
  /complete\./i,
  /rfc approved/i,
  /dev session/i,
  /session paused/i,
];

test("every non-final step has advancement language in Done-when or body", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  const missing = [];

  try {
    for (const skill of SKILLS) {
      const steps = loadWorkflow(skill, pmDir, PLUGIN_ROOT);
      if (steps.length === 0) continue;

      // Final step = highest order
      const maxOrder = Math.max(...steps.map((s) => s.order));

      for (const step of steps) {
        if (step.order === maxOrder) continue; // skip final step

        const body = step.body;
        const hasAdvancement = MID_STEP_PATTERNS.some((p) => p.test(body));

        if (!hasAdvancement) {
          missing.push(`${skill}/step-${step.order} (${step.name})`);
        }
      }
    }

    assert.equal(
      missing.length,
      0,
      `Non-final steps missing advancement language:\n  - ${missing.join("\n  - ")}`
    );
  } finally {
    cleanup();
  }
});

test("every final step has next-action language", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  const missing = [];

  try {
    for (const skill of SKILLS) {
      const steps = loadWorkflow(skill, pmDir, PLUGIN_ROOT);
      if (steps.length === 0) continue;

      const maxOrder = Math.max(...steps.map((s) => s.order));
      const finalStep = steps.find((s) => s.order === maxOrder);

      const body = finalStep.body;
      const hasNextAction = FINAL_STEP_PATTERNS.some((p) => p.test(body));

      if (!hasNextAction) {
        missing.push(`${skill}/step-${finalStep.order} (${finalStep.name})`);
      }
    }

    assert.equal(
      missing.length,
      0,
      `Final steps missing next-action language:\n  - ${missing.join("\n  - ")}`
    );
  } finally {
    cleanup();
  }
});

test("skill-runtime.md contains Step Transitions section", () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, "references", "skill-runtime.md"), "utf8");

  assert.match(text, /## Step Transitions/);
  assert.match(text, /### Mid-step advancement/);
  assert.match(text, /### Final-step completion/);
  assert.match(text, /\*\*Advance:\*\*/);
});

test("AGENTS.md Done-when description mentions advancement directive", () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, "AGENTS.md"), "utf8");

  assert.match(text, /advancement directive/i);
  assert.match(text, /skill-runtime\.md/);
});
