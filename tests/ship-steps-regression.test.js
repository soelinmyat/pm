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
  assert.match(contract, /invoke `pm:review` against current HEAD/);
  const review = read("skills/ship/steps/03-review.md");
  assert.match(
    review,
    /review-delta\.js" check --root "\$PWD" --review-dir "\.pm\/dev-sessions\/\{slug\}\/review" --base "\$\(git rev-parse --verify "refs\/remotes\/\{DELIVERY_REMOTE\}\/\{DEFAULT_BRANCH\}\^\{commit\}"\)"/,
    "03-review skip check must pass the live base resolved from the delivery remote"
  );
  assert.match(
    review,
    /`--verify` is required/,
    "03-review must explain why bare rev-parse cannot resolve the base"
  );
  assert.match(
    contract,
    /Both scoped paths fail closed; any check failure means the full round is required/
  );
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
  assert.match(
    reference,
    /push → create-pr → ready-pr \(draft delivery\) → merge → place-main-tag/
  );
  assert.match(push, /observe-first/);
  assert.match(push, /timeout or connection loss stays `attempting`/);
  assert.match(merge, /plan `place-main-tag`/);
  assert.match(merge, /never force-moved automatically/);
});

test("Ship binds the reviewer handoff body through Create PR and the Merge boundary", () => {
  const skill = read("skills/ship/SKILL.md");
  const createPr = read("skills/ship/steps/05-create-pr.md");
  const merge = read("skills/ship/steps/07-merge-loop.md");
  const reference = read("skills/ship/references/release-transaction.md");

  assert.match(skill, /exact canonical `pr-body\.md` bytes.*hash-bound/is);
  assert.match(createPr, /create-pr.*body_sha256/is);
  assert.match(createPr, /independently observed receipt.*body_sha256/is);
  assert.match(createPr, /migrate-pr-body/);
  assert.match(reference, /legacy schema-v1 journals may predate.*body_sha256/is);
  assert.match(merge, /attest-pr-body/);
  assert.match(merge, /five minutes and one Merge attempt only/i);
  assert.match(merge, /include the independently observed live.*body_sha256.*Merge receipt/is);
});

test("loaded Ship instructions honor covering task or standing metadata authorization without asking again", () => {
  const { pmDir, cleanup } = makeFakePmDir();
  try {
    const step = loadWorkflow("ship", pmDir, PLUGIN_ROOT).find((s) => s.order === 5);
    assert.match(step.body, /existing\s+explicit task authorization.*standing user instruction/is);
    assert.match(step.body, /covers this PR.*metadata update/is);
    assert.match(step.body, /without asking again/i);
    assert.match(step.body, /routine title.*body revision.*not.*scope change/is);
    assert.match(step.body, /title.*same\s+authorization/is);
    assert.doesNotMatch(
      step.body,
      /If the body differs,.*and request explicit user authorization scoped to updating that PR body\./
    );
  } finally {
    cleanup();
  }
});

test("metadata authorization remains scoped, canonical and independently observed", () => {
  const step = read("skills/ship/steps/05-create-pr.md");
  const contract = read("skills/ship/references/delivery-contract.md");
  assert.match(step, /absent.*unclear.*changed.*revoked/is);
  assert.match(step, /generic.*create.*push.*merge.*does not.*metadata/is);
  assert.match(contract, /standing.*metadata.*without asking again/is);
  assert.match(contract, /authority_log.*supported.*authorize/is);
  assert.match(contract, /previously.*standing authorization.*authorize/is);
  assert.match(contract, /never permits a remote.*owner\/repo.*head.*base change/is);
  assert.match(step, /re-observe.*exact.*PR_BODY_FILE.*before\/after body hashes/is);
  assert.match(step, /title.*re-observe.*exact/i);
});

test("metadata workflow authorization never overrides a denied execution", () => {
  for (const file of [
    "skills/ship/steps/05-create-pr.md",
    "skills/ship/references/delivery-contract.md",
  ]) {
    const text = read(file);
    assert.match(text, /tool.*platform.*approval reviewer.*denial/is);
    assert.match(text, /does not override execution restrictions/i);
    assert.match(text, /REST.*GraphQL.*tool.*runtime.*evade/is);
    assert.match(text, /host.*supported.*retry/is);
    assert.match(text, /whether.*process.*ran.*uncertain/is);
  }
});

test("comprehensive requested drafts have an explicit ready-before-merge procedure", () => {
  const step = read("skills/ship/steps/05-create-pr.md");
  assert.match(step, /comprehensive draft/i);
  assert.match(step, /requested draft-first/i);
  assert.match(step, /ready-pr.*before.*CI/i);
  assert.match(step, /--draft/);
});

test("an automatic merge under a standing authorization lets GitHub enforce the checked head", () => {
  // merge-check reads GitHub at the check; the merge command itself must still
  // bind the head and leave branch protection in force.
  const step = read("skills/ship/steps/07-merge-loop.md");
  const shared = read("references/merge-loop.md");
  const contract = read("skills/ship/references/delivery-contract.md");
  const schema = read("skills/dev/references/state-schema.md");
  const command =
    /gh pr merge "\$PR_NUMBER" --repo "\$GH_REPO" --squash --match-head-commit "\$remote_tip"/;
  assert.match(step, command);
  assert.match(shared, command);
  for (const text of [step, shared, contract, schema]) {
    assert.match(text, /--match-head-commit/);
    assert.match(text, /branch protection/);
  }
  // The standing-authorization merge command never carries --admin or --auto.
  const commands = [step, shared]
    .join("\n")
    .match(/gh pr merge [^`\n]*--match-head-commit[^`\n]*/g);
  assert.ok(commands && commands.length >= 2);
  for (const line of commands) assert.doesNotMatch(line, /--admin|--auto/);
  assert.match(schema, /merge-check[^\n]*observation[^\n]*--match-head-commit/);
});

test("the shared merge loop never arms auto-merge under a standing authorization", () => {
  // GitHub auto-merge would merge whatever head passes branch protection,
  // including one merge-check never passed.
  const shared = read("references/merge-loop.md");
  const step2 = shared.slice(shared.indexOf("## Step 2:"), shared.indexOf("## Step 3:"));
  assert.match(step2, /standing merge authorization[^\n]*do not arm[^\n]*auto-merge/i);
  assert.match(step2, /human-confirmed/i);
  // The only --auto command left is the human-confirmed one.
  for (const line of shared.match(/gh pr merge [^`\n]*--auto[^`\n]*/g) || [])
    assert.doesNotMatch(line, /--match-head-commit/);
  const fixLoop = shared.slice(shared.indexOf("## Step 3:"));
  assert.match(fixLoop, /standing merge authorization[^\n]*--match-head-commit/i);
});

test("Ship Step 07 sets PM_PLUGIN_ROOT and remote_tip before merge-check uses them", () => {
  const step = read("skills/ship/steps/07-merge-loop.md");
  const standing = step.slice(
    step.indexOf("### Standing merge authorization"),
    step.indexOf("### Pre-merge gate attestation")
  );
  const setRoot = standing.indexOf('PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT');
  const setTip = standing.indexOf('remote_tip="$(git rev-parse "{DELIVERY_REMOTE}/{branch}")"');
  assert.ok(setRoot >= 0, "standing section sets PM_PLUGIN_ROOT");
  assert.ok(setTip >= 0, "standing section sets remote_tip");
  assert.ok(setRoot < standing.indexOf('"$PM_PLUGIN_ROOT/'), "PM_PLUGIN_ROOT set before use");
  assert.ok(setTip < standing.indexOf('"$remote_tip"'), "remote_tip set before use");
});

test("merge authorization docs point to the shared trust model", () => {
  for (const file of [
    "skills/dev/references/state-schema.md",
    "skills/ship/steps/07-merge-loop.md",
    "docs/plans/2026-11-26-design-director.md",
  ])
    assert.match(read(file), /references\/trust-model\.md/, file);
  const plan = read("docs/plans/2026-11-26-design-director.md");
  assert.doesNotMatch(plan, /Authenticity rests on trust plus the three cheap checks/);
  const schema = read("skills/dev/references/state-schema.md");
  assert.match(schema, /teardown[^\n]*same trust as the project's own test suite/i);
});
