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

const GIT_ENV_KEYS_TO_CLEAR = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_SUPER_PREFIX",
];

function gitEnv(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const key of GIT_ENV_KEYS_TO_CLEAR) {
    delete env[key];
  }
  return env;
}

function gitExec(cmd, opts = {}) {
  const { env, ...rest } = opts;
  return execSync(cmd, {
    stdio: "pipe",
    env: gitEnv(env),
    ...rest,
  });
}

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
  gitExec("git init --bare", { cwd: remote });
  // Ensure HEAD points to main so clones check out the right branch
  gitExec("git symbolic-ref HEAD refs/heads/main", { cwd: remote });
  return {
    path: remote,
    url: remote, // local path works as a git remote URL
    cleanup: () => fs.rmSync(remote, { recursive: true, force: true }),
  };
}

const KB_SYNC_GIT_PATH = path.join(__dirname, "..", "scripts", "kb-sync-git.js");

// Ensure git identity is available for CI environments
process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "Test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || "test@test.local";
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || "Test";
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || "test@test.local";

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

  gitExec("git init", { cwd: pmDir });

  const { isGitRepo } = require(KB_SYNC_GIT_PATH);
  assert.equal(isGitRepo(pmDir), true);
});

test("linked Git worktrees are recognized as knowledge-base repositories", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-linked-worktree-"));
  const primary = path.join(root, "primary");
  const linked = path.join(root, "linked");
  fs.mkdirSync(primary, { recursive: true });
  gitExec("git init -b main", { cwd: primary });
  gitExec("git config user.name 'PM Test'", { cwd: primary });
  gitExec("git config user.email 'pm@example.com'", { cwd: primary });
  fs.writeFileSync(path.join(primary, "strategy.md"), "# Strategy\n");
  gitExec("git add strategy.md && git commit -m initial", { cwd: primary });
  gitExec(`git worktree add ${JSON.stringify(linked)} -b linked`, { cwd: primary });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { isGitRepo, localGitState } = require(KB_SYNC_GIT_PATH);
  assert.equal(fs.statSync(path.join(linked, ".git")).isFile(), true);
  assert.equal(isGitRepo(linked), true);
  assert.equal(localGitState(linked).repository, "present");
});

// ---------------------------------------------------------------------------
// Test: hasRemote / getRemoteUrl
// ---------------------------------------------------------------------------

test("hasRemote returns false when no remote configured", (t) => {
  const { pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  gitExec("git init", { cwd: pmDir });

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

  gitExec("git init", { cwd: pmDir });
  gitExec(`git remote add origin ${remote.url}`, { cwd: pmDir });

  const { hasRemote, getRemoteUrl } = require(KB_SYNC_GIT_PATH);
  assert.equal(hasRemote(pmDir), true);
  assert.equal(getRemoteUrl(pmDir), remote.url);
});

test("setup ignores inherited git hook env", (t) => {
  const { pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const remote = withBareRemote();
  const poisonObjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-poison-object-"));
  const poisonAlternateDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-poison-alternate-"));
  const repoRoot = path.join(__dirname, "..");
  const hookGitDir = gitExec("git rev-parse --git-dir", { cwd: repoRoot, encoding: "utf8" }).trim();
  const originalEnv = {};
  for (const key of GIT_ENV_KEYS_TO_CLEAR) {
    originalEnv[key] = process.env[key];
  }

  t.after(() => {
    for (const key of GIT_ENV_KEYS_TO_CLEAR) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    cleanup();
    remote.cleanup();
    fs.rmSync(poisonObjectDir, { recursive: true, force: true });
    fs.rmSync(poisonAlternateDir, { recursive: true, force: true });
  });

  process.env.GIT_DIR = hookGitDir;
  process.env.GIT_WORK_TREE = repoRoot;
  process.env.GIT_INDEX_FILE = path.join(hookGitDir, "index");
  process.env.GIT_OBJECT_DIRECTORY = poisonObjectDir;
  process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = poisonAlternateDir;
  process.env.GIT_NAMESPACE = "poisoned-hook-namespace";

  const { setup, hasRemote, getRemoteUrl } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, remote.url);

  assert.ok(result.ok, `setup should succeed under hook env: ${result.error || ""}`);
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
  gitExec(`git clone ${remote.url} ${checkDir}/clone`);
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

test("journaled setup commits the managed ignore file in an existing history", (t) => {
  const remote = withBareRemote();
  const { pmDir, dotPm, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  gitExec("git init -b main", { cwd: pmDir });
  gitExec("git add strategy.md && git commit -m initial", { cwd: pmDir });
  const { runSyncEffect } = require(KB_SYNC_GIT_PATH);
  const result = runSyncEffect({
    mode: "setup",
    pmDir,
    dotPmDir: dotPm,
    remoteUrl: remote.url,
    authorityActions: ["configure_sync"],
  });
  assert.equal(result.state, "verified", JSON.stringify(result));
  assert.equal(gitExec("git status --porcelain", { cwd: pmDir }).toString().trim(), "");
  assert.match(
    gitExec("git show origin/main:.gitignore", { cwd: pmDir }).toString(),
    /local-conflict/
  );
});

test("setup returns error for nonexistent pm directory", () => {
  const { setup } = require(KB_SYNC_GIT_PATH);
  const result = setup("/nonexistent/path/pm", "https://example.com/repo.git");

  assert.equal(result.ok, false);
  assert.ok(result.error.includes("does not exist"));
});

test("setup rejects option-shaped remote URLs before invoking git", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  t.after(cleanup);

  const { setup } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, "--upload-pack=touch-pwned");

  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported or unsafe/);
  assert.equal(fs.existsSync(path.join(pmDir, ".git")), false);
});

test("setup treats shell metacharacters as literal remote text", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const sentinel = path.join(path.dirname(pmDir), "pwned");
  t.after(cleanup);

  const { setup } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, `invalid;touch ${sentinel}`);

  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(sentinel), false);
});

test("setup supports a local remote path containing spaces", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb remote parent-"));
  const remotePath = path.join(remoteRoot, "knowledge base.git");
  fs.mkdirSync(remotePath);
  gitExec("git init --bare", { cwd: remotePath });
  gitExec("git symbolic-ref HEAD refs/heads/main", { cwd: remotePath });
  t.after(() => {
    cleanup();
    fs.rmSync(remoteRoot, { recursive: true, force: true });
  });

  const { setup, getRemoteUrl } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, remotePath);

  assert.equal(result.ok, true, result.error);
  assert.equal(getRemoteUrl(pmDir), remotePath);
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

test("setup refuses to turn a parent-repository-owned pm directory into a nested repo", (t) => {
  const { root, pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  gitExec("git init -b main", { cwd: root });
  gitExec("git add pm/strategy.md && git commit -m initial", { cwd: root });

  const { setup } = require(KB_SYNC_GIT_PATH);
  const result = setup(pmDir, remote.url);

  assert.equal(result.ok, false);
  assert.match(result.error, /owned by the parent Git repository/i);
  assert.match(result.error, /separate-repo/i);
  assert.equal(fs.existsSync(path.join(pmDir, ".git")), false);
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
  const { pmDir, cleanup } = withTempProject({});
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

test("push auto-rebases and retries when remote has new commits", (t) => {
  const remote = withBareRemote();

  // First "machine" sets up and pushes
  const { pmDir: machineA, cleanup: cleanupA } = withTempProject({
    "pm/strategy.md": "# v1\n",
  });
  const { setup, push } = require(KB_SYNC_GIT_PATH);
  setup(machineA, remote.url);

  // Second "machine" clones the same remote
  const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-b-"));
  gitExec(`git clone ${remote.url} ${machineBRoot}/pm`);
  const machineB = path.join(machineBRoot, "pm");

  t.after(() => {
    cleanupA();
    remote.cleanup();
    fs.rmSync(machineBRoot, { recursive: true, force: true });
  });

  // Machine A pushes a new commit (machine B is now behind)
  fs.writeFileSync(path.join(machineA, "a.md"), "# from A\n");
  const pushA = push(machineA);
  assert.ok(pushA.ok);

  // Machine B makes its own commit and pushes — should auto-rebase
  fs.writeFileSync(path.join(machineB, "b.md"), "# from B\n");
  const pushB = push(machineB);

  assert.ok(pushB.ok, `push from B should succeed via auto-rebase: ${pushB.error || ""}`);

  // Verify both files exist on the remote (clone fresh and check)
  const verify = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-verify-"));
  gitExec(`git clone ${remote.url} ${verify}/pm`);
  assert.ok(
    fs.existsSync(path.join(verify, "pm", "a.md")),
    "a.md from machine A should be present"
  );
  assert.ok(
    fs.existsSync(path.join(verify, "pm", "b.md")),
    "b.md from machine B should be present"
  );
  fs.rmSync(verify, { recursive: true, force: true });
});

test("push auto-rebases against the configured non-main upstream", (t) => {
  const remote = withBareRemote();
  const seeded = withTempProject({ "pm/strategy.md": "# v1\n" });
  const { setup, push } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(seeded.pmDir, remote.url, { branch: "release" }).ok, true);
  gitExec("git remote rename origin shared", { cwd: seeded.pmDir });

  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-upstream-release-"));
  gitExec(`git clone --branch release ${remote.url} ${secondRoot}/pm`);
  const second = path.join(secondRoot, "pm");
  gitExec("git remote rename origin shared", { cwd: second });
  t.after(() => {
    seeded.cleanup();
    remote.cleanup();
    fs.rmSync(secondRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(seeded.pmDir, "first.md"), "# first\n");
  assert.equal(push(seeded.pmDir).ok, true);
  fs.writeFileSync(path.join(second, "second.md"), "# second\n");

  const result = push(second);
  assert.equal(result.ok, true, result.error);
  assert.equal(fs.existsSync(path.join(second, "first.md")), true);
});

test("push treats a legal branch name containing shell metacharacters as data", (t) => {
  const remote = withBareRemote();
  const { root, pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const sentinel = path.join(root, "branch-command-ran");
  const branch = `sync;touch\${IFS}${sentinel}`;
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const { setup, push } = require(KB_SYNC_GIT_PATH);
  const configured = setup(pmDir, remote.url, { branch });
  assert.equal(configured.ok, true, configured.error);
  fs.writeFileSync(path.join(pmDir, "new.md"), "# New\n");
  const result = push(pmDir);

  assert.equal(result.ok, true, result.error);
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(
    gitExec("git rev-parse --abbrev-ref --symbolic-full-name @{upstream}", {
      cwd: pmDir,
      encoding: "utf8",
    }).trim(),
    `origin/${branch}`
  );
});

test("push fails closed when the current branch has no upstream", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  gitExec("git init -b local-only", { cwd: pmDir });
  gitExec("git add strategy.md && git commit -m initial", { cwd: pmDir });
  gitExec(`git remote add shared ${remote.url}`, { cwd: pmDir });

  const { push } = require(KB_SYNC_GIT_PATH);
  const result = push(pmDir);

  assert.equal(result.ok, false);
  assert.match(result.error, /has no upstream/i);
  assert.match(result.error, /--set-upstream/);
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
  gitExec(`git clone ${remote.url} ${dest}/pm`);

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

test("pull fails closed in detached HEAD state", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  const { setup, pull } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(pmDir, remote.url).ok, true);
  gitExec("git checkout --detach", { cwd: pmDir });

  const result = pull(pmDir);

  assert.equal(result.ok, false);
  assert.match(result.error, /detached HEAD/i);
  assert.match(result.error, /check out a branch/i);
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
// Test: sync — pulls then pushes in one bidirectional pass
// ---------------------------------------------------------------------------

test("sync pulls remote changes before pushing local changes", (t) => {
  const remote = withBareRemote();

  const { pmDir: machineA, cleanup: cleanupA } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const { setup, push, sync } = require(KB_SYNC_GIT_PATH);
  setup(machineA, remote.url);

  const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-sync-b-"));
  gitExec(`git clone ${remote.url} ${machineBRoot}/pm`);
  const machineB = path.join(machineBRoot, "pm");

  t.after(() => {
    cleanupA();
    remote.cleanup();
    fs.rmSync(machineBRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(machineA, "remote-note.md"), "# from remote\n");
  const pushA = push(machineA);
  assert.ok(pushA.ok, `remote update should push: ${pushA.error || ""}`);

  fs.writeFileSync(path.join(machineB, "local-note.md"), "# from local\n");
  const result = sync(machineB);
  assert.ok(result.ok, `sync should succeed: ${result.error || ""}`);
  assert.equal(typeof result.downloaded, "number");
  assert.ok(result.uploaded > 0, "sync should push local changes after pulling");
  assert.ok(
    fs.existsSync(path.join(machineB, "remote-note.md")),
    "local machine should receive remote changes"
  );

  const verify = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-sync-verify-"));
  gitExec(`git clone ${remote.url} ${verify}/pm`);
  assert.ok(fs.existsSync(path.join(verify, "pm", "remote-note.md")));
  assert.ok(fs.existsSync(path.join(verify, "pm", "local-note.md")));
  fs.rmSync(verify, { recursive: true, force: true });
});

test("CLI default sync writes combined sync-status.json", (t) => {
  const remote = withBareRemote();

  const { pmDir: machineA, cleanup: cleanupA } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  const { setup, push } = require(KB_SYNC_GIT_PATH);
  setup(machineA, remote.url);

  const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-git-sync-cli-"));
  fs.mkdirSync(path.join(machineBRoot, ".pm"), { recursive: true });
  gitExec(`git clone ${remote.url} ${machineBRoot}/pm`);

  t.after(() => {
    cleanupA();
    remote.cleanup();
    fs.rmSync(machineBRoot, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(machineA, "remote-cli.md"), "# from remote\n");
  const pushA = push(machineA);
  assert.ok(pushA.ok, `remote update should push: ${pushA.error || ""}`);

  fs.writeFileSync(path.join(machineBRoot, "pm", "local-cli.md"), "# from local\n");
  gitExec(`node "${KB_SYNC_GIT_PATH}"`, {
    cwd: machineBRoot,
    env: { CLAUDE_PROJECT_DIR: machineBRoot },
  });

  const statusPath = path.join(machineBRoot, ".pm", "sync-status.json");
  const syncStatus = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(syncStatus.mode, "sync");
  assert.equal(syncStatus.backend, "git");
  assert.equal(syncStatus.ok, true);
  assert.equal(typeof syncStatus.downloaded, "number");
  assert.ok(syncStatus.uploaded > 0);
  assert.match(syncStatus.effect_id, /^effect_[a-f0-9]{64}$/);
  assert.equal(syncStatus.effect_state, "verified");
  assert.equal(syncStatus.verified_receipt.effect, "sync-knowledge-base");
});

test("CLI setup routes initialization through the guarded helper", (t) => {
  const remote = withBareRemote();
  const { root, pmDir, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
  });
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const output = gitExec(`node "${KB_SYNC_GIT_PATH}" setup "${remote.url}"`, {
    cwd: root,
    env: { CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "setup");
  assert.equal(require(KB_SYNC_GIT_PATH).getRemoteUrl(pmDir), remote.url);
});

test("CLI setup never reconfigures the consumer source repository", (t) => {
  const kbRemote = withBareRemote();
  const sourceRemote = withBareRemote();
  const { root, pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  t.after(() => {
    cleanup();
    kbRemote.cleanup();
    sourceRemote.cleanup();
  });
  gitExec("git init", { cwd: root });
  gitExec(`git remote add origin "${sourceRemote.url}"`, { cwd: root });

  gitExec(`node "${KB_SYNC_GIT_PATH}" setup "${kbRemote.url}"`, {
    cwd: root,
    env: { CLAUDE_PROJECT_DIR: root },
  });

  assert.equal(
    gitExec("git remote get-url origin", { cwd: root, encoding: "utf8" }).trim(),
    sourceRemote.url
  );
  assert.equal(require(KB_SYNC_GIT_PATH).getRemoteUrl(pmDir), kbRemote.url);
});

test("CLI clone targets empty pm/ when the consumer source is a Git repository", (t) => {
  const seeded = withTempProject({ "pm/strategy.md": "# Remote Strategy\n" });
  const kbRemote = withBareRemote();
  const sourceRemote = withBareRemote();
  const { root, pmDir, cleanup } = withTempProject({});
  const { setup } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(seeded.pmDir, kbRemote.url).ok, true);
  t.after(() => {
    seeded.cleanup();
    cleanup();
    kbRemote.cleanup();
    sourceRemote.cleanup();
  });
  gitExec("git init", { cwd: root });
  gitExec(`git remote add origin "${sourceRemote.url}"`, { cwd: root });

  gitExec(`node "${KB_SYNC_GIT_PATH}" clone "${kbRemote.url}"`, {
    cwd: root,
    env: { CLAUDE_PROJECT_DIR: root },
  });

  assert.equal(fs.readFileSync(path.join(pmDir, "strategy.md"), "utf8"), "# Remote Strategy\n");
  assert.equal(
    gitExec("git remote get-url origin", { cwd: root, encoding: "utf8" }).trim(),
    sourceRemote.url
  );
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
  assert.equal(result.observation, "local-refs-only");
  assert.equal(result.refresh_action, "/pm:sync");
});

test("status uses the current branch's configured upstream instead of origin/main", (t) => {
  const { pmDir, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const remote = withBareRemote();
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  const { setup, status } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(pmDir, remote.url, { branch: "release" }).ok, true);
  gitExec("git remote rename origin shared", { cwd: pmDir });

  const result = status(pmDir);

  assert.equal(result.ok, true, result.error);
  assert.equal(result.branch, "release");
  assert.equal(result.upstream, "shared/release");
  assert.equal(result.remote, remote.url);
});

test("production sync Git calls do not use shell command strings", () => {
  const source = fs.readFileSync(KB_SYNC_GIT_PATH, "utf8");
  assert.doesNotMatch(source, /execSync/);
  assert.doesNotMatch(source, /runSafe\(\s*[`"']git\s/);
});

test("status is effect-free and never refreshes remote-tracking refs", (t) => {
  const remote = withBareRemote();
  const seeded = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-status-local-refs-"));
  const { setup, push, status } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(seeded.pmDir, remote.url).ok, true);
  gitExec(`git clone ${remote.url} ${machineBRoot}/pm`);
  const machineB = path.join(machineBRoot, "pm");
  const observedBefore = gitExec("git rev-parse refs/remotes/origin/main", {
    cwd: machineB,
    encoding: "utf8",
  }).trim();
  fs.writeFileSync(path.join(seeded.pmDir, "remote-only.md"), "# Remote\n");
  assert.equal(push(seeded.pmDir).ok, true);

  t.after(() => {
    seeded.cleanup();
    remote.cleanup();
    fs.rmSync(machineBRoot, { recursive: true, force: true });
  });

  const result = status(machineB);
  const observedAfter = gitExec("git rev-parse refs/remotes/origin/main", {
    cwd: machineB,
    encoding: "utf8",
  }).trim();
  assert.equal(result.ok, true);
  assert.equal(result.behind, 0, "status reports divergence from locally observed refs only");
  assert.equal(observedAfter, observedBefore, "status must not fetch or mutate refs");
  assert.equal(fs.existsSync(path.join(machineBRoot, ".pm", "effects")), false);
});

test("journaled push observes and reuses a verified outcome before another mutation", (t) => {
  const remote = withBareRemote();
  const { pmDir, dotPm, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const { setup, runSyncEffect } = require(KB_SYNC_GIT_PATH);
  const {
    serializationLockPath,
    sharedGitRepositorySerialization,
  } = require("../scripts/lib/operational-effect-journal.js");
  assert.equal(setup(pmDir, remote.url).ok, true);
  fs.writeFileSync(path.join(pmDir, "new.md"), "# New\n");
  t.after(() => {
    cleanup();
    remote.cleanup();
  });

  const options = {
    mode: "push",
    pmDir,
    dotPmDir: dotPm,
    authorityActions: ["push_knowledge_base"],
  };
  const first = runSyncEffect(options);
  const { writeSyncStatus } = require(KB_SYNC_GIT_PATH);
  writeSyncStatus(dotPm, {
    mode: "pull",
    downloaded: 7,
    errors: ["stale failure"],
    ok: false,
  });
  const second = runSyncEffect(options);
  assert.equal(first.state, "verified");
  assert.equal(second.state, "verified");
  assert.equal(second.replayed, true);
  const journal = JSON.parse(fs.readFileSync(first.journal_path, "utf8"));
  assert.equal(journal.attempts.length, 1);
  assert.equal(fs.statSync(first.journal_path).mode & 0o777, 0o600);
  let statusRecord = JSON.parse(fs.readFileSync(path.join(dotPm, "sync-status.json"), "utf8"));
  assert.equal(statusRecord.mode, "push");
  assert.deepEqual(statusRecord.errors, []);
  assert.equal(statusRecord.effect_id, first.effect_id);

  const serialization = sharedGitRepositorySerialization(pmDir);
  const lockPath = serializationLockPath(serialization.root, serialization.scope);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      token: "live-test-lock",
      acquired_at: new Date().toISOString(),
    })
  );
  const blocked = runSyncEffect({ ...options, lockTimeoutMs: 0 });
  fs.rmSync(lockPath);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.errors.length, 1);
  statusRecord = JSON.parse(fs.readFileSync(path.join(dotPm, "sync-status.json"), "utf8"));
  assert.equal(statusRecord.mode, "push");
  assert.equal(statusRecord.effect_state, "blocked");
  assert.equal(statusRecord.errors.length, 1);
});

test("interrupted sync with changed local state remains ambiguous without another mutation", (t) => {
  const remote = withBareRemote();
  const { pmDir, dotPm, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const { setup, runSyncEffect } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(pmDir, remote.url).ok, true);
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  const options = {
    mode: "sync",
    pmDir,
    dotPmDir: dotPm,
    authorityActions: ["sync_knowledge_base"],
  };
  const first = runSyncEffect(options);
  const journal = JSON.parse(fs.readFileSync(first.journal_path, "utf8"));
  journal.state = "attempting";
  journal.verified_receipt = null;
  journal.attempts.push({
    attempt: 2,
    state: "attempting",
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  });
  fs.writeFileSync(first.journal_path, `${JSON.stringify(journal, null, 2)}\n`);
  fs.writeFileSync(path.join(pmDir, "unresolved-local-change.md"), "# Inspect first\n");
  const headBefore = gitExec("git rev-parse HEAD", { cwd: pmDir, encoding: "utf8" }).trim();

  const recovered = runSyncEffect(options);
  const headAfter = gitExec("git rev-parse HEAD", { cwd: pmDir, encoding: "utf8" }).trim();
  const after = JSON.parse(fs.readFileSync(first.journal_path, "utf8"));

  assert.equal(recovered.state, "ambiguous");
  assert.match(after.last_observation.reason, /fresh Git observation found local changes/);
  assert.equal(after.attempts.length, 2);
  assert.equal(headAfter, headBefore);
});

for (const mode of ["pull", "sync"]) {
  test(`a pre-mutation ${mode} failure can recover and make one safe retry`, (t) => {
    const remote = withBareRemote();
    const seeded = withTempProject({ "pm/strategy.md": "# Strategy\n" });
    const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), `kb-${mode}-recover-`));
    const machineB = path.join(machineBRoot, "pm");
    const machineBState = path.join(machineBRoot, ".pm");
    const api = require(KB_SYNC_GIT_PATH);
    assert.equal(api.setup(seeded.pmDir, remote.url).ok, true);
    gitExec(`git clone ${remote.url} ${machineB}`);
    fs.mkdirSync(machineBState, { recursive: true });
    fs.writeFileSync(path.join(seeded.pmDir, `${mode}-recovered.md`), `# ${mode}\n`);
    assert.equal(api.push(seeded.pmDir).ok, true);
    t.after(() => {
      seeded.cleanup();
      remote.cleanup();
      fs.rmSync(machineBRoot, { recursive: true, force: true });
    });

    let operationCalls = 0;
    const operation = (target) => {
      operationCalls += 1;
      if (operationCalls === 1) {
        return { ok: false, error: "authentication failed before Git mutation" };
      }
      return api[mode](target);
    };
    const options = {
      mode,
      pmDir: machineB,
      dotPmDir: machineBState,
      authorityActions: [mode === "pull" ? "pull_knowledge_base" : "sync_knowledge_base"],
      operations: { [mode]: operation },
    };

    const failed = api.runSyncEffect(options);
    const recovered = api.runSyncEffect(options);

    assert.equal(failed.state, "ambiguous");
    assert.equal(recovered.state, "verified");
    assert.equal(operationCalls, 2);
    assert.equal(fs.existsSync(path.join(machineB, `${mode}-recovered.md`)), true);
  });
}

test("an indeterminate push is observed before replay and recovers without a second mutation", (t) => {
  const remote = withBareRemote();
  const { pmDir, dotPm, cleanup } = withTempProject({ "pm/strategy.md": "# Strategy\n" });
  const { setup, push, runSyncEffect } = require(KB_SYNC_GIT_PATH);
  assert.equal(setup(pmDir, remote.url).ok, true);
  fs.writeFileSync(path.join(pmDir, "after-send.md"), "# After send\n");
  t.after(() => {
    cleanup();
    remote.cleanup();
  });
  let mutations = 0;
  const options = {
    mode: "push",
    pmDir,
    dotPmDir: dotPm,
    authorityActions: ["push_knowledge_base"],
    operations: {
      push(target) {
        mutations += 1;
        const applied = push(target);
        assert.equal(applied.ok, true);
        return { ...applied, ok: false, error: "connection closed after send" };
      },
    },
  };

  const first = runSyncEffect(options);
  const second = runSyncEffect(options);
  assert.equal(first.state, "ambiguous");
  assert.equal(second.state, "verified");
  assert.equal(second.recovered, true);
  assert.equal(mutations, 1);
});

for (const mode of ["pull", "sync"]) {
  test(`journaled ${mode} refreshes the remote on every explicit invocation`, (t) => {
    const remote = withBareRemote();
    const seeded = withTempProject({ "pm/strategy.md": "# Strategy\n" });
    const machineBRoot = fs.mkdtempSync(path.join(os.tmpdir(), `kb-${mode}-fresh-`));
    const machineB = path.join(machineBRoot, "pm");
    const machineBState = path.join(machineBRoot, ".pm");
    const { setup, push, runSyncEffect } = require(KB_SYNC_GIT_PATH);
    assert.equal(setup(seeded.pmDir, remote.url).ok, true);
    gitExec(`git clone ${remote.url} ${machineB}`);
    fs.mkdirSync(machineBState, { recursive: true });
    t.after(() => {
      seeded.cleanup();
      remote.cleanup();
      fs.rmSync(machineBRoot, { recursive: true, force: true });
    });

    const options = {
      mode,
      pmDir: machineB,
      dotPmDir: machineBState,
      authorityActions: [mode === "pull" ? "pull_knowledge_base" : "sync_knowledge_base"],
    };
    const first = runSyncEffect(options);
    fs.writeFileSync(path.join(seeded.pmDir, `${mode}-remote.md`), `# ${mode}\n`);
    assert.equal(push(seeded.pmDir).ok, true);
    const second = runSyncEffect(options);

    assert.equal(first.state, "verified");
    assert.equal(second.state, "verified");
    assert.notEqual(second.replayed, true);
    assert.equal(fs.existsSync(path.join(machineB, `${mode}-remote.md`)), true);
    const journal = JSON.parse(fs.readFileSync(second.journal_path, "utf8"));
    assert.equal(journal.attempts.length, 2);
  });
}

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

// ---------------------------------------------------------------------------
// Test: resolveCliPaths — CLI path resolution for same-repo and separate-repo
// ---------------------------------------------------------------------------

test("resolveCliPaths: same-repo mode resolves to {projectDir}/pm", (t) => {
  const { root, pmDir, cleanup } = withTempProject({});
  t.after(cleanup);

  gitExec("git init", { cwd: pmDir });

  const { resolveCliPaths } = require(KB_SYNC_GIT_PATH);
  const paths = resolveCliPaths(root);

  assert.equal(paths.pmDir, pmDir);
  assert.equal(paths.dotPmDir, path.join(root, ".pm"));
});

test("resolveCliPaths: separate-repo with content at pm-repo-root (natural layout)", (t) => {
  // Source repo with pm_repo config pointing to a separate KB repo.
  // The KB repo itself is the git repo (no pm/ subdir inside it).
  const { root: sourceRoot, cleanup: sourceCleanup } = withTempProject({});
  const kbRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kb-root-")));
  t.after(() => {
    sourceCleanup();
    fs.rmSync(kbRoot, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(sourceRoot, ".pm"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, ".pm", "config.json"),
    JSON.stringify({
      config_schema: 2,
      pm_repo: { type: "local", path: kbRoot },
    })
  );

  // KB root is a git repo; no pm/ subdir inside
  gitExec("git init", { cwd: kbRoot });

  const { resolveCliPaths } = require(KB_SYNC_GIT_PATH);
  const paths = resolveCliPaths(sourceRoot);

  // resolvePmDir returns {kbRoot}/pm; since that isn't a git repo, we fall
  // back to kbRoot (which is a git repo).
  assert.equal(paths.pmDir, kbRoot);
  assert.equal(paths.dotPmDir, path.join(kbRoot, ".pm"));
});

test("resolveCliPaths: separate-repo with pm/ subdir (doc convention)", (t) => {
  const { root: sourceRoot, cleanup: sourceCleanup } = withTempProject({});
  const kbRootReal = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "kb-docconv-")));
  t.after(() => {
    sourceCleanup();
    fs.rmSync(kbRootReal, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(sourceRoot, ".pm"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, ".pm", "config.json"),
    JSON.stringify({
      config_schema: 2,
      pm_repo: { type: "local", path: kbRootReal },
    })
  );

  // Create pm/ subdir inside KB root and init git there
  const pmSubdir = path.join(kbRootReal, "pm");
  fs.mkdirSync(pmSubdir, { recursive: true });
  gitExec("git init", { cwd: pmSubdir });

  const { resolveCliPaths } = require(KB_SYNC_GIT_PATH);
  const paths = resolveCliPaths(sourceRoot);

  // pm/ is itself a git repo, so we sync pm/ directly
  assert.equal(paths.pmDir, pmSubdir);
  assert.equal(paths.dotPmDir, path.join(kbRootReal, ".pm"));
});

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
