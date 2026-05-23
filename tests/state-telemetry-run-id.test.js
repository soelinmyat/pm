"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const STATE_TELEMETRY = path.join(ROOT, "scripts", "state-telemetry.js");

const TEST_HOST_ID = "test-host";
const STEPS_FILE = `steps-${TEST_HOST_ID}.jsonl`;
const CURRENT_STEP_FILE = `.current-step-${TEST_HOST_ID}.json`;

function cleanGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  env.PM_HOST_ID = TEST_HOST_ID;
  return env;
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "state-telemetry-test-"));
  const env = cleanGitEnv();
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");
  fs.mkdirSync(path.join(root, ".pm", "analytics"), { recursive: true });
  fs.mkdirSync(path.join(root, ".pm", "dev-sessions"), { recursive: true });
  childProcess.execFileSync("git", ["init", "-b", "main"], { cwd: root, env, stdio: "ignore" });
  childProcess.execFileSync("git", ["config", "user.email", "pm@example.com"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  childProcess.execFileSync("git", ["config", "user.name", "PM Test"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  return { root, env };
}

function runStateTelemetry(root, env, command, args = []) {
  return childProcess.execFileSync(
    process.execPath,
    [STATE_TELEMETRY, command, "--project-dir", root, "--plugin-root", ROOT, ...args],
    { cwd: root, env, encoding: "utf8" }
  );
}

function readSteps(root) {
  const filePath = path.join(root, ".pm", "analytics", STEPS_FILE);
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function activeStepFile(root) {
  return path.join(root, ".pm", "analytics", CURRENT_STEP_FILE);
}

test("state-telemetry: skips active-step write when no run_id can be recovered", () => {
  const { root, env } = setupRepo();
  const stateRel = ".pm/dev-sessions/demo.md";
  const stateAbs = path.join(root, stateRel);

  fs.writeFileSync(stateAbs, "# Demo\n\n| Field | Value |\n|---|---|\n| Stage | implement |\n");
  runStateTelemetry(root, env, "snapshot", ["--file", stateRel]);
  runStateTelemetry(root, env, "apply", ["--file", stateRel]);

  assert.equal(
    fs.existsSync(activeStepFile(root)),
    false,
    "active-step was written despite missing run_id"
  );

  const untracked = readSteps(root).filter((s) => s.run_id === "untracked");
  assert.equal(untracked.length, 0, `unexpected untracked steps: ${JSON.stringify(untracked)}`);
});

test("state-telemetry: skips step-close when no run_id can be recovered", () => {
  const { root, env } = setupRepo();
  const stateRel = ".pm/dev-sessions/demo.md";
  const stateAbs = path.join(root, stateRel);

  fs.writeFileSync(stateAbs, "# Demo\n\n| Field | Value |\n|---|---|\n| Stage | implement |\n");
  runStateTelemetry(root, env, "snapshot", ["--file", stateRel]);

  fs.writeFileSync(stateAbs, "# Demo\n\n| Field | Value |\n|---|---|\n| Stage | review |\n");
  runStateTelemetry(root, env, "apply", ["--file", stateRel]);

  const untracked = readSteps(root).filter((s) => s.run_id === "untracked");
  assert.equal(
    untracked.length,
    0,
    `step transition wrote untracked entry: ${JSON.stringify(untracked)}`
  );
});

test("state-telemetry: writes active-step when .current-run provides run_id", () => {
  const { root, env } = setupRepo();
  const stateRel = ".pm/dev-sessions/demo.md";
  const stateAbs = path.join(root, stateRel);

  fs.writeFileSync(path.join(root, ".pm", "analytics", ".current-run"), "dev-test-123");
  fs.writeFileSync(path.join(root, ".pm", "analytics", ".current-skill"), "dev");

  fs.writeFileSync(stateAbs, "# Demo\n\n| Field | Value |\n|---|---|\n| Stage | implement |\n");
  runStateTelemetry(root, env, "snapshot", ["--file", stateRel]);
  runStateTelemetry(root, env, "apply", ["--file", stateRel]);

  assert.ok(
    fs.existsSync(activeStepFile(root)),
    "active-step was not written even though current-run exists"
  );
  const active = JSON.parse(fs.readFileSync(activeStepFile(root), "utf8"));
  assert.equal(active.run_id, "dev-test-123");
});
