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
  const run = (script, args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env });
  const init = run(CLI, ["init", "--slug", slug, "--source-dir", root, "--json"]);
  assert.equal(init.status, 0, init.stderr);
  const sessionPath = JSON.parse(init.stdout).session_path;
  const repo = {
    root,
    sessionPath,
    gatesPath: path.join(path.dirname(sessionPath), "gates.json"),
    head: () => git(root, ["rev-parse", "HEAD"]),
    run: (args) => run(CLI, args),
    check: (args) => run(CHECK, args),
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

test("review rows are derived from the canonical review report", () => {
  const fx = writerFixture("review", "review", [
    { kind: "review", command: "review-check.js", exit_code: 0, artifact: null },
  ]);
  try {
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
    fs.writeFileSync(path.join(reviewDir, "report.json"), structuredBytes);
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
      baseCommit: "a".repeat(40),
      verifyGit: false,
    });
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
