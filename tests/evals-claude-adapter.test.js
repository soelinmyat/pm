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
    assert.equal(
      command.argv[command.argv.indexOf("--permission-mode") + 1],
      "auto",
      "live evals must not bypass Claude permission checks"
    );
    assert.deepEqual(command.argv.slice(-4), ["--model", "claude-opus-4-8", "--effort", "xhigh"]);

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

test("stageKeychainLoginState copies only login-state keys when oauthAccount present", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        oauthAccount: { emailAddress: "user@example.com" },
        userID: "abc123",
        hasCompletedOnboarding: true,
        installMethod: "native",
        projects: { "/some/host/path": { some: "cache" } },
      })
    );
    process.env.HOME = home;

    const staged = _private.stageKeychainLoginState(stagedHome);
    assert.equal(staged, true);

    const written = JSON.parse(fs.readFileSync(path.join(stagedHome, ".claude.json"), "utf8"));
    assert.deepEqual(Object.keys(written).sort(), [
      "hasCompletedOnboarding",
      "installMethod",
      "oauthAccount",
      "userID",
    ]);
    assert.equal(written.projects, undefined);
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState returns false when oauthAccount is missing or falsy", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const hostConfig of [{ userID: "abc123" }, { oauthAccount: null }, { oauthAccount: "" }]) {
      fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify(hostConfig));
      const staged = _private.stageKeychainLoginState(stagedHome);
      assert.equal(staged, false);
      assert.equal(fs.existsSync(path.join(stagedHome, ".claude.json")), false);
    }
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState returns false when the host file is missing or unreadable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    process.env.HOME = home;
    const staged = _private.stageKeychainLoginState(stagedHome);
    assert.equal(staged, false);
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState returns false without throwing when host JSON is not an object", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    process.env.HOME = home;
    for (const primitive of [
      "null",
      "42",
      '"just a string"',
      "true",
      "[]",
      '[{"oauthAccount":1}]',
    ]) {
      fs.writeFileSync(path.join(home, ".claude.json"), primitive);
      assert.doesNotThrow(() => {
        const staged = _private.stageKeychainLoginState(stagedHome);
        assert.equal(staged, false);
      });
    }
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState returns false when HOME is unset", () => {
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    delete process.env.HOME;
    const staged = _private.stageKeychainLoginState(stagedHome);
    assert.equal(staged, false);
  } finally {
    setOrDelete("HOME", priorHome);
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState returns false instead of throwing when stagedHomeDir is not writable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const priorHome = process.env.HOME;
  try {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } })
    );
    process.env.HOME = home;

    const missingStagedHome = path.join(os.tmpdir(), "pm-staged-home-does-not-exist");
    assert.doesNotThrow(() => {
      const staged = _private.stageKeychainLoginState(missingStagedHome);
      assert.equal(staged, false);
    });
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("stageKeychainLoginState writes the staged login file with owner-only permissions", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const stagedHome = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-home-"));
  const priorHome = process.env.HOME;
  try {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } })
    );
    process.env.HOME = home;

    _private.stageKeychainLoginState(stagedHome);
    const mode = fs.statSync(path.join(stagedHome, ".claude.json")).mode & 0o777;
    assert.equal(mode, 0o600);
  } finally {
    process.env.HOME = priorHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(stagedHome, { recursive: true, force: true });
  }
});

test("prepareClaudeRuntime does not require keychain staging when an OAuth token is set", () => {
  const runId = "20260702T060203Z--dev-review-before-push--claude";
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prepare-runtime-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const priorHome = process.env.HOME;
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  const priorApiKey = process.env.PM_EVAL_CLAUDE_API_KEY;
  const priorTemplate = process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
  const priorKeychain = process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN;
  try {
    // No oauthAccount on the host — keychain staging would fail if attempted.
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ userID: "abc123" }));
    process.env.HOME = home;
    delete process.env.PM_EVAL_CLAUDE_API_KEY;
    delete process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
    process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN = "1";
    process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN = "sk-eval-oauth-token";

    const homeDir = path.join(runDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-runtime-src-"));
    fs.mkdirSync(path.join(runtimeDir, "skills", "dummy"), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "skills", "dummy", "SKILL.md"), "# dummy\n");

    const prepared = _private.prepareClaudeRuntime({
      paths: {
        runId,
        homeDir,
        rootDir: runDir,
        runtimeDir,
        runDir,
      },
    });
    assert.equal(prepared.status, "pass", JSON.stringify(prepared));
    assert.equal(fs.existsSync(path.join(homeDir, ".claude.json")), false);
  } finally {
    process.env.HOME = priorHome;
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
    setOrDelete("PM_EVAL_CLAUDE_API_KEY", priorApiKey);
    setOrDelete("PM_EVAL_CLAUDE_HOME_TEMPLATE", priorTemplate);
    setOrDelete("PM_EVAL_CLAUDE_ALLOW_KEYCHAIN", priorKeychain);
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("prepareClaudeRuntime stages keychain login state and passes when no other auth path is set", () => {
  const runId = "20260702T060203Z--dev-review-before-push--claude";
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prepare-runtime-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const priorHome = process.env.HOME;
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  const priorApiKey = process.env.PM_EVAL_CLAUDE_API_KEY;
  const priorTemplate = process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
  const priorKeychain = process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN;
  try {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } })
    );
    process.env.HOME = home;
    delete process.env.PM_EVAL_CLAUDE_API_KEY;
    delete process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
    delete process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
    process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN = "1";

    const homeDir = path.join(runDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-runtime-src-"));
    fs.mkdirSync(path.join(runtimeDir, "skills", "dummy"), { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "skills", "dummy", "SKILL.md"), "# dummy\n");

    const prepared = _private.prepareClaudeRuntime({
      paths: { runId, homeDir, rootDir: runDir, runtimeDir, runDir },
    });
    assert.equal(prepared.status, "pass", JSON.stringify(prepared));
    assert.equal(fs.existsSync(path.join(homeDir, ".claude.json")), true);
  } finally {
    process.env.HOME = priorHome;
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
    setOrDelete("PM_EVAL_CLAUDE_API_KEY", priorApiKey);
    setOrDelete("PM_EVAL_CLAUDE_HOME_TEMPLATE", priorTemplate);
    setOrDelete("PM_EVAL_CLAUDE_ALLOW_KEYCHAIN", priorKeychain);
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("prepareClaudeRuntime skips with claude-auth-missing when keychain staging fails and no other auth path is set", () => {
  const runId = "20260702T060203Z--dev-review-before-push--claude";
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prepare-runtime-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fake-host-home-"));
  const priorHome = process.env.HOME;
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  const priorApiKey = process.env.PM_EVAL_CLAUDE_API_KEY;
  const priorTemplate = process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
  const priorKeychain = process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN;
  try {
    // No oauthAccount on the host — keychain staging fails.
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ userID: "abc123" }));
    process.env.HOME = home;
    delete process.env.PM_EVAL_CLAUDE_API_KEY;
    delete process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
    delete process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
    process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN = "1";

    const homeDir = path.join(runDir, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-runtime-src-"));

    const prepared = _private.prepareClaudeRuntime({
      paths: { runId, homeDir, rootDir: runDir, runtimeDir, runDir },
    });
    assert.deepEqual(prepared, { status: "skip", reason: "claude-auth-missing" });
  } finally {
    process.env.HOME = priorHome;
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
    setOrDelete("PM_EVAL_CLAUDE_API_KEY", priorApiKey);
    setOrDelete("PM_EVAL_CLAUDE_HOME_TEMPLATE", priorTemplate);
    setOrDelete("PM_EVAL_CLAUDE_ALLOW_KEYCHAIN", priorKeychain);
    fs.rmSync(runDir, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("hasAuthPath accepts an OAuth token as a standalone auth path", () => {
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  const priorApiKey = process.env.PM_EVAL_CLAUDE_API_KEY;
  const priorTemplate = process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
  const priorKeychain = process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN;
  try {
    delete process.env.PM_EVAL_CLAUDE_API_KEY;
    delete process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE;
    delete process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN;
    process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN = "sk-eval-oauth-token";
    assert.equal(_private.hasAuthPath(), true);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
    setOrDelete("PM_EVAL_CLAUDE_API_KEY", priorApiKey);
    setOrDelete("PM_EVAL_CLAUDE_HOME_TEMPLATE", priorTemplate);
    setOrDelete("PM_EVAL_CLAUDE_ALLOW_KEYCHAIN", priorKeychain);
  }
});

test("claudeEnv forwards PM_EVAL_CLAUDE_OAUTH_TOKEN as CLAUDE_CODE_OAUTH_TOKEN", () => {
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  try {
    process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN = "sk-eval-oauth-token";
    const env = _private.claudeEnv({
      paths: {
        homeDir: "/tmp/pm-eval-home",
        tmpDir: "/tmp/pm-eval-tmp",
        xdgCacheDir: "/tmp/pm-eval-cache",
        xdgConfigDir: "/tmp/pm-eval-config",
        xdgDataDir: "/tmp/pm-eval-data",
        artifactsDir: "/tmp/pm-eval-artifacts",
        scenarioId: "dev-review-before-push",
      },
      prepared: { pluginRoot: "/tmp/pm-eval-plugin" },
    });
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-eval-oauth-token");
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
  }
});

test("claudeEnv omits CLAUDE_CODE_OAUTH_TOKEN when unset", () => {
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  try {
    delete process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
    const env = _private.claudeEnv({
      paths: {
        homeDir: "/tmp/pm-eval-home",
        tmpDir: "/tmp/pm-eval-tmp",
        xdgCacheDir: "/tmp/pm-eval-cache",
        xdgConfigDir: "/tmp/pm-eval-config",
        xdgDataDir: "/tmp/pm-eval-data",
        artifactsDir: "/tmp/pm-eval-artifacts",
        scenarioId: "dev-review-before-push",
      },
      prepared: { pluginRoot: "/tmp/pm-eval-plugin" },
    });
    assert.equal("CLAUDE_CODE_OAUTH_TOKEN" in env, false);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
  }
});

test("claudeEnv prefers the OAuth token and omits ANTHROPIC_API_KEY when both are set", () => {
  const priorToken = process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN;
  const priorApiKey = process.env.PM_EVAL_CLAUDE_API_KEY;
  try {
    process.env.PM_EVAL_CLAUDE_OAUTH_TOKEN = "sk-eval-oauth-token";
    process.env.PM_EVAL_CLAUDE_API_KEY = "pm-eval-test-key";
    const env = _private.claudeEnv({
      paths: {
        homeDir: "/tmp/pm-eval-home",
        tmpDir: "/tmp/pm-eval-tmp",
        xdgCacheDir: "/tmp/pm-eval-cache",
        xdgConfigDir: "/tmp/pm-eval-config",
        xdgDataDir: "/tmp/pm-eval-data",
        artifactsDir: "/tmp/pm-eval-artifacts",
        scenarioId: "dev-review-before-push",
      },
      prepared: { pluginRoot: "/tmp/pm-eval-plugin" },
    });
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "sk-eval-oauth-token");
    assert.equal("ANTHROPIC_API_KEY" in env, false);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_OAUTH_TOKEN", priorToken);
    setOrDelete("PM_EVAL_CLAUDE_API_KEY", priorApiKey);
  }
});

test("adapterTimeoutMs uses the default when PM_EVAL_CLAUDE_TIMEOUT_MS is unset", () => {
  const prior = process.env.PM_EVAL_CLAUDE_TIMEOUT_MS;
  try {
    delete process.env.PM_EVAL_CLAUDE_TIMEOUT_MS;
    assert.equal(_private.adapterTimeoutMs(), 600_000);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_TIMEOUT_MS", prior);
  }
});

test("adapterTimeoutMs honors a valid PM_EVAL_CLAUDE_TIMEOUT_MS override", () => {
  const prior = process.env.PM_EVAL_CLAUDE_TIMEOUT_MS;
  try {
    process.env.PM_EVAL_CLAUDE_TIMEOUT_MS = "1200000";
    assert.equal(_private.adapterTimeoutMs(), 1_200_000);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_TIMEOUT_MS", prior);
  }
});

test("adapterTimeoutMs falls back to the default for invalid or too-small overrides", () => {
  const prior = process.env.PM_EVAL_CLAUDE_TIMEOUT_MS;
  try {
    process.env.PM_EVAL_CLAUDE_TIMEOUT_MS = "not-a-number";
    assert.equal(_private.adapterTimeoutMs(), 600_000);
    process.env.PM_EVAL_CLAUDE_TIMEOUT_MS = "500";
    assert.equal(_private.adapterTimeoutMs(), 600_000);
    process.env.PM_EVAL_CLAUDE_TIMEOUT_MS = "99999999999999999999";
    assert.equal(_private.adapterTimeoutMs(), 600_000);
  } finally {
    setOrDelete("PM_EVAL_CLAUDE_TIMEOUT_MS", prior);
  }
});

function setOrDelete(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function liveClaudeEnv({ binDir }) {
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH || ""}`,
    PM_EVAL_CLAUDE_LIVE: "1",
    PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK: "1",
    PM_EVAL_CLAUDE_API_KEY: "pm-eval-test-key",
    PM_EVAL_CLAUDE_MODEL: "claude-opus-4-8",
    PM_EVAL_CLAUDE_REASONING_EFFORT: "xhigh",
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
