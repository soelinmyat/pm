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

  // Create a fake kb-sync.js that writes a marker file instead of doing real sync
  const fakeScripts = path.join(root, "fake-plugin", "scripts");
  fs.mkdirSync(fakeScripts, { recursive: true });
  fs.writeFileSync(
    path.join(fakeScripts, "kb-sync.js"),
    `const fs = require("fs");
const path = require("path");
const mode = process.argv[2];
const marker = path.join(process.env.CLAUDE_PROJECT_DIR || ".", ".pm", "sync-called-" + mode);
fs.writeFileSync(marker, "called");
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

test("PM-201: kb-pull calls kb-sync.js when sync not configured (defaults)", (t) => {
  const p = withProject({ config_schema: 2, projectId: "proj-1" });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pullMarker), "kb-sync.js pull should have been called");
});

test("PM-201: kb-pull skips when sync.enabled is false", (t) => {
  const p = withProject({
    config_schema: 2,
    projectId: "proj-1",
    sync: { enabled: false },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "kb-sync.js pull should NOT have been called");
});

test("PM-201: kb-pull skips when sync.auto_pull is false", (t) => {
  const p = withProject({
    config_schema: 2,
    projectId: "proj-1",
    sync: { enabled: true, auto_pull: false },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pullMarker), "kb-sync.js pull should NOT have been called");
});

test("PM-201: kb-pull runs when sync.enabled is true and auto_pull is true", (t) => {
  const p = withProject({
    config_schema: 2,
    projectId: "proj-1",
    sync: { enabled: true, auto_pull: true },
  });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pullMarker), "kb-sync.js pull should have been called");
});

test("PM-201: kb-pull runs when no projectId (enabled defaults to false but no sync block)", (t) => {
  // No projectId means enabled defaults to false, so pull should skip
  const p = withProject({ config_schema: 2 });
  t.after(p.cleanup);

  runHook(KB_PULL, p.root, p.pluginRoot);
  assert.ok(
    !fs.existsSync(p.pullMarker),
    "kb-sync.js pull should NOT have been called (no projectId)"
  );
});

// ---------------------------------------------------------------------------
// kb-push tests
// ---------------------------------------------------------------------------

test("PM-201: kb-push calls kb-sync.js when sync defaults apply and dirty marker exists", (t) => {
  const p = withProject({ config_schema: 2, projectId: "proj-1" }, { dirty: true });
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(fs.existsSync(p.pushMarker), "kb-sync.js push should have been called");
});

test("PM-201: kb-push skips when sync.enabled is false", (t) => {
  const p = withProject(
    { config_schema: 2, projectId: "proj-1", sync: { enabled: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "kb-sync.js push should NOT have been called");
});

test("PM-201: kb-push skips when sync.auto_push is false", (t) => {
  const p = withProject(
    { config_schema: 2, projectId: "proj-1", sync: { enabled: true, auto_push: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(p.pushMarker), "kb-sync.js push should NOT have been called");
});

test("PM-201: kb-push removes dirty marker even when sync is disabled", (t) => {
  const p = withProject(
    { config_schema: 2, projectId: "proj-1", sync: { enabled: false } },
    { dirty: true }
  );
  t.after(p.cleanup);

  const dirtyPath = path.join(p.dotPm, "sync-dirty");
  assert.ok(fs.existsSync(dirtyPath), "dirty marker should exist before hook");

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(!fs.existsSync(dirtyPath), "dirty marker should be removed even when sync disabled");
});

test("PM-201: kb-push skips entirely when no dirty marker exists", (t) => {
  const p = withProject({ config_schema: 2, projectId: "proj-1" });
  t.after(p.cleanup);

  runHook(KB_PUSH, p.root, p.pluginRoot);
  assert.ok(
    !fs.existsSync(p.pushMarker),
    "kb-sync.js push should NOT have been called (no dirty marker)"
  );
});
