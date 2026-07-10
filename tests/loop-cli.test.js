"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function runFail(script, args) {
  try {
    execFileSync("node", [path.join(ROOT, "scripts", script), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    return `${err.stdout || ""}${err.stderr || ""}`;
  }
  throw new Error(`${script} unexpectedly passed`);
}

test("loop CLIs reject missing option values instead of consuming another flag", () => {
  assert.match(runFail("loop-board.js", ["--pm-dir", "--format", "json"]), /Missing value/);
  assert.match(runFail("loop-runner.js", ["--mode", "--dry-run"]), /Missing value/);
  assert.match(runFail("loop-git.js", ["claim", "--card-id", "--stage", "dev"]), /Missing value/);
  assert.match(runFail("loop-reconcile.js", ["--pm-dir", "--apply"]), /Missing value/);
});

test("loop CLIs reject unknown options", () => {
  assert.match(runFail("loop-board.js", ["--bogus"]), /Unknown option/);
  assert.match(runFail("loop-runner.js", ["--bogus"]), /Unknown option/);
  assert.match(runFail("loop-config.js", ["--bogus"]), /Unknown option/);
  assert.match(runFail("loop-reconcile.js", ["--bogus"]), /Unknown option/);
});

test("loop command and skill docs expose dry-run-first reconciliation with guarded apply", () => {
  const command = fs.readFileSync(path.join(ROOT, "commands", "loop.md"), "utf8");
  const skill = fs.readFileSync(path.join(ROOT, "skills", "loop", "SKILL.md"), "utf8");
  const step = fs.readFileSync(
    path.join(ROOT, "skills", "loop", "steps", "07-reconcile.md"),
    "utf8"
  );
  assert.match(command, /reconcile/);
  assert.match(skill, /reconcile/);
  assert.match(step, /defaults? to dry-run/i);
  assert.match(step, /--apply/);
  assert.match(step, /Git sync readiness/i);
  assert.match(step, /recovery record.*expired lease/i);
  assert.match(step, /isolated PM transaction/i);
});
