"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/prepare-release.js");
const source = path.resolve(__dirname, "..");
const sessionRel = ".pm/dev-sessions/release-test/session.json";

function command(cwd, executable, args) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return command(cwd, "git", args);
}

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prepare-release-"));
  const root = path.join(parent, "project");
  fs.mkdirSync(root);
  const archive = spawnSync("git", ["archive", "--format=tar", "HEAD"], {
    cwd: source,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    archive.status,
    0,
    archive.error?.message || archive.stderr?.toString() || "git archive failed"
  );
  const extracted = spawnSync("tar", ["-xf", "-", "-C", root], {
    input: archive.stdout,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    extracted.status,
    0,
    extracted.error?.message || extracted.stderr?.toString() || "tar extraction failed"
  );
  git(root, "init", "-q", "-b", "codex/ship-v2");
  git(root, "config", "user.email", "release-test@example.com");
  git(root, "config", "user.name", "Release Test");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture baseline");
  git(root, "remote", "add", "origin", "https://github.com/acme/widget.git");
  fs.mkdirSync(path.join(root, path.dirname(sessionRel)), { recursive: true });
  fs.writeFileSync(
    path.join(root, sessionRel),
    `${JSON.stringify(
      {
        run_id: "dev_prepare_release",
        slug: "release-test",
        source: {
          branch: "codex/ship-v2",
          default_branch: "main",
          delivery_remote: "origin",
        },
        authority: { commit: true },
      },
      null,
      2
    )}\n`
  );
  return { root, cleanup: () => fs.rmSync(parent, { recursive: true, force: true }) };
}

test("prepare-release commits version files without creating a feature tag and resumes idempotently", () => {
  const item = fixture();
  try {
    const before = git(item.root, "rev-list", "--count", "HEAD");
    const currentVersion = JSON.parse(
      fs.readFileSync(path.join(item.root, "plugin.config.json"), "utf8")
    ).version;
    const [major, minor, patch] = currentVersion.split(".").map(Number);
    const expectedVersion = `${major}.${minor}.${patch + 1}`;
    const result = spawnSync(
      process.execPath,
      [script, "patch", "--root", item.root, "--session", sessionRel],
      { cwd: item.root, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const prepared = JSON.parse(result.stdout);
    assert.equal(prepared.status, "prepared");
    assert.equal(prepared.transaction.release.tag_created, false);
    assert.equal(prepared.transaction.release.next_version, expectedVersion);
    assert.equal(git(item.root, "rev-list", "--count", "HEAD"), String(Number(before) + 1));
    assert.equal(git(item.root, "tag", "--points-at", "HEAD"), "");
    assert.equal(git(item.root, "status", "--porcelain", "--untracked-files=no"), "");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(item.root, "plugin.config.json"))).version,
      expectedVersion
    );

    const resumed = spawnSync(
      process.execPath,
      [script, "patch", "--root", item.root, "--session", sessionRel],
      { cwd: item.root, encoding: "utf8" }
    );
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(JSON.parse(resumed.stdout).status, "already-prepared");
    assert.equal(git(item.root, "rev-list", "--count", "HEAD"), String(Number(before) + 1));
  } finally {
    item.cleanup();
  }
});

test("prepare-release refuses dirty tracked work instead of absorbing it", () => {
  const item = fixture();
  try {
    fs.appendFileSync(path.join(item.root, "README.md"), "\nlocal dirty change\n");
    const result = spawnSync(
      process.execPath,
      [script, "patch", "--root", item.root, "--session", sessionRel],
      { cwd: item.root, encoding: "utf8" }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /clean tracked worktree/);
    assert.match(fs.readFileSync(path.join(item.root, "README.md"), "utf8"), /local dirty change/);
  } finally {
    item.cleanup();
  }
});

test("version calculation is monotonic", () => {
  const { nextVersionFor } = require("../scripts/prepare-release");
  assert.equal(nextVersionFor("1.2.3", "patch"), "1.2.4");
  assert.equal(nextVersionFor("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersionFor("1.2.3", "2.0.0"), "2.0.0");
  assert.throws(() => nextVersionFor("1.2.3", "1.2.2"), /greater/);
});
