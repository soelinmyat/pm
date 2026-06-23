"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
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
});

test("loop CLIs reject unknown options", () => {
  assert.match(runFail("loop-board.js", ["--bogus"]), /Unknown option/);
  assert.match(runFail("loop-runner.js", ["--bogus"]), /Unknown option/);
  assert.match(runFail("loop-config.js", ["--bogus"]), /Unknown option/);
});
