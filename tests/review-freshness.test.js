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

test("diffIdentity rejects a whitespace-only amend against the same base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/lib.py", "def f():\n    return 1\n", "feature");
    const source = {
      commit: reviewed,
      base_commit: base,
      diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
    };
    fs.writeFileSync(path.join(repo.dir, "src/lib.py"), "def f():\nreturn 1\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "--amend", "-m", "feature dedented");
    const amended = repo.run("rev-parse", "HEAD");
    assert.notEqual(amended, reviewed);

    // Premise: patch-id --stable strips the intra-line whitespace, so the old
    // patch-id acceptance would have certified this semantics-changing amend.
    assert.equal(
      patchId(repo, frozenDiffBytes(repo, base, reviewed), "--stable"),
      patchId(repo, frozenDiffBytes(repo, base, amended), "--stable")
    );

    const verdict = diffIdentity({ root: repo.dir, source, currentCommit: amended });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not patch-identical/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("diffIdentity rejects a whitespace-only variant across a moved base", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "base.txt", "base\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "src/lib.py", "def f():\n    return 1\n", "feature");
    const source = {
      commit: reviewed,
      base_commit: base,
      diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
    };
    repo.run("switch", "-q", "main");
    const movedBase = commitFile(repo, "unrelated.txt", "unrelated\n", "main work");
    repo.run("switch", "-q", "-c", "feature-2");
    const dedented = commitFile(repo, "src/lib.py", "def f():\nreturn 1\n", "dedented variant");

    // Premise: --stable collides across the moved base too; only --verbatim
    // can distinguish the whitespace-only variant.
    assert.equal(
      patchId(repo, frozenDiffBytes(repo, base, reviewed), "--stable"),
      patchId(repo, frozenDiffBytes(repo, movedBase, dedented), "--stable")
    );

    const verdict = diffIdentity({
      root: repo.dir,
      source,
      currentCommit: dedented,
      currentBaseCommit: movedBase,
    });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /not patch-identical/);
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

test("diffIdentity rejects a relocated edit that patch-id alone accepts", () => {
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

    const verdict = diffIdentity({
      root: repo.dir,
      source: { commit: reviewed, base_commit: base, diff_sha256: digest(reviewedDiff) },
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

test("diffIdentity still accepts a clean rebase that only absorbed upstream files", () => {
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

    const verdict = diffIdentity({
      root: repo.dir,
      source: {
        commit: reviewed,
        base_commit: base,
        diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
      },
      currentCommit: rebased,
      currentBaseCommit: movedBase,
    });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.match(verdict.reason, /identical reviewed post-images/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("diffIdentity rejects a rebase that added an unreviewed file", () => {
  const repo = makeRepo();
  try {
    const base = commitFile(repo, "a.js", "one\n", "base");
    repo.run("switch", "-q", "-c", "feature");
    const reviewed = commitFile(repo, "a.js", "one\ntwo\n", "reviewed");
    const smuggled = commitFile(repo, "extra.js", "// never reviewed\n", "extra");

    const verdict = diffIdentity({
      root: repo.dir,
      source: {
        commit: reviewed,
        base_commit: base,
        diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
      },
      currentCommit: smuggled,
      currentBaseCommit: base,
    });
    assert.equal(verdict.ok, false);
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

test("a corrupt supplement does not block a byte-identical amend from diff identity", () => {
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
        source: {
          commit: reviewed,
          base_commit: base,
          diff_sha256: digest(frozenDiffBytes(repo, base, reviewed)),
        },
        changed_files: [{ path: "src/app.js" }],
      },
      currentCommit: amended,
    });
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(verdict.method, "diff-identity");
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
