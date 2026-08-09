"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const {
  artifactBranch,
  prepareArtifactWorktree,
  resolveRemoteDefaultBranch,
} = require("../scripts/artifact-worktree.js");
const {
  applyContext: applyGroomContext,
  createSession: createGroomSession,
} = require("../scripts/lib/groom-session-schema.js");
const {
  applyContext: applyRfcContext,
  createSession: createRfcSession,
} = require("../scripts/lib/rfc-session-schema.js");
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

test("artifact branch names preserve the complete slug identity", () => {
  assert.equal(artifactBranch("analytics", "rfc"), "codex/analytics-rfc");
  assert.equal(artifactBranch("analytics-rfc", "rfc"), "codex/analytics-rfc-rfc");
  assert.notEqual(artifactBranch("analytics", "rfc"), artifactBranch("analytics-rfc", "rfc"));
});

test("RFC preparation inherits the committed proposal from its owned Groom worktree", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const groom = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "handoff",
    kind: "groom",
  });
  const proposal = path.join(groom.worktree, "pm/backlog/proposals/handoff.md");
  fs.mkdirSync(path.dirname(proposal), { recursive: true });
  fs.writeFileSync(proposal, "# Approved handoff\n");
  git(groom.worktree, "add", "pm/backlog/proposals/handoff.md");
  git(groom.worktree, "commit", "-m", "approve handoff proposal");
  const groomCommit = git(groom.worktree, "rev-parse", "HEAD");

  const rfc = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "handoff",
    kind: "rfc",
  });

  assert.equal(rfc.base_commit, groomCommit);
  assert.equal(rfc.inherited_from, groom.branch);
  assert.equal(
    fs.readFileSync(path.join(rfc.worktree, "pm/backlog/proposals/handoff.md"), "utf8"),
    "# Approved handoff\n"
  );
});

test("RFC handoff refuses uncommitted Groom artifact bytes", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const groom = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "dirty-handoff",
    kind: "groom",
  });
  fs.writeFileSync(path.join(groom.worktree, "uncommitted.md"), "not yet approved\n");

  assert.throws(
    () =>
      prepareArtifactWorktree({
        pmDir: seeded.shared,
        slug: "dirty-handoff",
        kind: "rfc",
      }),
    /uncommitted changes/
  );
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

test("artifact preparation reuses an owned worktree while its remote is unavailable", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const first = prepareArtifactWorktree({ pmDir: seeded.shared, slug: "offline", kind: "groom" });
  fs.renameSync(seeded.remote, `${seeded.remote}.offline`);

  const resumed = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "offline",
    kind: "groom",
  });

  assert.equal(resumed.reused, true);
  assert.equal(resumed.worktree, first.worktree);
  assert.equal(resumed.base_commit, first.base_commit);
});

test("artifact preparation fetches from the same push URL used for default discovery", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const decoyRemote = path.join(seeded.root, "decoy.git");
  const decoyWriter = path.join(seeded.root, "decoy-writer");
  git(seeded.root, "clone", "--bare", seeded.remote, decoyRemote);
  git(seeded.root, "clone", decoyRemote, decoyWriter);
  git(decoyWriter, "config", "user.name", "PM Test");
  git(decoyWriter, "config", "user.email", "pm@example.com");
  fs.writeFileSync(path.join(decoyWriter, "decoy.md"), "# Wrong repository\n");
  git(decoyWriter, "add", "decoy.md");
  git(decoyWriter, "commit", "-m", "diverge decoy repository");
  git(decoyWriter, "push", "origin", "main");
  git(seeded.shared, "remote", "set-url", "origin", decoyRemote);
  git(seeded.shared, "remote", "set-url", "--push", "origin", seeded.remote);
  const authoritativeHead = git(seeded.remote, "rev-parse", "refs/heads/main");

  const prepared = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "one-remote-identity",
    kind: "rfc",
  });

  assert.equal(git(prepared.worktree, "rev-parse", "HEAD"), authoritativeHead);
  assert.equal(fs.existsSync(path.join(prepared.worktree, "decoy.md")), false);
});

test("default-branch discovery stays bound to the captured delivery URL", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const authoritative = path.join(seeded.root, "authoritative.git");
  git(seeded.root, "clone", "--bare", seeded.remote, authoritative);
  git(seeded.root, "--git-dir", authoritative, "branch", "trunk", "main");
  git(authoritative, "symbolic-ref", "HEAD", "refs/heads/trunk");
  const decoy = path.join(seeded.root, "decoy-default.git");
  git(seeded.root, "clone", "--bare", seeded.remote, decoy);
  git(decoy, "symbolic-ref", "HEAD", "refs/heads/main");
  git(seeded.shared, "remote", "set-url", "--push", "origin", decoy);

  const branch = resolveRemoteDefaultBranch(seeded.shared, "origin", authoritative);

  assert.equal(branch, "trunk");
  assert.equal(
    git(seeded.shared, "rev-parse", "refs/remotes/origin/trunk"),
    git(authoritative, "rev-parse", "refs/heads/trunk")
  );
});

test("artifact preparation ignores an unrelated shared branch pushRemote", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const fork = path.join(seeded.root, "fork.git");
  git(seeded.root, "clone", "--bare", seeded.remote, fork);
  git(seeded.shared, "remote", "add", "fork", fork);
  git(seeded.shared, "config", "branch.codex/other-rfc.pushRemote", "fork");

  const prepared = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "branch-independent-remote",
    kind: "groom",
  });

  assert.equal(prepared.remote, "origin");
  assert.equal(prepared.base_commit, git(seeded.remote, "rev-parse", "refs/heads/main"));
});

test("artifact preparation rejects owned reuse after delivery URL retargeting", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  prepareArtifactWorktree({ pmDir: seeded.shared, slug: "retargeted", kind: "rfc" });
  const replacement = path.join(seeded.root, "replacement.git");
  git(seeded.root, "clone", "--bare", seeded.remote, replacement);
  git(seeded.shared, "remote", "set-url", "--push", "origin", replacement);

  assert.throws(
    () => prepareArtifactWorktree({ pmDir: seeded.shared, slug: "retargeted", kind: "rfc" }),
    /different delivery URL/
  );
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

test("helper output keeps Groom and RFC source identity separate from KB artifacts", (t) => {
  const seeded = fixture();
  t.after(seeded.cleanup);
  const source = path.join(seeded.root, "product");
  fs.mkdirSync(source);
  git(source, "init", "-q", "-b", "main");
  git(source, "config", "user.name", "PM Test");
  git(source, "config", "user.email", "pm@example.com");
  fs.writeFileSync(path.join(source, "README.md"), "# Product\n");
  git(source, "add", "README.md");
  git(source, "commit", "-m", "initial product");

  const groomArtifact = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "separate-groom",
    kind: "groom",
  });
  const groom = applyGroomContext(
    createGroomSession({ slug: "separate-groom", sourceDir: source, tier: "quick" }),
    {
      title: "Separate Groom storage",
      outcome: "Preserve product identity",
      source_kind: "idea",
      evidence_refs: [],
      artifact_repo_root: groomArtifact.worktree,
    }
  );

  const rfcArtifact = prepareArtifactWorktree({
    pmDir: seeded.shared,
    slug: "separate-rfc",
    kind: "rfc",
  });
  const proposalPath = path.join(rfcArtifact.pm_dir, "backlog/proposals/separate-rfc.md");
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, "# Approved proposal\n");
  const rfc = applyRfcContext(createRfcSession({ slug: "separate-rfc", sourceDir: source }), {
    source_kind: "proposal",
    proposal_path: proposalPath,
    size: "M",
    acceptance_criteria: ["Source and artifact repositories remain distinct"],
    artifact_repo_root: rfcArtifact.worktree,
  });

  assert.equal(groom.source.repo_root, fs.realpathSync(source));
  assert.equal(groom.context.artifact_repo_root, fs.realpathSync(groomArtifact.worktree));
  assert.equal(rfc.source.repo_root, fs.realpathSync(source));
  assert.equal(rfc.context.artifact_repo_root, fs.realpathSync(rfcArtifact.worktree));
  assert.notEqual(groom.source.repo_root, groom.context.artifact_repo_root);
  assert.notEqual(rfc.source.repo_root, rfc.context.artifact_repo_root);
});

test("sync recovery forbids attaching a mixed checkout to a new upstream", () => {
  const root = path.resolve(__dirname, "..");
  const sync = fs.readFileSync(path.join(root, "skills/sync/SKILL.md"), "utf8");
  assert.match(sync, /unrelated commits or dirty paths/i);
  assert.match(sync, /do not set an upstream/i);
  assert.match(sync, /owning session.*artifact worktree/i);
});
