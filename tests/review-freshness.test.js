"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  baseEquivalence,
  computeDelta,
  diffIdentity,
  evaluateReviewFreshness,
  validateSupplementChain,
} = require("../scripts/lib/review-freshness");

function makeRepo(prefix = "pm-review-freshness-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const run = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  run("init", "-q", "-b", "main");
  run("config", "user.email", "test@example.com");
  run("config", "user.name", "Test User");
  run("config", "commit.gpgsign", "false");
  return { dir, run };
}

function commitFile(repo, file, content, message) {
  const target = path.join(repo.dir, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  repo.run("add", "-A");
  repo.run("commit", "-q", "-m", message);
  return repo.run("rev-parse", "HEAD");
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function frozenDiffBytes(repo, base, head) {
  const result = spawnSync("git", ["diff", "--binary", `${base}...${head}`], {
    cwd: repo.dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout;
}

test("baseEquivalence accepts an unrelated advance of the authoritative base", () => {
  const repo = makeRepo();
  try {
    const baseA = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const feature = commitFile(repo, "src/app.js", "feature\n", "feature");
    repo.run("switch", "-q", "main");
    const baseB = commitFile(repo, "unrelated.txt", "unrelated\n", "unrelated main work");
    repo.run("switch", "-q", "feature");

    const verdict = baseEquivalence({
      root: repo.dir,
      commit: feature,
      frozenBaseCommit: baseA,
      liveBaseCommit: baseB,
    });
    assert.equal(verdict.ok, true, verdict.reason);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("baseEquivalence rejects a branch that merged the moved base", () => {
  const repo = makeRepo();
  try {
    const baseA = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    commitFile(repo, "src/app.js", "feature\n", "feature");
    repo.run("switch", "-q", "main");
    const baseB = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("switch", "-q", "feature");
    repo.run("merge", "-q", "--no-edit", "main");
    const merged = repo.run("rev-parse", "HEAD");

    const verdict = baseEquivalence({
      root: repo.dir,
      commit: merged,
      frozenBaseCommit: baseA,
      liveBaseCommit: baseB,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /merge base with the live base differs/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("baseEquivalence rejects a rewritten authoritative base", () => {
  const repo = makeRepo();
  try {
    commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const feature = commitFile(repo, "src/app.js", "feature\n", "feature");
    repo.run("switch", "-q", "main");
    const frozenTip = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("commit", "-q", "--amend", "-m", "rewritten main work");
    const rewrittenTip = repo.run("rev-parse", "HEAD");
    repo.run("switch", "-q", "feature");

    const verdict = baseEquivalence({
      root: repo.dir,
      commit: feature,
      frozenBaseCommit: frozenTip,
      liveBaseCommit: rewrittenTip,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not an ancestor of the live authoritative base/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("baseEquivalence fails closed outside a usable repository", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-not-a-repo-"));
  try {
    const verdict = baseEquivalence({
      root: dir,
      commit: "a".repeat(40),
      frozenBaseCommit: "b".repeat(40),
      liveBaseCommit: "c".repeat(40),
    });
    assert.equal(verdict.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("diffIdentity accepts an amended commit with an identical patch", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = {
      commit: reviewed,
      base_commit: base,
      diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
    };
    repo.run("commit", "-q", "--amend", "-m", "feature with a better message");
    const amended = repo.run("rev-parse", "HEAD");
    assert.notEqual(amended, reviewed);

    const verdict = diffIdentity({ root: repo.dir, source, currentCommit: amended });
    assert.equal(verdict.ok, true, verdict.reason);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("diffIdentity accepts a rebase when compared against the live base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = {
      commit: reviewed,
      base_commit: base,
      diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
    };
    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("switch", "-q", "feature");
    repo.run("rebase", "-q", "main");
    const rebased = repo.run("rev-parse", "HEAD");

    const withLiveBase = diffIdentity({
      root: repo.dir,
      source,
      currentCommit: rebased,
      currentBaseCommit: movedBase,
    });
    assert.equal(withLiveBase.ok, true, withLiveBase.reason);

    const withFrozenBase = diffIdentity({ root: repo.dir, source, currentCommit: rebased });
    assert.equal(withFrozenBase.ok, false);
    assert.match(withFrozenBase.reason, /not patch-identical/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("diffIdentity rejects changed content and tampered frozen hashes", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = {
      commit: reviewed,
      base_commit: base,
      diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
    };
    const changed = commitFile(repo, "src/app.js", "feature\nextra\n", "post-review fix");

    const drifted = diffIdentity({ root: repo.dir, source, currentCommit: changed });
    assert.equal(drifted.ok, false);
    assert.match(drifted.reason, /not patch-identical/);

    const tampered = diffIdentity({
      root: repo.dir,
      source: { ...source, diff_sha256: "0".repeat(64) },
      currentCommit: reviewed,
    });
    assert.equal(tampered.ok, false);
    assert.match(tampered.reason, /no longer match the reviewed diff_sha256/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("computeDelta budgets code lines and exempts tests and docs", () => {
  const repo = makeRepo();
  try {
    const prior = commitFile(repo, "src/app.js", "one\ntwo\n", "base");
    commitFile(repo, "src/app.js", "one\ntwo\nthree\n", "code line");
    commitFile(repo, "tests/app.test.js", "test line\n".repeat(80), "test churn");
    const head = commitFile(repo, "docs/notes.md", "notes\n".repeat(40), "doc churn");

    const delta = computeDelta(repo.dir, prior, head);
    assert.equal(delta.code_lines, 1);
    assert.equal(delta.ineligible, null);
    assert.deepEqual(delta.files.map((row) => row.path).sort(), [
      "docs/notes.md",
      "src/app.js",
      "tests/app.test.js",
    ]);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("evaluateReviewFreshness reports every rejected path when nothing matches", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const head = commitFile(repo, "src/app.js", "feature\nextra\n", "unreviewed fix");
    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");

    const verdict = evaluateReviewFreshness({
      root: repo.dir,
      reviewDir,
      report: { outcome: "passed", source: { commit: reviewed } },
      target: {
        source: {
          commit: reviewed,
          base_commit: base,
          diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
        },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: head,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /diff identity: .*not patch-identical/);
    assert.match(verdict.reason, /delta chain: no delta supplements recorded/);

    const notPassed = evaluateReviewFreshness({
      root: repo.dir,
      reviewDir,
      report: { outcome: "failed", source: { commit: reviewed } },
      target: { source: { commit: reviewed } },
      currentCommit: reviewed,
    });
    assert.equal(notPassed.ok, false);
    assert.match(notPassed.reason, /outcome is not passed/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("validateSupplementChain rejects tampered supplement bindings", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const fix = commitFile(repo, "src/app.js", "feature\nfixed\n", "fix");
    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
    const report = { outcome: "passed", source: { commit: reviewed } };
    const target = {
      source: { commit: reviewed, base_commit: base },
      changed_files: [{ path: "src/app.js" }],
    };
    const supplement = {
      schema_version: 1,
      kind: "review-delta-v1",
      canonical_report: {
        sha256: digest(fs.readFileSync(path.join(reviewDir, "report.json"))),
        commit: reviewed,
      },
      prior_commit: reviewed,
      source: {
        commit: fix,
        delta_diff_sha256: digest(frozenDiffBytes(repo, reviewed, fix)),
      },
      result: { outcome: "passed" },
    };
    fs.writeFileSync(path.join(supplementsDir, "supplement-1.json"), JSON.stringify(supplement));

    const valid = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: fix,
    });
    assert.equal(valid.ok, true, valid.reason);

    const wrongHead = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: reviewed,
    });
    assert.equal(wrongHead.ok, false);
    assert.match(wrongHead.reason, /does not descend|ends at|is invalid/);

    fs.writeFileSync(
      path.join(supplementsDir, "supplement-1.json"),
      JSON.stringify({
        ...supplement,
        source: { ...supplement.source, delta_diff_sha256: "0".repeat(64) },
      })
    );
    const tampered = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: fix,
    });
    assert.equal(tampered.ok, false);
    assert.match(tampered.reason, /drifted from the reviewed delta/);

    fs.writeFileSync(
      path.join(supplementsDir, "supplement-1.json"),
      JSON.stringify({ ...supplement, result: { outcome: "failed" } })
    );
    const failedOutcome = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: fix,
    });
    assert.equal(failedOutcome.ok, false);
    assert.match(failedOutcome.reason, /outcome is not passed/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
