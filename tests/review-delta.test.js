"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildCommand, checkCommand, parseArgs, recordCommand } = require("../scripts/review-delta");
const { changedFileInventory } = require("../scripts/review-target");

const REVIEW_DIR = ".pm/dev-sessions/example/review";

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-delta-"));
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

// Builds a repo holding a certified feature branch: a passed canonical review
// report frozen at `reviewed` covering src/app.js, with .pm/ ignored so the
// evidence directory does not dirty the worktree.
function certifiedRepo() {
  const repo = makeRepo();
  commitFile(repo, ".gitignore", ".pm/\n");
  const base = commitFile(repo, "src/app.js", "line1\nline2\nline3\n", "base");
  repo.run("switch", "-q", "-c", "feature");
  const reviewed = commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\n", "feature");
  const diff = spawnSync("git", ["diff", "--binary", `${base}...${reviewed}`], {
    cwd: repo.dir,
    maxBuffer: 64 * 1024 * 1024,
  }).stdout;
  const reviewDir = path.join(repo.dir, REVIEW_DIR);
  const runDir = path.join(reviewDir, "runs/run-1/round-1");
  fs.mkdirSync(runDir, { recursive: true });
  const target = {
    source: {
      commit: reviewed,
      base_ref: "origin/main",
      base_commit: base,
      remote_push_url_sha256: "a".repeat(64),
      diff_sha256: digest(diff),
    },
    changed_files: changedFileInventory(repo.dir, base, reviewed),
  };
  const targetBytes = Buffer.from(`${JSON.stringify(target, null, 2)}`);
  fs.writeFileSync(path.join(runDir, "target.json"), targetBytes);
  const report = {
    outcome: "passed",
    source: { commit: reviewed, base_ref: "origin/main", base_commit: base },
    target: {
      path: `${REVIEW_DIR}/runs/run-1/round-1/target.json`,
      sha256: digest(targetBytes),
    },
  };
  fs.writeFileSync(path.join(reviewDir, "report.json"), JSON.stringify(report, null, 2));
  return { repo, base, reviewed };
}

function passingResult(repo, files) {
  const file = path.join(repo.dir, ".pm/reviewer-result.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      reviewer: { provider: "claude", model: "test-model", effort: "high" },
      lenses: ["bug", "edge", "reuse", "quality", "efficiency"],
      findings: [],
      summary: `Delta review of ${files.join(", ")} found no blocking issue.`,
    })
  );
  return ".pm/reviewer-result.json";
}

test("review-delta build/record/check certifies a bounded post-pass fix chain", () => {
  const { repo } = certifiedRepo();
  try {
    const fix1 = commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix1\n", "fix 1");
    const built = buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(built.ok, true);
    assert.equal(built.chain_index, 1);
    assert.equal(built.commit, fix1);
    assert.deepEqual(built.files, ["src/app.js"]);
    assert.equal(fs.existsSync(path.join(repo.dir, built.pending)), true);

    const recorded = recordCommand({
      root: repo.dir,
      reviewDir: REVIEW_DIR,
      result: passingResult(repo, built.files),
    });
    assert.equal(recorded.ok, true);
    assert.equal(recorded.outcome, "passed");
    assert.equal(recorded.supplement, `${REVIEW_DIR}/supplements/supplement-1.json`);
    assert.equal(fs.existsSync(path.join(repo.dir, built.pending)), false);

    const checked = checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(checked.ok, true, checked.reason);
    assert.equal(checked.method, "delta-chain");

    const fix2 = commitFile(
      repo,
      "src/app.js",
      "line1\nline2\nline3\nfeature\nfix1\nfix2\n",
      "fix 2"
    );
    const secondBuild = buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(secondBuild.chain_index, 2);
    assert.equal(secondBuild.prior_commit, fix1);
    assert.equal(secondBuild.commit, fix2);
    const secondRecord = recordCommand({
      root: repo.dir,
      reviewDir: REVIEW_DIR,
      result: passingResult(repo, secondBuild.files),
    });
    assert.equal(secondRecord.outcome, "passed");
    assert.equal(checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR }).ok, true);

    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix1\nfix2\nfix3\n", "fix 3");
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /delta budget exhausted/
    );
    assert.equal(checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR }).ok, false);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta build rejects out-of-scope, oversized, and already-certified deltas", () => {
  const { repo, reviewed } = certifiedRepo();
  try {
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /already certified/
    );

    commitFile(repo, "src/other.js", "new file\n", "out of scope");
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /outside the certified changed-file set/
    );
    repo.run("reset", "-q", "--hard", reviewed);

    commitFile(repo, "src/app.js", `${"padding\n".repeat(80)}feature\n`, "oversized");
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /over the 50-line budget/
    );
    repo.run("reset", "-q", "--hard", reviewed);

    commitFile(repo, "tests/app.test.js", "test line\n".repeat(120), "test-only churn");
    const testOnly = buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(testOnly.ok, true);
    assert.equal(testOnly.code_lines, 0);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta build rejects a rename that crosses the exempt boundary", () => {
  const { repo } = certifiedRepo();
  try {
    fs.mkdirSync(path.join(repo.dir, "tests"), { recursive: true });
    fs.renameSync(path.join(repo.dir, "src/app.js"), path.join(repo.dir, "tests/app.test.js"));
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "relocate source into tests");

    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /delta is ineligible: rename between exempt and non-exempt paths/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta build treats runtime Markdown as budgeted in-scope source", () => {
  const { repo, reviewed } = certifiedRepo();
  try {
    commitFile(repo, "skills/dev/SKILL.md", "runtime guidance\n", "runtime markdown");
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /outside the certified changed-file set/
    );
    repo.run("reset", "-q", "--hard", reviewed);

    commitFile(repo, "docs/notes.md", "notes\n".repeat(80), "docs-only churn");
    const docsOnly = buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(docsOnly.ok, true);
    assert.equal(docsOnly.code_lines, 0);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta rejects a symlinked review directory", () => {
  const { repo } = certifiedRepo();
  try {
    const realDir = path.join(repo.dir, ".pm/relocated-review");
    fs.renameSync(path.join(repo.dir, REVIEW_DIR), realDir);
    fs.symlinkSync(realDir, path.join(repo.dir, REVIEW_DIR));

    assert.throws(() => checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR }), /symlink/);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta record fails a delta with blocking findings and preserves the audit trail", () => {
  const { repo } = certifiedRepo();
  try {
    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix\n", "fix");
    buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    const resultFile = path.join(repo.dir, ".pm/reviewer-result.json");
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        reviewer: { provider: "claude", model: "test-model" },
        lenses: ["bug"],
        findings: [
          { severity: "high", file: "src/app.js", line: 5, issue: "the fix breaks the invariant" },
        ],
        summary: "Blocking issue found in the delta.",
      })
    );
    const recorded = recordCommand({
      root: repo.dir,
      reviewDir: REVIEW_DIR,
      result: ".pm/reviewer-result.json",
    });
    assert.equal(recorded.ok, false);
    assert.equal(recorded.outcome, "failed");
    assert.match(recorded.blocking[0], /high: src\/app\.js/);
    assert.equal(fs.existsSync(path.join(repo.dir, recorded.rejected)), true);
    assert.equal(
      fs.existsSync(path.join(repo.dir, REVIEW_DIR, "supplements/supplement-1.json")),
      false
    );
    assert.equal(checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR }).ok, false);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta build refuses to rebuild content a delta review already rejected", () => {
  // The rebuild gate is where a rejection actually bites: without it the agent
  // reruns build against the same content and gets a fresh pending record to
  // re-certify. It has to survive a SHA-moving amend and yield to a real fix.
  const { repo } = certifiedRepo();
  try {
    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix\n", "fix");
    buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    const resultFile = path.join(repo.dir, ".pm/reviewer-result.json");
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        reviewer: { provider: "claude", model: "test-model" },
        lenses: ["bug"],
        findings: [
          { severity: "high", file: "src/app.js", line: 5, issue: "the fix breaks the invariant" },
        ],
        summary: "Blocking issue found in the delta.",
      })
    );
    assert.equal(
      recordCommand({ root: repo.dir, reviewDir: REVIEW_DIR, result: ".pm/reviewer-result.json" })
        .outcome,
      "failed"
    );

    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /carries content a delta review rejected/
    );

    repo.run("commit", "-q", "--amend", "-m", "fix, reworded");
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /carries content a delta review rejected/,
      "an amend must not launder the rejected content"
    );

    const genuine = commitFile(
      repo,
      "src/app.js",
      "line1\nline2\nline3\nfeature\nreal fix\n",
      "actually fix it"
    );
    assert.equal(buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }).commit, genuine);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta record validates the reviewer result shape and binding drift", () => {
  const { repo } = certifiedRepo();
  try {
    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix\n", "fix");
    buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR });

    const resultFile = path.join(repo.dir, ".pm/reviewer-result.json");
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        reviewer: { provider: "claude" },
        lenses: [],
        findings: [{ severity: "odd", file: "not/in/delta.js", issue: "" }],
        summary: "",
      })
    );
    assert.throws(
      () =>
        recordCommand({
          root: repo.dir,
          reviewDir: REVIEW_DIR,
          result: ".pm/reviewer-result.json",
        }),
      /reviewer result is invalid/
    );

    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nfix\nmore\n", "moved HEAD");
    fs.writeFileSync(
      resultFile,
      JSON.stringify({
        reviewer: { provider: "claude" },
        lenses: ["bug"],
        findings: [],
        summary: "Fine.",
      })
    );
    assert.throws(
      () =>
        recordCommand({
          root: repo.dir,
          reviewDir: REVIEW_DIR,
          result: ".pm/reviewer-result.json",
        }),
      /HEAD moved after build/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta check accepts the exact certified commit and rejects strangers", () => {
  const { repo, reviewed } = certifiedRepo();
  try {
    const exact = checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(exact.ok, true);
    assert.equal(exact.method, "exact");

    commitFile(repo, "src/app.js", "line1\nline2\nline3\nfeature\nunreviewed\n", "unreviewed");
    const stranger = checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR });
    assert.equal(stranger.ok, false);

    const pinned = checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR, commit: reviewed });
    assert.equal(pinned.ok, true);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta rejects a frozen target that is not bound to the canonical report", () => {
  const { repo, reviewed } = certifiedRepo();
  try {
    const targetPath = path.join(repo.dir, REVIEW_DIR, "runs/run-1/round-1/target.json");
    const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    const stranger = commitFile(
      repo,
      "src/app.js",
      "line1\nline2\nline3\nfeature\nunreviewed\n",
      "unreviewed"
    );
    assert.notEqual(stranger, reviewed);

    // Swap the frozen target's reviewed commit without touching report.json.
    // Nothing else in the package changes, so only the hash binding can catch it.
    target.source.commit = stranger;
    fs.writeFileSync(targetPath, JSON.stringify(target, null, 2));

    assert.throws(
      () => checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /frozen review target does not match the canonical report binding/
    );
    assert.throws(
      () => buildCommand({ root: repo.dir, reviewDir: REVIEW_DIR }),
      /frozen review target does not match the canonical report binding/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("review-delta parseArgs enforces command and required options", () => {
  assert.throws(() => parseArgs(["build"]), /--review-dir is required/);
  assert.throws(() => parseArgs(["record", "--review-dir", "x"]), /record requires --result/);
  assert.throws(() => parseArgs(["unknown", "--review-dir", "x"]), /usage: review-delta/);
  assert.throws(
    () => parseArgs(["check", "--review-dir", "x", "--bogus", "y"]),
    /unknown argument/
  );
  const parsed = parseArgs(["check", "--review-dir", "x", "--commit", "abc", "--json"]);
  assert.deepEqual(parsed, { command: "check", reviewDir: "x", commit: "abc", json: true });
  const based = parseArgs(["check", "--review-dir", "x", "--base", "def456"]);
  assert.equal(based.base, "def456");
});

// Wires the fixture to a real local bare remote so resolveTrustedBase can
// answer `ls-remote`, which is what authenticates a declared --base.
function withOrigin(repo) {
  const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-review-delta-origin-"));
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", remoteDir], { encoding: "utf8" });
  repo.run("remote", "add", "origin", remoteDir);
  repo.run("push", "-q", "origin", "main");
  const tip = repo.run("rev-parse", "main");
  const urlSha = crypto.createHash("sha256").update(Buffer.from(remoteDir)).digest("hex");
  // The frozen target pins the delivery URL it was reviewed against.
  const targetPath = path.join(repo.dir, REVIEW_DIR, "runs/run-1/round-1/target.json");
  const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  target.source.remote_push_url_sha256 = urlSha;
  const targetBytes = Buffer.from(`${JSON.stringify(target, null, 2)}`);
  fs.writeFileSync(targetPath, targetBytes);
  const reportPath = path.join(repo.dir, REVIEW_DIR, "report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.target.sha256 = digest(targetBytes);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return { remoteDir, tip };
}

test("review-delta check refuses a --base that is not the authoritative tip", () => {
  const { repo, reviewed } = certifiedRepo();
  const { remoteDir } = withOrigin(repo);
  try {
    // A branch-local commit carrying unreviewed content. Accepting it as the
    // base would let diff identity treat that content as already-reviewed.
    const forged = commitFile(
      repo,
      "src/allow.js",
      "const ALLOW_ANON = true;\n",
      "unreviewed change posing as upstream"
    );
    assert.throws(
      () => checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR, base: forged }),
      /is not the authoritative base/
    );
    // Without --base the frozen base still stands and needs no remote at all.
    const pinned = checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR, commit: reviewed });
    assert.equal(pinned.ok, true);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
});

test("review-delta check accepts the authoritative tip as --base", () => {
  const { repo, reviewed } = certifiedRepo();
  const { remoteDir, tip } = withOrigin(repo);
  try {
    const accepted = checkCommand({
      root: repo.dir,
      reviewDir: REVIEW_DIR,
      commit: reviewed,
      base: tip,
    });
    assert.equal(accepted.ok, true, accepted.reason);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
});

test("review-delta check refuses a --base when the remote no longer matches the frozen URL", () => {
  const { repo, reviewed } = certifiedRepo();
  const { remoteDir, tip } = withOrigin(repo);
  try {
    const targetPath = path.join(repo.dir, REVIEW_DIR, "runs/run-1/round-1/target.json");
    const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    target.source.remote_push_url_sha256 = "b".repeat(64);
    const targetBytes = Buffer.from(`${JSON.stringify(target, null, 2)}`);
    fs.writeFileSync(targetPath, targetBytes);
    const reportPath = path.join(repo.dir, REVIEW_DIR, "report.json");
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    report.target.sha256 = digest(targetBytes);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    assert.throws(
      () => checkCommand({ root: repo.dir, reviewDir: REVIEW_DIR, commit: reviewed, base: tip }),
      /no longer points at the delivery URL the review froze/
    );
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
    fs.rmSync(remoteDir, { recursive: true, force: true });
  }
});
