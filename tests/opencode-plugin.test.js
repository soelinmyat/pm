"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSession } = require("../scripts/lib/dev-session-schema");
const {
  setup,
  checkPush,
  buildInstallConfig,
  installConfig,
} = require("../scripts/opencode-plugin");
const root = path.resolve(__dirname, "..");

function context(version = "2.0.24") {
  const skills = [],
    commands = [],
    hooks = {},
    prompts = [];
  return {
    skills,
    commands,
    hooks,
    prompts,
    app: { version },
    options: {},
    skill: { transform: async (fn) => fn({ add: (entry) => skills.push(entry) }) },
    command: { transform: async (fn) => fn({ add: (entry) => commands.push(entry) }) },
    shell: {
      hook: async (name, fn) => {
        hooks[name] = fn;
      },
    },
    session: {
      hook: async (name, fn) => {
        hooks[name] = fn;
      },
      prompt: async (value) => prompts.push(value),
    },
  };
}

test("V2 registers canonical PM skills and commands without starting a workflow", async () => {
  const ctx = context();
  await setup(ctx);
  assert.equal(ctx.skills.length, 24);
  assert.equal(ctx.commands.length, 23);
  assert.equal(ctx.prompts.length, 0);
  const dev = ctx.skills.find((s) => s.id === "pm-dev");
  assert.equal(dev.path, path.join(root, "skills/dev/SKILL.md"));
  assert.match(dev.content, /NEVER SHIP WITHOUT CURRENT GATE EVIDENCE/);
  assert.doesNotMatch(dev.content, /^---/);
  assert.equal(dev.autoinvoke, true);
});

test("slash commands preserve text, attachments, delivery and select the owning skill", async () => {
  const ctx = context();
  await setup(ctx);
  const prompt = {
    text: "Fix work orders",
    files: [{ uri: "file:///tmp/spec.md" }],
    skills: [{ id: "other" }],
  };
  await ctx.commands
    .find((c) => c.name === "pm:dev")
    .execute({ sessionID: "ses_test", prompt, delivery: "queue" });
  assert.deepEqual(ctx.prompts[0], {
    ...prompt,
    sessionID: "ses_test",
    delivery: "queue",
    skills: [{ id: "other" }, { id: "pm-dev" }],
  });
  assert.deepEqual(prompt.skills, [{ id: "other" }]);
});

test("the adapter refuses V1 and missing safety APIs before registering anything", async () => {
  const old = context("1.2.0");
  await assert.rejects(setup(old), /OpenCode 2\.0\.24/);
  assert.equal(old.skills.length, 0);
  const incomplete = context();
  delete incomplete.shell.hook;
  await assert.rejects(setup(incomplete), /shell/);
  assert.equal(incomplete.skills.length, 0);
});

test("shell hook binds root aliases without replacing cwd, permissions or unrelated environment", async () => {
  const ctx = context();
  await setup(ctx);
  const event = {
    command: "git status",
    cwd: root,
    env: { OTHER: "retained", PM_PLUGIN_ROOT: "stale" },
    timeout: 30000,
  };
  await ctx.hooks["create.before"](event);
  assert.equal(event.env.PM_PLUGIN_ROOT, root);
  assert.equal(event.env.CLAUDE_PLUGIN_ROOT, root);
  assert.equal(event.env.OTHER, "retained");
  assert.equal(event.cwd, root);
  assert.equal(event.command, "git status");
  assert.equal(event.timeout, 30000);
});

test("push gate maps the canonical hook deny and fails closed on unavailable or malformed output", () => {
  const event = { command: "git push origin HEAD", cwd: root, env: {} };
  const deny = {
    hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "stale review" },
  };
  assert.throws(
    () => checkPush(event, { run: () => ({ status: 0, stdout: JSON.stringify(deny) }) }),
    /stale review/
  );
  for (const result of [
    { status: 1 },
    { error: new Error("missing node") },
    { status: 0, stdout: "not json" },
  ]) {
    assert.throws(() => checkPush(event, { run: () => result }), /could not verify/);
  }
  let input;
  checkPush(event, {
    run: (_bin, args, options) => {
      input = JSON.parse(options.input);
      assert.equal(args[0], path.join(root, "hooks/push-gate"));
      return { status: 0, stdout: "" };
    },
  });
  assert.deepEqual(input, { cwd: root, tool_input: { command: event.command } });
  checkPush({ ...event, command: "git status" }, { run: () => assert.fail("no gate needed") });
});

test("install config preserves unrelated settings, is idempotent and refuses persona conflicts", () => {
  const existing = {
    model: "openai/custom",
    mcp: { servers: { retained: {} } },
    plugins: ["other"],
    agents: { custom: { system: "mine" } },
  };
  const installed = buildInstallConfig(existing, { root });
  assert.equal(installed.model, existing.model);
  assert.deepEqual(installed.mcp, existing.mcp);
  assert.deepEqual(installed.agents.custom, existing.agents.custom);
  assert.equal(installed.plugins[0], "other");
  assert.equal(installed.plugins[1].package.endsWith("/"), true);
  assert.equal(Object.keys(installed.agents).length, 8);
  const reviewer = installed.agents["pm:staff-engineer"];
  assert.equal(reviewer.mode, "subagent");
  assert.ok(reviewer.permissions.some((p) => p.action === "edit" && p.effect === "deny"));
  assert.ok(reviewer.permissions.some((p) => p.action === "shell" && p.effect === "ask"));
  assert.equal(reviewer.model, undefined);
  assert.deepEqual(buildInstallConfig(installed, { root }), installed);
  assert.throws(
    () =>
      buildInstallConfig(
        { agents: { "pm:staff-engineer": { system: "user override" } } },
        { root }
      ),
    /conflict/
  );
  assert.deepEqual(existing.plugins, ["other"]);
});

test("explicit installer does not overwrite invalid JSON, JSONC or a symlink", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-opencode-install-"));
  try {
    const file = path.join(dir, "opencode.json");
    fs.writeFileSync(file, '{"model":"custom"}');
    installConfig(file, { root });
    const saved = fs.readFileSync(file, "utf8");
    installConfig(file, { root });
    assert.equal(fs.readFileSync(file, "utf8"), saved);
    fs.writeFileSync(file, "{broken");
    assert.throws(() => installConfig(file, { root }), /JSON/);
    assert.equal(fs.readFileSync(file, "utf8"), "{broken");
    assert.throws(() => installConfig(path.join(dir, "opencode.jsonc"), { root }), /JSONC/);
    fs.symlinkSync(file, path.join(dir, "linked.json"));
    assert.throws(() => installConfig(path.join(dir, "linked.json"), { root }), /symlink/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("installer refuses dangling symlinks and invalid node options before writing config", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-opencode-safety-"));
  try {
    const file = path.join(dir, "opencode.json");
    fs.symlinkSync(path.join(dir, "missing.json"), file);
    assert.throws(() => installConfig(file, { root }), /symlink/);
    assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    assert.throws(
      () => buildInstallConfig({}, { root, nodeExecutable: "relative/node" }),
      /absolute/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real canonical push gate blocks a consumer session missing current gates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-opencode-gate-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "-q", "--initial-branch=main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "README.md"), "fixture\n");
    git("add", "README.md");
    git("commit", "-qm", "fixture");
    const remote = path.join(dir, ".git/origin.git");
    git("init", "--bare", "--initial-branch=main", remote);
    git("remote", "add", "origin", remote);
    git("push", "-q", "origin", "HEAD:main");
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git("checkout", "-qb", "feat/opencode-gate");
    const session = createSession({ slug: "opencode-gate", sourceDir: dir });
    const sessionDir = path.join(dir, ".pm/dev-sessions/opencode-gate");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(session));
    const before = git("ls-remote", "origin");
    assert.throws(
      () =>
        checkPush(
          { command: "git push origin HEAD", cwd: dir, env: {} },
          { nodeExecutable: process.execPath }
        ),
      /canonical gate manifest is missing/
    );
    assert.equal(git("ls-remote", "origin"), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unchanged installation is idempotent after recursive object-key reordering", () => {
  function reordered(value) {
    if (Array.isArray(value)) return value.map(reordered);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reordered(item)])
    );
  }
  const original = buildInstallConfig({}, { root });
  const changedOrder = reordered(original);
  assert.deepEqual(buildInstallConfig(changedOrder, { root }), original);
  changedOrder.agents["pm:staff-engineer"].permissions.reverse();
  assert.throws(() => buildInstallConfig(changedOrder, { root }), /conflict/);
});

test("installer aborts without overwriting an intervening unrelated config update", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-opencode-freshness-"));
  try {
    const file = path.join(dir, "opencode.json");
    fs.writeFileSync(file, JSON.stringify({ model: "old" }));
    const updated = JSON.stringify({
      model: "new",
      permissions: [{ action: "edit", resource: "*", effect: "ask" }],
    });
    assert.throws(
      () => installConfig(file, { root, beforePublish: () => fs.writeFileSync(file, updated) }),
      /changed during installation/
    );
    assert.equal(fs.readFileSync(file, "utf8"), updated);
    installConfig(file, { root });
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).model, "new");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two installer processes cannot publish concurrently and locks are released", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-opencode-concurrent-"));
  let observed = false;
  try {
    const file = path.join(dir, "opencode.json");
    fs.writeFileSync(file, JSON.stringify({ model: "retained" }));
    installConfig(file, {
      root,
      beforePublish: () => {
        observed = true;
        assert.throws(
          () =>
            execFileSync(
              process.execPath,
              [path.join(root, "scripts/opencode-install.js"), "--config", file],
              { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
            ),
          /installation is already in progress/
        );
        assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { model: "retained" });
      },
    });
    assert.equal(observed, true);
    installConfig(file, { root });
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).model, "retained");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
