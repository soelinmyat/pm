"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const HOOK_PATH = path.join(__dirname, "..", "hooks", "kb-pull.sh");

/**
 * Create a temp directory with a bare remote and a local clone.
 * The remote has an initial commit with pm/strategy.md.
 * Returns { local, remote, cleanup }.
 */
function createGitFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pull-"));
  const remote = path.join(base, "remote.git");
  const local = path.join(base, "local");

  // Create bare remote
  execSync(`git init --bare "${remote}"`, { stdio: "ignore" });

  // Clone and add initial commit
  execSync(`git clone "${remote}" "${local}"`, { stdio: "ignore" });
  fs.mkdirSync(path.join(local, "pm"), { recursive: true });
  fs.writeFileSync(path.join(local, "pm", "strategy.md"), "# Strategy v1\n");
  fs.mkdirSync(path.join(local, "src"), { recursive: true });
  fs.writeFileSync(path.join(local, "src", "app.js"), "// app\n");
  fs.mkdirSync(path.join(local, ".pm"), { recursive: true });
  fs.writeFileSync(
    path.join(local, ".pm", "config.json"),
    JSON.stringify({ config_schema: 1, preferences: {} })
  );
  execSync("git add -A && git commit -m 'init'", {
    cwd: local,
    stdio: "ignore",
  });
  execSync("git push", { cwd: local, stdio: "ignore" });

  return {
    base,
    local,
    remote,
    /**
     * Push a change to the remote from a separate clone, simulating
     * another team member pushing pm/ changes.
     */
    pushRemoteChange(files) {
      const tmp = path.join(base, "pusher");
      execSync(`git clone "${remote}" "${tmp}"`, { stdio: "ignore" });
      for (const [relPath, content] of Object.entries(files)) {
        const full = path.join(tmp, relPath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      execSync("git add -A && git commit -m 'remote change' && git push", {
        cwd: tmp,
        stdio: "ignore",
      });
      fs.rmSync(tmp, { recursive: true, force: true });
    },
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function runHook(projectDir, env = {}) {
  try {
    const result = execSync(`bash "${HOOK_PATH}"`, {
      cwd: projectDir,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: projectDir,
        ...env,
      },
      encoding: "utf8",
      timeout: 10000,
    });
    return { stdout: result, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", exitCode: err.status };
  }
}

test("kb-pull: pulls remote pm/ changes successfully", () => {
  const fixture = createGitFixture();
  try {
    // Push a change to pm/ from another clone
    fixture.pushRemoteChange({
      "pm/strategy.md": "# Strategy v2 — updated remotely\n",
      "pm/backlog/new-item.md": "# New Item\n",
    });

    const { stdout, exitCode } = runHook(fixture.local);
    assert.equal(exitCode, 0);

    // Verify local pm/ was updated
    const strategy = fs.readFileSync(path.join(fixture.local, "pm", "strategy.md"), "utf8");
    assert.match(strategy, /v2/);

    const newItem = fs.readFileSync(
      path.join(fixture.local, "pm", "backlog", "new-item.md"),
      "utf8"
    );
    assert.match(newItem, /New Item/);

    // Verify JSON output with additionalContext
    assert.match(stdout, /hookSpecificOutput/);
    assert.match(stdout, /additionalContext/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-pull: no-op when no remote configured", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pull-norem-"));
  try {
    // Create a git repo with no remote
    execSync("git init", { cwd: base, stdio: "ignore" });
    fs.mkdirSync(path.join(base, ".pm"), { recursive: true });
    fs.writeFileSync(path.join(base, ".pm", "config.json"), JSON.stringify({ config_schema: 1 }));
    fs.mkdirSync(path.join(base, "pm"), { recursive: true });
    fs.writeFileSync(path.join(base, "pm", "test.md"), "test");
    execSync("git add -A && git commit -m 'init'", {
      cwd: base,
      stdio: "ignore",
    });

    const { exitCode } = runHook(base);
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("kb-pull: no-op when not a git repo", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pull-nogit-"));
  try {
    const { exitCode } = runHook(base);
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("kb-pull: no-op when auto_sync is false and called as hook", () => {
  const fixture = createGitFixture();
  try {
    // Set auto_sync to false
    fs.writeFileSync(
      path.join(fixture.local, ".pm", "config.json"),
      JSON.stringify({ config_schema: 1, preferences: { auto_sync: false } })
    );

    fixture.pushRemoteChange({
      "pm/strategy.md": "# Strategy v2\n",
    });

    const { exitCode } = runHook(fixture.local);
    assert.equal(exitCode, 0);

    // Verify local pm/ was NOT updated (still v1)
    const strategy = fs.readFileSync(path.join(fixture.local, "pm", "strategy.md"), "utf8");
    assert.match(strategy, /v1/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-pull: still runs when auto_sync is false but called with --manual flag", () => {
  const fixture = createGitFixture();
  try {
    // Set auto_sync to false
    fs.writeFileSync(
      path.join(fixture.local, ".pm", "config.json"),
      JSON.stringify({ config_schema: 1, preferences: { auto_sync: false } })
    );

    fixture.pushRemoteChange({
      "pm/strategy.md": "# Strategy v2\n",
    });

    // Call with --manual flag
    execSync(`bash "${HOOK_PATH}" --manual`, {
      cwd: fixture.local,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: fixture.local,
      },
      encoding: "utf8",
      timeout: 10000,
    });

    // Verify local pm/ WAS updated
    const strategy = fs.readFileSync(path.join(fixture.local, "pm", "strategy.md"), "utf8");
    assert.match(strategy, /v2/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-pull: handles pm/ directory not existing", () => {
  const fixture = createGitFixture();
  try {
    // Remove pm/ locally
    fs.rmSync(path.join(fixture.local, "pm"), { recursive: true, force: true });

    // Push a pm/ change remotely
    fixture.pushRemoteChange({
      "pm/new-file.md": "# New\n",
    });

    const { exitCode } = runHook(fixture.local);
    assert.equal(exitCode, 0);

    // pm/ should now exist with the new file
    const content = fs.readFileSync(path.join(fixture.local, "pm", "new-file.md"), "utf8");
    assert.match(content, /New/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-pull: does NOT modify non-pm/ files", () => {
  const fixture = createGitFixture();
  try {
    // Push changes to both pm/ and src/ on remote
    fixture.pushRemoteChange({
      "pm/strategy.md": "# Strategy v2\n",
      "src/app.js": "// app v2\n",
    });

    const { exitCode } = runHook(fixture.local);
    assert.equal(exitCode, 0);

    // pm/ should be updated
    const strategy = fs.readFileSync(path.join(fixture.local, "pm", "strategy.md"), "utf8");
    assert.match(strategy, /v2/);

    // src/ should NOT be updated (still v1)
    const app = fs.readFileSync(path.join(fixture.local, "src", "app.js"), "utf8");
    assert.doesNotMatch(app, /v2/);
    assert.match(app, /\/\/ app/);
  } finally {
    fixture.cleanup();
  }
});

test("kb-pull: always exits 0 even when fetch fails", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "kb-pull-badfetch-"));
  try {
    execSync("git init", { cwd: base, stdio: "ignore" });
    // Add a remote that doesn't exist
    execSync("git remote add origin https://nonexistent.invalid/repo.git", {
      cwd: base,
      stdio: "ignore",
    });
    fs.mkdirSync(path.join(base, ".pm"), { recursive: true });
    fs.writeFileSync(path.join(base, ".pm", "config.json"), JSON.stringify({ config_schema: 1 }));
    // Need at least one commit for git branch --show-current to work
    fs.writeFileSync(path.join(base, "README.md"), "# test\n");
    execSync("git add -A && git commit -m 'init'", {
      cwd: base,
      stdio: "ignore",
    });

    const { exitCode } = runHook(base);
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("kb-pull: warns about previous push failure via additionalContext", () => {
  const fixture = createGitFixture();
  try {
    // Create the push failure marker
    fs.writeFileSync(
      path.join(fixture.local, ".pm", ".sync-push-failed"),
      "2026-04-10T12:00:00Z push rejected"
    );

    const { stdout, exitCode } = runHook(fixture.local);
    assert.equal(exitCode, 0);
    assert.match(stdout, /push.*fail/i);
  } finally {
    fixture.cleanup();
  }
});
