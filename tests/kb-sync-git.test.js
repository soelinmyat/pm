"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-test-"));
  const pmDir = path.join(root, "pm");
  const dotPm = path.join(root, ".pm");
  fs.mkdirSync(pmDir, { recursive: true });
  fs.mkdirSync(dotPm, { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    root,
    pmDir,
    dotPm,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Create a bare git repo to act as a remote, and return its path.
 */
function withBareRemote() {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-remote-"));
  execSync("git init --bare", { cwd: remote, stdio: "pipe" });
  return {
    path: remote,
    url: remote, // local path works as a git remote URL
    cleanup: () => fs.rmSync(remote, { recursive: true, force: true }),
  };
}

const KB_SYNC_GIT_PATH = path.join(__dirname, "..", "scripts", "kb-sync-git.js");

// ---------------------------------------------------------------------------
// Test: isGitRepo detection
// ---------------------------------------------------------------------------

test("isGitRepo returns false for non-git directory", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  const { isGitRepo } = require(KB_SYNC_GIT_PATH);
  assert.equal(isGitRepo(pmDir), false);
});

test("isGitRepo returns true after git init", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  execSync("git init", { cwd: pmDir, stdio: "pipe" });

  const { isGitRepo } = require(KB_SYNC_GIT_PATH);
  assert.equal(isGitRepo(pmDir), true);
});

// ---------------------------------------------------------------------------
// Test: hasRemote / getRemoteUrl
// ---------------------------------------------------------------------------

test("hasRemote returns false when no remote configured", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  execSync("git init", { cwd: pmDir, stdio: "pipe" });

  const { hasRemote } = require(KB_SYNC_GIT_PATH);
  assert.equal(hasRemote(pmDir), false);
});

test("hasRemote returns true and getRemoteUrl returns URL after adding remote", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  execSync("git init", { cwd: pmDir, stdio: "pipe" });
  execSync(`git remote add origin ${remote.url}`, { cwd: pmDir, stdio: "pipe" });

  const { hasRemote, getRemoteUrl } = require(KB_SYNC_GIT_PATH);
  assert.equal(hasRemote(pmDir), true);
  assert.equal(getRemoteUrl(pmDir), remote.url);
});

// ---------------------------------------------------------------------------
// Test: setup — initializes git repo with remote and pushes
// ---------------------------------------------------------------------------

test("setup initializes pm/ as git repo, commits, and pushes to remote", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
    "pm/backlog/item.md": "# Item\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, isGitRepo, hasRemote } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, remote.url);

  assert.ok(result.ok, `setup should succeed: ${result.error || ""}`);
  assert.ok(isGitRepo(pmDir), "pm/ should be a git repo");
  assert.ok(hasRemote(pmDir), "pm/ should have a remote");

  // Verify files were pushed — clone the remote and check
  const checkDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-check-"));
  execSync(`git clone ${remote.url} ${checkDir}/clone`, { stdio: "pipe" });
  assert.ok(fs.existsSync(path.join(checkDir, "clone", "strategy.md")));
  assert.ok(fs.existsSync(path.join(checkDir, "clone", "backlog", "item.md")));
  fs.rmSync(checkDir, { recursive: true, force: true });
});

test("setup creates .gitignore with *.local-conflict", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup } = require(KB_SYNC_GIT_PATH);
  setup(pmDir, remote.url);

  const gitignore = fs.readFileSync(path.join(pmDir, ".gitignore"), "utf8");
  assert.ok(gitignore.includes("*.local-conflict"));
});

test("setup returns error for nonexistent pm directory", (t) => {
  const { setup } = require(KB_SYNC_GIT_PATH);
  const result = setup("/nonexistent/path/pm", "https://example.com/repo.git");

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("does not exist"));
});

test("setup updates remote URL when already configured", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote1 = withBareRemote();
  const remote2 = withBareRemote();
  t.after(() => {
    cleanup();
    remote1.cleanup();
    remote2.cleanup();
  });

  const { setup, getRemoteUrl } = require(KB_SYNC_GIT_PATH);

  // First setup with remote1
  setup(pmDir, remote1.url);
  assert.equal(getRemoteUrl(pmDir), remote1.url);

  // Second setup with remote2 — should update
  const result = setup(pmDir, remote2.url);
  assert.ok(result.ok);
  assert.equal(getRemoteUrl(pmDir), remote2.url);
});

// ---------------------------------------------------------------------------
// Test: clone
// ---------------------------------------------------------------------------

test("clone pulls remote content into pm/", (t) => {
  // Set up a remote with content
  const { pmDir: srcDir, cleanup: srcCleanup } = withTempProject({
    "pm/strategy.md": "# Remote Strategy\n",
  });
  const remote = withBareRemote();

  const { setup } = require(KB_SYNC_GIT_PATH);
  setup(srcDir, remote.url);
  srcCleanup();

  // Now clone into a fresh project
  const { root, pmDir, cleanup } = withTempProject({});
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  // Remove the empty pm/ so clone can create it
  fs.rmdirSync(pmDir);

  const { clone } = require(KB_SYNC_GIT_PATH);
  const result = clone(pmDir, remote.url);

  assert.ok(result.ok, `clone should succeed: ${result.error || ""}`);
  assert.ok(fs.existsSync(path.join(pmDir, "strategy.md")));
  assert.equal(fs.readFileSync(path.join(pmDir, "strategy.md"), "utf8"), "# Remote Strategy\n");
});

test("clone fails when pm/ already has content", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/existing.md": "# Existing\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { clone } = require(KB_SYNC_GIT_PATH);
  const result = clone(pmDir, remote.url);

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("already has content"));
});

// ---------------------------------------------------------------------------
// Test: push — stages, commits, and pushes changes
// ---------------------------------------------------------------------------

test("push commits and pushes new files", (t) => {
  const { pmDir, dotPm, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, push } = require(KB_SYNC_GIT_PATH);
  setup(pmDir, remote.url);

  // Add a new file after initial setup
  fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
  fs.writeFileSync(path.join(pmDir, "backlog", "new-item.md"), "# New\n");

  const result = push(pmDir);
  assert.ok(result.ok, `push should succeed: ${result.error || ""}`);
  assert.ok(result.committed > 0, "should have committed files");
});

test("push returns committed=0 when nothing changed", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, push } = require(KB_SYNC_GIT_PATH);
  setup(pmDir, remote.url);

  // Push without changes
  const result = push(pmDir);
  assert.ok(result.ok);
  assert.equal(result.committed, 0);
});

test("push returns error when pm/ is not a git repo", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  t.after(cleanup);

  const { push } = require(KB_SYNC_GIT_PATH);
  const result = push(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("not a git repo"));
});

// ---------------------------------------------------------------------------
// Test: pull — fetches and merges remote changes
// ---------------------------------------------------------------------------

test("pull fetches remote changes", (t) => {
  const remote = withBareRemote();

  // Set up initial content and push
  const { pmDir: src, cleanup: srcCleanup } = withTempProject({
    "pm/strategy.md": "# Strategy v1\n",
  });
  const { setup, push } = require(KB_SYNC_GIT_PATH);
  setup(src, remote.url);

  // Clone to a second "machine"
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-dest-"));
  execSync(`git clone ${remote.url} ${dest}/pm`, { stdio: "pipe" });

  // Push a change from src
  fs.writeFileSync(path.join(src, "strategy.md"), "# Strategy v2\n");
  push(src);

  t.after(() => {
    srcCleanup();
    remote.cleanup();
    fs.rmSync(dest, { recursive: true, force: true });
  });

  // Pull on dest
  const { pull } = require(KB_SYNC_GIT_PATH);
  const result = pull(path.join(dest, "pm"));

  assert.ok(result.ok, `pull should succeed: ${result.error || ""}`);

  const content = fs.readFileSync(path.join(dest, "pm", "strategy.md"), "utf8");
  assert.equal(content, "# Strategy v2\n");
});

test("pull returns error when pm/ is not a git repo", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  t.after(cleanup);

  const { pull } = require(KB_SYNC_GIT_PATH);
  const result = pull(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("not a git repo"));
});

// ---------------------------------------------------------------------------
// Test: status
// ---------------------------------------------------------------------------

test("status returns repo info for configured git repo", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, status } = require(KB_SYNC_GIT_PATH);
  setup(pmDir, remote.url);

  const result = status(pmDir);

  assert.ok(result.ok);
  assert.equal(result.remote, remote.url);
  assert.equal(result.branch, "main");
  assert.equal(result.uncommitted, 0);
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
});

test("status reports uncommitted changes", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, status } = require(KB_SYNC_GIT_PATH);
  setup(pmDir, remote.url);

  // Make an uncommitted change
  fs.writeFileSync(path.join(pmDir, "strategy.md"), "# Strategy v2\n");

  const result = status(pmDir);
  assert.ok(result.ok);
  assert.ok(result.uncommitted > 0, "should report uncommitted changes");
});

test("status returns error for non-git directory", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  const { status } = require(KB_SYNC_GIT_PATH);
  const result = status(pmDir);
  assert.equal(result.ok, false);
  assert.ok(result.error.includes("not a git repo"));
});

// ---------------------------------------------------------------------------
// Test: writeSyncStatus
// ---------------------------------------------------------------------------

test("writeSyncStatus writes correctly shaped JSON with git backend", (t) => {
  const { root, cleanup } = withTempProject({});
  t.after(cleanup);

  const { writeSyncStatus } = require(KB_SYNC_GIT_PATH);
  writeSyncStatus(path.join(root, ".pm"), {
    mode: "push",
    uploaded: 3,
    errors: [],
    ok: true,
  });

  const statusPath = path.join(root, ".pm", "sync-status.json");
  assert.ok(fs.existsSync(statusPath));

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(status.mode, "push");
  assert.equal(status.backend, "git");
  assert.equal(status.uploaded, 3);
  assert.equal(status.ok, true);
  assert.ok(status.lastSync);
  assert.ok(!isNaN(Date.parse(status.lastSync)), "lastSync must be valid ISO date");
});
