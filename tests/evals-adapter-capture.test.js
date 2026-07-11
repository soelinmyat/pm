"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { scanCapturedLines, spawnCapturedSync } = require("../scripts/evals/adapters/shared.js");

test("spawnCapturedSync persists stdout, stderr, and terminal progress metadata", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-capture-"));
  try {
    const stdoutPath = path.join(tmp, "stdout.jsonl");
    const stderrPath = path.join(tmp, "stderr.log");
    const progressPath = path.join(tmp, "progress.json");
    const result = spawnCapturedSync(
      process.execPath,
      ["-e", "process.stdout.write('first\\n'); process.stderr.write('warning\\n')"],
      { cwd: tmp, encoding: "utf8", timeout: 5000 },
      { stdoutPath, stderrPath, progressPath }
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "first\n");
    assert.equal(result.stderr, "warning\n");
    assert.equal(fs.readFileSync(stdoutPath, "utf8"), "first\n");
    const progress = JSON.parse(fs.readFileSync(progressPath, "utf8"));
    assert.equal(progress.status, "complete");
    assert.equal(progress.stdout_bytes, 6);
    assert.equal(progress.stderr_bytes, 8);
    assert.equal(typeof progress.duration_ms, "number");
    assert.match(progress.started_at, /^\d{4}-/);
    assert.match(progress.ended_at, /^\d{4}-/);
    assert.ok(Date.parse(progress.ended_at) >= Date.parse(progress.started_at));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanCapturedLines finds safety evidence without loading the complete capture", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-capture-scan-"));
  try {
    const file = path.join(tmp, "large.jsonl");
    fs.writeFileSync(
      file,
      `${JSON.stringify({ command: "/outside/escape" })}\n${"x".repeat(200000)}\n`
    );
    const result = scanCapturedLines(file, (line) => {
      try {
        return JSON.parse(line).command === "/outside/escape";
      } catch {
        return false;
      }
    });
    assert.equal(result.matched, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("spawnCapturedSync refuses to load captures above the memory budget", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-eval-capture-limit-"));
  try {
    const stdoutPath = path.join(tmp, "stdout.log");
    const stderrPath = path.join(tmp, "stderr.log");
    const progressPath = path.join(tmp, "progress.json");
    const result = spawnCapturedSync(
      process.execPath,
      ["-e", "process.stdout.write('123456789')"],
      { cwd: tmp, encoding: "utf8", timeout: 5000 },
      { stdoutPath, stderrPath, progressPath, maxBytes: 8 }
    );
    assert.equal(result.captureOverflow, true);
    assert.equal(result.stdout, "");
    assert.equal(fs.statSync(stdoutPath).size, 9);
    assert.equal(JSON.parse(fs.readFileSync(progressPath, "utf8")).status, "overflow");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
