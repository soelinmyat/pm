"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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
    assert.ok(postRecords.length >= 2);
    assert.deepEqual(
      postRecords.map((record) => record.status),
      ["pass", "pass"]
    );
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("ineligible live adapters skip before scenario shell starts", () => {
  const runId = "20260701T050200Z--dev-tdd-before-implementation--codex";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "codex",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "skip");
    assert.equal(verdict.reason, "network-policy");
    assert.equal(fs.existsSync(path.join(runDir, "workdir", "desired-behavior.md")), false);
    assert.equal(fs.existsSync(path.join(runDir, "metadata", "check-results.pre.jsonl")), false);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("unknown adapters fail before creating a run directory", () => {
  const runId = "20260701T050200Z--dev-tdd-before-implementation--typo";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });

  const result = spawnSync(
    process.execPath,
    [
      runScript,
      "evals/scenarios/dev-tdd-before-implementation",
      "--agent",
      "typo",
      "--run-id",
      runId,
    ],
    { cwd: repoRoot, encoding: "utf8" }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown adapter: typo/);
  assert.equal(fs.existsSync(runDir), false);
});

test("codex live adapter stages isolated runtime and captures transcript", () => {
  const runId = "20260701T050201Z--dev-tdd-before-implementation--codex";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-codex-"));
  const template = path.join(tmp, "template");
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(template, "plugins", "cache", "pm", "pm", "stale"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(template, "auth.json"), "{}\n");
  fs.writeFileSync(path.join(template, "config.toml"), "sandbox = 'danger-full-access'\n");
  fs.writeFileSync(
    path.join(template, "plugins", "cache", "pm", "pm", "stale", "marker.txt"),
    "stale\n"
  );
  writeFakeCodex(binDir, logPath, { writeMarker: true });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "codex",
        "--run-id",
        runId,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: liveCodexEnv({ template, binDir }),
      }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "pass");

    const command = JSON.parse(
      fs.readFileSync(path.join(runDir, "metadata", "codex_command.json"), "utf8")
    );
    assert.ok(command.argv.includes("--ignore-user-config"));
    assert.ok(command.argv.includes("--ignore-rules"));
    assert.ok(command.argv.includes("--json"));

    const fakeLog = JSON.parse(fs.readFileSync(logPath, "utf8"));
    assert.equal(fakeLog.markerInPrompt, false);
    assert.equal(fakeLog.env.HOME, path.join(runDir, "home"));
    assert.equal(fakeLog.env.CODEX_HOME, path.join(runDir, "home", ".codex"));
    assert.equal(fakeLog.env.PM_PLUGIN_ROOT, path.join(runDir, "home", ".agents", "vendor", "pm"));
    assert.equal(fakeLog.env.CLAUDE_PLUGIN_ROOT, fakeLog.env.PM_PLUGIN_ROOT);
    assert.match(fakeLog.marker, /^pm-eval-source:/);

    assert.equal(fs.existsSync(path.join(runDir, "home", ".codex", "auth.json")), true);
    assert.equal(fs.existsSync(path.join(runDir, "home", ".codex", "config.toml")), false);
    assert.equal(
      fs.existsSync(path.join(runDir, "home", ".codex", "plugins", "cache", "pm", "pm", "stale")),
      false
    );
    assert.equal(
      fs.existsSync(path.join(runDir, "home", ".agents", "vendor", "pm", "skills", "dev")),
      true
    );
    assert.equal(
      fs.existsSync(path.join(runDir, "home", ".agents", "skills", "pm-dev", "SKILL.md")),
      true
    );

    const normalized = fs.readFileSync(
      path.join(runDir, "metadata", "transcript.normalized.jsonl"),
      "utf8"
    );
    assert.match(normalized, /"name":"pm:dev"/);
    assert.match(normalized, /"name":"functions.exec_command"/);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("codex live adapter marks missing marker evidence as wrong-source", () => {
  const runId = "20260701T050202Z--dev-tdd-before-implementation--codex";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-codex-missing-marker-"));
  const template = path.join(tmp, "template");
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(template, { recursive: true });
  fs.writeFileSync(path.join(template, "auth.json"), "{}\n");
  writeFakeCodex(binDir, logPath, { writeMarker: false });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "codex",
        "--run-id",
        runId,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: liveCodexEnv({ template, binDir }),
      }
    );

    assert.notEqual(result.status, 0);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "indeterminate");
    assert.equal(verdict.reason, "wrong-source");
    assert.equal(fs.existsSync(path.join(runDir, "metadata", "check-results.post.jsonl")), false);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("codex live adapter skips without an auth template before setup", () => {
  const runId = "20260701T050203Z--dev-tdd-before-implementation--codex";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-codex-no-template-"));
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  writeFakeCodex(binDir, logPath, { writeMarker: true });

  try {
    const env = liveCodexEnv({ template: "", binDir });
    delete env.PM_EVAL_CODEX_HOME_TEMPLATE;
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "codex",
        "--run-id",
        runId,
      ],
      { cwd: repoRoot, encoding: "utf8", env }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "skip");
    assert.equal(verdict.reason, "codex-auth-missing");
    assert.equal(fs.existsSync(path.join(runDir, "workdir", "desired-behavior.md")), false);
    assert.equal(fs.existsSync(logPath), false);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("codex live adapter skips empty auth template before setup", () => {
  const runId = "20260701T050204Z--dev-tdd-before-implementation--codex";
  const runDir = path.join(repoRoot, "eval-results", "runs", runId);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-codex-empty-template-"));
  const template = path.join(tmp, "template");
  const binDir = path.join(tmp, "bin");
  const logPath = path.join(tmp, "fake-log.json");
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(template, { recursive: true });
  writeFakeCodex(binDir, logPath, { writeMarker: true });

  try {
    const result = spawnSync(
      process.execPath,
      [
        runScript,
        "evals/scenarios/dev-tdd-before-implementation",
        "--agent",
        "codex",
        "--run-id",
        runId,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: liveCodexEnv({ template, binDir }),
      }
    );

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const verdict = JSON.parse(fs.readFileSync(path.join(runDir, "verdict.json"), "utf8"));
    assert.equal(verdict.status, "skip");
    assert.equal(verdict.reason, "codex-auth-missing");
    assert.equal(fs.existsSync(path.join(runDir, "workdir", "desired-behavior.md")), false);
    assert.equal(fs.existsSync(path.join(runDir, "metadata", "check-results.pre.jsonl")), false);
    assert.equal(fs.existsSync(logPath), false);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function liveCodexEnv({ template, binDir }) {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    PM_EVAL_CODEX_LIVE: "1",
    PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK: "1",
    PM_EVAL_CODEX_HOME_TEMPLATE: template,
  };
}

function writeFakeCodex(binDir, logPath, opts) {
  fs.mkdirSync(binDir, { recursive: true });
  const script = path.join(binDir, "codex");
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
      CODEX_HOME: process.env.CODEX_HOME,
      PM_PLUGIN_ROOT: process.env.PM_PLUGIN_ROOT,
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT,
      PM_EVAL_ARTIFACTS_DIR: process.env.PM_EVAL_ARTIFACTS_DIR
    },
    marker,
    markerInPrompt: input.includes("pm-eval-source:")
  }, null, 2));
  console.log(JSON.stringify({ type: "skill", name: "pm:dev" }));
  console.log(JSON.stringify({ type: "tool", name: "functions.exec_command", command: "npm test -- --filter behavior", exit_code: 1 }));
  console.log(JSON.stringify({ type: "tool", name: "functions.apply_patch", command: "apply_patch src/behavior.js" }));
  console.log(JSON.stringify({ type: "tool", name: "functions.exec_command", command: "npm test -- --filter behavior", exit_code: 0 }));
});
`
  );
  fs.chmodSync(script, 0o755);
}
