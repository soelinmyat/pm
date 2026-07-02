"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const scoreScript = path.join(repoRoot, "scripts", "evals", "score.js");

const {
  buildScoreReport,
  compareLedgers,
  formatScore,
  summarizeLedger,
} = require("../scripts/evals/score.js");
const { REQUIRED_SENTINEL_IDS, validateResultLedger } = require("../scripts/evals/check.js");

function row(id, status, overrides = {}) {
  return {
    id,
    tier: "sentinel",
    agent: "codex",
    status,
    reason: status === "pass" ? "" : `${status} reason`,
    artifact_ref: `runs/20260702T01010${Math.min(5, id.length % 10)}Z--${id}--codex`,
    recorded_at: "2026-07-02T01:01:00Z",
    ...overrides,
  };
}

function ledger(statuses) {
  return {
    $schema: "https://pm-plugin.local/evals/baseline.schema.json",
    schema_version: 1,
    updated: "2026-07-02",
    scenarios: REQUIRED_SENTINEL_IDS.map((id) => row(id, statuses[id] || "pass")),
  };
}

function cleanupLedgerRuns(filePath) {
  if (!fs.existsSync(filePath)) return;
  const found = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const scenario of found.scenarios || []) {
    const runId = String(scenario.artifact_ref || "").replace(/^runs\//, "");
    if (/^[0-9]{8}T[0-9]{6}Z--/.test(runId)) {
      fs.rmSync(path.join(repoRoot, "eval-results", "runs", runId), {
        recursive: true,
        force: true,
      });
    }
  }
}

function cleanupAgentRuns(agent) {
  const runsDir = path.join(repoRoot, "eval-results", "runs");
  if (!fs.existsSync(runsDir)) return;
  for (const entry of fs.readdirSync(runsDir)) {
    if (entry.endsWith(`--${agent}`)) {
      fs.rmSync(path.join(runsDir, entry), { recursive: true, force: true });
    }
  }
}

test("score summary counts determinate and non-comparable rows", () => {
  const result = ledger({
    "dev-ui-design-critique-required": "skip",
    "dev-review-before-push": "indeterminate",
    "dev-tdd-before-implementation": "fail",
  });
  const summary = summarizeLedger(result);
  assert.equal(summary.pass, 3);
  assert.equal(summary.fail, 1);
  assert.equal(summary.skip, 1);
  assert.equal(summary.indeterminate, 1);
  assert.equal(summary.determinate, 4);
  assert.equal(summary.determinate_pass_rate, 3 / 4);
});

test("score comparison identifies improvements regressions and unscorable rows", () => {
  const baseline = ledger({
    "dev-ui-design-critique-required": "fail",
    "dev-review-before-push": "pass",
    "review-catches-planted-bug": "indeterminate",
  });
  const result = ledger({
    "dev-ui-design-critique-required": "pass",
    "dev-review-before-push": "fail",
    "dev-tdd-before-implementation": "skip",
    "review-catches-planted-bug": "pass",
  });
  const comparison = compareLedgers(baseline, result);
  assert.deepEqual(comparison.improvements, ["dev-ui-design-critique-required"]);
  assert.deepEqual(comparison.regressions, ["dev-review-before-push"]);
  assert.deepEqual(comparison.newly_unscorable, ["dev-tdd-before-implementation"]);
  assert.deepEqual(comparison.newly_scored, ["review-catches-planted-bug"]);
  assert.equal(comparison.comparable, 4);
});

test("score report marks all-skip current runs as not comparable", () => {
  const report = buildScoreReport({
    baseline: ledger({
      "dev-ui-design-critique-required": "fail",
      "dev-review-before-push": "fail",
      "review-catches-planted-bug": "indeterminate",
    }),
    results: ledger(Object.fromEntries(REQUIRED_SENTINEL_IDS.map((id) => [id, "skip"]))),
    baselineRef: "evals/baselines/sentinel.json",
    resultsRef: "/tmp/current.json",
  });
  assert.equal(report.results.determinate_pass_rate, null);
  assert.equal(report.comparison.comparable, 0);
  assert.equal(report.comparison.newly_unscorable.length, 5);
  assert.match(formatScore(report), /All result rows are skipped or indeterminate/);
});

test("score report explains zero comparable rows without claiming all results skipped", () => {
  const report = buildScoreReport({
    baseline: ledger({
      "dev-ui-design-critique-required": "fail",
      "dev-review-before-push": "fail",
      "dev-tdd-before-implementation": "fail",
      "skill-description-body-read": "indeterminate",
      "review-catches-planted-bug": "indeterminate",
      "groom-quick-from-backlog": "indeterminate",
    }),
    results: ledger({
      "dev-ui-design-critique-required": "skip",
      "dev-review-before-push": "skip",
      "dev-tdd-before-implementation": "skip",
      "skill-description-body-read": "pass",
      "review-catches-planted-bug": "pass",
      "groom-quick-from-backlog": "pass",
    }),
    baselineRef: "evals/baselines/sentinel.json",
    resultsRef: "/tmp/current.json",
  });
  const text = formatScore(report);
  assert.equal(report.results.determinate, 3);
  assert.equal(report.comparison.comparable, 0);
  assert.doesNotMatch(text, /All result rows are skipped or indeterminate/);
  assert.match(text, /No rows are determinate in both baseline and current results/);
});

test("eval score CLI writes a valid all-skip codex result ledger", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-score-"));
  const out = path.join(dir, "codex-current.json");
  try {
    const result = spawnSync(process.execPath, [scoreScript, "--agent", "codex", "--write", out], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Current score is not comparable to baseline/);

    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepEqual(
      written.scenarios.map((scenario) => scenario.status),
      REQUIRED_SENTINEL_IDS.map(() => "skip")
    );
    assert.equal(
      validateResultLedger(written, out, { requiredScenarioIds: REQUIRED_SENTINEL_IDS }).ok,
      true
    );
  } finally {
    cleanupLedgerRuns(out);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("eval score CLI rejects unknown adapters before writing ledger or run artifacts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-score-unknown-"));
  const out = path.join(dir, "typo-current.json");
  cleanupAgentRuns("typo");
  try {
    const result = spawnSync(process.execPath, [scoreScript, "--agent", "typo", "--write", out], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown adapter: typo/);
    assert.equal(fs.existsSync(out), false);

    const runsDir = path.join(repoRoot, "eval-results", "runs");
    const typoRuns = fs.existsSync(runsDir)
      ? fs.readdirSync(runsDir).filter((entry) => entry.endsWith("--typo"))
      : [];
    assert.deepEqual(typoRuns, []);
  } finally {
    cleanupAgentRuns("typo");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("eval score CLI reads an existing ledger as JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-score-read-"));
  const out = path.join(dir, "current.json");
  try {
    fs.writeFileSync(
      out,
      JSON.stringify(
        ledger(Object.fromEntries(REQUIRED_SENTINEL_IDS.map((id) => [id, "skip"]))),
        null,
        2
      )
    );
    const result = spawnSync(process.execPath, [scoreScript, "--results", out, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.results.skip, REQUIRED_SENTINEL_IDS.length);
    assert.equal(report.results.determinate_pass_rate, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
