"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  checkQaReport,
  expectedQaReportPath,
  validateQaReport,
} = require("../scripts/lib/qa-report-schema");
const {
  createSession,
  recertifyEvidence,
  recordResult,
  validateResult,
  writeSession,
} = require("../scripts/lib/dev-session-schema");

const SHA_A = "a".repeat(40);

test("strict QA report accepts a closed, internally consistent passing artifact", () => {
  const report = passingReport(SHA_A);
  assert.deepEqual(validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }), []);
});

test("strict QA report rejects unknown fields and inconsistent totals, counts, scores, and runs", () => {
  const report = passingReport(SHA_A);
  report.untrusted = true;
  report.assertions.passed = 13;
  report.finding_counts.low = 1;
  report.category_breakdown[0].score = 99;
  report.runs[0].health_score = 99;
  report.runs[0].finding_ids = ["unknown-finding"];

  const messages = validateQaReport(report, {
    expectedCommit: SHA_A,
    requirePassing: true,
  }).map((entry) => `${entry.path}: ${entry.message}`);
  assert.ok(messages.some((message) => /report\.untrusted: unknown field/.test(message)));
  assert.ok(messages.some((message) => /assertions\.passed: cannot exceed total/.test(message)));
  assert.ok(messages.some((message) => /finding_counts\.low: must equal 0/.test(message)));
  assert.ok(messages.some((message) => /category_breakdown\[0\]\.score/.test(message)));
  assert.ok(messages.some((message) => /must equal top-level health_score/.test(message)));
  assert.ok(messages.some((message) => /unknown finding unknown-finding/.test(message)));
});

test("passing QA verdict rejects unresolved Critical or High findings", () => {
  const report = passingReport(SHA_A);
  report.findings = [finding({ id: "qa-core-flow", severity: "high" })];
  report.finding_counts.high = 1;
  report.category_breakdown = categoryRows({ functional: 85 });
  report.health_score = 96;
  report.runs[0].health_score = 96;
  report.runs[0].finding_ids = ["qa-core-flow"];

  const messages = validateQaReport(report, {
    expectedCommit: SHA_A,
    requirePassing: true,
  }).map((entry) => entry.message);
  assert.ok(messages.some((message) => /unresolved Critical or High/.test(message)));
});

test("re-verification history is ordered and bound to the latest report state", () => {
  const report = passingReport(SHA_A);
  report.findings = [finding({ id: "qa-fixed-modal", disposition: "fixed" })];
  report.runs[0] = {
    ...report.runs[0],
    verdict: "fail",
    health_score: 98,
    assertions: { passed: 10, total: 12 },
    finding_ids: ["qa-fixed-modal"],
  };
  report.runs.push({
    run: 2,
    kind: "reverify",
    checked_at: "2026-09-04T01:10:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 12, total: 12 },
    finding_ids: ["qa-fixed-modal"],
    previous_verdict: "fail",
    previous_health_score: 98,
    fixed_finding_ids: ["qa-fixed-modal"],
    still_open_finding_ids: [],
    new_finding_ids: [],
  });

  assert.deepEqual(validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }), []);
  report.runs[1].previous_health_score = 97;
  assert.ok(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }).some((entry) =>
      /previous run health_score/.test(entry.message)
    )
  );
});

test("QA report file must use the exact in-session path and rejects symlinks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "quality-gate", source: { repo_root: root } };
  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(passingReport(SHA_A), null, 2)}\n`);

  assert.equal(
    checkQaReport({ session, reportPath, expectedCommit: SHA_A, requirePassing: true }).ok,
    true
  );
  const aliasedPath = `${path.dirname(reportPath)}/../qa/report.json`;
  const aliased = checkQaReport({
    session,
    reportPath: aliasedPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(aliased.ok, false);
  assert.match(JSON.stringify(aliased.issues), /must equal/);

  const outside = path.join(root, "outside.json");
  fs.renameSync(reportPath, outside);
  fs.symlinkSync(outside, reportPath);
  const linked = checkQaReport({ session, reportPath, expectedCommit: SHA_A });
  assert.equal(linked.ok, false);
  assert.match(JSON.stringify(linked.issues), /symbolic links are not allowed/);
});

test("Dev QA phase and later recertification require the bound report artifact", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-bound", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(passingReport(repo.head()), null, 2)}\n`);

  const result = phaseResult(session, repo.head(), reportPath);
  assert.deepEqual(validateResult(session, result), []);
  assert.ok(
    validateResult(session, phaseResult(session, repo.head(), null)).some((entry) =>
      /absolute report artifact path/.test(entry.message)
    )
  );
  session = recordResult(session, result);

  fs.appendFileSync(path.join(repo.root, "README.md"), "final review fix\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "review fix"], { cwd: repo.root });
  const finalCommit = repo.head();
  const stale = recertificationRecord(reportPath);
  assert.throws(
    () => recertifyEvidence(session, ["qa"], finalCommit, { qa: [stale] }),
    /must equal current result commit/
  );

  fs.writeFileSync(reportPath, `${JSON.stringify(passingReport(finalCommit), null, 2)}\n`);
  const recertified = recertifyEvidence(session, ["qa"], finalCommit, { qa: [stale] });
  assert.equal(recertified.evidence.qa.verified_commit, finalCommit);
  assert.equal(recertified.evidence.qa.verification_records[0].artifact, reportPath);
});

test("final Dev completion does not grandfather legacy null QA evidence", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-final-gate", sourceDir: repo.root });
  session.phase = "retro";
  session.routing.required_phases = ["retro"];
  session.routing.required_gates = ["qa"];
  session.evidence.qa = {
    commit: repo.head(),
    records: [{ kind: "test", command: "legacy QA", exit_code: 0, artifact: null }],
    recorded_at: "2026-09-04T01:00:00.000Z",
  };
  const result = {
    ...phaseResult(session, repo.head(), null),
    phase: "retro",
    evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
  };
  assert.throws(() => recordResult(session, result), /required gates: qa/);

  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(passingReport(repo.head()), null, 2)}\n`);
  session.evidence.qa.records = [recertificationRecord(reportPath)];
  assert.equal(recordResult(session, result).status, "complete");
});

test("qa-report-check CLI validates the canonical session artifact", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-cli", sourceDir: repo.root });
  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  writeSession(sessionPath, session);
  fs.writeFileSync(reportPath, `${JSON.stringify(passingReport(repo.head()), null, 2)}\n`);
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");

  const checked = spawnSync(
    process.execPath,
    [script, "--session", sessionPath, "--report", reportPath, "--commit", repo.head()],
    { encoding: "utf8" }
  );
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).ok, true);
});

function passingReport(commit) {
  return {
    schema_version: 1,
    commit,
    verdict: "pass",
    health_score: 100,
    tier: "full",
    platform: "web",
    assertions: { passed: 12, total: 12 },
    finding_counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
    category_breakdown: categoryRows(),
    screenshots: [],
    runs: [
      {
        run: 1,
        kind: "initial",
        checked_at: "2026-09-04T01:00:00.000Z",
        verdict: "pass",
        health_score: 100,
        assertions: { passed: 12, total: 12 },
        finding_ids: [],
      },
    ],
  };
}

function finding(overrides = {}) {
  return {
    id: "qa-finding",
    severity: "medium",
    category: "functional",
    summary: "The tested interaction does not reach its expected state",
    route: "/dashboard",
    evidence: {
      type: "assertion",
      probe: "submit action result",
      observed: "error state",
      expected: "success state",
      screenshot: null,
    },
    disposition: "open",
    ...overrides,
  };
}

function categoryRows(overrides = {}) {
  return ["console", "links", "visual", "functional", "ux", "performance", "accessibility"].map(
    (category) => ({ category, score: overrides[category] ?? 100 })
  );
}

function phaseResult(session, commit, artifact) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: "qa",
    attempt: session.phase_attempt,
    status: "passed",
    summary: "QA passed",
    commit,
    files_changed: [],
    evidence: [
      {
        kind: "test",
        command: "node scripts/qa-report-check.js",
        exit_code: 0,
        artifact,
      },
    ],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
  };
}

function recertificationRecord(reportPath) {
  return {
    kind: "test",
    command: "node scripts/qa-report-check.js",
    exit_code: 0,
    artifact: reportPath,
  };
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-repo-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });
  return {
    root,
    head() {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
