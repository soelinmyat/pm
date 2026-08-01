"use strict";

// Regression tripwire for the analytics run lifecycle. Every started run must
// be closable, genuine workflow completions must produce a `completed`
// terminal with status "completed" (not just session-end `abandoned`), and
// nested skill invocations must supersede-and-link instead of silently
// leaking the previous run. These properties broke twice before (v1.6 hook
// rewrite, v2 session scripts) without any test noticing.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ANALYTICS_LOG = path.join(ROOT, "hooks", "analytics-log");
const DEV_CLI = path.join(ROOT, "scripts", "dev-session.js");
const GROOM_CLI = path.join(ROOT, "scripts", "groom-session.js");

const TEST_HOST_ID = "test-host";
const ACTIVITY_FILE = `activity-${TEST_HOST_ID}.jsonl`;
const STEPS_FILE = `steps-${TEST_HOST_ID}.jsonl`;

function makeEnv(root) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.PM_ANALYTICS;
  env.PM_HOST_ID = TEST_HOST_ID;
  env.CLAUDE_PROJECT_DIR = root;
  env.CLAUDE_PLUGIN_ROOT = ROOT;
  return env;
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-run-lifecycle-"));
  const env = makeEnv(root);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: root, env, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "pm@example.com"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "PM Test"], { cwd: root, env, stdio: "ignore" });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root, env, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, env, stdio: "ignore" });
  return {
    root,
    env,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function readJsonLines(root, name) {
  const filePath = path.join(root, ".pm", "analytics", name);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function invokeAnalyticsLog(root, env, skill) {
  const result = spawnSync("bash", [ANALYTICS_LOG], {
    cwd: root,
    env,
    encoding: "utf8",
    input: JSON.stringify({ tool_input: { skill } }),
  });
  assert.equal(result.status, 0, result.stderr);
}

function runCli(cli, root, env, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: "utf8" });
}

function devResult(session, overrides = {}) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `Completed ${session.phase}`,
    commit: null,
    files_changed: [],
    evidence: [{ kind: "retro", command: "fixture", exit_code: 0, artifact: null }],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    ...overrides,
  };
}

test("nested invocation supersedes the open run and links it via parent_run_id", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    invokeAnalyticsLog(root, env, "pm:dev");
    invokeAnalyticsLog(root, env, "pm:review");

    const activity = readJsonLines(root, ACTIVITY_FILE);
    const devStart = activity.find((r) => r.skill === "dev" && r.event === "started");
    assert.ok(devStart, "dev run must start");

    const superseded = activity.find(
      (r) => r.skill === "dev" && r.event === "completed" && r.status === "superseded"
    );
    assert.ok(superseded, "open dev run must be soft-closed when review starts");
    assert.equal(superseded.run_id, devStart.run_id);
    assert.equal(superseded.detail, "superseded-by=review");

    const reviewStart = activity.find((r) => r.skill === "review" && r.event === "started");
    assert.ok(reviewStart, "review run must start");
    assert.equal(reviewStart.parent_run_id, devStart.run_id);

    const marker = fs.readFileSync(path.join(root, ".pm", "analytics", ".current-run"), "utf8");
    assert.equal(marker, reviewStart.run_id);
  } finally {
    cleanup();
  }
});

test("dev completion emits a genuine completed terminal, a phase span, and clears the marker", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    invokeAnalyticsLog(root, env, "pm:dev");
    const hookRunId = fs.readFileSync(path.join(root, ".pm", "analytics", ".current-run"), "utf8");

    const init = runCli(DEV_CLI, root, env, [
      "init",
      "--slug",
      "lifecycle",
      "--source-dir",
      root,
      "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const sessionPath = JSON.parse(init.stdout).session_path;

    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = [];
    fs.writeFileSync(sessionPath, JSON.stringify(session));

    const resultPath = path.join(root, "retro-result.json");
    fs.writeFileSync(resultPath, JSON.stringify(devResult(session)));
    const recorded = runCli(DEV_CLI, root, env, [
      "record",
      "--session",
      sessionPath,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);
    assert.equal(JSON.parse(recorded.stdout).session.status, "complete");

    const steps = readJsonLines(root, STEPS_FILE).filter((r) => r.skill === "dev");
    assert.equal(steps.length, 1);
    assert.equal(steps[0].step, "retro");
    assert.equal(steps[0].status, "completed");
    assert.equal(steps[0].run_id, hookRunId);
    assert.equal(steps[0].meta.workflow_run_id, session.run_id);

    const terminals = readJsonLines(root, ACTIVITY_FILE).filter(
      (r) => r.skill === "dev" && r.event === "completed"
    );
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].status, "completed");
    assert.equal(terminals[0].run_id, hookRunId);
    assert.equal(terminals[0].detail, "complete");
    assert.equal(terminals[0].meta.origin, "session-script");

    assert.equal(
      fs.existsSync(path.join(root, ".pm", "analytics", ".current-run")),
      false,
      "a genuinely completed run must not be re-closed as abandoned by session-end"
    );
    const map = JSON.parse(
      fs.readFileSync(path.join(root, ".pm", "analytics", ".run-map.json"), "utf8")
    );
    assert.equal(map["dev:lifecycle"], undefined);
  } finally {
    cleanup();
  }
});

test("a blocked dev session emits a blocked event and a failed-phase span survives", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const init = runCli(DEV_CLI, root, env, [
      "init",
      "--slug",
      "blocked-flow",
      "--source-dir",
      root,
      "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const sessionPath = JSON.parse(init.stdout).session_path;
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));

    const resultPath = path.join(root, "blocked-result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify(
        devResult(session, {
          status: "blocked",
          summary: "Blocked in intake",
          evidence: [{ kind: "intake", command: "fixture", exit_code: 1, artifact: null }],
          blocker: { code: "missing-scope", reason: "no acceptance criteria" },
        })
      )
    );
    const recorded = runCli(DEV_CLI, root, env, [
      "record",
      "--session",
      sessionPath,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.ok([0, 5].includes(recorded.status), recorded.stderr);

    const activity = readJsonLines(root, ACTIVITY_FILE);
    const blocked = activity.find((r) => r.skill === "dev" && r.event === "blocked");
    assert.ok(blocked, "blocked transition must be visible in the activity stream");
    assert.equal(blocked.status, "blocked");

    const started = activity.find((r) => r.skill === "dev" && r.event === "started");
    assert.ok(started, "with no hook run open, the session script must self-start one");
    assert.equal(started.meta.origin, "session-script");
    assert.equal(blocked.run_id, started.run_id);

    const steps = readJsonLines(root, STEPS_FILE).filter((r) => r.skill === "dev");
    assert.equal(steps.length, 1);
    assert.equal(steps[0].step, "intake");
    assert.equal(steps[0].status, "blocked");
  } finally {
    cleanup();
  }
});

test("separate-repo mode: streams land in the storage repo, scratch stays project-local", () => {
  // Reproduces the production layout (project + sibling kb storage repo)
  // where run closure was silently broken: hooks wrote .current-run to the
  // project dir while Node-side readers resolved the storage repo's
  // analytics dir and never found it.
  const { root, env, cleanup } = setupRepo();
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), "pm-run-lifecycle-kb-"));
  try {
    fs.mkdirSync(path.join(root, ".pm"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".pm", "config.json"),
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb } })
    );

    invokeAnalyticsLog(root, env, "pm:dev");
    const hookRunId = fs.readFileSync(path.join(root, ".pm", "analytics", ".current-run"), "utf8");

    const init = runCli(DEV_CLI, root, env, [
      "init",
      "--slug",
      "separate-repo",
      "--source-dir",
      root,
      "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const sessionPath = JSON.parse(init.stdout).session_path;
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = [];
    fs.writeFileSync(sessionPath, JSON.stringify(session));

    const resultPath = path.join(root, "retro-result.json");
    fs.writeFileSync(resultPath, JSON.stringify(devResult(session)));
    const recorded = runCli(DEV_CLI, root, env, [
      "record",
      "--session",
      sessionPath,
      "--result",
      resultPath,
      "--json",
    ]);
    assert.equal(recorded.status, 0, recorded.stderr);

    const kbActivity = path.join(kb, ".pm", "analytics", ACTIVITY_FILE);
    assert.ok(fs.existsSync(kbActivity), "activity stream must land in the storage repo");
    const terminals = fs
      .readFileSync(kbActivity, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((r) => r.skill === "dev" && r.event === "completed");
    assert.equal(terminals.length, 1);
    assert.equal(terminals[0].status, "completed");
    assert.equal(terminals[0].run_id, hookRunId);

    assert.equal(
      fs.existsSync(path.join(root, ".pm", "analytics", ".current-run")),
      false,
      "genuine completion must clear the project-local marker"
    );
    assert.ok(
      fs.existsSync(path.join(root, ".pm", "analytics", ".run-map.json")),
      "run map is project-local scratch, never synced through the storage repo"
    );
    assert.equal(fs.existsSync(path.join(kb, ".pm", "analytics", ".run-map.json")), false);
  } finally {
    fs.rmSync(kb, { recursive: true, force: true });
    cleanup();
  }
});

test("groom phase recording emits spans once per attempt and reuses the mapped run", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const init = runCli(GROOM_CLI, root, env, [
      "init",
      "--slug",
      "groom-flow",
      "--source-dir",
      root,
      "--tier",
      "quick",
      "--json",
    ]);
    assert.equal(init.status, 0, init.stderr);
    const sessionPath = JSON.parse(init.stdout).session_path;

    const factsPath = path.join(root, "facts.json");
    fs.writeFileSync(
      factsPath,
      JSON.stringify({
        title: "Flow",
        outcome: "Signal",
        source_kind: "idea",
        evidence_refs: [],
      })
    );
    assert.equal(
      runCli(GROOM_CLI, root, env, [
        "context",
        "--session",
        sessionPath,
        "--facts",
        factsPath,
        "--json",
      ]).status,
      0
    );

    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    const resultPath = path.join(root, "result.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({
        schema_version: 1,
        run_id: session.run_id,
        phase: session.phase,
        attempt: session.phase_attempt,
        status: "passed",
        summary: "Intake complete",
        proposal: null,
        evidence: [{ kind: "intake", command: "test", exit_code: 0, artifact: null }],
        question_outcomes: [],
        capability_downgrades: [],
        blocker: null,
        runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
      })
    );
    const args = ["record", "--session", sessionPath, "--result", resultPath, "--json"];
    assert.equal(runCli(GROOM_CLI, root, env, args).status, 0);
    const retried = runCli(GROOM_CLI, root, env, args);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(JSON.parse(retried.stdout).idempotent, true);

    const steps = readJsonLines(root, STEPS_FILE).filter((r) => r.skill === "groom");
    assert.equal(steps.length, 1, "idempotent retries must not duplicate phase spans");
    assert.equal(steps[0].step, session.phase);

    const map = JSON.parse(
      fs.readFileSync(path.join(root, ".pm", "analytics", ".run-map.json"), "utf8")
    );
    assert.equal(map["groom:groom-flow"].run_id, steps[0].run_id);
    assert.ok(map["groom:groom-flow"].phase, "map keeps the next phase for span timing");
  } finally {
    cleanup();
  }
});
