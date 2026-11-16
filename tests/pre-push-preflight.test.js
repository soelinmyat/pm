"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-preflight-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const key of [
    "NODE_TEST_CONTEXT",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_PREFIX",
  ])
    delete env[key];
  const run = (cmd, args, extra = {}) =>
    spawnSync(cmd, args, { cwd: dir, env, encoding: "utf8", ...extra });
  const git = (...args) => {
    const result = run("git", args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout.trim();
  };
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write(".gitignore", ".remote.git/\nnode_modules/\nmarker\n");
  write(
    "tests/marker.test.js",
    'require("node:fs").writeFileSync(process.env.PM_PREFLIGHT_MARKER, "ran");\n'
  );
  git("add", ".");
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  git("init", "-q", "--bare", ".remote.git");
  git("--git-dir", ".remote.git", "symbolic-ref", "HEAD", "refs/heads/main");
  git("remote", "add", "origin", path.join(dir, ".remote.git"));
  git("push", "-q", "origin", `${base}:refs/heads/main`);
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "candidate");
    return git("rev-parse", "HEAD");
  };
  const push = (sha = git("rev-parse", "HEAD")) =>
    run("bash", [path.join(root, ".githooks/pre-push"), "origin"], {
      input: `refs/heads/fix/preflight ${sha} refs/heads/fix/preflight ${"0".repeat(40)}\n`,
      env: { ...env, NODE_ENV: "production", PM_PREFLIGHT_MARKER: path.join(dir, "marker") },
    });
  return { dir, run, git, write, commit, push };
}

test("PM gate prerequisites reject before the test process starts", (t) => {
  const f = fixture(t);
  f.write("plugin.config.json", JSON.stringify({ version: "1.0.0", commands: [] }));
  f.write(
    "scripts/lib/session-slug.js",
    fs.readFileSync(path.join(root, "scripts/lib/session-slug.js"))
  );
  const result = f.push(f.commit());
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /missing scripts\/dev-gate-check.js/);
  assert.equal(fs.existsSync(path.join(f.dir, "marker")), false, "heavy tests must not start");
});

test("locked dependencies come from the pushed checkout, never dirty source", (t) => {
  const f = fixture(t);
  f.write(
    "package.json",
    JSON.stringify({
      name: "fixture",
      version: "1.0.0",
      devDependencies: { "fixture-dep": "file:vendor" },
    })
  );
  f.write(
    "vendor/package.json",
    JSON.stringify({ name: "fixture-dep", version: "1.0.0", main: "index.js" })
  );
  f.write("vendor/index.js", 'exports.value = "committed";\n');
  const locked = f.run("npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
  ]);
  assert.equal(locked.status, 0, locked.stdout + locked.stderr);
  f.write(
    "tests/dependency.test.js",
    'require("node:assert/strict").equal(require("fixture-dep").value, "committed");\n'
  );
  const sha = f.commit();
  f.git("push", "-q", "origin", `${sha}:refs/heads/main`);
  f.write("vendor/index.js", 'exports.value = "dirty";\n');
  const result = f.push(sha);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Preparing locked test dependencies/);
});

test("missing lockfile fails before tests and cleans up temporary checkout", (t) => {
  const f = fixture(t);
  f.write("package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  const sha = f.commit();
  f.git("push", "-q", "origin", `${sha}:refs/heads/main`);
  const before = f.git("worktree", "list", "--porcelain");
  const result = f.push(sha);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /package-lock.json/);
  assert.equal(fs.existsSync(path.join(f.dir, "marker")), false);
  assert.equal(f.git("worktree", "list", "--porcelain"), before);
});

test("invalid lockfile blocks before tests without retaining a worktree", (t) => {
  const f = fixture(t);
  f.write("package.json", JSON.stringify({ name: "fixture", version: "1.0.0" }));
  f.write("package-lock.json", "not JSON\n");
  const sha = f.commit();
  f.git("push", "-q", "origin", `${sha}:refs/heads/main`);
  const before = f.git("worktree", "list", "--porcelain");
  const result = f.push(sha);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /locked dependency setup failed/);
  assert.equal(fs.existsSync(path.join(f.dir, "marker")), false);
  assert.equal(f.git("worktree", "list", "--porcelain"), before);
});

test("all pushed refs pass preflight before any branch suite starts", (t) => {
  const f = fixture(t);
  const valid = f.git("rev-parse", "HEAD");
  f.write("plugin.config.json", JSON.stringify({ version: "1.0.0", commands: [] }));
  f.write(
    "scripts/lib/session-slug.js",
    fs.readFileSync(path.join(root, "scripts/lib/session-slug.js"))
  );
  const invalid = f.commit();
  const result = f.run("bash", [path.join(root, ".githooks/pre-push"), "origin"], {
    input: [valid, invalid]
      .map(
        (sha, i) =>
          `refs/heads/fix/preflight-${i} ${sha} refs/heads/fix/preflight-${i} ${"0".repeat(40)}\n`
      )
      .join(""),
    env: { ...process.env, PM_PREFLIGHT_MARKER: path.join(f.dir, "marker") },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /missing scripts\/dev-gate-check.js/);
  assert.equal(fs.existsSync(path.join(f.dir, "marker")), false);
});
