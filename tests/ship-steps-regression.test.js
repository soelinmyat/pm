"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { loadWorkflow, buildPrompt } = require("../scripts/step-loader");

// ---------------------------------------------------------------------------
// Integration regression test for PM-185 Issue A-5
//
// Validates that extracting ship SKILL.md into step files preserves all
// critical instructions. The step loader reads the shipped defaults (no user
// overrides) and builds a concatenated prompt. We assert that critical
// keywords from the original ship SKILL.md appear in the output.
// ---------------------------------------------------------------------------

const PLUGIN_ROOT = path.resolve(__dirname, "..");

const fs = require("fs");
const os = require("os");

function makeFakePmDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-steps-regression-"));
  const pmDir = path.join(tmp, "pm");
  fs.mkdirSync(pmDir, { recursive: true });
  return { pmDir, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

// ---------------------------------------------------------------------------
// AC 1: All 7 step files exist and load
// ---------------------------------------------------------------------------

test("ship steps: all 7 step files load with correct order", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ship", pmDir, PLUGIN_ROOT);

    assert.equal(steps.length, 7, `Expected 7 steps, got ${steps.length}`);

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

test("ship steps: each step has name, order, and description in frontmatter", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ship", pmDir, PLUGIN_ROOT);

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
  // Step 1: Pre-flight
  "pre-flight",
  "command -v gh",
  "GitHub CLI",
  "git branch --show-current",
  "git status --porcelain",
  "DEFAULT_BRANCH",

  // Step 2: Conflict check
  "conflict",
  "git merge origin",
  "diff-filter=U",
  "lockfile",

  // Step 3: Review
  "prepare-release",
  "release-transaction.js",
  "ready: true",
  "review",
  "pm:review",
  "Review gate",
  "skills/review/SKILL.md",
  "handling-feedback.md",

  // Step 4: Push
  "push",
  "git push",
  "--no-verify",
  "pre-push",
  "timeout: 600000",

  // Step 5: Create PR
  "gh pr create",
  "gh pr view",
  "auto_merge",
  "preferences.ship",
  "config.json",
  "codex_review",

  // Step 6: CI Monitor
  "ci-monitor",
  "gh run list",
  "gh run watch",
  "--log-failed",
  "Max 3 CI fix attempts",

  // Step 7: Merge Loop
  "merge",
  "merge-loop.md",
  "gate-monitoring",
  "Auto-merge",
  "cleanup",
  "Product Memory",
  "backlog",
  "linear_id",
  "dev-sessions",
];

test("ship steps: concatenated output contains all critical instruction keywords", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ship", pmDir, PLUGIN_ROOT);
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

test("ship steps: step names match expected phase structure", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ship", pmDir, PLUGIN_ROOT);

    const expectedNames = [
      "Pre-flight",
      "Conflict Check",
      "Prepare Release and Review Gate",
      "Push",
      "Create or Detect PR",
      "CI Monitor",
      "Merge Loop",
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

test("ship steps: reference paths use ${CLAUDE_PLUGIN_ROOT} template variable", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const steps = loadWorkflow("ship", pmDir, PLUGIN_ROOT);
    const prompt = buildPrompt(steps);

    const references = [
      "merge-loop.md",
      "skills/review/SKILL.md",
      "handling-feedback.md",
      "release-transaction.md",
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
// Delivery safety: authority, exact repository identity, and recertification
// ---------------------------------------------------------------------------

test("standalone Ship persists independent push, PR, and merge authority", () => {
  const review = read("skills/ship/steps/03-review.md");
  const createPr = read("skills/ship/steps/05-create-pr.md");
  const merge = read("skills/ship/steps/07-merge-loop.md");
  const contract = read("skills/ship/references/delivery-contract.md");

  assert.match(contract, /dev-session\.js" authorize/);
  assert.match(contract, /push_feature_branch,create_pr/);
  assert.match(contract, /Do not infer merge authority from a request to push or create a PR/);
  assert.match(review, /persist action-specific user authority/);
  assert.match(createPr, /preferences\.ship\.auto_merge.*does not override/s);
  assert.match(merge, /canonical and snapshotted `merge: true`/);
  assert.match(merge, /preferences\.ship\.auto_merge.*never merge authority/s);
  assert.match(review, /standalone-routing-facts\.json/);
  assert.match(review, /dev-session\.js" route/);
  assert.match(review, /tdd, design-critique, qa, review, verification/);
  assert.match(review, /Do not advance with the initializer's placeholder route/);
});

test("Ship freezes and rejects changes to exact GitHub delivery identity", () => {
  const review = read("skills/ship/steps/03-review.md");
  const createPr = read("skills/ship/steps/05-create-pr.md");
  const contract = read("skills/ship/references/delivery-contract.md");

  assert.match(review, /delivery-contract\.json/);
  assert.match(review, /Multiple push URLs/);
  for (const field of [
    "push_url_sha256",
    "github_owner",
    "github_repository",
    "github_name_with_owner",
    "head_branch",
    "base_branch",
  ]) {
    assert.ok(contract.includes(`"${field}"`), `delivery contract must persist ${field}`);
  }
  assert.match(contract, /Any mismatch blocks delivery/);
  assert.match(contract, /Reject fork PRs and every head\/base mismatch/);
  assert.match(
    createPr,
    /gh pr list --repo "\$GH_REPO" --head "\$HEAD_BRANCH" --base "\$BASE_BRANCH"/
  );
  assert.match(
    createPr,
    /gh pr create --repo "\$GH_REPO" --head "\$HEAD_BRANCH" --base "\$BASE_BRANCH"/
  );
  assert.match(createPr, /repos\/\$GH_OWNER\/\$GH_REPOSITORY\/pulls\/\$PR_NUMBER/);
});

test("every executable gh PR/run command is pinned to the contracted repository", () => {
  const sources = [
    "skills/ship/steps/05-create-pr.md",
    "skills/ship/steps/06-ci-monitor.md",
    "references/merge-loop.md",
  ];

  for (const source of sources) {
    const commands = read(source)
      .split("\n")
      .filter((line) => /^\s*(?:gh_retry\s+)?gh\s+(?:pr|run)\s/.test(line));
    assert.ok(commands.length > 0, `${source} should contain gh PR/run commands`);
    for (const command of commands) {
      assert.match(command, /--repo "\$GH_REPO"/, `${source}: ${command.trim()}`);
    }
  }
});

test("CI and merge-loop fix commits recertify before retry push", () => {
  const push = read("skills/ship/steps/04-push.md");
  const ci = read("skills/ship/steps/06-ci-monitor.md");
  const mergeLoop = read("references/merge-loop.md");
  const contract = read("skills/ship/references/delivery-contract.md");

  for (const [name, source] of [
    ["push", push],
    ["ci", ci],
    ["merge loop", mergeLoop],
  ]) {
    assert.match(source, /post-mutation recertification/, `${name} must require recertification`);
    assert.match(source, /dev-gate-check/, `${name} must require the executable gate checker`);
  }
  assert.match(contract, /Invoke `pm:review` against current HEAD/);
  assert.match(contract, /Regenerate its canonical artifact/);
  assert.match(contract, /Only after the checker exits zero may Ship retry/);
  assert.match(ci, /git push -- "\$DELIVERY_REMOTE" HEAD/);
  assert.doesNotMatch(ci, /Push: `git push`/);
});

test("Ship journals ambiguous effects and places version tags only after verified merge", () => {
  const skill = read("skills/ship/SKILL.md");
  const reference = read("skills/ship/references/release-transaction.md");
  const push = read("skills/ship/steps/04-push.md");
  const merge = read("skills/ship/steps/07-merge-loop.md");

  assert.match(skill, /Observe before replay/);
  assert.match(reference, /attempting.*Observe first/s);
  assert.match(reference, /denied.*authority boundary/s);
  assert.match(reference, /verified.*never replay/s);
  assert.match(reference, /push → create-pr → merge → place-main-tag/);
  assert.match(push, /observe-first/);
  assert.match(push, /timeout or connection loss stays `attempting`/);
  assert.match(merge, /plan `place-main-tag`/);
  assert.match(merge, /never force-moved automatically/);
});
