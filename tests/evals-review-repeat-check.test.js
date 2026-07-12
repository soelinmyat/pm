"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checkReviewRepeats,
  deriveConsistencyMetrics,
} = require("../scripts/evals/review-repeat-check");
const { checkReview } = require("../scripts/review-check");
const { renderReviewReport } = require("../scripts/review-report");

test("review repeat comparison binds three complete independent result sets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-repeats-"));
  const source = seedGit(root);
  const runs = ["repeat-one", "repeat-two", "repeat-three"].map((runId) =>
    seedRun(root, runId, source)
  );
  for (const run of runs) {
    const roundRoot = path.posix.dirname(run.target.path);
    write(root, `${roundRoot}/draft-report.json`, { preserved: run.run_id });
    fs.writeFileSync(path.join(root, `${roundRoot}/draft-report.html`), `<p>${run.run_id}</p>`);
  }
  const preserved = snapshotDrafts(root, runs);
  const reportPath = ".pm/dev-sessions/feature/review/report.json";
  const htmlPath = ".pm/dev-sessions/feature/review/report.html";
  const generated = checkReview({
    root,
    targetPath: runs[0].target.path,
    resultPaths: runs[0].results.map((item) => item.path),
    reportPath,
    humanReportPath: htmlPath,
    writeReport: true,
    verifyGit: false,
    verifyFrozenGit: true,
    verifyBrowser: false,
  });
  assert.equal(generated.ok, true, JSON.stringify(generated.issues));
  renderReviewReport({ root, reportPath, outputPath: htmlPath });
  write(root, ".pm/dev-sessions/feature/review/repeat-comparison.json", {
    schema_version: 1,
    canonical_report: binding(root, reportPath),
    runs,
    metrics: {
      finding_set_agreement: 1,
      finding_count_stability: 1,
      severity_agreement: 1,
      outcome_agreement: 1,
    },
  });
  const valid = checkReviewRepeats(root, ".pm/dev-sessions/feature/review/repeat-comparison.json");
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.deepEqual(valid.computed_metrics, {
    finding_set_agreement: 1,
    finding_count_stability: 1,
    severity_agreement: 1,
    outcome_agreement: 1,
  });
  assert.deepEqual(snapshotDrafts(root, runs), preserved);

  const comparisonPath = path.join(root, ".pm/dev-sessions/feature/review/repeat-comparison.json");
  const forged = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
  forged.metrics.finding_set_agreement = 0.37;
  fs.writeFileSync(comparisonPath, `${JSON.stringify(forged, null, 2)}\n`);
  const forgedResult = checkReviewRepeats(
    root,
    ".pm/dev-sessions/feature/review/repeat-comparison.json"
  );
  assert.equal(forgedResult.ok, false);
  assert.match(
    JSON.stringify(forgedResult.issues),
    /metrics\.finding_set_agreement must equal derived value 1/
  );

  fs.writeFileSync(
    comparisonPath,
    `${JSON.stringify({ ...forged, metrics: valid.computed_metrics }, null, 2)}\n`
  );
  const invalid = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
  delete invalid.metrics.outcome_agreement;
  invalid.metrics.finding_set_agreement = 0.37;
  invalid.runs[2].run_id = invalid.runs[1].run_id;
  fs.copyFileSync(path.join(root, reportPath), path.join(root, ".pm/fake-passed-report.json"));
  invalid.canonical_report = binding(root, ".pm/fake-passed-report.json");
  fs.writeFileSync(comparisonPath, `${JSON.stringify(invalid, null, 2)}\n`);
  const rejected = checkReviewRepeats(
    root,
    ".pm/dev-sessions/feature/review/repeat-comparison.json"
  );
  assert.equal(rejected.ok, false);
  assert.match(
    JSON.stringify(rejected.issues),
    /canonical_report\.path must equal|run_id must be unique|metrics\.outcome_agreement|metrics\.finding_set_agreement/
  );
  assert.deepEqual(snapshotDrafts(root, runs), preserved);
});

test("consistency metrics are derived from checked report findings and outcomes", () => {
  const metrics = deriveConsistencyMetrics([
    { outcome: "passed", findings: [] },
    { outcome: "failed", findings: [{ id: "rv-a", severity: "high" }] },
    { outcome: "failed", findings: [{ id: "rv-a", severity: "low" }] },
  ]);
  assert.deepEqual(metrics, {
    finding_set_agreement: 0.333333,
    finding_count_stability: 0,
    severity_agreement: 0,
    outcome_agreement: 0.333333,
  });
});

function snapshotDrafts(root, runs) {
  return runs.flatMap((run) => {
    const roundRoot = path.posix.dirname(run.target.path);
    return ["json", "html"].map((extension) =>
      fs.readFileSync(path.join(root, `${roundRoot}/draft-report.${extension}`), "utf8")
    );
  });
}

function seedRun(root, runId, source) {
  const roundRoot = `.pm/dev-sessions/feature/review/runs/${runId}/round-1`;
  const targetPath = `${roundRoot}/target.json`;
  const changedBytes = fs.readFileSync(path.join(root, "src/example.js"));
  const lenses = ["bug", "design", "edge", "reuse", "quality", "efficiency"];
  const runtime = {
    provider: "codex",
    model: "gpt-5.6-sol",
    effort: "high",
    external_effects: false,
  };
  write(root, targetPath, {
    schema_version: 1,
    run_id: runId,
    review_round: 1,
    iteration_cap: 3,
    created_at: "2026-07-12T00:00:00Z",
    mode: "full",
    source,
    changed_files: [
      {
        path: "src/example.js",
        old_path: null,
        status: "M",
        sha256: crypto.createHash("sha256").update(changedBytes).digest("hex"),
        bytes: changedBytes.length,
      },
    ],
    acceptance: null,
    upstream: { design_critique: null },
    ownership: {
      review: ["source-correctness"],
      design_critique: ["rendered-design"],
      qa: ["live-behavior"],
    },
    lenses: lenses.map((name) => ({
      name,
      applicable: true,
      reason: "required repeat lens",
    })),
    allocation: [
      {
        worker_id: "reviewer-1",
        profile: "codex-workhorse",
        lenses,
        independent: true,
        runtime,
      },
    ],
    prior_report: null,
  });
  const target = binding(root, targetPath);
  const resultPath = `${roundRoot}/results/reviewer-1.json`;
  write(root, resultPath, {
    schema_version: 1,
    run_id: runId,
    review_round: 1,
    source,
    target,
    worker_id: "reviewer-1",
    profile: "codex-workhorse",
    runtime,
    lenses,
    verdicts: lenses.map((lens) => ({
      lens,
      outcome: "clean",
      summary: `No ${lens} finding in the frozen repeat.`,
    })),
    findings: [],
    checked_at: "2026-07-12T00:01:00Z",
  });
  return { run_id: runId, target, results: [binding(root, resultPath)] };
}

function seedGit(root) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = 1;\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]).trim();
  fs.writeFileSync(path.join(root, "src/example.js"), "module.exports = 2;\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "change"]);
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  const diff = execFileSync("git", ["diff", "--binary", `${base}...${commit}`], {
    cwd: root,
  });
  return {
    commit,
    base_ref: "origin/main",
    base_commit: base,
    diff_sha256: crypto.createHash("sha256").update(diff).digest("hex"),
  };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function binding(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  return {
    path: relative,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}
