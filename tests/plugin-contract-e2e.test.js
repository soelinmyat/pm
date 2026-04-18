"use strict";

// Integration test for the `node scripts/validate.js --plugin` CLI.
// Spawns the real process against fixture trees and asserts exit code +
// stdout content. Ensures the CI entrypoint used by the `plugin-contract`
// workflow job actually works end-to-end.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const VALIDATE = path.join(REPO_ROOT, "scripts", "validate.js");

function runValidatePlugin(rootFixture) {
  return spawnSync(process.execPath, [VALIDATE, "--plugin", "--root", rootFixture], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
}

test("E2E: validate.js --plugin exits 0 on the canonical valid fixture", () => {
  const fixture = path.join(__dirname, "fixtures", "plugin-contract", "valid");
  const result = runValidatePlugin(fixture);
  assert.equal(result.status, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.mode, "plugin");
  assert.equal(parsed.pack_version, "1.0.0");
  assert.equal(parsed.issues.length, 0);
});

test("E2E: validate.js --plugin exits non-zero on the violating fixture and surfaces rule IDs", () => {
  const fixture = path.join(__dirname, "fixtures", "plugin-contract", "violating", "multiple");
  const result = runValidatePlugin(fixture);
  assert.notEqual(result.status, 0, "expected non-zero exit on violating fixture");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  const ids = new Set(parsed.issues.map((i) => i.ruleId));
  for (const id of [
    "D1-FM-001",
    "D1-FM-002",
    "D1-FM-003",
    "D1-MANIFEST-001",
    "D1-MANIFEST-002",
    "D1-STEP-002",
  ]) {
    assert.ok(ids.has(id), `expected rule ${id} to surface via CLI output`);
  }
});

test("E2E: validate.js --plugin on the real plugin source is clean (no regressions)", () => {
  // Runs against REPO_ROOT — equivalent to the CI job command.
  const result = spawnSync(process.execPath, [VALIDATE, "--plugin"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  assert.equal(
    result.status,
    0,
    `Plugin contract check failed on real source. stdout:\n${result.stdout}`
  );
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.issues.length, 0);
});
