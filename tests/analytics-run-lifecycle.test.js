"use strict";

// Production-shaped regression tripwire for analytics identity. Hook
// engagements are scoped to one host session, while v2 workflow telemetry is
// keyed by the canonical workflow run_id. Worktrees and concurrent sessions
// must never share mutable "current run" state.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ANALYTICS_LOG = path.join(ROOT, "hooks", "analytics-log");
const SESSION_END = path.join(ROOT, "hooks", "session-end");
const DEV_CLI = path.join(ROOT, "scripts", "dev-session.js");
const GROOM_CLI = path.join(ROOT, "scripts", "groom-session.js");
const { recordSessionTelemetry } = require("../scripts/lib/telemetry.js");

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

function invokeAnalyticsLog(root, env, skill, sessionId = "host-session-a") {
  const result = spawnSync("bash", [ANALYTICS_LOG], {
    cwd: root,
    env,
    encoding: "utf8",
    input: JSON.stringify({ session_id: sessionId, tool_input: { skill } }),
  });
  assert.equal(result.status, 0, result.stderr);
}

function invokeAnalyticsLogAsync(root, env, skill, sessionId) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [ANALYTICS_LOG], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`analytics-log exited ${code}: ${stderr}`))
    );
    child.stdin.end(JSON.stringify({ session_id: sessionId, tool_input: { skill } }));
  });
}

function endSession(root, env, sessionId) {
  const result = spawnSync("bash", [SESSION_END], {
    cwd: root,
    env,
    encoding: "utf8",
    input: JSON.stringify({ session_id: sessionId }),
  });
  assert.equal(result.status, 0, result.stderr);
}

function engagementStatePath(root, sessionId) {
  return path.join(root, ".pm", "analytics", "sessions", sessionId, "engagements.json");
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

test("nested invocations preserve parentage without superseding and concurrent host sessions isolate state", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    invokeAnalyticsLog(root, env, "pm:dev", "host-session-a");
    invokeAnalyticsLog(root, env, "pm:review", "host-session-a");
    invokeAnalyticsLog(root, env, "pm:dev", "host-session-b");

    const activity = readJsonLines(root, ACTIVITY_FILE);
    const starts = activity.filter((r) => r.event === "started");
    const devStart = starts.find(
      (r) => r.skill === "dev" && r.meta?.host_session_id === "host-session-a"
    );
    const otherDevStart = starts.find(
      (r) => r.skill === "dev" && r.meta?.host_session_id === "host-session-b"
    );
    const reviewStart = starts.find(
      (r) => r.skill === "review" && r.meta?.host_session_id === "host-session-a"
    );
    assert.ok(devStart);
    assert.ok(otherDevStart);
    assert.ok(reviewStart, "review run must start");
    assert.equal(reviewStart.parent_run_id, devStart.run_id);
    assert.notEqual(otherDevStart.run_id, devStart.run_id);
    assert.equal(otherDevStart.parent_run_id, undefined);
    assert.equal(
      activity.some((r) => r.event === "completed" && r.status === "superseded"),
      false,
      "nested skill loading is not a workflow terminal"
    );

    const stateA = JSON.parse(fs.readFileSync(engagementStatePath(root, "host-session-a"), "utf8"));
    const stateB = JSON.parse(fs.readFileSync(engagementStatePath(root, "host-session-b"), "utf8"));
    assert.equal(stateA.current_run_id, reviewStart.run_id);
    assert.deepEqual(
      Object.keys(stateA.open_runs).sort(),
      [devStart.run_id, reviewStart.run_id].sort()
    );
    assert.equal(stateB.current_run_id, otherDevStart.run_id);
    assert.deepEqual(Object.keys(stateB.open_runs), [otherDevStart.run_id]);
  } finally {
    cleanup();
  }
});

test("session end closes only engagements owned by that host session", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    invokeAnalyticsLog(root, env, "pm:dev", "host-session-a");
    invokeAnalyticsLog(root, env, "pm:dev", "host-session-b");
    endSession(root, env, "host-session-a");

    const activity = readJsonLines(root, ACTIVITY_FILE);
    const startA = activity.find(
      (r) => r.event === "started" && r.meta?.host_session_id === "host-session-a"
    );
    const startB = activity.find(
      (r) => r.event === "started" && r.meta?.host_session_id === "host-session-b"
    );
    const terminals = activity.filter((r) => r.event === "completed");
    assert.ok(terminals.some((r) => r.run_id === startA.run_id && r.status === "abandoned"));
    assert.equal(
      terminals.some((r) => r.run_id === startB.run_id),
      false
    );
    assert.equal(fs.existsSync(engagementStatePath(root, "host-session-a")), false);
    assert.equal(fs.existsSync(engagementStatePath(root, "host-session-b")), true);
  } finally {
    cleanup();
  }
});

test("simultaneous skill hooks in one host session retain every engagement", async () => {
  const { root, env, cleanup } = setupRepo();
  try {
    await Promise.all([
      invokeAnalyticsLogAsync(root, env, "pm:dev", "contended-session"),
      invokeAnalyticsLogAsync(root, env, "pm:review", "contended-session"),
    ]);
    const state = JSON.parse(
      fs.readFileSync(engagementStatePath(root, "contended-session"), "utf8")
    );
    const runs = Object.entries(state.open_runs);
    assert.equal(runs.length, 2);
    const roots = runs.filter(([, run]) => run.parent_run_id === null);
    const children = runs.filter(([, run]) => run.parent_run_id !== null);
    assert.equal(roots.length, 1);
    assert.equal(children.length, 1);
    assert.equal(children[0][1].parent_run_id, roots[0][0]);
  } finally {
    cleanup();
  }
});

test("dev completion uses the canonical workflow run id independently of hook engagement state", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    invokeAnalyticsLog(root, env, "pm:dev");
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
    assert.equal(steps[0].run_id, session.run_id);
    assert.equal(steps[0].meta.workflow_run_id, session.run_id);

    const terminals = readJsonLines(root, ACTIVITY_FILE).filter(
      (r) => r.skill === "dev" && r.event === "completed"
    );
    const canonicalTerminals = terminals.filter((r) => r.run_id === session.run_id);
    assert.equal(canonicalTerminals.length, 1);
    assert.equal(canonicalTerminals[0].status, "completed");
    assert.equal(canonicalTerminals[0].detail, "complete");
    assert.equal(canonicalTerminals[0].meta.origin, "session-script");
    assert.equal(canonicalTerminals[0].meta.identity_kind, "workflow");
    assert.equal(
      fs.existsSync(engagementStatePath(root, "host-session-a")),
      true,
      "workflow completion must not mutate independent hook engagement state"
    );
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
    assert.equal(started.run_id, JSON.parse(fs.readFileSync(sessionPath, "utf8")).run_id);
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
    assert.equal(terminals.filter((r) => r.run_id === session.run_id).length, 1);
    assert.equal(terminals.find((r) => r.run_id === session.run_id).status, "completed");
    assert.ok(
      fs.existsSync(engagementStatePath(root, "host-session-a")),
      "hook engagement state remains project-local"
    );
    assert.equal(fs.existsSync(path.join(kb, ".pm", "analytics", "sessions")), false);
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

    assert.equal(steps[0].run_id, session.run_id);
  } finally {
    cleanup();
  }
});

test("duplicate worktree completion attempts emit one canonical workflow terminal", () => {
  const kb = fs.mkdtempSync(path.join(os.tmpdir(), "pm-run-lifecycle-shared-kb-"));
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), "pm-run-lifecycle-worktree-a-"));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), "pm-run-lifecycle-worktree-b-"));
  const previousHostId = process.env.PM_HOST_ID;
  try {
    process.env.PM_HOST_ID = TEST_HOST_ID;
    for (const root of [projectA, projectB]) {
      fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
      fs.mkdirSync(path.join(root, ".pm", "dev-sessions", "shared"), { recursive: true });
      fs.writeFileSync(path.join(root, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");
      fs.writeFileSync(
        path.join(root, ".pm", "config.json"),
        JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: kb } })
      );
    }
    const workflow = {
      schema_version: 2,
      run_id: "dev_canonical_shared",
      slug: "shared",
      status: "complete",
      phase: "retro",
      phase_attempt: 1,
      created_at: "2026-08-08T00:00:00.000Z",
      updated_at: "2026-08-08T01:00:00.000Z",
    };
    const previous = { ...workflow, status: "active" };
    const result = devResult(workflow);
    for (const root of [projectA, projectB]) {
      const sessionPath = path.join(root, ".pm", "dev-sessions", "shared", "session.json");
      fs.writeFileSync(sessionPath, JSON.stringify(workflow));
      recordSessionTelemetry({
        workflow: "dev",
        sessionPath,
        prevSession: previous,
        session: workflow,
        result,
      });
    }

    const activity = fs
      .readFileSync(path.join(kb, ".pm", "analytics", ACTIVITY_FILE), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse)
      .filter((r) => r.run_id === workflow.run_id);
    assert.equal(activity.filter((r) => r.event === "started").length, 1);
    assert.equal(activity.filter((r) => r.event === "completed").length, 1);
    assert.equal(activity.find((r) => r.event === "completed").status, "completed");
  } finally {
    if (previousHostId === undefined) delete process.env.PM_HOST_ID;
    else process.env.PM_HOST_ID = previousHostId;
    fs.rmSync(kb, { recursive: true, force: true });
    fs.rmSync(projectA, { recursive: true, force: true });
    fs.rmSync(projectB, { recursive: true, force: true });
  }
});
