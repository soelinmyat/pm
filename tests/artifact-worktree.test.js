"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { prepareArtifactWorktree } = require("../scripts/artifact-worktree.js");
const execFileAsync = promisify(execFile);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-worktree-"));
  const remote = path.join(root, "origin.git");
  const shared = path.join(root, "kb");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, shared);
  git(shared, "config", "user.name", "PM Test");
  git(shared, "config", "user.email", "pm@example.com");
  fs.writeFileSync(path.join(shared, "memory.md"), "# Memory\n");
  git(shared, "add", "memory.md");
  git(shared, "commit", "-m", "initial knowledge base");
  git(shared, "push", "-u", "origin", "main");
  git(shared, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  git(shared, "checkout", "-b", "codex/other-rfc");
  fs.writeFileSync(path.join(shared, "other.md"), "# Other session\n");
  git(shared, "add", "other.md");
  git(shared, "commit", "-m", "other session commit");
  fs.writeFileSync(path.join(shared, "memory.md"), "# Memory\n\nUncommitted other work\n");
  return {
    root,
    remote,
    shared,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("artifact preparation leaves a dirty feature checkout untouched and branches from remote default", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const beforeBranch = git(seeded.shared, "branch", "--show-current");
  const beforeStatus = git(seeded.shared, "status", "--porcelain=v1");
  const remoteMain = git(seeded.shared, "rev-parse", "origin/main");

  const prepared = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "analytics",
    kind: "rfc",
  });

  assert.equal(prepared.reused, false);
  assert.equal(prepared.branch, "codex/analytics-rfc");
  assert.equal(git(prepared.worktree, "rev-parse", "HEAD"), remoteMain);
  assert.equal(git(prepared.worktree, "merge-base", "HEAD", "origin/main"), remoteMain);
  assert.equal(git(seeded.shared, "branch", "--show-current"), beforeBranch);
  assert.equal(git(seeded.shared, "status", "--porcelain=v1"), beforeStatus);
  assert.equal(fs.existsSync(path.join(prepared.worktree, "other.md")), false);
});

test("artifact preparation observes a remote default-branch change instead of trusting stale origin HEAD", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  git(seeded.shared, "push", "origin", "origin/main:refs/heads/trunk");
  git(seeded.remote, "symbolic-ref", "HEAD", "refs/heads/trunk");
  assert.equal(
    git(seeded.shared, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"),
    "origin/main"
  );

  const prepared = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "default-moved",
    kind: "rfc",
  });

  assert.equal(prepared.default_branch, "trunk");
  assert.equal(prepared.base_ref, "origin/trunk");
  assert.equal(
    git(prepared.worktree, "rev-parse", "HEAD"),
    git(seeded.shared, "rev-parse", "origin/trunk")
  );
});

test("artifact preparation reuses only a helper-owned worktree", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const first = prepareArtifactWorktree({ pmDir: seeded.shared, slug: "analytics", kind: "rfc" });
  fs.writeFileSync(path.join(first.worktree, "draft.md"), "# Draft\n");

  const resumed = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "analytics",
    kind: "rfc",
  });

  assert.equal(resumed.reused, true);
  assert.equal(resumed.worktree, first.worktree);
  assert.equal(fs.readFileSync(path.join(resumed.worktree, "draft.md"), "utf8"), "# Draft\n");
});

test("artifact preparation rejects a legacy branch with unverified ancestry", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  git(seeded.shared, "branch", "codex/analytics-rfc");

  assert.throws(
    () => prepareArtifactWorktree({ pmDir: seeded.shared, slug: "analytics", kind: "rfc" }),
    /already exists without PM artifact-worktree ownership/
  );
});

test("concurrent preparation converges on one owned worktree", async (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const script = path.resolve(__dirname, "../scripts/artifact-worktree.js");
  const args = [
    script,
    "prepare",
    "--pm-dir",
    seeded.shared,
    "--slug",
    "analytics",
    "--kind",
    "rfc",
    "--json",
  ];

  const [left, right] = await Promise.all([
    execFileAsync(process.execPath, args, { encoding: "utf8" }),
    execFileAsync(process.execPath, args, { encoding: "utf8" }),
  ]);
  const results = [JSON.parse(left.stdout), JSON.parse(right.stdout)];

  assert.equal(results[0].worktree, results[1].worktree);
  assert.deepEqual(results.map((item) => item.reused).sort(), [false, true]);
  assert.equal(
    git(seeded.shared, "worktree", "list", "--porcelain").match(
      /branch refs\/heads\/codex\/analytics-rfc/g
    ).length,
    1
  );
});

test("Groom and RFC intake require the isolation helper before artifact writes", () => {
  const root = path.resolve(__dirname, "..");
  const groom = fs.readFileSync(path.join(root, "skills/groom/steps/01-intake.md"), "utf8");
  const rfc = fs.readFileSync(path.join(root, "skills/rfc/steps/01-intake.md"), "utf8");

  for (const contract of [groom, rfc]) {
    assert.match(contract, /artifact-worktree\.js prepare/);
    assert.match(contract, /before (?:initializing|creating|writing)/i);
    assert.match(contract, /returned .*worktree/i);
  }
  assert.match(rfc, /artifact_repo_root/);
});

test("sync recovery forbids attaching a mixed checkout to a new upstream", () => {
  const root = path.resolve(__dirname, "..");
  const sync = fs.readFileSync(path.join(root, "skills/sync/SKILL.md"), "utf8");
  assert.match(sync, /unrelated commits or dirty paths/i);
  assert.match(sync, /do not set an upstream/i);
  assert.match(sync, /owning session.*artifact worktree/i);
});
