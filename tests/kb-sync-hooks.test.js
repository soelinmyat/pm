"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOOKS_DIR = path.join(__dirname, "..", "hooks");
const KB_PULL = path.join(HOOKS_DIR, "kb-pull");
const KB_PUSH = path.join(HOOKS_DIR, "kb-push");

function withProject(config, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-sync-test-"));
  const dotPm = path.join(root, ".pm");
  const pmDir = path.join(root, "pm");
  fs.mkdirSync(dotPm, { recursive: true });
  fs.mkdirSync(pmDir, { recursive: true });

  if (config !== null) {
    fs.writeFileSync(path.join(dotPm, "config.json"), JSON.stringify(config));
  }

  // Create fake sync scripts that write marker files instead of doing real sync
  const fakeScripts = path.join(root, "fake-plugin", "scripts");
  fs.mkdirSync(fakeScripts, { recursive: true });

  // Server backend script
  fs.writeFileSync(
    path.join(fakeScripts, "kb-sync.js"),
    `const fs = require("fs");
const path = require("path");
const mode = process.argv[2];
const marker = path.join(process.env.CLAUDE_PROJECT_DIR || ".", ".pm", "sync-called-" + mode);
fs.writeFileSync(marker, "server");
`
  );

  // Git backend script
  fs.writeFileSync(
    path.join(fakeScripts, "kb-sync-git.js"),
    `const fs = require("fs");
const path = require("path");
const mode = process.argv[2];
const marker = path.join(process.env.CLAUDE_PROJECT_DIR || ".", ".pm", "sync-called-" + mode);
fs.writeFileSync(marker, "git");
`
  );

  if (opts.dirty) {
    fs.writeFileSync(path.join(dotPm, "sync-dirty"), "1");
  }

  return {
    root,
    dotPm,
    pluginRoot: path.join(root, "fake-plugin"),
    pullMarker: path.join(dotPm, "sync-called-pull"),
    pushMarker: path.join(dotPm, "sync-called-push"),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function runHook(hookPath, projectDir, pluginRoot) {
  try {
    execFileSync("bash", [hookPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
      cwd: projectDir,
    });
  } catch (err) {
    // Hooks always exit 0, but just in case
    return err;
  }
  return null;
}

// ---------------------------------------------------------------------------
// kb-pull tests
// ---------------------------------------------------------------------------

test("PM-201: kb-pull skips when no sync backend configured", (t) => {
  const p = withProject({ config_schema: 2 });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "pull should NOT run when backend is not set");
});

test("PM-201: kb-pull skips when sync.enabled is false", (t) => {
  const p = withProject({
    config_schema: 2,
    sync: { backend: "git", enabled: false },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "pull should NOT run when enabled is false");
});

test("PM-201: kb-pull skips when sync.auto_pull is false", (t) => {
  const p = withProject({
    config_schema: 2,
    sync: { backend: "git", enabled: true, auto_pull: false },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "pull should NOT run when auto_pull is false");
});

test("PM-201: kb-pull calls kb-sync-git.js when backend is git", (t) => {
  const p = withProject({
    config_schema: 2,
    sync: { backend: "git", enabled: true, auto_pull: true },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pullMarker), "pull should run for git backend");
  assert.equal(fs.readFileSync(p.pullMarker, "utf8"), "git", "should use git script");
});

test("PM-201: kb-pull calls kb-sync.js when backend is server", (t) => {
  const p = withProject({
    config_schema: 2,
    sync: { backend: "server", enabled: true, auto_pull: true },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pullMarker), "pull should run for server backend");
  assert.equal(fs.readFileSync(p.pullMarker, "utf8"), "server", "should use server script");
});

test("PM-201: kb-pull skips when no projectId and no sync block (legacy config)", (t) => {
  const p = withProject({ config_schema: 2 });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "pull should NOT run with no sync config");
});

// ---------------------------------------------------------------------------
// kb-push tests
// ---------------------------------------------------------------------------

test("PM-201: kb-push calls kb-sync-git.js when backend is git and dirty", (t) => {
  const p = withProject(
    { config_schema: 2, sync: { backend: "git", enabled: true } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pushMarker), "push should run for git backend");
  assert.equal(fs.readFileSync(p.pushMarker, "utf8"), "git", "should use git script");
});

test("PM-201: kb-push calls kb-sync.js when backend is server and dirty", (t) => {
  const p = withProject(
    { config_schema: 2, sync: { backend: "server", enabled: true } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pushMarker), "push should run for server backend");
  assert.equal(fs.readFileSync(p.pushMarker, "utf8"), "server", "should use server script");
});

test("PM-201: kb-push skips when sync.enabled is false", (t) => {
  const p = withProject(
    { config_schema: 2, sync: { backend: "git", enabled: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "push should NOT run when enabled is false");
});

test("PM-201: kb-push skips when sync.auto_push is false", (t) => {
  const p = withProject(
    { config_schema: 2, sync: { backend: "git", enabled: true, auto_push: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "push should NOT run when auto_push is false");
});

test("PM-201: kb-push removes dirty marker even when sync is disabled", (t) => {
  const p = withProject(
    { config_schema: 2, sync: { backend: "git", enabled: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  const dirtyPath = path.join(p.dotPm, "sync-dirty");
  assert.ok(fs.existsSync(dirtyPath), "dirty marker should exist before hook");

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(dirtyPath), "dirty marker should be removed even when sync disabled");
});

test("PM-201: kb-push skips entirely when no dirty marker exists", (t) => {
  const p = withProject({ config_schema: 2, sync: { backend: "git", enabled: true } });
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "push should NOT run without dirty marker");
});

test("PM-201: kb-push skips when no sync backend configured", (t) => {
  const p = withProject({ config_schema: 2 }, { dirty: true });
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "push should NOT run when backend is not set");
});
