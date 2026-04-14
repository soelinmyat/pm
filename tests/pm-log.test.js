"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PM_LOG = path.join(ROOT, "scripts", "pm-log.sh");
const PM_BASELINE = path.join(ROOT, "scripts", "pm-baseline.js");
const ANALYTICS_LOG = path.join(ROOT, "hooks", "analytics-log.sh");
const STATE_PRE = path.join(ROOT, "hooks", "state-pre.sh");
const STATE_STEP = path.join(ROOT, "hooks", "state-step.sh");

// Clean env strips GIT_DIR/GIT_WORK_TREE that git hooks inject, so child
// processes in temp repos resolve their own git root instead of the parent's.
function cleanGitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  return env;
}

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-log-test-"));
  const env = cleanGitEnv();
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "pm.local.md"), "---\nanalytics: true\n---\n");
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
  return {
    root,
    env,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function readJsonLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("legacy activity logging still writes activity.jsonl", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    childProcess.execFileSync(PM_LOG, ["dev", "invoked", "args=demo"], {
      cwd: root,
      env,
      stdio: "ignore",
    });
    const records = readJsonLines(path.join(root, ".pm", "analytics", "activity.jsonl"));
    assert.equal(records.length, 1);
    assert.equal(records[0].skill, "dev");
    assert.equal(records[0].event, "invoked");
    assert.equal(records[0].detail, "args=demo");
  } finally {
    cleanup();
  }
});

test("run-start, step, and run-end write structured telemetry", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "groom", "--args", "tracking"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    assert.ok(runId.length > 10);

    childProcess.execFileSync(
      PM_LOG,
      [
        "step",
        "--skill",
        "groom",
        "--run-id",
        runId,
        "--phase",
        "scope",
        "--step",
        "scope-definition",
        "--status",
        "completed",
        "--started-at",
        "2026-04-04T01:00:00.000Z",
        "--ended-at",
        "2026-04-04T01:00:05.000Z",
        "--input-chars",
        "80",
        "--output-chars",
        "40",
        "--files-read",
        "2",
        "--files-written",
        "1",
        "--meta-json",
        '{"state":"ok"}',
      ],
      { cwd: root, env, stdio: "ignore" }
    );

    childProcess.execFileSync(
      PM_LOG,
      ["run-end", "--skill", "groom", "--run-id", runId, "--status", "completed"],
      { cwd: root, env, stdio: "ignore" }
    );

    const activity = readJsonLines(path.join(root, ".pm", "analytics", "activity.jsonl"));
    const steps = readJsonLines(path.join(root, ".pm", "analytics", "steps.jsonl"));

    assert.equal(activity.length, 2);
    assert.equal(activity[0].event, "started");
    assert.equal(activity[0].run_id, runId);
    assert.equal(activity[1].event, "completed");
    assert.equal(activity[1].status, "completed");

    assert.equal(steps.length, 1);
    assert.equal(steps[0].run_id, runId);
    assert.equal(steps[0].phase, "scope");
    assert.equal(steps[0].step, "scope-definition");
    assert.equal(steps[0].duration_ms, 5000);
    assert.equal(steps[0].est_input_tokens, 20);
    assert.equal(steps[0].est_output_tokens, 10);
    assert.equal(steps[0].token_source, "estimated");
    assert.equal(steps[0].files_read, 2);
    assert.equal(steps[0].files_written, 1);
    assert.deepEqual(steps[0].meta, { state: "ok" });
  } finally {
    cleanup();
  }
});

test("agent-pre.sh + agent-step.sh produce step with real duration", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const pluginRoot = ROOT;
    const agentPre = path.join(pluginRoot, "hooks", "agent-pre.sh");
    const agentStep = path.join(pluginRoot, "hooks", "agent-step.sh");

    // Start a run so agent-step can correlate
    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "dev"], { cwd: root, env, encoding: "utf8" })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "dev");

    const agentName = "test-duration-agent";
    const preInput = JSON.stringify({
      tool_name: "Agent",
      tool_input: {
        name: agentName,
        prompt: "Do something useful for testing purposes here",
        subagent_type: "Explore",
      },
    });

    // Fire PreToolUse hook - writes start timestamp
    childProcess.execFileSync(agentPre, {
      cwd: root,
      input: preInput,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Verify timestamp file was created
    const crypto = require("node:crypto");
    const hash = crypto.createHash("sha256").update(agentName).digest("hex").slice(0, 16);
    const startFile = path.join(analyticsDir, ".agent-starts", hash);
    assert.ok(fs.existsSync(startFile), "start timestamp file should exist");
    const startTs = fs.readFileSync(startFile, "utf8").trim();
    assert.match(startTs, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, "should be ISO timestamp");

    // Simulate ~1s delay (write a timestamp 2s in the past to make duration measurable)
    const past = new Date(Date.now() - 2000).toISOString().replace(/\.\d+Z$/, ".000Z");
    fs.writeFileSync(startFile, past);

    const postInput = JSON.stringify({
      tool_name: "Agent",
      tool_input: {
        name: agentName,
        prompt: "Do something useful for testing purposes here",
        subagent_type: "Explore",
      },
      tool_output: "ok",
    });

    // Fire PostToolUse hook - reads timestamp, logs step
    childProcess.execFileSync(agentStep, {
      cwd: root,
      input: postInput,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Verify step record has real duration
    const steps = readJsonLines(path.join(analyticsDir, "steps.jsonl"));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].run_id, runId);
    assert.equal(steps[0].skill, "dev");
    assert.equal(steps[0].step, "agent-dispatch");
    assert.equal(steps[0].actor, "agent:Explore");
    assert.ok(
      steps[0].duration_ms >= 1000,
      `duration_ms should be >= 1000, got ${steps[0].duration_ms}`
    );
    assert.equal(steps[0].started_at, past);
    assert.ok(steps[0].meta.output_truncated, "short output should be flagged as truncated");

    // Verify timestamp file was cleaned up
    assert.ok(!fs.existsSync(startFile), "start timestamp file should be deleted after use");
  } finally {
    cleanup();
  }
});

test("agent-step.sh without agent-pre.sh falls back to duration 0", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const pluginRoot = ROOT;
    const agentStep = path.join(pluginRoot, "hooks", "agent-step.sh");

    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "review"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "review");

    const postInput = JSON.stringify({
      tool_name: "Agent",
      tool_input: {
        name: "no-pre-hook",
        prompt: "A prompt long enough to pass the 10 char filter",
        subagent_type: "general-purpose",
      },
      tool_output: "done",
    });

    childProcess.execFileSync(agentStep, {
      cwd: root,
      input: postInput,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const steps = readJsonLines(path.join(analyticsDir, "steps.jsonl"));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].skill, "review");
    assert.equal(steps[0].duration_ms, 0, "without PreToolUse, duration falls back to 0");
  } finally {
    cleanup();
  }
});

test("analytics-log.sh preserves quoted args and writes current skill", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const input = JSON.stringify({
      tool_name: "Skill",
      tool_input: {
        skill: "pm:groom",
        args: 'Redesign the "inspection report" flow',
      },
    });

    childProcess.execFileSync(ANALYTICS_LOG, {
      cwd: root,
      input,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const activity = readJsonLines(path.join(root, ".pm", "analytics", "activity.jsonl"));
    assert.equal(activity.length, 2);
    assert.equal(activity[0].detail, 'args=Redesign the "inspection report" flow');
    assert.equal(activity[1].detail, 'Redesign the "inspection report" flow');
    assert.equal(
      fs.readFileSync(path.join(root, ".pm", "analytics", ".current-skill"), "utf8"),
      "groom"
    );
  } finally {
    cleanup();
  }
});

test("state hooks log groom phase transitions and keep the next phase active", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "groom"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "groom");

    const stateDir = path.join(root, ".pm", "groom-sessions");
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, "tracking.md");
    const initial = [
      "---",
      'topic: "Tracking rollout"',
      "phase: intake",
      `run_id: "${runId}"`,
      "started_at: 2026-04-05T00:00:00Z",
      "phase_started_at: 2026-04-05T00:00:00Z",
      "completed_at: null",
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(stateFile, initial);

    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: stateFile,
      },
    });

    childProcess.execFileSync(STATE_PRE, {
      cwd: root,
      input: payload,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const next = [
      "---",
      'topic: "Tracking rollout"',
      "phase: research",
      `run_id: "${runId}"`,
      "started_at: 2026-04-05T00:00:00Z",
      "phase_started_at: 2026-04-05T00:05:00Z",
      "completed_at: null",
      "---",
      "",
    ].join("\n");
    fs.writeFileSync(stateFile, next);

    childProcess.execFileSync(STATE_STEP, {
      cwd: root,
      input: payload,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const steps = readJsonLines(path.join(analyticsDir, "steps.jsonl"));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].skill, "groom");
    assert.equal(steps[0].phase, "intake");
    assert.equal(steps[0].step, "intake");
    assert.equal(steps[0].run_id, runId);
    assert.equal(steps[0].started_at, "2026-04-05T00:00:00Z");
    assert.equal(steps[0].meta.state_file, ".pm/groom-sessions/tracking.md");

    const active = JSON.parse(
      fs.readFileSync(path.join(analyticsDir, ".current-step.json"), "utf8")
    );
    assert.equal(active.skill, "groom");
    assert.equal(active.phase, "research");
    assert.equal(active.step, "research");
    assert.equal(active.started_at, "2026-04-05T00:05:00Z");
  } finally {
    cleanup();
  }
});

test("session-end.sh closes the last active stateful step", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "dev"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "dev");

    const stateDir = path.join(root, ".pm", "dev-sessions");
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, "feature-x.md");
    fs.writeFileSync(
      stateFile,
      [
        "# Dev Session State",
        "",
        "| Field | Value |",
        "|-------|-------|",
        `| Run ID | ${runId} |`,
        "| Stage | implement |",
        "| Started at | 2026-04-06T01:00:00Z |",
        "| Stage started at | 2026-04-06T01:15:00Z |",
        "| Completed at | null |",
        "",
      ].join("\n")
    );

    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: {
        file_path: stateFile,
      },
    });

    childProcess.execFileSync(STATE_PRE, {
      cwd: root,
      input: payload,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });
    childProcess.execFileSync(STATE_STEP, {
      cwd: root,
      input: payload,
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const sessionEnd = path.join(ROOT, "hooks", "session-end.sh");
    childProcess.execFileSync(sessionEnd, {
      cwd: root,
      input: JSON.stringify({ hook_event_name: "SessionEnd" }),
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: ROOT },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const steps = readJsonLines(path.join(analyticsDir, "steps.jsonl"));
    assert.equal(steps.length, 1);
    assert.equal(steps[0].skill, "dev");
    assert.equal(steps[0].step, "implementation");
    assert.equal(steps[0].run_id, runId);
    assert.equal(steps[0].started_at, "2026-04-06T01:15:00Z");

    const activity = readJsonLines(path.join(analyticsDir, "activity.jsonl"));
    const endEvents = activity.filter((record) => record.event === "completed");
    assert.equal(endEvents.length, 1);
    assert.equal(endEvents[0].run_id, runId);

    assert.ok(
      !fs.existsSync(path.join(analyticsDir, ".current-step.json")),
      ".current-step.json should be deleted"
    );
  } finally {
    cleanup();
  }
});

test("session-end.sh closes open run and cleans up", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const pluginRoot = ROOT;
    const sessionEnd = path.join(pluginRoot, "hooks", "session-end.sh");

    // Start a run
    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "ship"], { cwd: root, env, encoding: "utf8" })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "ship");

    // Create a stale agent-starts dir
    fs.mkdirSync(path.join(analyticsDir, ".agent-starts"), { recursive: true });
    fs.writeFileSync(path.join(analyticsDir, ".agent-starts", "stale"), "2026-01-01T00:00:00.000Z");

    // Fire SessionEnd hook
    childProcess.execFileSync(sessionEnd, {
      cwd: root,
      input: JSON.stringify({ hook_event_name: "SessionEnd" }),
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Verify run was closed
    const activity = readJsonLines(path.join(analyticsDir, "activity.jsonl"));
    const endEvents = activity.filter((r) => r.event === "completed");
    assert.equal(endEvents.length, 1);
    assert.equal(endEvents[0].run_id, runId);
    assert.equal(endEvents[0].status, "completed");

    // Verify .current-run was removed
    assert.ok(
      !fs.existsSync(path.join(analyticsDir, ".current-run")),
      ".current-run should be deleted"
    );
    assert.ok(
      !fs.existsSync(path.join(analyticsDir, ".current-skill")),
      ".current-skill should be deleted"
    );

    // Verify .agent-starts was cleaned up
    assert.ok(
      !fs.existsSync(path.join(analyticsDir, ".agent-starts")),
      ".agent-starts should be deleted"
    );
  } finally {
    cleanup();
  }
});

test("session-end.sh preserves hyphenated skill names", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const pluginRoot = ROOT;
    const sessionEnd = path.join(pluginRoot, "hooks", "session-end.sh");

    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "design-critique"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    const analyticsDir = path.join(root, ".pm", "analytics");
    fs.writeFileSync(path.join(analyticsDir, ".current-run"), runId);
    fs.writeFileSync(path.join(analyticsDir, ".current-skill"), "design-critique");

    childProcess.execFileSync(sessionEnd, {
      cwd: root,
      input: JSON.stringify({ hook_event_name: "SessionEnd" }),
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const activity = readJsonLines(path.join(analyticsDir, "activity.jsonl"));
    const endEvents = activity.filter((r) => r.event === "completed");
    assert.equal(endEvents.length, 1);
    assert.equal(endEvents[0].skill, "design-critique");
    assert.equal(endEvents[0].run_id, runId);
  } finally {
    cleanup();
  }
});

test("session-end.sh is a no-op when no run is active", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const pluginRoot = ROOT;
    const sessionEnd = path.join(pluginRoot, "hooks", "session-end.sh");

    // Ensure analytics dir exists but no .current-run
    fs.mkdirSync(path.join(root, ".pm", "analytics"), { recursive: true });

    // Should exit cleanly with no error
    childProcess.execFileSync(sessionEnd, {
      cwd: root,
      input: JSON.stringify({ hook_event_name: "SessionEnd" }),
      env: { ...env, CLAUDE_PROJECT_DIR: root, CLAUDE_PLUGIN_ROOT: pluginRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // No activity file should be created
    assert.ok(
      !fs.existsSync(path.join(root, ".pm", "analytics", "activity.jsonl")),
      "no activity should be written"
    );
  } finally {
    cleanup();
  }
});

test("baseline generator reports empty corpus and populated corpus", () => {
  const { root, env, cleanup } = setupRepo();
  try {
    const emptyOutput = childProcess.execFileSync("node", [PM_BASELINE, "--project-dir", root], {
      env,
      encoding: "utf8",
    });
    assert.match(emptyOutput, /No telemetry runs have been captured yet/);

    const runId = childProcess
      .execFileSync(PM_LOG, ["run-start", "--skill", "review"], {
        cwd: root,
        env,
        encoding: "utf8",
      })
      .trim();
    childProcess.execFileSync(
      PM_LOG,
      [
        "step",
        "--skill",
        "review",
        "--run-id",
        runId,
        "--phase",
        "review",
        "--step",
        "parallel-review",
        "--status",
        "completed",
        "--duration-ms",
        "120000",
        "--input-chars",
        "400",
        "--output-chars",
        "100",
      ],
      { cwd: root, env, stdio: "ignore" }
    );

    const outputPath = path.join(root, "baseline.md");
    childProcess.execFileSync(
      "node",
      [PM_BASELINE, "--project-dir", root, "--output", outputPath],
      { env, stdio: "ignore" }
    );
    const baseline = fs.readFileSync(outputPath, "utf8");
    assert.match(baseline, /Runs captured: 1/);
    assert.match(baseline, /review — review \/ parallel-review/);
  } finally {
    cleanup();
  }
});
