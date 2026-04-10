"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const HOOK_PATH = path.join(__dirname, "..", "hooks", "kb-push.sh");

// Prevent inheriting global/system git config (hooks, etc.) in test fixtures
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

function gitExec(cmd, opts = {}) {
  const defaults = opts.encoding ? { env: GIT_ENV } : { env: GIT_ENV, stdio: "ignore" };
  return execSync(cmd, { ...defaults, ...opts });
}

/**
 * Create a temp directory with a bare remote and a local clone.
 * Returns { local, remote, cleanup }.
 */
function createGitFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-push-"));
  const remote = path.join(base, "remote.git");
  const local = path.join(base, "local");

  // Create bare remote
  gitExec(`git init --bare "${remote}"`);

  // Clone and add initial commit
  gitExec(`git clone "${remote}" "${local}"`);
  fs.mkdirSync(path.join(local, "pm"), { recursive: true });
  fs.writeFileSync(path.join(local, "pm", "strategy.md"), "# Strategy v1\n");
  fs.mkdirSync(path.join(local, "src"), { recursive: true });
  fs.writeFileSync(path.join(local, "src", "app.js"), "// app\n");
  fs.mkdirSync(path.join(local, ".pm"), { recursive: true });
  fs.writeFileSync(
    path.join(local, ".pm", "config.json"),
    JSON.stringify({ config_schema: 1, preferences: {} })
  );
  gitExec("git add -A && git commit -m 'init'", { cwd: local });
  gitExec("git push", { cwd: local });

  return {
    base,
    local,
    remote,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function runHook(projectDir, args = "", env = {}) {
  try {
    const result = execSync(`bash "${HOOK_PATH}" ${args}`, {
      cwd: projectDir,
      env: {
        ...GIT_ENV,
        CLAUDE_PROJECT_DIR: projectDir,
        ...env,
      },
      encoding: "utf8",
      timeout: 15000,
    });
    return { stdout: result, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.status };
  }
}

test("kb-push: commits and pushes pm/ changes successfully", () => {
  const fixture = createGitFixture();
  try {
    // Make a pm/ change
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# Strategy v2\n");

    const { exitCode } = runHook(fixture.local, "--skill groom");
    assert.equal(exitCode, 0);

    // Verify the change was committed
    const log = gitExec("git log --oneline -1", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\):/);
    assert.match(log, /groom/);

    // Verify the change was pushed (check remote)
    const tmp = path.join(fixture.base, "verify");
    gitExec(`git clone "${fixture.remote}" "${tmp}"`);
    const content = fs.readFileSync(path.join(tmp, "pm", "strategy.md"), "utf8");
    assert.match(content, /v2/);
    fs.rmSync(tmp, { recursive: true, force: true });
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: no-op when pm/ has no changes", () => {
  const fixture = createGitFixture();
  try {
    const { exitCode } = runHook(fixture.local, "--skill dev");
    assert.equal(exitCode, 0);

    // No new commits should have been created
    const log = gitExec("git log --oneline", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    const lines = log.trim().split("\n");
    assert.equal(lines.length, 1); // only the init commit
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: stages only pm/ files — non-pm/ changes remain unstaged", () => {
  const fixture = createGitFixture();
  try {
    // Make changes in both pm/ and src/
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# Strategy v2\n");
    fs.writeFileSync(path.join(fixture.local, "src", "app.js"), "// app v2\n");

    const { exitCode } = runHook(fixture.local, "--skill dev");
    assert.equal(exitCode, 0);

    // Verify pm/ was committed (use HEAD~1 HEAD to compare commits, not working tree)
    const committed = gitExec("git diff HEAD~1 HEAD --name-only", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(committed, /pm\//);
    assert.doesNotMatch(committed, /src\//);

    // Verify src/ changes still exist as unstaged
    const status = gitExec("git status --porcelain", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(status, /src\/app\.js/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: commits new untracked files in pm/", () => {
  const fixture = createGitFixture();
  try {
    // Create a brand new file in pm/
    fs.mkdirSync(path.join(fixture.local, "pm", "backlog"), { recursive: true });
    fs.writeFileSync(path.join(fixture.local, "pm", "backlog", "new-item.md"), "# New\n");

    const { exitCode } = runHook(fixture.local, "--skill groom");
    assert.equal(exitCode, 0);

    // Verify the new file was committed
    const committed = gitExec("git diff HEAD~1 --name-only", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(committed, /pm\/backlog\/new-item\.md/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: commit message includes skill name from --skill flag", () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    runHook(fixture.local, "--skill research");

    const log = gitExec("git log --oneline -1", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\): sync research changes/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: commit message defaults to 'manual' when no --skill and no .current-skill file", () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    runHook(fixture.local);

    const log = gitExec("git log --oneline -1", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\): sync manual changes/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: reads skill name from .pm/analytics/.current-skill when --skill not provided", () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    // Write .current-skill file
    fs.mkdirSync(path.join(fixture.local, ".pm", "analytics"), { recursive: true });
    fs.writeFileSync(path.join(fixture.local, ".pm", "analytics", ".current-skill"), "groom");

    runHook(fixture.local);

    const log = gitExec("git log --oneline -1", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\): sync groom changes/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: push failure writes .sync-push-failed marker and exits 0", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-push-nopush-"));
  try {
    // Create a local-only repo (no remote to push to)
    gitExec("git init", { cwd: base });
    fs.mkdirSync(path.join(base, "pm"), { recursive: true });
    fs.writeFileSync(path.join(base, "pm", "test.md"), "test");
    fs.mkdirSync(path.join(base, ".pm"), { recursive: true });
    fs.writeFileSync(path.join(base, ".pm", "config.json"), JSON.stringify({ config_schema: 1 }));
    gitExec("git add -A && git commit -m 'init'", { cwd: base });

    // Now make a pm/ change
    fs.writeFileSync(path.join(base, "pm", "test.md"), "test v2");

    const { exitCode } = runHook(base, "--skill dev");
    assert.equal(exitCode, 0);

    // Verify the commit was created
    const log = gitExec("git log --oneline -1", {
      cwd: base,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\):/);

    // Verify failure marker was written
    assert.ok(fs.existsSync(path.join(base, ".pm", ".sync-push-failed")));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("kb-push: skips when lockfile is held (exits 0, no error)", () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    // Create lock directory to simulate held lock
    fs.mkdirSync(path.join(fixture.local, ".pm", ".sync-lock"), { recursive: true });

    const { exitCode } = runHook(fixture.local, "--skill dev");
    assert.equal(exitCode, 0);

    // Verify NO commit was created (still only init commit)
    const log = gitExec("git log --oneline", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    const lines = log.trim().split("\n");
    assert.equal(lines.length, 1);

    // Clean up lock
    fs.rmSync(path.join(fixture.local, ".pm", ".sync-lock"), { recursive: true, force: true });
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: no-op when auto_sync is false and called as hook", () => {
  const fixture = createGitFixture();
  try {
    fs.writeFileSync(
      path.join(fixture.local, ".pm", "config.json"),
      JSON.stringify({ config_schema: 1, preferences: { auto_sync: false } })
    );
    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    const { exitCode } = runHook(fixture.local, "--skill dev");
    assert.equal(exitCode, 0);

    // No commit should have been created
    const log = gitExec("git log --oneline", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    const lines = log.trim().split("\n");
    assert.equal(lines.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("kb-push: always exits 0 even when git commands fail", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-push-nogit-"));
  try {
    // Not a git repo at all
    fs.mkdirSync(path.join(base, "pm"), { recursive: true });
    fs.writeFileSync(path.join(base, "pm", "test.md"), "test");

    const { exitCode } = runHook(base, "--skill dev");
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("kb-push: uses --no-verify for auto-commits", () => {
  const fixture = createGitFixture();
  try {
    // Install a pre-commit hook that would reject the commit
    const hooksDir = path.join(fixture.local, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "pre-commit"), "#!/bin/bash\nexit 1\n");
    fs.chmodSync(path.join(hooksDir, "pre-commit"), "755");

    fs.writeFileSync(path.join(fixture.local, "pm", "strategy.md"), "# v2\n");

    const { exitCode } = runHook(fixture.local, "--skill dev");
    assert.equal(exitCode, 0);

    // The commit should succeed despite the pre-commit hook rejecting
    const log = gitExec("git log --oneline -1", {
      cwd: fixture.local,
      encoding: "utf8",
    });
    assert.match(log, /chore\(pm\):/);
  } finally {
    fixture.cleanup();
  }
});
