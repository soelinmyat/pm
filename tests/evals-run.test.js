"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const runScript = path.join(repoRoot, "scripts", "evals", "run.js");

test("stub eval runner stages source and writes a passing verdict", () => {
  const runId = "20260701T050200Z--dev-tdd-before-implementation--stub";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "stub",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "pass");
    assert.equal(verdict.artifact_ref, `runs/${runId}`);

    assert.ok(fs.existsSync(path.join(runDir, "runtime", "pm", "scripts", "evals", "prelude.sh")));
    assert.ok(fs.existsSync(path.join(runDir, "scenario", "checks.sh")));
    assert.ok(fs.existsSync(path.join(runDir, "metadata", "source_identity.json")));
    assert.ok(fs.existsSync(path.join(runDir, "metadata", "scenario_identity.json")));
    assert.ok(fs.existsSync(path.join(runDir, "metadata", "adapter_boot.json")));
    assert.ok(fs.existsSync(path.join(runDir, "metadata", "sandbox_identity.json")));

    const postRecords = fs
      .readFileSync(path.join(runDir, "metadata", "check-results.post.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.ok(postRecords.length >= 3);
    assert.deepEqual(
      postRecords.map((record) => record.status),
      ["pass", "pass", "pass"]
    );
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
