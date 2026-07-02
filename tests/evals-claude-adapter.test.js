"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const runScript = path.join(repoRoot, "scripts", "evals", "run.js");

const { _private } = require("../scripts/evals/adapters/claude.js");

test("claude stream-json normalizes skills, tools, commands, and exit codes", () => {
  const stream = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "pm:dev" } }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test" } }],
      },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "t3", name: "Edit", input: { file_path: "src/behavior.js" } },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t3", is_error: false }] },
    }),
    JSON.stringify({ type: "result", subtype: "success" }),
  ].join("\n");

  const events = _private.normalizeClaudeStream(stream);
  assert.deepEqual(events[0], { type: "skill", name: "pm:dev" });
  assert.equal(events[1].type, "tool");
  assert.equal(events[1].name, "Bash");
  assert.equal(events[1].command, "npm test");
  assert.equal(events[1].exit_code, 1);
  assert.equal(events[2].name, "Edit");
  assert.equal(events[2].command, "src/behavior.js");
  assert.equal(events[2].exit_code, 0);
});

test("claude live adapter skips with network-policy by default", () => {
  const runId = "20260702T060200Z--dev-tdd-before-implementation--claude";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });

  try {
    const env = { ...process.env };
    delete env.PM_EVAL_CLAUDE_LIVE;
    delete env.PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK;
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "claude",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8", env }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "skip");
    assert.equal(verdict.reason, "network-policy");
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("claude live adapter stages plugin, enables analytics, and captures evidence", () => {
  const runId = "20260702T060201Z--dev-tdd-before-implementation--claude";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-claude-"));
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  writeFakeClaude(binDir, logPath, { writeMarker: true });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "claude",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8", env: liveClaudeEnv({ binDir }) }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "pass", JSON.stringify(verdict));

    const command = JSON.parse(
      fs.readFileSync(path.join(runDir, "metadata", "claude_command.json"), "utf8")
    );
    assert.ok(command.argv.includes("--plugin-dir"));
    assert.ok(command.argv.includes("stream-json"));
    assert.ok(command.argv.includes("--no-session-persistence"));

    const fakeLog = JSON.parse(fs.readFileSync(logPath, "utf8"));
    assert.equal(fakeLog.markerInPrompt, false);
    assert.equal(fakeLog.env.HOME, path.join(runDir, "home"));
    assert.equal(fakeLog.env.ANTHROPIC_API_KEY, "pm-eval-test-key");
    assert.equal(fakeLog.env.PM_PLUGIN_ROOT, path.join(runDir, "home", ".agents", "vendor", "pm"));

    const analytics = fs.readFileSync(
      path.join(runDir, "workdir", ".claude", "pm.local.md"),
      "utf8"
    );
    assert.match(analytics, /analytics: true/);

    const normalized = fs.readFileSync(
      path.join(runDir, "metadata", "transcript.normalized.jsonl"),
      "utf8"
    );
    assert.match(normalized, /"name":"pm:dev"/);
    assert.match(normalized, /"exit_code":1/);
    assert.match(normalized, /"exit_code":0/);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("claude live adapter marks missing marker evidence as wrong-source", () => {
  const runId = "20260702T060202Z--dev-tdd-before-implementation--claude";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-claude-missing-"));
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  writeFakeClaude(binDir, logPath, { writeMarker: false });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "claude",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8", env: liveClaudeEnv({ binDir }) }
    );

    assert.notEqual(result.status, 0);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "indeterminate");
    assert.equal(verdict.reason, "wrong-source");
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function liveClaudeEnv({ binDir }) {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    PM_EVAL_CLAUDE_LIVE: "1",
    PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK: "1",
    PM_EVAL_CLAUDE_API_KEY: "pm-eval-test-key",
  };
}

function writeFakeClaude(binDir, logPath, opts) {
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, "claude");
  fs.writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const pluginRoot = process.env.PM_PLUGIN_ROOT;
  let marker = "";
  for (const skill of fs.readdirSync(path.join(pluginRoot, "skills"))) {
    const file = path.join(pluginRoot, "skills", skill, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, "utf8").match(/PM_EVAL_SOURCE_MARKER ([^\\s<]+)/);
    if (match) {
      marker = match[1];
      break;
    }
  }
  const artifacts = process.env.PM_EVAL_ARTIFACTS_DIR;
  fs.mkdirSync(artifacts, { recursive: true });
  if (${opts.writeMarker ? "true" : "false"}) {
    fs.writeFileSync(path.join(artifacts, "pm-source-marker.txt"), marker + "\\n");
  }
  fs.writeFileSync(${JSON.stringify(logPath)}, JSON.stringify({
    argv: process.argv.slice(2),
    env: {
      HOME: process.env.HOME,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      PM_PLUGIN_ROOT: process.env.PM_PLUGIN_ROOT,
      PM_EVAL_ARTIFACTS_DIR: process.env.PM_EVAL_ARTIFACTS_DIR
    },
    marker,
    markerInPrompt: input.includes("pm-eval-source:")
  }, null, 2));
  const lines = [
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "pm:dev" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "npm test -- --filter behavior" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t3", name: "Edit", input: { file_path: "src/behavior.js" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t3", is_error: false }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", id: "t4", name: "Bash", input: { command: "npm test -- --filter behavior" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t4", is_error: false }] } },
    { type: "result", subtype: "success" }
  ];
  for (const line of lines) console.log(JSON.stringify(line));
});
`
  );
  fs.chmodSync(script, 0o755);
}
