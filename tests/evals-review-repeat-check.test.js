"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkReviewRepeats } = require("../scripts/evals/review-repeat-check");

test("review repeat comparison binds three complete independent result sets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-repeats-"));
  const runs = ["repeat-one", "repeat-two", "repeat-three"].map((runId) => seedRun(root, runId));
  write(root, ".pm/dev-sessions/feature/review/repeat-comparison.json", {
    schema_version: 1,
    runs,
    metrics: {
      recall: 0.9,
      false_positive_rate: 0.1,
      severity_calibration: 0.8,
      deduplication: 1,
    },
  });
  const valid = checkReviewRepeats(root, ".pm/dev-sessions/feature/review/repeat-comparison.json");
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));

  const comparisonPath = path.join(root, ".pm/dev-sessions/feature/review/repeat-comparison.json");
  const invalid = JSON.parse(fs.readFileSync(comparisonPath, "utf8"));
  delete invalid.metrics.deduplication;
  invalid.runs[2].run_id = invalid.runs[1].run_id;
  fs.writeFileSync(comparisonPath, `${JSON.stringify(invalid, null, 2)}\n`);
  const rejected = checkReviewRepeats(
    root,
    ".pm/dev-sessions/feature/review/repeat-comparison.json"
  );
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /run_id must be unique|metrics\.deduplication/);
});

function seedRun(root, runId) {
  const roundRoot = `.pm/dev-sessions/feature/review/runs/${runId}/round-1`;
  const targetPath = `${roundRoot}/target.json`;
  const source = {
    commit: "a".repeat(40),
    base_ref: "origin/main",
    base_commit: "b".repeat(40),
    diff_sha256: "c".repeat(64),
  };
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
        sha256: "d".repeat(64),
        bytes: 10,
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
