"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");
const CHECK = path.resolve(__dirname, "..", "scripts", "dev-gate-check.js");
const { planGateWrite } = require("../scripts/lib/dev-gate-writer");

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

// A feature branch with an authoritative origin, so the writer resolves the
// same trusted base the delivery checker does.
function makeRepo(slug = "gate-cli") {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-gate-")));
  const remote = path.join(scratch, "origin.git");
  const root = path.join(scratch, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  fs.mkdirSync(root);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n.test-config/\n");
  git(root, ["add", "README.md", ".gitignore"]);
  git(root, ["commit", "-q", "-m", "fixture"]);
  git(root, ["remote", "add", "origin", remote]);
  git(root, ["push", "-q", "origin", "main"]);
  git(root, ["checkout", "-q", "-b", `feat/${slug}`]);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "feature.js"), "module.exports = 1;\n");
  git(root, ["add", "scripts/feature.js"]);
  git(root, ["commit", "-q", "-m", "feature"]);
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: path.join(root, ".test-config"),
    PM_EXECUTION_POLICY_FILE: "",
  };
  const run = (script, args, cwd = root) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env });
  const init = run(CLI, ["init", "--slug", slug, "--source-dir", root, "--json"]);
  assert.equal(init.status, 0, init.stderr);
  const sessionPath = JSON.parse(init.stdout).session_path;
  const repo = {
    root,
    sessionPath,
    gatesPath: path.join(path.dirname(sessionPath), "gates.json"),
    head: () => git(root, ["rev-parse", "HEAD"]),
    run: (args) => run(CLI, args),
    check: (args, cwd) => run(CHECK, args, cwd),
    session: () => JSON.parse(fs.readFileSync(sessionPath, "utf8")),
    saveSession(value) {
      fs.writeFileSync(sessionPath, JSON.stringify(value, null, 2));
    },
    recordEvidence(phase, records, commit = repo.head()) {
      const session = repo.session();
      session.evidence[phase] = { commit, records, recorded_at: new Date().toISOString() };
      repo.saveSession(session);
    },
    gate(args) {
      return run(CLI, ["gate", "--session", sessionPath, ...args, "--json"]);
    },
    gates: () => JSON.parse(fs.readFileSync(repo.gatesPath, "utf8")),
    cleanup: () => fs.rmSync(scratch, { recursive: true, force: true }),
  };
  const session = repo.session();
  session.task.kind = "bug";
  session.task.size = "S";
  repo.saveSession(session);
  return repo;
}

const passingTest = [{ kind: "test", command: "node --test", exit_code: 0, artifact: null }];

test("gate creates the canonical manifest from current session evidence", () => {
  const repo = makeRepo();
  try {
    repo.recordEvidence("implementation", passingTest);
    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = repo.gates();
    const session = repo.session();
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.run_id, session.run_id);
    assert.equal(manifest.size, "S");
    assert.equal(manifest.kind, "bug");
    assert.equal(manifest.gates.length, 1);
    const [row] = manifest.gates;
    assert.equal(row.name, "tdd");
    assert.equal(row.status, "passed");
    assert.equal(row.commit, repo.head());
    assert.equal(row.reason, "");
    assert.equal(row.artifact, ".pm/dev-sessions/gate-cli/session.json#evidence.implementation");
    assert.ok(!Number.isNaN(Date.parse(row.checked_at)));
    assert.equal("verified_commit" in row, false);
    assert.equal(JSON.parse(result.stdout).row.name, "tdd");

    const checked = repo.check(["--manifest", repo.gatesPath, "--require", "tdd", "--json"]);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    repo.cleanup();
  }
});

test("gate refuses missing or stale evidence and writes nothing", () => {
  const repo = makeRepo();
  try {
    const missing = repo.gate(["--name", "tdd"]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /no passing test evidence for implementation/);
    assert.equal(fs.existsSync(repo.gatesPath), false);

    repo.recordEvidence("implementation", [
      { kind: "test", command: "node --test", exit_code: 1, artifact: null },
    ]);
    assert.notEqual(repo.gate(["--name", "tdd"]).status, 0);
    assert.equal(fs.existsSync(repo.gatesPath), false);

    repo.recordEvidence("implementation", passingTest);
    fs.writeFileSync(path.join(repo.root, "scripts", "feature.js"), "module.exports = 2;\n");
    git(repo.root, ["commit", "-qam", "move head"]);
    const stale = repo.gate(["--name", "tdd"]);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /record or recertify/);
    assert.equal(fs.existsSync(repo.gatesPath), false);
  } finally {
    repo.cleanup();
  }
});

test("gate binds recertified evidence with verified_commit and verified_at together", () => {
  const repo = makeRepo();
  try {
    const original = repo.head();
    repo.recordEvidence("implementation", passingTest);
    fs.writeFileSync(path.join(repo.root, "scripts", "feature.js"), "module.exports = 2;\n");
    git(repo.root, ["commit", "-qam", "move head"]);
    const session = repo.session();
    session.evidence.implementation.verified_commit = repo.head();
    session.evidence.implementation.verified_at = new Date().toISOString();
    session.evidence.implementation.verification_records = passingTest;
    repo.saveSession(session);

    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    const [row] = repo.gates().gates;
    assert.equal(row.commit, original);
    assert.equal(row.verified_commit, repo.head());
    assert.ok(!Number.isNaN(Date.parse(row.verified_at)));
  } finally {
    repo.cleanup();
  }
});

test("same-commit CLI recertification selects the refreshed gate artifact", () => {
  const repo = makeRepo();
  try {
    repo.recordEvidence("implementation", passingTest);
    const artifact = path.join(path.dirname(repo.sessionPath), "fresh-test.txt");
    fs.writeFileSync(artifact, "fresh passing test evidence\n");
    const evidence = path.join(path.dirname(repo.sessionPath), "recertify.json");
    fs.writeFileSync(
      evidence,
      JSON.stringify({
        implementation: [{ kind: "test", command: "node --test", exit_code: 0, artifact }],
      })
    );
    const recertified = repo.run([
      "recertify",
      "--session",
      repo.sessionPath,
      "--phases",
      "implementation",
      "--commit",
      repo.head(),
      "--evidence",
      evidence,
    ]);
    assert.equal(recertified.status, 0, recertified.stderr);
    assert.deepEqual(repo.session().evidence.implementation.records, passingTest);
    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.gates().gates[0].artifact, ".pm/dev-sessions/gate-cli/fresh-test.txt");
    assert.equal("verified_commit" in repo.gates().gates[0], false);
  } finally {
    repo.cleanup();
  }
});

test("gate upserts only the named row and preserves the others", () => {
  const repo = makeRepo();
  try {
    repo.recordEvidence("implementation", passingTest);
    const blocked = repo.gate([
      "--name",
      "verification",
      "--status",
      "blocked",
      "--reason",
      "suite needs a database",
    ]);
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.equal(repo.gate(["--name", "tdd"]).status, 0);
    const failed = repo.gate([
      "--name",
      "verification",
      "--status",
      "failed",
      "--reason",
      "two tests fail",
    ]);
    assert.equal(failed.status, 0, failed.stderr);
    const rows = repo.gates().gates;
    assert.deepEqual(
      rows.map((row) => [row.name, row.status]),
      [
        ["verification", "failed"],
        ["tdd", "passed"],
      ]
    );
    assert.equal(rows[0].reason, "two tests fail");
  } finally {
    repo.cleanup();
  }
});

test("gate enforces reasons and the checker's skip policy", () => {
  const repo = makeRepo();
  try {
    for (const status of ["failed", "blocked", "skipped"]) {
      const result = repo.gate(["--name", "tdd", "--status", status]);
      assert.equal(result.status, 2, `${status}: ${result.stderr}`);
      assert.match(result.stderr, /--reason/);
    }
    for (const name of ["review", "verification"]) {
      const result = repo.gate(["--name", name, "--status", "skipped", "--reason", "docs only"]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /cannot be skipped/);
    }
    const behavior = repo.gate([
      "--name",
      "tdd",
      "--status",
      "skipped",
      "--reason",
      "documentation-only change",
    ]);
    assert.notEqual(behavior.status, 0);
    assert.match(behavior.stderr, /behavior files changed/);
    assert.equal(fs.existsSync(repo.gatesPath), false);

    const reasonOnPass = repo.gate(["--name", "tdd", "--reason", "looks fine"]);
    assert.equal(reasonOnPass.status, 2);
    const unknown = repo.gate(["--name", "simplify"]);
    assert.equal(unknown.status, 2);
    assert.equal(fs.existsSync(repo.gatesPath), false);
  } finally {
    repo.cleanup();
  }
});

test("gate refuses a manifest that belongs to another run", () => {
  const repo = makeRepo();
  try {
    repo.recordEvidence("implementation", passingTest);
    const foreign = { schema_version: 1, run_id: "dev_other", gates: [] };
    fs.writeFileSync(repo.gatesPath, JSON.stringify(foreign));
    const result = repo.gate(["--name", "tdd"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /run_id/);
    assert.deepEqual(repo.gates(), foreign);
  } finally {
    repo.cleanup();
  }
});

function writerFixture(gateName, phase, records) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-gate-writer-")));
  const dir = path.join(root, ".pm", "dev-sessions", "unit");
  fs.mkdirSync(dir, { recursive: true });
  const sessionPath = path.join(dir, "session.json");
  const session = {
    run_id: "dev_unit",
    slug: "unit",
    source: { worktree: root, branch: "feat/unit", delivery_remote: "origin" },
    task: { kind: "bug", size: "M" },
    routing: { review_mode: "full", required_gates: [gateName] },
    evidence: { [phase]: { commit: "c".repeat(40), records } },
  };
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  const calls = {};
  const deps = {
    head: () => "c".repeat(40),
    resolveContext: () => ({
      currentBranch: "feat/unit",
      changedFiles: ["scripts/feature.js"],
      authoritativeBaseRef: "origin/main",
      authoritativeBaseCommit: "b".repeat(40),
      authoritativePushUrlSha256: "d".repeat(64),
    }),
    checkManifest(manifest, opts) {
      calls.manifest = { manifest, opts };
      return { ok: true, issues: [] };
    },
    checkDesignCritique(options) {
      calls.designCritique = options;
      return { ok: true, issues: [] };
    },
    validateQa(_session, currentRecords, commit) {
      calls.qa = { currentRecords, commit };
    },
    isAncestor(_root, ancestor, descendant) {
      (calls.ancestry ||= []).push([ancestor, descendant]);
      return true;
    },
  };
  return {
    root,
    dir,
    sessionPath,
    session,
    deps,
    calls,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function writeReviewReport(fx) {
  const reviewDir = path.join(fx.dir, "review");
  fs.mkdirSync(path.join(reviewDir, "renders"), { recursive: true });
  fs.writeFileSync(
    path.join(reviewDir, "report.json"),
    JSON.stringify({
      human_report: { path: ".pm/dev-sessions/unit/review/report.html" },
      coverage: { completed: ["bug", "edge", "reuse", "quality", "efficiency", "product"] },
    })
  );
  fs.writeFileSync(path.join(reviewDir, "report.html"), "<html></html>");
  const renderBytes = Buffer.from('{"renders":[]}');
  fs.writeFileSync(path.join(reviewDir, "renders", "manifest.json"), renderBytes);
  return renderBytes;
}

function writeLegacySimplify(fx, status) {
  fs.writeFileSync(
    path.join(fx.dir, "gates.json"),
    JSON.stringify({
      schema_version: 1,
      run_id: "dev_unit",
      gates: [
        {
          name: "simplify",
          status,
          commit: "a".repeat(40),
          artifact: "",
          reason: "old",
          checked_at: "2026-01-01T00:00:00Z",
        },
      ],
    })
  );
}

test("review rows are derived from the canonical review report", () => {
  const fx = writerFixture("review", "review", [
    { kind: "review", command: "review-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const renderBytes = writeReviewReport(fx);

    const plan = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "review" },
      fx.deps
    );
    assert.deepEqual(
      {
        artifact: plan.row.artifact,
        evidence_kind: plan.row.evidence_kind,
        render_manifest: plan.row.render_manifest,
        render_manifest_sha256: plan.row.render_manifest_sha256,
        lenses: plan.row.lenses,
      },
      {
        artifact: ".pm/dev-sessions/unit/review/report.html",
        evidence_kind: "review-report-v1",
        render_manifest: ".pm/dev-sessions/unit/review/renders/manifest.json",
        render_manifest_sha256: crypto.createHash("sha256").update(renderBytes).digest("hex"),
        lenses: ["bug", "edge", "reuse", "quality", "efficiency", "product"],
      }
    );
    assert.deepEqual(fx.calls.manifest.opts.requiredGates, ["review"]);
    assert.equal(fx.calls.manifest.opts.reviewEvidenceMode, "enforce");
    assert.equal(fx.calls.manifest.opts.authoritativeBaseCommit, "b".repeat(40));
    assert.equal(fx.calls.manifest.opts.artifactRoot, fx.root);

    const structuredBytes = Buffer.from(
      JSON.stringify({ human_report: null, coverage: { completed: ["bug"] } })
    );
    fs.writeFileSync(path.join(fx.dir, "review", "report.json"), structuredBytes);
    const structured = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "review" },
      fx.deps
    );
    assert.equal(structured.row.artifact, ".pm/dev-sessions/unit/review/report.json");
    assert.equal(
      structured.row.report_sha256,
      crypto.createHash("sha256").update(structuredBytes).digest("hex")
    );
    assert.equal("render_manifest" in structured.row, false);

    fx.deps.checkManifest = () => ({
      ok: false,
      issues: [{ path: "gates.json", message: "review-report-v1 outcome must be passed" }],
    });
    assert.throws(
      () =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "review" },
          fx.deps
        ),
      /outcome must be passed/
    );
  } finally {
    fx.cleanup();
  }
});

test("design-critique rows rerun the full critique chain before writing", () => {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const dc = path.join(fx.dir, "design-critique");
    fs.mkdirSync(dc);
    fs.writeFileSync(
      path.join(dc, "route.json"),
      JSON.stringify({ source: { base_commit: "a".repeat(40) } })
    );
    fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
    const plan = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
      fx.deps
    );
    assert.equal(plan.row.artifact, ".pm/dev-sessions/unit/design-critique/report.html");
    assert.deepEqual(fx.calls.designCritique, {
      root: fx.root,
      routePath: ".pm/dev-sessions/unit/design-critique/route.json",
      capturesPath: ".pm/dev-sessions/unit/design-critique/captures.json",
      reportPath: ".pm/dev-sessions/unit/design-critique/report.json",
      commit: "c".repeat(40),
      baseRef: "origin/main",
      baseCommit: "b".repeat(40),
      verifyRemote: false,
    });
    fx.deps.checkDesignCritique = () => ({
      ok: false,
      issues: [{ path: "report.outcome", message: "must be passed" }],
    });
    assert.throws(
      () =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        ),
      /design-critique check failed.*report\.outcome/
    );
  } finally {
    fx.cleanup();
  }
});

test("qa rows revalidate the recorded QA report and point at it", () => {
  const fx = writerFixture("qa", "qa", []);
  try {
    const reportPath = path.join(fx.dir, "qa", "report.json");
    fs.mkdirSync(path.dirname(reportPath));
    fs.writeFileSync(reportPath, "{}");
    fx.session.evidence.qa.records = [
      {
        kind: "test",
        command: "qa-report-check.js --report x",
        exit_code: 0,
        artifact: reportPath,
      },
    ];
    const plan = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "qa" },
      fx.deps
    );
    assert.equal(plan.row.artifact, ".pm/dev-sessions/unit/qa/report.json");
    assert.equal(fx.calls.qa.commit, "c".repeat(40));
    fx.deps.validateQa = (s, r, c, m, issues) =>
      issues.push({ path: m, message: "canonical QA report outcome: must be passed" });
    assert.throws(
      () =>
        planGateWrite({ sessionPath: fx.sessionPath, session: fx.session, name: "qa" }, fx.deps),
      /canonical QA report outcome/
    );
  } finally {
    fx.cleanup();
  }
});

test("gate writes the worktree manifest for a session kept in the originating checkout", () => {
  const repo = makeRepo("split");
  try {
    const worktree = path.join(path.dirname(repo.root), "split-worktree");
    git(repo.root, ["worktree", "add", "-q", "-b", "fix/split", worktree]);
    const moved = repo.run(["workspace", "--session", repo.sessionPath, "--worktree", worktree]);
    assert.equal(moved.status, 0, moved.stderr);
    repo.recordEvidence("implementation", passingTest, git(worktree, ["rev-parse", "HEAD"]));
    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    const gatesPath = path.join(worktree, ".pm", "dev-sessions", "split", "gates.json");
    assert.equal(JSON.parse(result.stdout).manifest_path, gatesPath);
    assert.equal(fs.existsSync(repo.gatesPath), false);
    const [row] = JSON.parse(fs.readFileSync(gatesPath, "utf8")).gates;
    assert.equal(row.artifact, `${repo.sessionPath}#evidence.implementation`);
    const checked = repo.check(["--manifest", gatesPath, "--require", "tdd", "--json"], worktree);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    repo.cleanup();
  }
});

test("failed rows still write in the split layout on a detached worktree", () => {
  const repo = makeRepo("detached");
  try {
    const worktree = path.join(path.dirname(repo.root), "detached-worktree");
    git(repo.root, ["worktree", "add", "-q", "-b", "fix/detached", worktree]);
    const moved = repo.run(["workspace", "--session", repo.sessionPath, "--worktree", worktree]);
    assert.equal(moved.status, 0, moved.stderr);
    repo.recordEvidence("implementation", passingTest, git(worktree, ["rev-parse", "HEAD"]));
    git(worktree, ["checkout", "-q", "--detach"]);
    const failed = repo.gate([
      "--name",
      "review",
      "--status",
      "failed",
      "--reason",
      "rebase stopped on a conflict",
    ]);
    assert.equal(failed.status, 0, failed.stderr);
    const gatesPath = path.join(worktree, ".pm", "dev-sessions", "detached", "gates.json");
    const rows = JSON.parse(fs.readFileSync(gatesPath, "utf8")).gates;
    assert.deepEqual(
      rows.map((row) => [row.name, row.status]),
      [["review", "failed"]]
    );
    const passed = repo.gate(["--name", "tdd"]);
    assert.notEqual(passed.status, 0);
    assert.match(passed.stderr, /canonical session/);
  } finally {
    repo.cleanup();
  }
});

test("qa rows in the split layout keep the originating report path absolute", () => {
  const repo = makeRepo("split-qa");
  try {
    const worktree = path.join(path.dirname(repo.root), "split-qa-worktree");
    git(repo.root, ["worktree", "add", "-q", "-b", "fix/split-qa", worktree]);
    const moved = repo.run(["workspace", "--session", repo.sessionPath, "--worktree", worktree]);
    assert.equal(moved.status, 0, moved.stderr);
    const head = git(worktree, ["rev-parse", "HEAD"]);
    const reportPath = path.join(path.dirname(repo.sessionPath), "qa", "report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, "{}");
    repo.recordEvidence(
      "qa",
      [{ kind: "test", command: "qa-report-check.js", exit_code: 0, artifact: reportPath }],
      head
    );
    const session = repo.session();
    const plan = planGateWrite(
      { sessionPath: repo.sessionPath, session, name: "qa" },
      {
        head: () => head,
        resolveContext: () => ({
          currentBranch: "fix/split-qa",
          changedFiles: ["scripts/feature.js"],
          authoritativeBaseRef: "origin/main",
          authoritativeBaseCommit: "b".repeat(40),
          authoritativePushUrlSha256: "d".repeat(64),
        }),
        checkManifest: () => ({ ok: true, issues: [] }),
        validateQa: () => {},
      }
    );
    assert.equal(plan.row.artifact, reportPath);
  } finally {
    repo.cleanup();
  }
});

test("evidence artifacts follow the checker's path rules", () => {
  const repo = makeRepo();
  try {
    const log = path.join(path.dirname(repo.sessionPath), "tdd.log");
    fs.writeFileSync(log, "ok\n");
    repo.recordEvidence("implementation", [
      {
        kind: "test",
        command: "node --test",
        exit_code: 0,
        artifact: " .pm/dev-sessions/gate-cli/tdd.log ",
      },
    ]);
    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.gates().gates[0].artifact, ".pm/dev-sessions/gate-cli/tdd.log");
  } finally {
    repo.cleanup();
  }
});

test("gate refuses a session copy the checker would not resolve", () => {
  const repo = makeRepo("stale");
  try {
    repo.recordEvidence("implementation", passingTest);
    const copy = path.join(path.dirname(repo.root), "copy", ".pm", "dev-sessions", "stale");
    fs.mkdirSync(copy, { recursive: true });
    fs.copyFileSync(repo.sessionPath, path.join(copy, "session.json"));
    const result = repo.run([
      "gate",
      "--session",
      path.join(copy, "session.json"),
      "--name",
      "tdd",
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /canonical session/);
    assert.equal(fs.existsSync(repo.gatesPath), false);
  } finally {
    repo.cleanup();
  }
});

test("the writer and the delivery check share one current-evidence rule", () => {
  const { currentPassingRecords } = require("../scripts/dev-gate-check");
  const fx = writerFixture("tdd", "implementation", [
    ...passingTest,
    { kind: "lint", command: "eslint", exit_code: 0, artifact: null },
    { kind: "test", command: "node --test red", exit_code: 1, artifact: null },
  ]);
  try {
    const shared = currentPassingRecords(fx.session, "tdd", "c".repeat(40));
    assert.deepEqual(shared.contract, { phase: "implementation", kind: "test" });
    assert.equal(shared.records.length, 3);
    assert.deepEqual(shared.passing, passingTest);
    assert.deepEqual(currentPassingRecords(fx.session, "tdd", "e".repeat(40)).passing, []);
    const plan = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "tdd" },
      fx.deps
    );
    assert.equal(plan.row.status, "passed");
  } finally {
    fx.cleanup();
  }
});

test("a passed review retires a failed legacy simplify row", () => {
  const fx = writerFixture("review", "review", [
    { kind: "review", command: "review-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    writeReviewReport(fx);
    writeLegacySimplify(fx, "failed");
    const plan = planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "review" },
      fx.deps
    );
    assert.deepEqual(plan.retired, ["simplify"]);
    assert.deepEqual(
      plan.manifest.gates.map((gate) => gate.name),
      ["review"]
    );
  } finally {
    fx.cleanup();
  }
});

test("other gates keep a blocked legacy simplify row and say how to clear it", () => {
  const fx = writerFixture("tdd", "implementation", passingTest);
  try {
    writeLegacySimplify(fx, "blocked");
    fx.deps.checkManifest = () => ({
      ok: false,
      issues: [{ file: "gates.json#gates[0]", message: "legacy gate simplify is blocked" }],
    });
    assert.throws(
      () =>
        planGateWrite({ sessionPath: fx.sessionPath, session: fx.session, name: "tdd" }, fx.deps),
      /gates\.json#gates\[0\]: legacy gate simplify is blocked; a passed review gate retires/
    );
  } finally {
    fx.cleanup();
  }
});

test("a failed legacy simplify row does not block recording another failure", () => {
  const fx = writerFixture("tdd", "implementation", passingTest);
  try {
    writeLegacySimplify(fx, "failed");
    fx.deps.checkManifest = require("../scripts/dev-gate-check").checkGateManifest;
    const plan = planGateWrite(
      {
        sessionPath: fx.sessionPath,
        session: fx.session,
        name: "tdd",
        status: "failed",
        reason: "suite red",
      },
      fx.deps
    );
    assert.equal(plan.row.status, "failed");
    assert.deepEqual(plan.retired, []);
  } finally {
    fx.cleanup();
  }
});

test("gate refuses a session outside its own worktree", () => {
  const fx = writerFixture("tdd", "implementation", passingTest);
  try {
    fx.session.source.worktree = path.join(fx.root, "elsewhere");
    assert.throws(
      () =>
        planGateWrite({ sessionPath: fx.sessionPath, session: fx.session, name: "tdd" }, fx.deps),
      /canonical session/
    );
  } finally {
    fx.cleanup();
  }
});

test("gate resolves the base through the session's delivery remote", () => {
  const repo = makeRepo();
  try {
    git(repo.root, ["remote", "rename", "origin", "upstream"]);
    const session = repo.session();
    session.source.delivery_remote = "upstream";
    repo.saveSession(session);
    repo.recordEvidence("implementation", passingTest);
    const result = repo.gate(["--name", "tdd"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.gates().gates[0].status, "passed");
  } finally {
    repo.cleanup();
  }
});

test("failed and blocked rows need neither a reachable remote nor a branch", () => {
  const repo = makeRepo();
  try {
    git(repo.root, ["remote", "set-url", "origin", path.join(repo.root, "missing.git")]);
    git(repo.root, ["checkout", "-q", "--detach"]);
    const failed = repo.gate([
      "--name",
      "review",
      "--status",
      "failed",
      "--reason",
      "blocked on P1",
    ]);
    assert.equal(failed.status, 0, failed.stderr);
    const blocked = repo.gate(["--name", "qa", "--status", "blocked", "--reason", "no device"]);
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.deepEqual(
      repo.gates().gates.map((row) => [row.name, row.status]),
      [
        ["review", "failed"],
        ["qa", "blocked"],
      ]
    );
    const passed = repo.gate(["--name", "tdd"]);
    assert.notEqual(passed.status, 0);
  } finally {
    repo.cleanup();
  }
});

test("recertified design-critique rows rerun the critique at the critiqued commit", () => {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const records = fx.session.evidence["design-critique"].records;
    fx.session.evidence["design-critique"] = {
      commit: "e".repeat(40),
      records,
      verified_commit: "c".repeat(40),
      verified_at: "2026-09-26T00:00:00.000Z",
      verification_records: records,
    };
    const dc = path.join(fx.dir, "design-critique");
    fs.mkdirSync(dc);
    fs.writeFileSync(
      path.join(dc, "route.json"),
      JSON.stringify({ source: { commit: "e".repeat(40), base_commit: "a".repeat(40) } })
    );
    fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
    const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
    const plan = planGateWrite(request, fx.deps);
    assert.equal(plan.row.commit, "e".repeat(40));
    assert.equal(plan.row.verified_commit, "c".repeat(40));
    assert.equal(plan.row.artifact, ".pm/dev-sessions/unit/design-critique/report.html");
    assert.deepEqual(fx.calls.designCritique, {
      root: fx.root,
      routePath: ".pm/dev-sessions/unit/design-critique/route.json",
      capturesPath: ".pm/dev-sessions/unit/design-critique/captures.json",
      reportPath: ".pm/dev-sessions/unit/design-critique/report.json",
      commit: "e".repeat(40),
      baseRef: "origin/main",
      verifyGit: false,
    });
    assert.equal(fx.calls.ancestry, undefined);
    fx.deps.checkDesignCritique = () => ({
      ok: false,
      issues: [{ path: "report.outcome", message: "must be passed" }],
    });
    assert.throws(
      () => planGateWrite(request, fx.deps),
      /design-critique check failed.*report\.outcome/
    );
  } finally {
    fx.cleanup();
  }
});

test("recertified design-critique re-captured at HEAD reruns the full HEAD-bound check", () => {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const records = fx.session.evidence["design-critique"].records;
    fx.session.evidence["design-critique"] = {
      commit: "e".repeat(40),
      records,
      verified_commit: "c".repeat(40),
      verified_at: "2026-09-26T00:00:00.000Z",
      verification_records: records,
    };
    const dc = path.join(fx.dir, "design-critique");
    fs.mkdirSync(dc);
    fs.writeFileSync(
      path.join(dc, "route.json"),
      JSON.stringify({ source: { commit: "c".repeat(40), base_commit: "b".repeat(40) } })
    );
    fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
    const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
    const plan = planGateWrite(request, fx.deps);
    assert.equal(plan.row.commit, "e".repeat(40));
    assert.equal(plan.row.verified_commit, "c".repeat(40));
    assert.deepEqual(fx.calls.designCritique, {
      root: fx.root,
      routePath: ".pm/dev-sessions/unit/design-critique/route.json",
      capturesPath: ".pm/dev-sessions/unit/design-critique/captures.json",
      reportPath: ".pm/dev-sessions/unit/design-critique/report.json",
      commit: "c".repeat(40),
      baseRef: "origin/main",
      baseCommit: "b".repeat(40),
      verifyRemote: false,
    });
  } finally {
    fx.cleanup();
  }
});

test("recertified design-critique re-captured after the critiqued commit reruns at its route source", () => {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const records = fx.session.evidence["design-critique"].records;
    fx.session.evidence["design-critique"] = {
      commit: "e".repeat(40),
      records,
      verified_commit: "c".repeat(40),
      verified_at: "2026-09-26T00:00:00.000Z",
      verification_records: records,
    };
    const dc = path.join(fx.dir, "design-critique");
    fs.mkdirSync(dc);
    fs.writeFileSync(
      path.join(dc, "route.json"),
      JSON.stringify({ source: { commit: "d".repeat(40), base_commit: "a".repeat(40) } })
    );
    fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
    const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
    const plan = planGateWrite(request, fx.deps);
    assert.equal(plan.row.commit, "e".repeat(40));
    assert.equal(plan.row.verified_commit, "c".repeat(40));
    assert.deepEqual(fx.calls.designCritique, {
      root: fx.root,
      routePath: ".pm/dev-sessions/unit/design-critique/route.json",
      capturesPath: ".pm/dev-sessions/unit/design-critique/captures.json",
      reportPath: ".pm/dev-sessions/unit/design-critique/report.json",
      commit: "d".repeat(40),
      baseRef: "origin/main",
      verifyGit: false,
    });
    assert.deepEqual(fx.calls.ancestry, [
      ["e".repeat(40), "d".repeat(40)],
      ["d".repeat(40), "c".repeat(40)],
    ]);
    fx.deps.isAncestor = (_root, ancestor) => ancestor !== "e".repeat(40);
    assert.throws(
      () => planGateWrite(request, fx.deps),
      /could not prove design-critique route source d{40} descends from e{40} and precedes HEAD/
    );
    fx.deps.isAncestor = (_root, ancestor) => ancestor !== "d".repeat(40);
    assert.throws(() => planGateWrite(request, fx.deps), /precedes HEAD/);
  } finally {
    fx.cleanup();
  }
});

test("recertified design-critique without a route source reruns at the critiqued commit", () => {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  try {
    const records = fx.session.evidence["design-critique"].records;
    fx.session.evidence["design-critique"] = {
      commit: "e".repeat(40),
      records,
      verified_commit: "c".repeat(40),
      verified_at: "2026-09-26T00:00:00.000Z",
      verification_records: records,
    };
    const dc = path.join(fx.dir, "design-critique");
    fs.mkdirSync(dc);
    fs.writeFileSync(path.join(dc, "route.json"), JSON.stringify({ source: {} }));
    fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
    planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
      fx.deps
    );
    assert.equal(fx.calls.designCritique.commit, "e".repeat(40));
    assert.equal(fx.calls.designCritique.verifyGit, false);
    assert.equal(fx.calls.ancestry, undefined);
  } finally {
    fx.cleanup();
  }
});

test("gate writer ancestry proof ignores an inherited Git environment", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pm-gate-ancestry-env-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  const inherited = process.env.GIT_DIR;
  try {
    git("init", "-q");
    const [older, newer] = ["older", "newer"].map((name) => {
      git("commit", "-q", "--allow-empty", "-m", name);
      return git("rev-parse", "HEAD");
    });
    process.env.GIT_DIR = path.join(repo, "not-a-git-dir");
    const { isAncestor } = require("../scripts/lib/dev-gate-writer").defaultDeps();
    assert.equal(isAncestor(repo, older, newer), true);
    assert.equal(isAncestor(repo, newer, older), false);
  } finally {
    if (inherited === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = inherited;
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("gate writer proves a re-captured critique's ancestry with real Git in order", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pm-gate-ancestry-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    }).trim();
  try {
    git("init", "-q");
    const commits = ["original", "source", "head"].map((name) => {
      git("commit", "-q", "--allow-empty", "-m", name);
      return git("rev-parse", "HEAD");
    });
    const [original, source, head] = commits;
    const fx = writerFixture("design-critique", "design-critique", [
      { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
    ]);
    try {
      const records = fx.session.evidence["design-critique"].records;
      fx.session.evidence["design-critique"] = {
        commit: original,
        records,
        verified_commit: head,
        verified_at: "2026-09-26T00:00:00.000Z",
        verification_records: records,
      };
      const dc = path.join(fx.dir, "design-critique");
      fs.mkdirSync(dc);
      const route = path.join(dc, "route.json");
      fs.writeFileSync(path.join(dc, "report.html"), "<html></html>");
      const { isAncestor } = require("../scripts/lib/dev-gate-writer").defaultDeps();
      fx.deps.head = () => head;
      fx.deps.isAncestor = (_root, ancestor, descendant) => isAncestor(repo, ancestor, descendant);
      const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
      fs.writeFileSync(route, JSON.stringify({ source: { commit: source } }));
      planGateWrite(request, fx.deps);
      assert.equal(fx.calls.designCritique.commit, source);
      fx.session.evidence["design-critique"].commit = source;
      fs.writeFileSync(route, JSON.stringify({ source: { commit: original } }));
      assert.throws(() => planGateWrite(request, fx.deps), /could not prove/);
    } finally {
      fx.cleanup();
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function selectedReportFixture() {
  const fx = writerFixture("design-critique", "design-critique", [
    { kind: "review", command: "design-critique-check.js", exit_code: 0, artifact: null },
  ]);
  const dc = path.join(fx.dir, "design-critique");
  fs.mkdirSync(dc);
  const selected = ".pm/dev-sessions/unit/design-critique/runs/dc_selected/round-3";
  fs.mkdirSync(path.join(fx.root, selected), { recursive: true });
  fs.writeFileSync(
    path.join(fx.root, selected, "route.json"),
    JSON.stringify({ source: { commit: "c".repeat(40) } })
  );
  const report = {
    run_id: "dc_selected",
    rounds: 3,
    route: { path: `${selected}/route.json`, sha256: "d".repeat(64) },
    captures: { path: `${selected}/captures.json`, sha256: "e".repeat(64) },
  };
  fx.report = report;
  fx.reportFile = path.join(dc, "report.json");
  fx.writeReport = () => fs.writeFileSync(fx.reportFile, JSON.stringify(fx.report));
  fx.writeReport();
  return fx;
}
for (const retained of [false, true]) {
  test(`legacy HTML phase evidence selects its checked machine report: ${retained}`, () => {
    const fx = selectedReportFixture();
    try {
      const selected = retained
        ? path.posix.dirname(fx.report.route.path)
        : ".pm/dev-sessions/unit/design-critique";
      const reportPath = `${selected}/report.json`;
      const htmlPath = `${selected}/report.html`;
      if (!retained) {
        fx.report.rounds = 1;
        fx.report.route.path = `${selected}/route.json`;
        fx.report.captures.path = `${selected}/captures.json`;
        fs.writeFileSync(
          path.join(fx.root, selected, "route.json"),
          JSON.stringify({ source: { commit: "c".repeat(40) } })
        );
      }
      fx.report.human_report = { path: htmlPath };
      fs.writeFileSync(path.join(fx.root, reportPath), JSON.stringify(fx.report));
      fs.writeFileSync(path.join(fx.root, htmlPath), "<html></html>");
      fx.session.evidence["design-critique"].records[0].artifact = path.join(fx.root, htmlPath);
      const plan = planGateWrite(
        { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
        fx.deps
      );
      assert.equal(fx.calls.designCritique.reportPath, reportPath);
      assert.equal(fx.calls.designCritique.routePath, fx.report.route.path);
      assert.equal(plan.row.artifact, htmlPath);
    } finally {
      fx.cleanup();
    }
  });
}

for (const variant of ["mismatched-human-report", "malformed-human-report", "symlink-html"]) {
  test(`legacy HTML phase mapping rejects ${variant}`, () => {
    const fx = selectedReportFixture();
    try {
      const selected = path.posix.dirname(fx.report.route.path);
      const htmlPath = `${selected}/report.html`;
      fx.report.human_report =
        variant === "malformed-human-report"
          ? htmlPath
          : { path: variant === "mismatched-human-report" ? `${selected}/other.html` : htmlPath };
      fs.writeFileSync(path.join(fx.root, selected, "report.json"), JSON.stringify(fx.report));
      if (variant === "symlink-html") fs.symlinkSync(fx.reportFile, path.join(fx.root, htmlPath));
      else fs.writeFileSync(path.join(fx.root, htmlPath), "<html></html>");
      fx.session.evidence["design-critique"].records[0].artifact = path.join(fx.root, htmlPath);
      assert.throws(() =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        )
      );
      assert.equal(fx.calls.designCritique, undefined);
    } finally {
      fx.cleanup();
    }
  });
}

test("same-commit Design recertification selects its canonical report and still reruns the checker", () => {
  const fx = selectedReportFixture();
  try {
    const selected = path.posix.dirname(fx.report.route.path);
    const reportPath = `${selected}/report.json`;
    fs.writeFileSync(path.join(fx.root, reportPath), JSON.stringify(fx.report));
    const phase = fx.session.evidence["design-critique"];
    phase.records[0].artifact = path.join(fx.root, selected, "report-draft.json");
    phase.verified_commit = phase.commit;
    phase.verified_at = "2026-10-17T00:00:00.000Z";
    phase.verification_records = [
      {
        kind: "review",
        command: "design-critique-check.js",
        exit_code: 0,
        artifact: path.join(fx.root, reportPath),
      },
    ];
    const before = structuredClone(phase);
    const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
    const plan = planGateWrite(request, fx.deps);
    assert.equal(fx.calls.designCritique.reportPath, reportPath);
    assert.equal(fx.calls.designCritique.commit, phase.commit);
    assert.equal(fx.calls.designCritique.verifyRemote, false);
    assert.equal(plan.row.artifact, `${selected}/report.html`);
    assert.deepEqual(phase, before);
    fx.deps.checkDesignCritique = () => ({
      ok: false,
      issues: [{ path: "report.captures.sha256", message: "hash mismatch" }],
    });
    assert.throws(() => planGateWrite(request, fx.deps), /hash mismatch/);
  } finally {
    fx.cleanup();
  }
});

test("phase-bound immutable report selects a later round without overwriting the predecessor", () => {
  const fx = selectedReportFixture();
  try {
    const selected = path.posix.dirname(fx.report.route.path);
    const reportPath = `${selected}/report.json`;
    fs.writeFileSync(path.join(fx.root, reportPath), JSON.stringify(fx.report));
    fx.session.evidence["design-critique"].records[0].artifact = path.join(fx.root, reportPath);
    const frozen = {
      run_id: "dc_selected",
      rounds: 1,
      route: { path: ".pm/dev-sessions/unit/design-critique/route.json", sha256: "a".repeat(64) },
      captures: {
        path: ".pm/dev-sessions/unit/design-critique/captures.json",
        sha256: "b".repeat(64),
      },
    };
    fs.writeFileSync(fx.reportFile, JSON.stringify(frozen));
    fs.writeFileSync(
      path.join(fx.dir, "design-critique/route.json"),
      JSON.stringify({ source: { commit: "e".repeat(40) } })
    );
    const before = fs.readFileSync(fx.reportFile);
    const request = { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" };
    const plan = planGateWrite(request, fx.deps);
    assert.equal(fx.calls.designCritique.reportPath, reportPath);
    assert.equal(fx.calls.designCritique.routePath, fx.report.route.path);
    assert.equal(fx.calls.designCritique.capturesPath, fx.report.captures.path);
    assert.equal(fx.calls.designCritique.commit, "c".repeat(40));
    assert.equal(plan.row.artifact, `${selected}/report.html`);
    assert.deepEqual(fs.readFileSync(fx.reportFile), before);
    fx.deps.checkDesignCritique = () => ({
      ok: false,
      issues: [{ path: "report.route.sha256", message: "hash mismatch" }],
    });
    assert.throws(() => planGateWrite(request, fx.deps), /hash mismatch/);
    assert.deepEqual(fs.readFileSync(fx.reportFile), before);
  } finally {
    fx.cleanup();
  }
});

for (const variant of [
  "outside",
  "foreign-session",
  "run-mismatch",
  "round-mismatch",
  "over-budget",
  "filename",
  "input-mismatch",
  "symlink",
]) {
  test(`phase-bound immutable report rejects ${variant}`, () => {
    const fx = selectedReportFixture();
    try {
      const selected = path.posix.dirname(fx.report.route.path);
      let artifact = `${selected}/report.json`;
      if (variant === "outside") artifact = "../outside/report.json";
      if (variant === "foreign-session")
        artifact = artifact.replace("dev-sessions/unit/", "dev-sessions/foreign/");
      if (variant === "over-budget") artifact = artifact.replace("round-3/", "round-51/");
      if (variant === "filename") artifact = artifact.replace("report.json", "other.json");
      const target = path.join(fx.root, artifact);
      if (["run-mismatch", "round-mismatch", "input-mismatch", "symlink"].includes(variant)) {
        if (variant === "run-mismatch") fx.report.run_id = "dc_other";
        if (variant === "round-mismatch") fx.report.rounds = 2;
        if (variant === "input-mismatch") {
          fx.report.route.path = ".pm/dev-sessions/unit/design-critique/route.json";
          fx.report.captures.path = ".pm/dev-sessions/unit/design-critique/captures.json";
        }
        if (variant === "symlink") fs.symlinkSync(fx.reportFile, target);
        else fs.writeFileSync(target, JSON.stringify(fx.report));
      }
      fx.session.evidence["design-critique"].records[0].artifact = target;
      assert.throws(() =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        )
      );
      assert.equal(
        fx.calls.designCritique,
        undefined,
        "unsafe selection never reaches the checker"
      );
    } finally {
      fx.cleanup();
    }
  });
}

test("report-selected immutable inputs reach the full gate checker exactly", () => {
  const fx = selectedReportFixture();
  try {
    planGateWrite(
      { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
      fx.deps
    );
    assert.equal(fx.calls.designCritique.routePath, fx.report.route.path);
    assert.equal(fx.calls.designCritique.capturesPath, fx.report.captures.path);
    fx.deps.checkDesignCritique = () => ({
      ok: false,
      issues: [{ path: "report.route.sha256", message: "hash mismatch" }],
    });
    assert.throws(
      () =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        ),
      /hash mismatch/
    );
  } finally {
    fx.cleanup();
  }
});
for (const variant of [
  "outside",
  "foreign-session",
  "different-round",
  "different-run",
  "over-budget",
  "missing-binding",
]) {
  test(`report-selected inputs reject ${variant}`, () => {
    const fx = selectedReportFixture();
    try {
      if (variant === "outside") fx.report.route.path = "../outside/route.json";
      if (variant === "foreign-session")
        fx.report.route.path = fx.report.route.path.replace("/unit/", "/other/");
      if (variant === "different-round")
        fx.report.captures.path = fx.report.captures.path.replace("round-3", "round-2");
      if (variant === "different-run") fx.report.run_id = "dc_other";
      if (variant === "over-budget") {
        fx.report.rounds = 51;
        fx.report.route.path = fx.report.route.path.replace("round-3", "round-51");
        fx.report.captures.path = fx.report.captures.path.replace("round-3", "round-51");
      }
      if (variant === "missing-binding") delete fx.report.route.path;
      fx.writeReport();
      assert.throws(() =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        )
      );
    } finally {
      fx.cleanup();
    }
  });
}

test("report-selected inputs refuse a symlinked canonical report", () => {
  const fx = selectedReportFixture();
  try {
    const original = path.join(fx.root, "foreign-report.json");
    fs.renameSync(fx.reportFile, original);
    fs.symlinkSync(original, fx.reportFile);
    assert.throws(
      () =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        ),
      /symlink/
    );
  } finally {
    fx.cleanup();
  }
});
test("report-selected inputs refuse oversized canonical report bytes", () => {
  const fx = selectedReportFixture();
  try {
    fs.writeFileSync(fx.reportFile, " ".repeat(4 * 1024 * 1024 + 1));
    assert.throws(
      () =>
        planGateWrite(
          { sessionPath: fx.sessionPath, session: fx.session, name: "design-critique" },
          fx.deps
        ),
      /budget|maximum|size|large/
    );
  } finally {
    fx.cleanup();
  }
});

test("policy-approved UI skips advance only their active phase without passing evidence", () => {
  const repo = makeRepo();
  try {
    const session = repo.session();
    session.phase = "design-critique";
    session.routing.required_phases = [
      "intake",
      "workspace",
      "implementation",
      "design-critique",
      "qa",
      "review",
      "ship",
      "retro",
    ];
    session.routing.required_gates = ["tdd", "design-critique", "qa", "review", "verification"];
    session.task.risk.ui = 1;
    repo.saveSession(session);
    const args = (name) => [
      "--name",
      name,
      "--status",
      "skipped",
      "--reason",
      "No UI impact: command-only changes.",
    ];
    assert.equal(repo.gate(args("qa")).status, 0);
    assert.equal(repo.session().phase, "design-critique");
    const first = repo.gate(args("design-critique"));
    assert.equal(first.status, 0, first.stderr);
    assert.equal(repo.session().phase, "qa");
    assert.equal(repo.session().evidence["design-critique"], undefined);
    assert.equal(repo.gate(args("qa")).status, 0);
    assert.equal(repo.session().phase, "review");
    assert.equal(repo.session().evidence.qa, undefined);
    assert.equal(repo.session().history.length, 2);
    assert.match(repo.session().history[0].reason, /policy-approved.*skip/);
    assert.equal(repo.gate(args("qa")).status, 0);
    assert.equal(repo.session().history.length, 2);
    const blocked = repo.session();
    blocked.phase = "qa";
    repo.saveSession(blocked);
    const before = fs.readFileSync(repo.sessionPath, "utf8");
    assert.notEqual(
      repo.gate(["--name", "qa", "--status", "skipped", "--reason", "Browser unavailable"]).status,
      0
    );
    assert.equal(fs.readFileSync(repo.sessionPath, "utf8"), before);
    fs.writeFileSync(path.join(repo.root, "view.tsx"), "export const View = () => <div />;\n");
    git(repo.root, ["add", "view.tsx"]);
    git(repo.root, ["commit", "-qm", "add UI"]);
    assert.notEqual(repo.gate(args("qa")).status, 0);
    assert.equal(fs.readFileSync(repo.sessionPath, "utf8"), before);
  } finally {
    repo.cleanup();
  }
});

test("completion rechecks policy skips against current source and commit", () => {
  const repo = makeRepo();
  try {
    for (const name of ["design-critique", "qa"]) {
      const result = repo.gate([
        "--name",
        name,
        "--status",
        "skipped",
        "--reason",
        "No UI impact: CLI only.",
      ]);
      assert.equal(result.status, 0, result.stderr);
    }
    const { recordResult } = require("../scripts/lib/dev-session-schema");
    const session = repo.session();
    session.phase = "retro";
    session.routing.required_phases = ["retro"];
    session.routing.required_gates = ["design-critique", "qa"];
    repo.saveSession(session);
    const result = {
      schema_version: 1,
      run_id: session.run_id,
      phase: "retro",
      attempt: 1,
      status: "passed",
      summary: "Complete non-UI fixture",
      commit: repo.head(),
      files_changed: [],
      evidence: [
        {
          kind: "retro",
          command: "review retained release evidence",
          exit_code: 0,
          artifact: null,
        },
      ],
      blocker: null,
      runtime: { provider: "codex", model: "inherit", reasoning: "inherit", session_id: null },
    };
    assert.equal(recordResult(session, result).status, "complete");
    const retained = repo.gates();
    for (const corrupt of [
      { ...retained, gates: retained.gates.map((row) => ({ ...row, checked_at: "invalid" })) },
      { ...retained, gates: [...retained.gates, { ...retained.gates[0], status: "failed" }] },
    ]) {
      fs.writeFileSync(repo.gatesPath, JSON.stringify(corrupt));
      assert.throws(() => recordResult(session, result), /missing or stale/);
    }
    fs.writeFileSync(repo.gatesPath, JSON.stringify(retained));
    git(repo.root, ["commit", "--allow-empty", "-qm", "advance"]);
    result.commit = repo.head();
    assert.throws(() => recordResult(session, result), /missing or stale/);
  } finally {
    repo.cleanup();
  }
});
