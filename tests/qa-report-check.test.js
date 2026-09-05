"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL,
  MAX_QA_VALIDATION_ISSUES,
  checkQaReport,
  expectedQaReportPath,
  validateQaReport,
} = require("../scripts/lib/qa-report-schema");
const { MAX_SESSION_BYTES } = require("../scripts/qa-report-check");
const {
  anchorQaHistory,
  createSession,
  recertifyEvidence,
  recordNonPassingQaCandidate,
  recordResult,
  validateResult,
  writeSession,
} = require("../scripts/lib/dev-session-schema");

const SHA_A = "a".repeat(40);
const QA_COMMAND = "node --test tests/acceptance.test.js";

function qaOutput(
  commit,
  receiptId = "qa-run-1-tests",
  assertions = 12,
  exitCode = 0,
  options = {}
) {
  const kind = options.kind || "deterministic";
  const command = options.command || QA_COMMAND;
  const idPrefix = options.idPrefix || "acceptance";
  const findingIds = options.findingIds || [];
  return Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 1,
        assurance: "workflow-attested-non-cryptographic",
        receipt_id: receiptId,
        commit,
        kind,
        command,
        exit_code: exitCode,
        assertions: Array.from({ length: assertions }, (_, index) => ({
          id: `${idPrefix}-${index + 1}`,
          status: index < 10 && exitCode !== 0 ? "passed" : exitCode === 0 ? "passed" : "failed",
          probe: `acceptance assertion ${index + 1}`,
          observed: index < 10 || exitCode === 0 ? "expected state observed" : "failure observed",
          expected: "expected state observed",
          finding_ids: findingIds,
        })),
      },
      null,
      2
    )}\n`
  );
}

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

test("strict QA report bounds collection traversal and caps validation diagnostics", () => {
  const report = passingReport(SHA_A);
  report.receipts[0].screenshot_ids = Array.from(
    { length: 16 },
    (_, index) => `unbound-screenshot-${index}`
  );
  Object.defineProperty(report.receipts[0].screenshot_ids, 15, {
    configurable: true,
    get() {
      throw new Error("validator traversed beyond the receipt screenshot limit");
    },
  });
  report.findings = Array.from({ length: 1_100 }, () => null);
  Object.defineProperty(report.findings, 1_000, {
    configurable: true,
    get() {
      throw new Error("validator traversed beyond the finding limit");
    },
  });
  report.runs[0].finding_ids = Array.from(
    { length: 1_001 },
    (_, index) => `unbound-finding-${index}`
  );
  Object.defineProperty(report.runs[0].finding_ids, 1_000, {
    configurable: true,
    get() {
      throw new Error("validator traversed beyond the run finding limit");
    },
  });

  const issues = validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true });

  assert.equal(issues.length, MAX_QA_VALIDATION_ISSUES);
  assert.match(issues.at(-1).message, /validation diagnostics were capped/);
  assert.ok(
    issues.every((entry) => !/^report\.findings\[(?:10\d\d|[2-9]\d{3,})\]/.test(entry.path)),
    "validation must not visit findings beyond the declared maximum"
  );
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
  report.receipts[0].exit_code = 1;
  report.receipts[0].assertions = { passed: 10, total: 12 };
  report.receipts.push({
    ...report.receipts[0],
    id: "qa-run-2-tests",
    run: 2,
    exit_code: 0,
    assertions: { passed: 12, total: 12 },
    output: {
      ...report.receipts[0].output,
      path: "/tmp/qa/evidence/run-2.tap",
    },
  });
  report.runs.push({
    run: 2,
    kind: "reverify",
    commit: SHA_A,
    checked_at: "2026-09-04T01:10:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 12, total: 12 },
    finding_ids: ["qa-fixed-modal"],
    receipt_ids: ["qa-run-2-tests"],
    previous_verdict: "fail",
    previous_health_score: 98,
    fixed_finding_ids: ["qa-fixed-modal"],
    still_open_finding_ids: [],
    new_finding_ids: [],
    fixed_finding_evidence: [{ finding_id: "qa-fixed-modal", assertion_ids: ["acceptance-1"] }],
    previous_report: {
      path: "/tmp/qa/evidence/report-run-1.json",
      sha256: "b".repeat(64),
      bytes: 1024,
    },
  });

  assert.deepEqual(validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }), []);
  report.runs[0].checked_at = "2026-09-04T01:00:00.000+02:00";
  report.runs[1].checked_at = "2026-09-04T00:30:00.000Z";
  assert.deepEqual(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }),
    [],
    "chronology must compare represented instants, not timestamp text"
  );
  report.runs[0].checked_at = "2026-09-04T01:00:00.000-02:00";
  report.runs[1].checked_at = "2026-09-04T02:00:00.000Z";
  assert.ok(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }).some(
      (entry) =>
        entry.path === "report.runs[1].checked_at" &&
        /must not precede the previous run/.test(entry.message)
    ),
    "an earlier represented instant must be rejected even when its timestamp text sorts later"
  );
  report.runs[0].checked_at = "2026-09-04T01:00:00.0002Z";
  report.runs[1].checked_at = "2026-09-04T01:00:00.0001Z";
  assert.ok(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }).some(
      (entry) =>
        entry.path === "report.runs[1].checked_at" &&
        /must not precede the previous run/.test(entry.message)
    ),
    "chronology must preserve accepted sub-millisecond precision"
  );
  report.runs[0].checked_at = "2026-09-04T01:00:00.0001Z";
  report.runs[1].checked_at = "2026-09-04T01:00:00.0002Z";
  assert.deepEqual(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }),
    [],
    "sub-millisecond instants must remain ordered"
  );
  report.runs[0].checked_at = "2026-09-04T01:00:00.000Z";
  report.runs[1].checked_at = "2026-09-04T01:10:00.000Z";
  report.runs[1].previous_health_score = 97;
  assert.ok(
    validateQaReport(report, { expectedCommit: SHA_A, requirePassing: true }).some((entry) =>
      /previous run health_score/.test(entry.message)
    )
  );
});

test("canonical re-verification preserves historical commits and exact finding transitions", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = { slug: "qa-history", source: { repo_root: repo.root } };
  const initialCommit = repo.head();
  writeFailingReport(session, initialCommit);
  fs.appendFileSync(path.join(repo.root, "README.md"), "fixed\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "fix QA finding"], { cwd: repo.root });
  const fixedCommit = repo.head();
  const written = writeFixedReverifiedReport(session, fixedCommit);

  const check = () =>
    checkQaReport({
      session,
      reportPath: written.reportPath,
      expectedCommit: fixedCommit,
      requirePassing: true,
    });
  const validReportBytes = fs.readFileSync(written.reportPath);
  const validReport = JSON.parse(validReportBytes);
  const validSnapshotBytes = fs.readFileSync(written.snapshotPath);
  assert.equal(check().ok, true, JSON.stringify(check().issues));
  assert.equal(validReport.runs[0].commit, initialCommit);
  assert.equal(validReport.receipts[0].commit, initialCommit);
  assert.equal(validReport.runs[1].commit, fixedCommit);
  assert.equal(validReport.receipts[1].commit, fixedCommit);

  const fakeCommit = "f".repeat(40);
  const initialOutputPath = validReport.receipts[0].output.path;
  const validInitialOutputBytes = fs.readFileSync(initialOutputPath);
  const fakeInitialOutput = JSON.parse(validInitialOutputBytes);
  fakeInitialOutput.commit = fakeCommit;
  const fakeInitialOutputBytes = Buffer.from(`${JSON.stringify(fakeInitialOutput, null, 2)}\n`);
  fs.writeFileSync(initialOutputPath, fakeInitialOutputBytes);
  const fakeSnapshot = JSON.parse(validSnapshotBytes);
  fakeSnapshot.commit = fakeCommit;
  fakeSnapshot.runs[0].commit = fakeCommit;
  fakeSnapshot.receipts[0].commit = fakeCommit;
  fakeSnapshot.receipts[0].output.sha256 = digest(fakeInitialOutputBytes);
  fakeSnapshot.receipts[0].output.bytes = fakeInitialOutputBytes.length;
  const fakeSnapshotBytes = Buffer.from(`${JSON.stringify(fakeSnapshot, null, 2)}\n`);
  fs.writeFileSync(written.snapshotPath, fakeSnapshotBytes);
  const fakeHistory = structuredClone(validReport);
  fakeHistory.runs[0].commit = fakeCommit;
  fakeHistory.receipts[0].commit = fakeCommit;
  fakeHistory.receipts[0].output.sha256 = digest(fakeInitialOutputBytes);
  fakeHistory.receipts[0].output.bytes = fakeInitialOutputBytes.length;
  fakeHistory.runs[1].previous_report.sha256 = digest(fakeSnapshotBytes);
  fakeHistory.runs[1].previous_report.bytes = fakeSnapshotBytes.length;
  fs.writeFileSync(written.reportPath, `${JSON.stringify(fakeHistory, null, 2)}\n`);
  let rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /must resolve to a Git commit/);
  fs.writeFileSync(initialOutputPath, validInitialOutputBytes);
  fs.writeFileSync(written.snapshotPath, validSnapshotBytes);

  execFileSync("git", ["checkout", "-b", "qa-unrelated", initialCommit], { cwd: repo.root });
  fs.appendFileSync(path.join(repo.root, "README.md"), "unrelated history\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "unrelated QA history"], { cwd: repo.root });
  const unrelatedCommit = repo.head();
  execFileSync("git", ["checkout", "main"], { cwd: repo.root });
  const unrelatedOutput = JSON.parse(validInitialOutputBytes);
  unrelatedOutput.commit = unrelatedCommit;
  const unrelatedOutputBytes = Buffer.from(`${JSON.stringify(unrelatedOutput, null, 2)}\n`);
  fs.writeFileSync(initialOutputPath, unrelatedOutputBytes);
  const unrelatedSnapshot = JSON.parse(validSnapshotBytes);
  unrelatedSnapshot.commit = unrelatedCommit;
  unrelatedSnapshot.runs[0].commit = unrelatedCommit;
  unrelatedSnapshot.receipts[0].commit = unrelatedCommit;
  unrelatedSnapshot.receipts[0].output.sha256 = digest(unrelatedOutputBytes);
  unrelatedSnapshot.receipts[0].output.bytes = unrelatedOutputBytes.length;
  const unrelatedSnapshotBytes = Buffer.from(`${JSON.stringify(unrelatedSnapshot, null, 2)}\n`);
  fs.writeFileSync(written.snapshotPath, unrelatedSnapshotBytes);
  const unrelatedHistory = structuredClone(validReport);
  unrelatedHistory.runs[0].commit = unrelatedCommit;
  unrelatedHistory.receipts[0].commit = unrelatedCommit;
  unrelatedHistory.receipts[0].output.sha256 = digest(unrelatedOutputBytes);
  unrelatedHistory.receipts[0].output.bytes = unrelatedOutputBytes.length;
  unrelatedHistory.runs[1].previous_report.sha256 = digest(unrelatedSnapshotBytes);
  unrelatedHistory.runs[1].previous_report.bytes = unrelatedSnapshotBytes.length;
  fs.writeFileSync(written.reportPath, `${JSON.stringify(unrelatedHistory, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /must descend from the immediately preceding/);
  fs.writeFileSync(initialOutputPath, validInitialOutputBytes);
  fs.writeFileSync(written.snapshotPath, validSnapshotBytes);

  const rewrittenCommit = structuredClone(validReport);
  rewrittenCommit.runs[0].commit = fixedCommit;
  rewrittenCommit.receipts[0].commit = fixedCommit;
  fs.writeFileSync(written.reportPath, `${JSON.stringify(rewrittenCommit, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /immutable current-history prefix|bound receipt/);

  const omittedFixed = structuredClone(validReport);
  omittedFixed.runs[1].fixed_finding_ids = [];
  omittedFixed.runs[1].fixed_finding_evidence = [];
  fs.writeFileSync(written.reportPath, `${JSON.stringify(omittedFixed, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /must equal the exact set: qa-core-flow/);

  const priorOnlyEvidence = structuredClone(validReport);
  priorOnlyEvidence.runs[1].fixed_finding_evidence[0].assertion_ids = ["prior-1"];
  fs.writeFileSync(written.reportPath, `${JSON.stringify(priorOnlyEvidence, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /outside this run/);

  const rewrittenEvidence = structuredClone(validReport);
  rewrittenEvidence.findings[0].evidence.observed = "rewritten after the fix";
  fs.writeFileSync(written.reportPath, `${JSON.stringify(rewrittenEvidence, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /changed immutable field evidence/);

  const inventedNew = structuredClone(validReport);
  inventedNew.findings.push(finding({ id: "qa-new-regression", severity: "low" }));
  inventedNew.finding_counts.low = 1;
  inventedNew.category_breakdown = categoryRows({ functional: 97 });
  inventedNew.health_score = 99;
  inventedNew.runs[1].health_score = 99;
  inventedNew.runs[1].finding_ids.push("qa-new-regression");
  fs.writeFileSync(written.reportPath, `${JSON.stringify(inventedNew, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /new_finding_ids.*qa-new-regression/);

  fs.writeFileSync(written.reportPath, validReportBytes);
  fs.appendFileSync(written.snapshotPath, "\n");
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /does not match retained file bytes/);

  fs.writeFileSync(written.snapshotPath, validSnapshotBytes);
  const crossPath = structuredClone(validReport);
  crossPath.runs[1].previous_report.path = path.join(repo.root, "prior-report.json");
  fs.writeFileSync(written.reportPath, `${JSON.stringify(crossPath, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /canonical prior snapshot/);

  fs.writeFileSync(written.reportPath, validReportBytes);
  fs.rmSync(written.snapshotPath);
  fs.symlinkSync(path.join(repo.root, "README.md"), written.snapshotPath);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /symbolic links are not allowed/);

  fs.rmSync(written.snapshotPath);
  fs.writeFileSync(written.snapshotPath, validSnapshotBytes);
  const freshOutputPath = path.join(path.dirname(written.outputPath), "fresh-run.json");
  const freshOutput = qaOutput(fixedCommit);
  fs.writeFileSync(freshOutputPath, freshOutput);
  const freshReport = passingReport(fixedCommit, freshOutputPath);
  fs.writeFileSync(written.reportPath, `${JSON.stringify(freshReport, null, 2)}\n`);
  rejected = check();
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /orphan prior-report snapshot/);
});

test("a fixed finding requires a passed assertion from its own re-verification run", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = { slug: "qa-fixed-assertion", source: { repo_root: repo.root } };
  writeFailingReport(session, repo.head());
  fs.appendFileSync(path.join(repo.root, "README.md"), "attempted fix\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "attempt QA fix"], { cwd: repo.root });
  const written = writeFixedReverifiedReport(session, repo.head());
  const report = JSON.parse(fs.readFileSync(written.reportPath, "utf8"));
  const result = JSON.parse(fs.readFileSync(written.outputPath, "utf8"));
  result.assertions[0].finding_ids = [];
  let resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(written.outputPath, resultBytes);
  report.receipts[1].output.sha256 = digest(resultBytes);
  report.receipts[1].output.bytes = resultBytes.length;
  fs.writeFileSync(written.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  let rejected = checkQaReport({
    session,
    reportPath: written.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /does not identify fixed finding qa-core-flow/);

  result.assertions[0].finding_ids = ["qa-core-flow"];
  result.assertions[0].status = "failed";
  result.assertions[0].observed = "the defect remains";
  result.exit_code = 1;
  resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(written.outputPath, resultBytes);
  report.verdict = "fail";
  report.assertions = { passed: 11, total: 12 };
  report.receipts[1].exit_code = 1;
  report.receipts[1].assertions = { passed: 11, total: 12 };
  report.receipts[1].output.sha256 = digest(resultBytes);
  report.receipts[1].output.bytes = resultBytes.length;
  report.runs[1].verdict = "fail";
  report.runs[1].assertions = { passed: 11, total: 12 };
  fs.writeFileSync(written.reportPath, `${JSON.stringify(report, null, 2)}\n`);

  rejected = checkQaReport({
    session,
    reportPath: written.reportPath,
    expectedCommit: repo.head(),
    requirePassing: false,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /requires passed assertion current-1/);
});

test("every QA verdict is runner-recorded before re-verification and prevents history reset", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-attempt-history", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const initialCommit = repo.head();
  const written = writeFailingReport(session, initialCommit);
  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  writeSession(sessionPath, session);
  const checker = path.join(__dirname, "..", "scripts", "qa-report-check.js");

  let checked = spawnSync(
    process.execPath,
    [checker, "--session", sessionPath, "--report", written.reportPath, "--commit", initialCommit],
    { encoding: "utf8" }
  );
  assert.equal(checked.status, 1);
  checked = spawnSync(
    process.execPath,
    [
      checker,
      "--session",
      sessionPath,
      "--report",
      written.reportPath,
      "--commit",
      initialCommit,
      "--allow-nonpassing",
    ],
    { encoding: "utf8" }
  );
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);

  const failed = {
    ...phaseResult(session, initialCommit, written.reportPath),
    status: "failed",
    summary: "QA found a blocking core-flow defect",
  };
  failed.evidence[0].command =
    "node scripts/qa-report-check.js --allow-nonpassing --session session.json";
  assert.deepEqual(validateResult(session, failed), []);
  session = recordResult(session, failed);
  assert.equal(session.phase, "qa");
  assert.equal(session.phase_attempt, 2);
  assert.equal(session.attempts.at(-1).status, "failed");

  fs.appendFileSync(path.join(repo.root, "README.md"), "fixed after recorded QA\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "fix recorded QA finding"], { cwd: repo.root });
  const fixedCommit = repo.head();
  const reverified = writeFixedReverifiedReport(session, fixedCommit);
  assert.deepEqual(
    validateResult(session, phaseResult(session, fixedCommit, reverified.reportPath)),
    []
  );

  fs.rmSync(reverified.snapshotPath);
  const reset = writePassingReport(session, fixedCommit);
  const resetErrors = validateResult(session, phaseResult(session, fixedCommit, reset.reportPath));
  assert.ok(
    resetErrors.some((entry) =>
      /one per runner-recorded QA run plus the current candidate/.test(entry.message)
    )
  );
});

test("QA can complete as the final routed phase without inventing another candidate run", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-final-phase", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa"];
  session.routing.required_gates = ["qa"];
  const { reportPath } = writePassingReport(session, repo.head());

  const completed = recordResult(session, phaseResult(session, repo.head(), reportPath));
  assert.equal(completed.status, "complete");
  assert.equal(completed.evidence.qa.qa_run_count, 1);

  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  writeSession(sessionPath, completed);
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");
  const checked = spawnSync(
    process.execPath,
    [script, "--session", sessionPath, "--report", reportPath, "--commit", repo.head()],
    { encoding: "utf8" }
  );
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
});

test("blocked QA reports can be structurally checked and recorded without becoming a pass", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-blocked-report", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const written = writeFailingReport(session, repo.head(), "blocked");
  const result = {
    ...phaseResult(session, repo.head(), written.reportPath),
    status: "blocked",
    summary: "QA environment could not authenticate",
    blocker: {
      code: "qa-auth-unavailable",
      reason: "The seeded account cannot authenticate",
      remediation: "Repair the local seed and resume QA",
    },
  };
  result.evidence[0].command = "node scripts/qa-report-check.js --allow-nonpassing";
  assert.deepEqual(validateResult(session, result), []);
  assert.notEqual(JSON.parse(fs.readFileSync(written.reportPath, "utf8")).verdict, "pass");
});

test("QA report file must use the exact in-session path and rejects symlinks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "quality-gate", source: { repo_root: root } };
  const { reportPath } = writePassingReport(session, SHA_A);

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

test("canonical QA report is read from one bounded descriptor without a pathname reopen", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-descriptor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "descriptor-read", source: { repo_root: root } };
  const { reportPath } = writePassingReport(session, SHA_A);

  const originalReadFile = fs.readFileSync;
  fs.readFileSync = function rejectReportPathReopen(file, ...args) {
    if (path.resolve(String(file)) === reportPath) {
      throw new Error("canonical report pathname was reopened");
    }
    return originalReadFile.call(fs, file, ...args);
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.readFileSync = originalReadFile;
  }

  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
});

test("canonical QA report cannot be rebound between location inspection and descriptor open", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-open-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "report-open-swap", source: { repo_root: root } };
  const { reportPath } = writePassingReport(session, SHA_A);
  const replacement = Buffer.concat([fs.readFileSync(reportPath), Buffer.from("\n")]);

  const originalLstat = fs.lstatSync;
  const originalStat = fs.statSync;
  let reportLstats = 0;
  let swapped = false;
  const swapAfterInspection = () => {
    if (swapped) return;
    swapped = true;
    fs.renameSync(reportPath, `${reportPath}.opened`);
    fs.writeFileSync(reportPath, replacement);
  };
  fs.lstatSync = function patchedLstat(file, ...args) {
    const stat = originalLstat.call(fs, file, ...args);
    if (path.resolve(String(file)) === reportPath && ++reportLstats === 2) swapAfterInspection();
    return stat;
  };
  fs.statSync = function patchedStat(file, ...args) {
    const stat = originalStat.call(fs, file, ...args);
    if (path.resolve(String(file)) === reportPath) swapAfterInspection();
    return stat;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.lstatSync = originalLstat;
    fs.statSync = originalStat;
  }

  assert.equal(swapped, true);
  assert.equal(checked.ok, false);
  assert.match(
    JSON.stringify(checked.issues),
    /changed before.*opened safely|could not read QA report/
  );
});

test("canonical QA report detects a pathname swap during descriptor read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-read-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "report-read-swap", source: { repo_root: root } };
  const { reportPath } = writePassingReport(session, SHA_A);
  const reportBytes = fs.readFileSync(reportPath);

  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  let reportDescriptor;
  let swapped = false;
  fs.openSync = function captureReportDescriptor(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(String(file)) === reportPath) reportDescriptor = descriptor;
    return descriptor;
  };
  fs.readSync = function swapReportPath(descriptor, buffer, offset, length, position) {
    const count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    if (descriptor === reportDescriptor && count > 0 && !swapped) {
      swapped = true;
      fs.renameSync(reportPath, `${reportPath}.opened`);
      fs.writeFileSync(reportPath, reportBytes);
    }
    return count;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
  }

  assert.equal(swapped, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /report(?: path)? changed during validation/);
});

test("canonical QA report growth is stopped at the four MiB descriptor limit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-growth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "report-growth", source: { repo_root: root } };
  const { reportPath } = writePassingReport(session, SHA_A);
  const maximumBytes = 4 * 1024 * 1024;
  const reportBytes = fs.readFileSync(reportPath);
  fs.writeFileSync(
    reportPath,
    Buffer.concat([reportBytes, Buffer.alloc(maximumBytes - reportBytes.length, 0x20)])
  );

  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  let reportDescriptor;
  let grew = false;
  fs.openSync = function captureReportDescriptor(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(String(file)) === reportPath) reportDescriptor = descriptor;
    return descriptor;
  };
  fs.readSync = function growAtReadBoundary(descriptor, buffer, offset, length, position) {
    let count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    if (descriptor === reportDescriptor && count === 0 && !grew) {
      grew = true;
      fs.appendFileSync(reportPath, " ");
      count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    }
    return count;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
  }

  assert.equal(grew, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /exceeds 4194304 bytes/);
});

test("canonical QA report rejects a FIFO without blocking on open", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX FIFO regression");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-fifo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "report-fifo", source: { repo_root: root } };
  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  try {
    execFileSync("mkfifo", [reportPath]);
  } catch {
    t.skip("mkfifo is unavailable");
    return;
  }

  const checkerPath = require.resolve("../scripts/lib/qa-report-schema");
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
const path = require("node:path");
const { checkQaReport } = require(process.argv[1]);
const originalOpen = fs.openSync;
let reportOpens = 0;
fs.openSync = function countedOpen(file, ...args) {
  if (path.resolve(String(file)) === path.resolve(process.argv[4])) reportOpens += 1;
  return originalOpen.call(fs, file, ...args);
};
const result = checkQaReport({
  session: JSON.parse(process.argv[2]),
  reportPath: process.argv[3],
  expectedCommit: "${SHA_A}",
  requirePassing: true,
});
process.stdout.write(JSON.stringify({ result, reportOpens }));`,
      checkerPath,
      JSON.stringify(session),
      reportPath,
      reportPath,
    ],
    { encoding: "utf8", timeout: 1_500 }
  );

  assert.notEqual(child.error?.code, "ETIMEDOUT", "FIFO validation must not block");
  assert.equal(child.status, 0, child.stderr);
  const { result: checked, reportOpens } = JSON.parse(child.stdout);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /regular file/);
  assert.equal(reportOpens, 0, "a known FIFO must be rejected before open");
});

test("canonical QA rejects a vacuous all-100 report and revalidates retained output bytes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-forgery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "forged-pass", source: { repo_root: root } };
  const reportPath = expectedQaReportPath(session);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const forged = passingReport(SHA_A);
  delete forged.receipts;
  delete forged.runs[0].receipt_ids;
  fs.writeFileSync(reportPath, `${JSON.stringify(forged, null, 2)}\n`);

  const rejected = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(rejected.ok, false);
  assert.match(JSON.stringify(rejected.issues), /executed evidence receipt|receipt_ids/);

  const materialized = writePassingReport(session, SHA_A);
  assert.equal(
    checkQaReport({ session, reportPath, expectedCommit: SHA_A, requirePassing: true }).ok,
    true
  );
  fs.appendFileSync(materialized.outputPath, "forged after QA\n");
  const tampered = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(tampered.ok, false);
  assert.match(JSON.stringify(tampered.issues), /does not match retained file bytes/);

  const arbitrary = Buffer.from("all tests passed\n");
  fs.writeFileSync(materialized.outputPath, arbitrary);
  const rebound = passingReport(SHA_A, materialized.outputPath);
  rebound.receipts[0].output.sha256 = digest(arbitrary);
  rebound.receipts[0].output.bytes = arbitrary.length;
  fs.writeFileSync(reportPath, `${JSON.stringify(rebound, null, 2)}\n`);
  const unstructured = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(unstructured.ok, false);
  assert.match(JSON.stringify(unstructured.issues), /structured QA execution result/);
});

test("retained execution evidence validates bounded assertion and finding-ID prefixes", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-output-bounds-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "output-bounds", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);

  let report = passingReport(SHA_A, outputPath);
  let output = JSON.parse(qaOutput(SHA_A, "qa-run-1-tests", 2_000).toString("utf8"));
  output.assertions.push({
    id: "beyond-assertion-limit",
    status: "invalid",
    probe: "must not be inspected",
    observed: "must not be inspected",
    expected: "must not be inspected",
    finding_ids: ["beyond-finding-limit"],
  });
  let outputBytes = Buffer.from(`${JSON.stringify(output)}\n`);
  fs.writeFileSync(outputPath, outputBytes);
  report.assertions = { passed: 2_000, total: 2_000 };
  report.receipts[0].assertions = { passed: 2_000, total: 2_000 };
  report.receipts[0].output = {
    path: outputPath,
    sha256: digest(outputBytes),
    bytes: outputBytes.length,
  };
  report.runs[0].assertions = { passed: 2_000, total: 2_000 };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  let checked = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /no more than 2000 assertion results/);
  assert.doesNotMatch(JSON.stringify(checked.issues), /assertions\[2000\]|beyond-assertion-limit/);

  report = passingReport(SHA_A, outputPath);
  output = JSON.parse(qaOutput(SHA_A, "qa-run-1-tests", 1).toString("utf8"));
  output.assertions[0].finding_ids = [
    ...Array.from({ length: 1_000 }, (_, index) => `missing-finding-${index}`),
    "beyond-finding-limit",
  ];
  outputBytes = Buffer.from(`${JSON.stringify(output)}\n`);
  fs.writeFileSync(outputPath, outputBytes);
  report.assertions = { passed: 1, total: 1 };
  report.receipts[0].assertions = { passed: 1, total: 1 };
  report.receipts[0].output = {
    path: outputPath,
    sha256: digest(outputBytes),
    bytes: outputBytes.length,
  };
  report.runs[0].assertions = { passed: 1, total: 1 };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  checked = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(checked.ok, false);
  assert.equal(checked.issues.length, MAX_QA_VALIDATION_ISSUES);
  assert.match(checked.issues.at(-1).message, /validation diagnostics were capped/);
  assert.doesNotMatch(JSON.stringify(checked.issues), /beyond-finding-limit/);
});

test("retained QA evidence cannot be rebound by a path swap after inspection", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-swap", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const openedBytes = fs.readFileSync(outputPath);
  const replacementBytes = Buffer.concat([openedBytes, Buffer.from("\n")]);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.receipts[0].output.bytes = replacementBytes.length;
  report.receipts[0].output.sha256 = digest(replacementBytes);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const originalOpen = fs.openSync;
  const originalStat = fs.statSync;
  const originalFstat = fs.fstatSync;
  let evidenceDescriptor;
  let swapped = false;
  const swapAfterInspection = () => {
    if (swapped) return;
    swapped = true;
    fs.renameSync(outputPath, `${outputPath}.opened`);
    fs.writeFileSync(outputPath, replacementBytes);
  };
  fs.statSync = function patchedStat(file, ...args) {
    const stat = originalStat.call(fs, file, ...args);
    if (path.resolve(file) === outputPath) swapAfterInspection();
    return stat;
  };
  fs.openSync = function captureEvidenceDescriptor(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(String(file)) === outputPath) evidenceDescriptor = descriptor;
    return descriptor;
  };
  fs.fstatSync = function patchedFstat(descriptor, ...args) {
    const stat = originalFstat.call(fs, descriptor, ...args);
    if (descriptor === evidenceDescriptor) swapAfterInspection();
    return stat;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.statSync = originalStat;
    fs.fstatSync = originalFstat;
  }

  assert.equal(swapped, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /changed during.*validation|does not match/);
});

test("retained QA evidence cannot be rebound while its descriptor is being read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-read-swap-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-read-swap", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const openedBytes = fs.readFileSync(outputPath);

  const originalOpen = fs.openSync;
  const originalFstat = fs.fstatSync;
  const originalRead = fs.readSync;
  let evidenceDescriptor;
  let openedStat;
  let swapped = false;
  fs.openSync = function patchedOpen(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(String(file)) === outputPath && evidenceDescriptor === undefined) {
      evidenceDescriptor = descriptor;
    }
    return descriptor;
  };
  fs.fstatSync = function stableOpenedStat(descriptor, ...args) {
    const stat = originalFstat.call(fs, descriptor, ...args);
    if (descriptor !== evidenceDescriptor) return stat;
    openedStat ||= stat;
    return openedStat;
  };
  fs.readSync = function patchedRead(descriptor, buffer, offset, length, position) {
    const count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    if (descriptor === evidenceDescriptor && count > 0 && !swapped) {
      swapped = true;
      fs.renameSync(outputPath, `${outputPath}.opened`);
      fs.writeFileSync(outputPath, openedBytes);
    }
    return count;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.fstatSync = originalFstat;
    fs.readSync = originalRead;
  }

  assert.equal(swapped, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /evidence path changed during validation/);
});

test("retained QA evidence detects same-inode mutation after the descriptor read", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-final-mutation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-final-mutation", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);

  const originalOpen = fs.openSync;
  const originalFstat = fs.fstatSync;
  let evidenceDescriptor;
  let evidenceFstats = 0;
  let mutated = false;
  fs.openSync = function patchedOpen(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(String(file)) === outputPath && evidenceDescriptor === undefined) {
      evidenceDescriptor = descriptor;
    }
    return descriptor;
  };
  fs.fstatSync = function mutateAfterFinalDescriptorStat(descriptor, ...args) {
    const stat = originalFstat.call(fs, descriptor, ...args);
    if (descriptor === evidenceDescriptor && ++evidenceFstats === 2) {
      fs.appendFileSync(outputPath, " ");
      mutated = true;
    }
    return stat;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.fstatSync = originalFstat;
  }

  assert.equal(mutated, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /evidence path changed during validation/);
});

test("retained QA evidence growth is stopped at the per-file read limit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-growth-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-growth", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const maximumBytes = 16 * 1024 * 1024;
  const output = fs.readFileSync(outputPath);
  const padded = Buffer.concat([output, Buffer.alloc(maximumBytes - output.length, 0x20)]);
  fs.writeFileSync(outputPath, padded);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.receipts[0].output.bytes = padded.length;
  report.receipts[0].output.sha256 = digest(padded);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  let evidenceDescriptor;
  let grew = false;
  fs.openSync = function patchedOpen(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (path.resolve(file) === outputPath) evidenceDescriptor = descriptor;
    return descriptor;
  };
  fs.readSync = function patchedRead(descriptor, buffer, offset, length, position) {
    let count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    if (descriptor === evidenceDescriptor && count === 0 && !grew) {
      grew = true;
      fs.appendFileSync(outputPath, " ");
      count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    }
    return count;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
  }

  assert.equal(grew, true);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /1 through 16777216 bytes/);
});

test("retained QA evidence stops before reading a file beyond the aggregate limit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-total-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-total", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const maximumBytes = 16 * 1024 * 1024;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const template = report.receipts[0];
  const evidencePaths = Array.from({ length: 5 }, (_, index) => {
    const evidencePath =
      index === 0 ? outputPath : path.join(path.dirname(outputPath), `run-${index + 1}.json`);
    fs.writeFileSync(evidencePath, "{}\n");
    fs.truncateSync(evidencePath, maximumBytes);
    return evidencePath;
  });
  report.receipts = evidencePaths.map((evidencePath, index) => ({
    ...template,
    id: `qa-run-1-tests-${index + 1}`,
    output: { path: evidencePath, sha256: "a".repeat(64), bytes: maximumBytes },
  }));
  report.assertions = { passed: 60, total: 60 };
  report.runs[0].assertions = { passed: 60, total: 60 };
  report.runs[0].receipt_ids = report.receipts.map((receipt) => receipt.id);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const originalOpen = fs.openSync;
  const originalRead = fs.readSync;
  const states = new Map();
  const openedStates = [];
  const evidenceSet = new Set(evidencePaths.map((item) => path.resolve(item)));
  fs.openSync = function patchedOpen(file, ...args) {
    const descriptor = originalOpen.call(fs, file, ...args);
    if (evidenceSet.has(path.resolve(String(file)))) {
      const state = { path: path.resolve(String(file)), read: 0 };
      states.set(descriptor, state);
      openedStates.push(state);
    }
    return descriptor;
  };
  fs.readSync = function patchedRead(descriptor, buffer, offset, length, position) {
    const state = states.get(descriptor);
    const count = originalRead.call(fs, descriptor, buffer, offset, length, position);
    if (state) state.read += count;
    return count;
  };
  let checked;
  try {
    checked = checkQaReport({
      session,
      reportPath,
      expectedCommit: SHA_A,
      requirePassing: true,
    });
  } finally {
    fs.openSync = originalOpen;
    fs.readSync = originalRead;
  }

  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /retained evidence exceeds 67108864 total bytes/);
  assert.equal(
    openedStates.at(-1)?.read,
    maximumBytes,
    "the fourth in-budget file should be read completely"
  );
  assert.equal(openedStates.length, 4, "the fifth over-budget file must not be opened or read");
});

test("retained QA evidence rejects a FIFO without blocking on open", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX FIFO regression");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-retained-fifo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "retained-fifo", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  fs.unlinkSync(outputPath);
  try {
    execFileSync("mkfifo", [outputPath]);
  } catch {
    t.skip("mkfifo is unavailable");
    return;
  }

  const checkerPath = require.resolve("../scripts/lib/qa-report-schema");
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `const fs = require("node:fs");
const path = require("node:path");
const { checkQaReport } = require(process.argv[1]);
const originalOpen = fs.openSync;
let evidenceOpens = 0;
fs.openSync = function countedOpen(file, ...args) {
  if (path.resolve(String(file)) === path.resolve(process.argv[5])) evidenceOpens += 1;
  return originalOpen.call(fs, file, ...args);
};
const result = checkQaReport({
  session: JSON.parse(process.argv[2]),
  reportPath: process.argv[3],
  expectedCommit: process.argv[4],
  requirePassing: true,
});
process.stdout.write(JSON.stringify({ result, evidenceOpens }));`,
      checkerPath,
      JSON.stringify(session),
      reportPath,
      SHA_A,
      outputPath,
    ],
    { encoding: "utf8", timeout: 1_500 }
  );

  assert.notEqual(child.error?.code, "ETIMEDOUT", "FIFO validation must not block");
  assert.equal(child.status, 0, child.stderr);
  const { result: checked, evidenceOpens } = JSON.parse(child.stdout);
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /regular file/);
  assert.equal(evidenceOpens, 0, "a known non-regular path must be rejected before open");
});

test("passing QA covers the exact session criteria and critical states with current assertions", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-session-coverage", sourceDir: repo.root });
  session.task.acceptance_criteria = ["Save persists after reload", "Failure preserves input"];
  session.task.design_context = {
    ui_impact: false,
    critical_states: ["saved", "service unavailable"],
  };
  const { reportPath } = writePassingReport(session, repo.head());
  assert.equal(
    checkQaReport({
      session,
      reportPath,
      expectedCommit: repo.head(),
      requirePassing: true,
      qaCandidate: "required",
    }).ok,
    true
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.coverage.acceptance_criteria[0].target = "A plausible but different criterion";
  report.coverage.critical_states.pop();
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const drifted = checkQaReport({
    session,
    reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(drifted.ok, false);
  assert.match(JSON.stringify(drifted.issues), /exact session target|session-bound rows/);

  report.coverage = coverageForSession(session);
  report.coverage.acceptance_criteria[0].assertion_ids = ["invented-assertion"];
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const invented = checkQaReport({
    session,
    reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(invented.ok, false);
  assert.match(JSON.stringify(invented.issues), /outside the current run/);
});

test("passing QA tier is derived from the routed Dev task size", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-session-tier", sourceDir: repo.root });
  session.task.size = "M";
  const { reportPath } = writePassingReport(session, repo.head());
  assert.equal(
    checkQaReport({
      session,
      reportPath,
      expectedCommit: repo.head(),
      requirePassing: true,
      qaCandidate: "required",
    }).ok,
    true
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  report.tier = "quick";
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const weakened = checkQaReport({
    session,
    reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(weakened.ok, false);
  assert.match(JSON.stringify(weakened.issues), /must equal full for session task size M/);

  session.task.size = "S";
  report.tier = "focused";
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(
    checkQaReport({
      session,
      reportPath,
      expectedCommit: repo.head(),
      requirePassing: true,
      qaCandidate: "required",
    }).ok,
    true
  );
});

test("UI-impact QA requires current browser evidence for design context or routed risk", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-ui-browser", sourceDir: repo.root });
  session.task.design_context = { ui_impact: true, critical_states: ["empty dashboard"] };
  let written = writePassingReport(session, repo.head());
  let checked = checkQaReport({
    session,
    reportPath: written.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /browser evidence receipt|browser receipt/);

  written = writePassingReport(session, repo.head(), {
    kind: "browser",
    command: "playwright test dashboard acceptance flow",
  });
  checked = checkQaReport({
    session,
    reportPath: written.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));

  session.task.design_context = null;
  session.task.risk.ui = 1;
  writePassingReport(session, repo.head());
  checked = checkQaReport({
    session,
    reportPath: written.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /browser evidence receipt/);
});

test("optional browser screenshots are dimension- and hash-bound to their receipt", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-screenshot-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "screenshot-proof", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const screenshotPath = path.join(path.dirname(reportPath), "evidence", "dashboard.png");
  const screenshot = testPng();
  fs.writeFileSync(screenshotPath, screenshot);
  const report = passingReport(SHA_A, outputPath);
  report.receipts[0].screenshot_ids = ["dashboard-primary"];
  report.screenshots = [
    {
      id: "dashboard-primary",
      run: 1,
      commit: SHA_A,
      path: screenshotPath,
      sha256: digest(screenshot),
      bytes: screenshot.length,
      width: 10,
      height: 10,
    },
  ];
  report.findings = [
    finding({
      id: "qa-dashboard-overlap",
      category: "visual",
      evidence: {
        type: "visual",
        probe: "open the dashboard action menu",
        observed: "the menu overlaps the primary action",
        expected: "the menu leaves the primary action visible",
        screenshot: screenshotPath,
      },
    }),
  ];
  report.finding_counts.medium = 1;
  report.category_breakdown = categoryRows({ visual: 92 });
  report.health_score = 99;
  report.runs[0].health_score = 99;
  report.runs[0].finding_ids = ["qa-dashboard-overlap"];
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(
    checkQaReport({ session, reportPath, expectedCommit: SHA_A, requirePassing: true }).ok,
    true
  );

  report.screenshots[0].width = 11;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const mismatched = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });
  assert.equal(mismatched.ok, false);
  assert.match(JSON.stringify(mismatched.issues), /dimensions do not match/);
});

test("retained screenshots reject an aggregate decoded PNG budget before further inflation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-report-png-budget-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = { slug: "screenshot-budget", source: { repo_root: root } };
  const { reportPath, outputPath } = writePassingReport(session, SHA_A);
  const width = 8_000;
  const height = 4_000;
  const decodedBytesPerScreenshot = BigInt((width * 4 + 1) * height);
  assert.ok(decodedBytesPerScreenshot < 128n * 1024n * 1024n);
  assert.ok(decodedBytesPerScreenshot * 4n < BigInt(MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL));
  assert.ok(decodedBytesPerScreenshot * 5n > BigInt(MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL));

  const screenshot = testPngWithDeclaredDimensions(width, height);
  const report = passingReport(SHA_A, outputPath);
  for (let index = 1; index <= 5; index += 1) {
    const id = `large-capture-${index}`;
    const screenshotPath = path.join(path.dirname(reportPath), "evidence", `${id}.png`);
    fs.writeFileSync(screenshotPath, screenshot);
    report.receipts[0].screenshot_ids.push(id);
    report.screenshots.push({
      id,
      run: 1,
      commit: SHA_A,
      path: screenshotPath,
      sha256: digest(screenshot),
      bytes: screenshot.length,
      width,
      height,
    });
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const checked = checkQaReport({
    session,
    reportPath,
    expectedCommit: SHA_A,
    requirePassing: true,
  });

  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /cumulative decoded bytes/);
  assert.equal(
    checked.issues.filter((entry) => /must be a strict PNG screenshot/.test(entry.message)).length,
    4,
    "strict decode must run for four in-budget images and skip the rejected fifth image"
  );
});

test("screenshots have one run-and-commit owner and a per-run rather than global cap", () => {
  const report = twoRunScreenshotReport(15, 15);
  assert.deepEqual(
    validateQaReport(report, { expectedCommit: report.commit, requirePassing: true }),
    []
  );

  const tooManyInRunOne = structuredClone(report);
  const movedId = tooManyInRunOne.receipts[1].screenshot_ids.shift();
  tooManyInRunOne.receipts[0].screenshot_ids.push(movedId);
  const moved = tooManyInRunOne.screenshots.find((screenshot) => screenshot.id === movedId);
  moved.run = 1;
  moved.commit = tooManyInRunOne.runs[0].commit;
  let messages = validateQaReport(tooManyInRunOne, {
    expectedCommit: tooManyInRunOne.commit,
    requirePassing: true,
  }).map((entry) => entry.message);
  assert.ok(
    messages.some((message) => /run 1 must contain no more than 15 screenshots/.test(message))
  );

  const crossRun = structuredClone(report);
  crossRun.screenshots[0].run = 2;
  crossRun.screenshots[0].commit = crossRun.runs[1].commit;
  messages = validateQaReport(crossRun, {
    expectedCommit: crossRun.commit,
    requirePassing: true,
  }).map((entry) => entry.message);
  assert.ok(messages.some((message) => /must identify run 1/.test(message)));

  const twiceOwned = structuredClone(report);
  twiceOwned.receipts[1].screenshot_ids.pop();
  twiceOwned.receipts[1].screenshot_ids.push(twiceOwned.screenshots[0].id);
  messages = validateQaReport(twiceOwned, {
    expectedCommit: twiceOwned.commit,
    requirePassing: true,
  }).map((entry) => entry.message);
  assert.ok(messages.some((message) => /bound to exactly one receipt/.test(message)));
});

test("Dev QA phase and later recertification require the bound report artifact", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-bound", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const { reportPath } = writePassingReport(session, repo.head());

  const result = phaseResult(session, repo.head(), reportPath);
  assert.deepEqual(validateResult(session, result), []);
  const nullCommand = phaseResult(session, repo.head(), reportPath);
  nullCommand.evidence[0].command = null;
  assert.ok(
    validateResult(session, nullCommand).some((entry) =>
      /executed qa-report-check command/.test(entry.message)
    )
  );
  assert.ok(
    validateResult(session, phaseResult(session, repo.head(), null)).some((entry) =>
      /absolute report artifact path/.test(entry.message)
    )
  );
  session = recordResult(session, result);
  assert.equal(session.evidence.qa.qa_run_anchors.length, 1);

  fs.appendFileSync(path.join(repo.root, "README.md"), "final review fix\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "review fix"], { cwd: repo.root });
  const finalCommit = repo.head();
  const stale = recertificationRecord(reportPath);
  assert.throws(
    () => recertifyEvidence(session, ["qa"], finalCommit, { qa: [stale] }),
    /must equal current result commit/
  );

  writeReverifiedReport(session, finalCommit);
  const missingCandidateFlag = recertificationRecord(reportPath);
  missingCandidateFlag.command = "node scripts/qa-report-check.js";
  assert.throws(
    () => recertifyEvidence(session, ["qa"], finalCommit, { qa: [missingCandidateFlag] }),
    /must record --qa-candidate validation/
  );
  let recertified = recertifyEvidence(session, ["qa"], finalCommit, { qa: [stale] });
  assert.equal(recertified.evidence.qa.verified_commit, finalCommit);
  assert.equal(recertified.evidence.qa.verification_records[0].artifact, reportPath);
  assert.equal(recertified.evidence.qa.qa_run_count, 2);
  assert.equal(recertified.evidence.qa.qa_run_anchors.length, 2);
  assert.throws(
    () => recertifyEvidence(recertified, ["qa"], finalCommit, { qa: [stale] }),
    /exactly 3 runs: one per runner-recorded QA run plus the current candidate/
  );
  const unanchoredVerified = structuredClone(recertified);
  delete unanchoredVerified.evidence.qa.qa_run_count;
  delete unanchoredVerified.evidence.qa.qa_run_anchors;
  assert.throws(
    () => recertifyEvidence(unanchoredVerified, ["qa"], finalCommit, { qa: [stale] }),
    /without immutable run anchors/
  );
  const recovered = anchorQaHistory(unanchoredVerified, finalCommit, [
    historyAnchorRecord(reportPath),
  ]);
  assert.equal(recovered.evidence.qa.qa_run_count, 2);
  assert.equal(recovered.evidence.qa.qa_run_anchors.length, 2);
  recertified = recovered;

  fs.appendFileSync(path.join(repo.root, "README.md"), "second review fix\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "second review fix"], { cwd: repo.root });
  const secondCommit = repo.head();
  writeReverifiedReport(recertified, secondCommit);
  recertified = recertifyEvidence(recertified, ["qa"], secondCommit, { qa: [stale] });
  assert.equal(recertified.evidence.qa.qa_run_count, 3);

  for (const message of ["unrecorded review fix one\n", "unrecorded review fix two\n"]) {
    fs.appendFileSync(path.join(repo.root, "README.md"), message);
    execFileSync("git", ["add", "README.md"], { cwd: repo.root });
    execFileSync("git", ["commit", "-m", message.trim()], { cwd: repo.root });
    writeReverifiedReport(recertified, repo.head());
  }
  assert.throws(
    () => recertifyEvidence(recertified, ["qa"], repo.head(), { qa: [stale] }),
    /exactly 4 runs: one per runner-recorded QA run plus the current candidate/
  );
});

test("post-QA non-passing candidates advance only the history anchor before a fixed candidate recertifies", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-post-phase-recovery", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const initial = writePassingReport(session, repo.head());
  session = recordResult(session, phaseResult(session, repo.head(), initial.reportPath));
  assert.equal(session.evidence.qa.qa_run_count, 1);

  fs.appendFileSync(path.join(repo.root, "README.md"), "post-QA regression\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "post-QA regression"], { cwd: repo.root });
  const failingCommit = repo.head();
  writeFailingReverifiedReport(session, failingCommit);
  const failingRecord = nonPassingCandidateRecord(initial.reportPath);

  const beforeRecovery = structuredClone(session);
  assert.throws(
    () => recordNonPassingQaCandidate(session, "passed", failingCommit, [failingRecord]),
    /requires failed or blocked status/
  );
  const missingCandidateFlag = structuredClone(failingRecord);
  missingCandidateFlag.command = "node scripts/qa-report-check.js --allow-nonpassing";
  assert.throws(
    () => recordNonPassingQaCandidate(session, "failed", failingCommit, [missingCandidateFlag]),
    /must record --qa-candidate validation/
  );
  const missingNonPassingFlag = structuredClone(failingRecord);
  missingNonPassingFlag.command = "node scripts/qa-report-check.js --qa-candidate";
  assert.throws(
    () => recordNonPassingQaCandidate(session, "failed", failingCommit, [missingNonPassingFlag]),
    /must record --allow-nonpassing validation/
  );
  const stillInQa = structuredClone(session);
  stillInQa.phase = "qa";
  assert.throws(
    () => recordNonPassingQaCandidate(stillInQa, "failed", failingCommit, [failingRecord]),
    /active post-QA phase/
  );

  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  const evidencePath = path.join(path.dirname(sessionPath), "qa-nonpassing.json");
  writeSession(sessionPath, session);
  fs.writeFileSync(evidencePath, `${JSON.stringify({ qa: [failingRecord] }, null, 2)}\n`);
  const devSessionScript = path.join(__dirname, "..", "scripts", "dev-session.js");
  const cliArgs = [
    devSessionScript,
    "record-qa-nonpassing",
    "--session",
    sessionPath,
    "--status",
    "failed",
    "--commit",
    failingCommit,
    "--evidence",
    evidencePath,
    "--json",
  ];
  const closed = spawnSync(process.execPath, [...cliArgs, "--phases", "qa"], {
    encoding: "utf8",
  });
  assert.equal(closed.status, 2);
  assert.match(closed.stderr, /unexpected option for this command: --phases/);
  const recorded = spawnSync(process.execPath, cliArgs, { encoding: "utf8" });
  assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
  session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  assert.equal(session.evidence.qa.qa_run_count, 2);
  const expectedRecovery = structuredClone(beforeRecovery);
  expectedRecovery.evidence.qa.qa_run_count = 2;
  expectedRecovery.evidence.qa.qa_run_anchors = session.evidence.qa.qa_run_anchors;
  expectedRecovery.updated_at = session.updated_at;
  assert.deepEqual(session, expectedRecovery);
  assert.throws(
    () => recordNonPassingQaCandidate(session, "failed", failingCommit, [failingRecord]),
    /exactly 3 runs/
  );

  const failedGateSession = structuredClone(session);
  failedGateSession.phase = "retro";
  failedGateSession.routing.required_phases = ["retro"];
  const retroAtFailure = retroResult(failedGateSession, failingCommit);
  assert.throws(() => recordResult(failedGateSession, retroAtFailure), /required gates: qa/);

  fs.appendFileSync(path.join(repo.root, "README.md"), "fix post-QA regression\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "fix post-QA regression"], { cwd: repo.root });
  const fixedCommit = repo.head();
  writeFixedCandidateReport(session, fixedCommit);
  const passingRecord = recertificationRecord(initial.reportPath);
  assert.throws(
    () => recertifyEvidence(beforeRecovery, ["qa"], fixedCommit, { qa: [passingRecord] }),
    /exactly 2 runs/
  );
  session = recertifyEvidence(session, ["qa"], fixedCommit, { qa: [passingRecord] });
  assert.equal(session.evidence.qa.qa_run_count, 3);
  assert.equal(session.evidence.qa.qa_run_anchors.length, 3);
  assert.equal(session.evidence.qa.verified_commit, fixedCommit);

  session.phase = "retro";
  session.routing.required_phases = ["retro"];
  const completed = recordResult(session, retroResult(session, fixedCommit));
  assert.equal(completed.status, "complete");
});

test("accepted post-QA run anchors reject same-index rewrites in current and later reports", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-post-phase-rewrite", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const initial = writePassingReport(session, repo.head());
  const initialBytes = fs.readFileSync(initial.reportPath);
  session = recordResult(session, phaseResult(session, repo.head(), initial.reportPath));

  writeFailingReverifiedReport(session, repo.head());
  session = recordNonPassingQaCandidate(session, "failed", repo.head(), [
    nonPassingCandidateRecord(initial.reportPath),
  ]);
  assert.equal(session.evidence.qa.qa_run_anchors[1].verdict, "fail");

  fs.writeFileSync(initial.reportPath, initialBytes);
  writeReverifiedReport(session, repo.head());
  let checked = checkQaReport({
    session,
    reportPath: initial.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
  });
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /accepted QA run identity|accepted QA report bytes/);

  writeReverifiedReport(session, repo.head());
  checked = checkQaReport({
    session,
    reportPath: initial.reportPath,
    expectedCommit: repo.head(),
    requirePassing: true,
    qaCandidate: "required",
  });
  assert.equal(checked.ok, false);
  assert.match(JSON.stringify(checked.issues), /accepted QA run identity|accepted QA report bytes/);
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

  const { reportPath } = writePassingReport(session, repo.head());
  session.evidence.qa.records = [recertificationRecord(reportPath)];
  assert.equal(recordResult(session, result).status, "complete");
});

test("qa-report-check CLI validates the canonical session artifact", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  const session = createSession({ slug: "qa-cli", sourceDir: repo.root });
  session.phase = "qa";
  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  const { reportPath } = writePassingReport(session, repo.head());
  writeSession(sessionPath, session);
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");

  const checked = spawnSync(
    process.execPath,
    [script, "--session", sessionPath, "--report", reportPath, "--commit", repo.head()],
    { encoding: "utf8" }
  );
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).ok, true);
});

test("qa-report-check CLI exposes a closed one-run recertification candidate mode", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-cli-candidate", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const initial = writePassingReport(session, repo.head());
  session = recordResult(session, phaseResult(session, repo.head(), initial.reportPath));

  fs.appendFileSync(path.join(repo.root, "README.md"), "candidate change\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "candidate change"], { cwd: repo.root });
  writeReverifiedReport(session, repo.head());

  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  writeSession(sessionPath, session);
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");
  const args = ["--session", sessionPath, "--report", initial.reportPath, "--commit", repo.head()];

  const ordinary = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stdout, /must contain exactly 1 runs/);

  const candidate = spawnSync(process.execPath, [script, ...args, "--qa-candidate"], {
    encoding: "utf8",
  });
  assert.equal(candidate.status, 0, candidate.stderr || candidate.stdout);
  assert.equal(JSON.parse(candidate.stdout).run_count, 2);

  const duplicate = spawnSync(
    process.execPath,
    [script, ...args, "--qa-candidate", "--qa-candidate"],
    { encoding: "utf8" }
  );
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /duplicate argument --qa-candidate/);

  const unknown = spawnSync(process.execPath, [script, ...args, "--qa-candidates"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown argument --qa-candidates/);
});

test("runner-owned QA history anchoring recovers schema-v3 count-only sessions", (t) => {
  const repo = makeRepo();
  t.after(repo.cleanup);
  let session = createSession({ slug: "qa-cli-history-anchor", sourceDir: repo.root });
  session.phase = "qa";
  session.routing.required_phases = ["qa", "review", "retro"];
  session.routing.required_gates = ["qa"];
  const initial = writePassingReport(session, repo.head());
  session = recordResult(session, phaseResult(session, repo.head(), initial.reportPath));

  fs.appendFileSync(path.join(repo.root, "README.md"), "legacy recertification\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "legacy recertification"], { cwd: repo.root });
  writeReverifiedReport(session, repo.head());
  session = recertifyEvidence(session, ["qa"], repo.head(), {
    qa: [recertificationRecord(initial.reportPath)],
  });
  const staleRecordedCommit = session.evidence.qa.commit;
  const staleVerifiedCommit = session.evidence.qa.verified_commit;

  fs.appendFileSync(path.join(repo.root, "README.md"), "legacy unaudited report head\n");
  execFileSync("git", ["add", "README.md"], { cwd: repo.root });
  execFileSync("git", ["commit", "-m", "legacy unaudited report head"], { cwd: repo.root });
  writeReverifiedReport(session, repo.head());
  session.evidence.qa.qa_run_count = 3;
  delete session.evidence.qa.qa_run_anchors;
  assert.notEqual(session.evidence.qa.commit, repo.head());
  assert.notEqual(session.evidence.qa.verified_commit, repo.head());

  const sessionPath = path.join(repo.root, ".pm", "dev-sessions", session.slug, "session.json");
  const evidencePath = path.join(path.dirname(sessionPath), "qa-history-anchor.json");
  writeSession(sessionPath, session);
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify({ qa: [historyAnchorRecord(initial.reportPath)] }, null, 2)}\n`
  );
  const qaScript = path.join(__dirname, "..", "scripts", "qa-report-check.js");
  const qaArgs = [
    qaScript,
    "--session",
    sessionPath,
    "--report",
    initial.reportPath,
    "--commit",
    repo.head(),
  ];
  const ordinary = spawnSync(process.execPath, qaArgs, { encoding: "utf8" });
  assert.equal(ordinary.status, 1);
  assert.match(ordinary.stdout, /must immutably bind every accepted QA run/);
  const audit = spawnSync(process.execPath, [...qaArgs, "--qa-history-anchor"], {
    encoding: "utf8",
  });
  assert.equal(audit.status, 0, audit.stderr || audit.stdout);
  assert.equal(JSON.parse(audit.stdout).run_count, 3);
  const unboundStoredGate = structuredClone(session);
  unboundStoredGate.evidence.qa.verified_commit = SHA_A;
  assert.throws(
    () =>
      anchorQaHistory(unboundStoredGate, repo.head(), [historyAnchorRecord(initial.reportPath)]),
    /commit must identify a passing run in the audited QA history/
  );

  const devSessionScript = path.join(__dirname, "..", "scripts", "dev-session.js");
  const beforeMigration = fs.readFileSync(sessionPath);
  const unexpectedOption = spawnSync(
    process.execPath,
    [
      devSessionScript,
      "anchor-qa-history",
      "--session",
      sessionPath,
      "--commit",
      repo.head(),
      "--evidence",
      evidencePath,
      "--phases",
      "qa",
    ],
    { encoding: "utf8" }
  );
  assert.equal(unexpectedOption.status, 2);
  assert.match(unexpectedOption.stderr, /unexpected option for this command: --phases/);
  assert.deepEqual(fs.readFileSync(sessionPath), beforeMigration);

  const wrongIdentity = spawnSync(
    process.execPath,
    [
      devSessionScript,
      "anchor-qa-history",
      "--session",
      sessionPath,
      "--commit",
      SHA_A,
      "--evidence",
      evidencePath,
    ],
    { encoding: "utf8" }
  );
  assert.equal(wrongIdentity.status, 3);
  assert.match(wrongIdentity.stderr, /current at the anchor commit|anchor commit is invalid/);
  assert.deepEqual(fs.readFileSync(sessionPath), beforeMigration);

  const oversizedEvidencePath = path.join(path.dirname(sessionPath), "oversized-anchor.json");
  fs.closeSync(fs.openSync(oversizedEvidencePath, "w"));
  fs.truncateSync(oversizedEvidencePath, 4 * 1024 * 1024 + 1);
  const oversizedEvidence = spawnSync(
    process.execPath,
    [
      devSessionScript,
      "anchor-qa-history",
      "--session",
      sessionPath,
      "--commit",
      repo.head(),
      "--evidence",
      oversizedEvidencePath,
    ],
    { encoding: "utf8" }
  );
  assert.equal(oversizedEvidence.status, 2);
  assert.match(oversizedEvidence.stderr, /input must be a bounded regular file/);
  assert.deepEqual(fs.readFileSync(sessionPath), beforeMigration);

  const anchored = spawnSync(
    process.execPath,
    [
      devSessionScript,
      "anchor-qa-history",
      "--session",
      sessionPath,
      "--commit",
      repo.head(),
      "--evidence",
      evidencePath,
      "--json",
    ],
    { encoding: "utf8" }
  );
  assert.equal(anchored.status, 0, anchored.stderr || anchored.stdout);
  session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  assert.equal(session.evidence.qa.qa_run_count, 3);
  assert.equal(session.evidence.qa.qa_run_anchors.length, 3);
  assert.equal(session.evidence.qa.commit, staleRecordedCommit);
  assert.equal(session.evidence.qa.verified_commit, staleVerifiedCommit);
  assert.notEqual(session.evidence.qa.verified_commit, repo.head());
  assert.equal(spawnSync(process.execPath, qaArgs, { encoding: "utf8" }).status, 0);
  const anchoredBytes = fs.readFileSync(sessionPath);
  const idempotent = spawnSync(
    process.execPath,
    [
      devSessionScript,
      "anchor-qa-history",
      "--session",
      sessionPath,
      "--commit",
      repo.head(),
      "--evidence",
      evidencePath,
      "--json",
    ],
    { encoding: "utf8" }
  );
  assert.equal(idempotent.status, 0, idempotent.stderr || idempotent.stdout);
  assert.deepEqual(fs.readFileSync(sessionPath), anchoredBytes);

  const mixedModes = spawnSync(
    process.execPath,
    [...qaArgs, "--qa-history-anchor", "--qa-candidate"],
    { encoding: "utf8" }
  );
  assert.equal(mixedModes.status, 2);
  assert.match(mixedModes.stderr, /mutually exclusive/);
});

test("qa-report-check CLI rejects an oversized session before allocating its contents", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-session-oversized-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionPath = path.join(root, "session.json");
  fs.closeSync(fs.openSync(sessionPath, "w"));
  fs.truncateSync(sessionPath, MAX_SESSION_BYTES + 1);
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");

  const checked = spawnSync(
    process.execPath,
    [
      script,
      "--session",
      sessionPath,
      "--report",
      path.join(root, "report.json"),
      "--commit",
      SHA_A,
    ],
    { encoding: "utf8", timeout: 1_500 }
  );

  assert.notEqual(checked.error?.code, "ETIMEDOUT");
  assert.equal(checked.status, 2);
  assert.match(checked.stderr, /cannot read --session .*input must be a bounded regular file/);
});

test("qa-report-check CLI rejects a session FIFO without blocking", (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX FIFO regression");
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qa-session-fifo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionPath = path.join(root, "session.json");
  try {
    execFileSync("mkfifo", [sessionPath]);
  } catch {
    t.skip("mkfifo is unavailable");
    return;
  }
  const script = path.join(__dirname, "..", "scripts", "qa-report-check.js");

  const checked = spawnSync(
    process.execPath,
    [
      script,
      "--session",
      sessionPath,
      "--report",
      path.join(root, "report.json"),
      "--commit",
      SHA_A,
    ],
    { encoding: "utf8", timeout: 1_500 }
  );

  assert.notEqual(checked.error?.code, "ETIMEDOUT", "session FIFO validation must not block");
  assert.equal(checked.status, 2, checked.stderr || checked.stdout);
  assert.match(checked.stderr, /cannot read --session .*input must be a bounded regular file/);
});

function passingReport(commit, outputPath = "/tmp/qa/evidence/run-1.tap", options = {}) {
  const kind = options.kind || "deterministic";
  const command = options.command || QA_COMMAND;
  const output = qaOutput(commit, "qa-run-1-tests", 12, 0, { ...options, kind, command });
  return {
    schema_version: 2,
    commit,
    verdict: "pass",
    health_score: 100,
    tier: "full",
    platform: "web",
    assertions: { passed: 12, total: 12 },
    finding_counts: { critical: 0, high: 0, medium: 0, low: 0 },
    findings: [],
    category_breakdown: categoryRows(),
    coverage: { acceptance_criteria: [], critical_states: [] },
    receipts: [
      {
        id: "qa-run-1-tests",
        run: 1,
        kind,
        commit,
        command,
        exit_code: 0,
        assertions: { passed: 12, total: 12 },
        output: {
          path: outputPath,
          sha256: digest(output),
          bytes: output.length,
        },
        screenshot_ids: [],
      },
    ],
    screenshots: [],
    runs: [
      {
        run: 1,
        kind: "initial",
        commit,
        checked_at: "2026-09-04T01:00:00.000Z",
        verdict: "pass",
        health_score: 100,
        assertions: { passed: 12, total: 12 },
        finding_ids: [],
        receipt_ids: ["qa-run-1-tests"],
      },
    ],
  };
}

function writePassingReport(session, commit, options = {}) {
  const reportPath = expectedQaReportPath(session);
  const outputPath = path.join(path.dirname(reportPath), "evidence", "run-1.json");
  const output = qaOutput(commit, "qa-run-1-tests", 12, 0, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  const report = passingReport(commit, outputPath, options);
  report.coverage = coverageForSession(session);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, outputPath };
}

function writeFailingReport(session, commit, verdict = "fail") {
  const reportPath = expectedQaReportPath(session);
  const outputPath = path.join(path.dirname(reportPath), "evidence", "run-1.json");
  const options = { idPrefix: "prior", findingIds: ["qa-core-flow"] };
  const output = qaOutput(commit, "qa-run-1-tests", 12, 1, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output);
  const report = passingReport(commit, outputPath, options);
  report.verdict = verdict;
  report.health_score = 96;
  report.assertions = { passed: 10, total: 12 };
  report.findings = [finding({ id: "qa-core-flow", severity: "high" })];
  report.finding_counts.high = 1;
  report.category_breakdown = categoryRows({ functional: 85 });
  report.coverage = coverageForSession(session);
  Object.assign(report.receipts[0], {
    exit_code: 1,
    assertions: { passed: 10, total: 12 },
    output: { path: outputPath, sha256: digest(output), bytes: output.length },
  });
  Object.assign(report.runs[0], {
    verdict,
    health_score: 96,
    assertions: { passed: 10, total: 12 },
    finding_ids: ["qa-core-flow"],
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, outputPath };
}

function writeFixedReverifiedReport(session, commit) {
  const reportPath = expectedQaReportPath(session);
  const previousBytes = fs.readFileSync(reportPath);
  const previous = JSON.parse(previousBytes);
  const evidenceRoot = path.join(path.dirname(reportPath), "evidence");
  const snapshotPath = path.join(evidenceRoot, "report-run-1.json");
  fs.writeFileSync(snapshotPath, previousBytes);
  const receiptId = "qa-run-2-tests";
  const outputPath = path.join(evidenceRoot, "run-2.json");
  const output = qaOutput(commit, receiptId, 12, 0, {
    idPrefix: "current",
    findingIds: ["qa-core-flow"],
  });
  fs.writeFileSync(outputPath, output);
  const report = structuredClone(previous);
  report.commit = commit;
  report.verdict = "pass";
  report.health_score = 100;
  report.assertions = { passed: 12, total: 12 };
  report.findings = report.findings.map((entry) => ({ ...entry, disposition: "fixed" }));
  report.finding_counts.high = 0;
  report.category_breakdown = categoryRows();
  report.coverage = coverageForSession(session);
  report.receipts.push({
    id: receiptId,
    run: 2,
    kind: "deterministic",
    commit,
    command: QA_COMMAND,
    exit_code: 0,
    assertions: { passed: 12, total: 12 },
    output: { path: outputPath, sha256: digest(output), bytes: output.length },
    screenshot_ids: [],
  });
  report.runs.push({
    run: 2,
    kind: "reverify",
    commit,
    checked_at: "2026-09-04T02:00:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 12, total: 12 },
    finding_ids: ["qa-core-flow"],
    receipt_ids: [receiptId],
    previous_verdict: "fail",
    previous_health_score: 96,
    fixed_finding_ids: ["qa-core-flow"],
    still_open_finding_ids: [],
    new_finding_ids: [],
    fixed_finding_evidence: [{ finding_id: "qa-core-flow", assertion_ids: ["current-1"] }],
    previous_report: {
      path: snapshotPath,
      sha256: digest(previousBytes),
      bytes: previousBytes.length,
    },
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, outputPath, snapshotPath };
}

function writeReverifiedReport(session, commit) {
  const reportPath = expectedQaReportPath(session);
  const previousBytes = fs.readFileSync(reportPath);
  const previous = JSON.parse(previousBytes);
  const run = previous.runs.length + 1;
  const evidenceRoot = path.join(path.dirname(reportPath), "evidence");
  const snapshotPath = path.join(evidenceRoot, `report-run-${run - 1}.json`);
  fs.writeFileSync(snapshotPath, previousBytes);
  const receiptId = `qa-run-${run}-tests`;
  const outputPath = path.join(evidenceRoot, `run-${run}.json`);
  const output = qaOutput(commit, receiptId);
  fs.writeFileSync(outputPath, output);
  const next = structuredClone(previous);
  next.commit = commit;
  next.verdict = "pass";
  next.health_score = 100;
  next.assertions = { passed: 12, total: 12 };
  next.coverage = coverageForSession(session);
  next.receipts.push({
    id: receiptId,
    run,
    kind: "deterministic",
    commit,
    command: QA_COMMAND,
    exit_code: 0,
    assertions: { passed: 12, total: 12 },
    output: { path: outputPath, sha256: digest(output), bytes: output.length },
    screenshot_ids: [],
  });
  next.runs.push({
    run,
    kind: "reverify",
    commit,
    checked_at: "2026-09-04T02:00:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 12, total: 12 },
    finding_ids: next.findings.map((finding) => finding.id),
    receipt_ids: [receiptId],
    previous_verdict: previous.verdict,
    previous_health_score: previous.health_score,
    fixed_finding_ids: [],
    still_open_finding_ids: previous.findings
      .filter((finding) => finding.disposition === "open")
      .map((finding) => finding.id),
    new_finding_ids: [],
    fixed_finding_evidence: [],
    previous_report: {
      path: snapshotPath,
      sha256: digest(previousBytes),
      bytes: previousBytes.length,
    },
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(next, null, 2)}\n`);
  return { reportPath, outputPath, snapshotPath };
}

function writeFailingReverifiedReport(session, commit) {
  const reportPath = expectedQaReportPath(session);
  const previousBytes = fs.readFileSync(reportPath);
  const previous = JSON.parse(previousBytes);
  const run = previous.runs.length + 1;
  const evidenceRoot = path.join(path.dirname(reportPath), "evidence");
  const snapshotPath = path.join(evidenceRoot, `report-run-${run - 1}.json`);
  fs.writeFileSync(snapshotPath, previousBytes);
  const findingId = "qa-post-phase-regression";
  const receiptId = `qa-run-${run}-tests`;
  const outputPath = path.join(evidenceRoot, `run-${run}.json`);
  const output = qaOutput(commit, receiptId, 12, 1, {
    idPrefix: "regression",
    findingIds: [findingId],
  });
  fs.writeFileSync(outputPath, output);
  const next = structuredClone(previous);
  next.commit = commit;
  next.verdict = "fail";
  next.health_score = 96;
  next.assertions = { passed: 10, total: 12 };
  next.findings.push(finding({ id: findingId, severity: "high" }));
  next.finding_counts.high += 1;
  next.category_breakdown = categoryRows({ functional: 85 });
  next.coverage = coverageForSession(session);
  next.receipts.push({
    id: receiptId,
    run,
    kind: "deterministic",
    commit,
    command: QA_COMMAND,
    exit_code: 1,
    assertions: { passed: 10, total: 12 },
    output: { path: outputPath, sha256: digest(output), bytes: output.length },
    screenshot_ids: [],
  });
  next.runs.push({
    run,
    kind: "reverify",
    commit,
    checked_at: "2026-09-04T02:00:00.000Z",
    verdict: "fail",
    health_score: 96,
    assertions: { passed: 10, total: 12 },
    finding_ids: [findingId],
    receipt_ids: [receiptId],
    previous_verdict: previous.verdict,
    previous_health_score: previous.health_score,
    fixed_finding_ids: [],
    still_open_finding_ids: [],
    new_finding_ids: [findingId],
    fixed_finding_evidence: [],
    previous_report: {
      path: snapshotPath,
      sha256: digest(previousBytes),
      bytes: previousBytes.length,
    },
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(next, null, 2)}\n`);
  return { reportPath, outputPath, snapshotPath };
}

function writeFixedCandidateReport(session, commit) {
  const reportPath = expectedQaReportPath(session);
  const previousBytes = fs.readFileSync(reportPath);
  const previous = JSON.parse(previousBytes);
  const run = previous.runs.length + 1;
  const evidenceRoot = path.join(path.dirname(reportPath), "evidence");
  const snapshotPath = path.join(evidenceRoot, `report-run-${run - 1}.json`);
  fs.writeFileSync(snapshotPath, previousBytes);
  const findingId = "qa-post-phase-regression";
  const receiptId = `qa-run-${run}-tests`;
  const outputPath = path.join(evidenceRoot, `run-${run}.json`);
  const output = qaOutput(commit, receiptId, 12, 0, {
    idPrefix: "fixed",
    findingIds: [findingId],
  });
  fs.writeFileSync(outputPath, output);
  const next = structuredClone(previous);
  next.commit = commit;
  next.verdict = "pass";
  next.health_score = 100;
  next.assertions = { passed: 12, total: 12 };
  next.findings = next.findings.map((entry) =>
    entry.id === findingId ? { ...entry, disposition: "fixed" } : entry
  );
  next.finding_counts.high -= 1;
  next.category_breakdown = categoryRows();
  next.coverage = coverageForSession(session);
  next.receipts.push({
    id: receiptId,
    run,
    kind: "deterministic",
    commit,
    command: QA_COMMAND,
    exit_code: 0,
    assertions: { passed: 12, total: 12 },
    output: { path: outputPath, sha256: digest(output), bytes: output.length },
    screenshot_ids: [],
  });
  next.runs.push({
    run,
    kind: "reverify",
    commit,
    checked_at: "2026-09-04T03:00:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 12, total: 12 },
    finding_ids: [findingId],
    receipt_ids: [receiptId],
    previous_verdict: previous.verdict,
    previous_health_score: previous.health_score,
    fixed_finding_ids: [findingId],
    still_open_finding_ids: [],
    new_finding_ids: [],
    fixed_finding_evidence: [{ finding_id: findingId, assertion_ids: ["fixed-1"] }],
    previous_report: {
      path: snapshotPath,
      sha256: digest(previousBytes),
      bytes: previousBytes.length,
    },
  });
  fs.writeFileSync(reportPath, `${JSON.stringify(next, null, 2)}\n`);
  return { reportPath, outputPath, snapshotPath };
}

function coverageForSession(session) {
  const assertionIds = ["acceptance-1"];
  const criticalStates = [];
  const seen = new Set();
  for (const context of [
    session.task?.design_context,
    ...(Array.isArray(session.task?.work_units)
      ? session.task.work_units.map((unit) => unit?.contract?.design_context)
      : []),
  ]) {
    for (const state of Array.isArray(context?.critical_states) ? context.critical_states : []) {
      if (!seen.has(state)) {
        seen.add(state);
        criticalStates.push(state);
      }
    }
  }
  const rows = (targets) =>
    targets.map((target, index) => ({ index, target, assertion_ids: assertionIds }));
  return {
    acceptance_criteria: rows(
      Array.isArray(session.task?.acceptance_criteria) ? session.task.acceptance_criteria : []
    ),
    critical_states: rows(criticalStates),
  };
}

function twoRunScreenshotReport(runOneCount, runTwoCount) {
  const SHA_B = "b".repeat(40);
  const report = passingReport(SHA_B, "/tmp/qa/evidence/run-2.json");
  report.receipts[0] = {
    ...report.receipts[0],
    id: "qa-run-1-browser",
    run: 1,
    kind: "browser",
    commit: SHA_A,
    command: "playwright test historical flow",
    assertions: { passed: 1, total: 1 },
    output: {
      path: "/tmp/qa/evidence/run-1.json",
      sha256: "c".repeat(64),
      bytes: 1024,
    },
    screenshot_ids: [],
  };
  report.receipts.push({
    id: "qa-run-2-browser",
    run: 2,
    kind: "browser",
    commit: SHA_B,
    command: "playwright test current flow",
    exit_code: 0,
    assertions: { passed: 1, total: 1 },
    output: {
      path: "/tmp/qa/evidence/run-2.json",
      sha256: "d".repeat(64),
      bytes: 1024,
    },
    screenshot_ids: [],
  });
  report.runs[0] = {
    ...report.runs[0],
    commit: SHA_A,
    assertions: { passed: 1, total: 1 },
    receipt_ids: ["qa-run-1-browser"],
  };
  report.runs.push({
    run: 2,
    kind: "reverify",
    commit: SHA_B,
    checked_at: "2026-09-04T02:00:00.000Z",
    verdict: "pass",
    health_score: 100,
    assertions: { passed: 1, total: 1 },
    finding_ids: [],
    receipt_ids: ["qa-run-2-browser"],
    previous_verdict: "pass",
    previous_health_score: 100,
    fixed_finding_ids: [],
    still_open_finding_ids: [],
    new_finding_ids: [],
    fixed_finding_evidence: [],
    previous_report: {
      path: "/tmp/qa/evidence/report-run-1.json",
      sha256: "e".repeat(64),
      bytes: 1024,
    },
  });
  report.assertions = { passed: 1, total: 1 };
  report.screenshots = [];
  for (const [run, count, commit, receipt] of [
    [1, runOneCount, SHA_A, report.receipts[0]],
    [2, runTwoCount, SHA_B, report.receipts[1]],
  ]) {
    for (let index = 1; index <= count; index += 1) {
      const id = `run-${run}-shot-${index}`;
      const screenshotPath = `/tmp/qa/evidence/${id}.png`;
      receipt.screenshot_ids.push(id);
      report.screenshots.push({
        id,
        run,
        commit,
        path: screenshotPath,
        sha256: "f".repeat(64),
        bytes: 1024,
        width: 10,
        height: 10,
      });
    }
  }
  return report;
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function testPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(10, 0);
  header.writeUInt32BE(10, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((10 * 4 + 1) * 10);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.alloc(1024, 0x61)),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function testPngWithDeclaredDimensions(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("tEXt", Buffer.alloc(1024, 0x61)),
    pngChunk("IDAT", zlib.deflateSync(Buffer.from([0]))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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
    command: "node scripts/qa-report-check.js --qa-candidate",
    exit_code: 0,
    artifact: reportPath,
  };
}

function nonPassingCandidateRecord(reportPath) {
  return {
    kind: "test",
    command: "node scripts/qa-report-check.js --qa-candidate --allow-nonpassing",
    exit_code: 0,
    artifact: reportPath,
  };
}

function historyAnchorRecord(reportPath) {
  return {
    kind: "test",
    command: "node scripts/qa-report-check.js --qa-history-anchor",
    exit_code: 0,
    artifact: reportPath,
  };
}

function retroResult(session, commit) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: "retro",
    attempt: session.phase_attempt,
    status: "passed",
    summary: "Retrospective complete",
    commit,
    files_changed: [],
    evidence: [{ kind: "retro", command: "retro", exit_code: 0, artifact: null }],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
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
