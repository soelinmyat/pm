"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createNativeRuntime } = require("../scripts/productmemory-native-runtime");
const { expectedQaReportPath, checkQaReport } = require("../scripts/lib/qa-report-schema");
const { DIMENSION_NAMES } = require("../scripts/lib/dev-risk");
const { sha } = require("../scripts/lib/native-dev-contract");
const {
  bindCurrentReviewContract,
  materializeProposalSources,
} = require("./helpers/groom-review-fixture");
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-qa-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.com");
  git("config", "user.name", "Fixture");
  fs.writeFileSync(path.join(root, "code.txt"), "code");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  git("add", ".");
  git("commit", "-qm", "baseline");
  git("checkout", "-qb", "structured-groom");
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "remote-contract-"));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  const proposal = bindCurrentReviewContract(
    structuredClone(require("./fixtures/proposals/strong-v1.json"))
  );
  // A reviewed QA route can cover existing UI behavior while this proposal's
  // implementation contract itself remains nonvisual.
  proposal.design_requirements = [
    {
      id: "design:cli-errors",
      requirement: "Return stable CLI exit codes with actionable errors.",
    },
  ];
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((row) => row.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["success", "invalid input", "service unavailable"],
    experience_invariants: ["Failures return a stable nonzero exit code and next action."],
    visual_invariants: [],
  };
  materializeProposalSources(source, proposal);
  const rfc = {
    schema_version: 3,
    slug: proposal.slug,
    title: "Native implementation",
    size: proposal.size,
    design_context: proposal.design_context,
    issues: [
      {
        num: 1,
        title: "Implement contract",
        size: "M",
        depends_on: [],
        owns: ["code.txt"],
        acceptance_criteria: ["Source and approval stay bound"],
        approach: "Implement source binding",
        verification_commands: ["node --test"],
        test_hooks: ["Unit -> source binding"],
      },
    ],
    test_strategy: {
      test_levels: "Unit and integration",
      new_infrastructure: "None",
      regression_surface: "Approval binding",
      verification_commands: "node --test",
      open_questions: "None",
    },
  };
  const execution = {
    schema_version: 1,
    kind: "proposal",
    ui_platform: "web",
    risk: {
      ...Object.fromEntries(
        DIMENSION_NAMES.map((name) => [name, ["behavioral", "ui"].includes(name) ? 1 : 0])
      ),
      destructive_data: false,
    },
  };
  const documents = new Map([
    ["pm/proposal.json", Buffer.from(JSON.stringify(proposal))],
    ["pm/rfc.json", Buffer.from(JSON.stringify(rfc))],
    ["pm/execution.json", Buffer.from(JSON.stringify(execution))],
  ]);
  for (const item of proposal.source.lineage)
    documents.set(item.path, fs.readFileSync(path.join(source, item.path)));
  const entries = [...documents]
    .map(([document, bytes], index) => ({
      path: document,
      role:
        document === "pm/proposal.json"
          ? "proposal"
          : document === "pm/rfc.json"
            ? "rfc"
            : "supporting",
      revision: 1,
      knowledge_version_id: index + 1,
      content_hash: sha(bytes),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const workflow = {
    id: 1,
    project: "cleanlog",
    record_id: "bkl_NATIVE",
    revision: 5,
    status: "planned",
    owner_id: 2,
    dependencies: [],
    bundle: {
      id: 4,
      digest: "b".repeat(64),
      current: true,
      review: { id: 7, user: "second-person@example.com", decision: "approved" },
      entries,
    },
    sessions: [],
  };
  const calls = [];
  const transport = {
    identity: { service_url: "https://productmemory.io", project: "cleanlog" },
    request: async (input) => {
      calls.push(input);
      const url = new URL(input.path, transport.identity.service_url);
      if (url.pathname === "/api/v1/knowledge_file") {
        const bytes = documents.get(url.searchParams.get("path"));
        return {
          status: 200,
          body: {
            path: url.searchParams.get("path"),
            revision: 1,
            content_hash: sha(bytes),
            byte_size: bytes.length,
            content_base64: bytes.toString("base64"),
          },
        };
      }
      if (input.method === "PATCH") {
        const session = workflow.sessions[0];
        Object.assign(session, {
          state: input.body.state,
          result_commit: input.body.result_commit,
          verification: input.body.verification,
          revision: session.revision + 1,
        });
        workflow.revision++;
        return {
          status: 200,
          body: { workflow: structuredClone(workflow), session: structuredClone(session) },
        };
      }
      if (input.method === "POST") {
        const session = {
          id: 9,
          revision: 1,
          feature_workflow_id: 1,
          feature_bundle_id: 4,
          feature_bundle_review_id: 7,
          owner_id: 2,
          state: "running",
          ...input.body,
        };
        workflow.revision++;
        workflow.status = "in-progress";
        workflow.sessions = [session];
        return { status: 200, body: { workflow: structuredClone(workflow), session } };
      }
      return { status: 200, body: structuredClone(workflow) };
    },
  };
  return {
    root,
    git,
    workflow,
    documents,
    calls,
    transport,
    options: {
      sourceDir: root,
      slug: proposal.slug,
      recordId: workflow.record_id,
      executionPath: "pm/execution.json",
    },
  };
}

const QA_COMMAND = "browser native QA observation fixture";
const categories = (failed) =>
  ["console", "links", "visual", "functional", "ux", "performance", "accessibility"].map(
    (category) => ({ category, score: failed && category === "functional" ? 85 : 100 })
  );
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const readSession = (f) => JSON.parse(fs.readFileSync(f.sessionPath));

async function qaFixture(t) {
  const f = fixture(t);
  f.runtime = createNativeRuntime(f.transport);
  const initialized = await f.runtime.initialize(f.options);
  f.sessionPath = initialized.session_path;
  // Seed the checkpoint being tested, preserving the bootstrap's approved
  // contract and routing. Earlier implementation phases have separate coverage.
  initialized.session.phase = "qa";
  writeJson(f.sessionPath, initialized.session);
  assert.ok(initialized.session.routing.required_phases.includes("qa"));
  assert.equal((await f.runtime.decision(f.sessionPath)).phase, "qa");
  f.head = () => f.git("rev-parse", "HEAD");
  f.commit = (message) => {
    fs.appendFileSync(path.join(f.root, "code.txt"), `\n${message}`);
    f.git("add", "code.txt");
    f.git("commit", "-qm", message);
    return f.head();
  };
  return f;
}

// The observation payload is a fixture; the retained-file, report, run-ledger,
// commit, coverage and native phase validators are the real implementations.
function appendQaReport(f, verdict = "pass") {
  const session = readSession(f);
  const reportPath = expectedQaReportPath(session);
  const previousBytes = fs.existsSync(reportPath) ? fs.readFileSync(reportPath) : null;
  const previous = previousBytes ? JSON.parse(previousBytes) : null;
  const run = (previous?.runs.length || 0) + 1;
  const commit = f.head();
  const failing = ["fail", "blocked"].includes(verdict);
  const fixing = !failing && previous?.findings.some((row) => row.disposition === "open");
  const findingId = "qa-native-regression";
  const receiptId = `qa-run-${run}-browser`;
  const firstAssertion = `run-${run}-1`;
  const evidenceRoot = path.join(path.dirname(reportPath), "evidence");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const outputPath = path.join(evidenceRoot, `run-${run}.json`);
  const output = Buffer.from(
    JSON.stringify({
      schema_version: 1,
      assurance: "workflow-attested-non-cryptographic",
      receipt_id: receiptId,
      commit,
      kind: "browser",
      command: QA_COMMAND,
      exit_code: failing ? 1 : 0,
      assertions: Array.from({ length: 12 }, (_, index) => ({
        id: `run-${run}-${index + 1}`,
        status: failing && index >= 10 ? "failed" : "passed",
        probe: `native QA fixture assertion ${index + 1}`,
        observed: failing && index >= 10 ? "regression observed" : "expected state observed",
        expected: "expected state observed",
        finding_ids: failing || fixing ? [findingId] : [],
      })),
    })
  );
  fs.writeFileSync(outputPath, output);
  const assertions = { passed: failing ? 10 : 12, total: 12 };
  const findings = structuredClone(previous?.findings || []);
  if (failing)
    findings.push({
      id: findingId,
      severity: "high",
      category: "functional",
      summary: "The native QA fixture observed a failed acceptance assertion",
      route: "/native-fixture",
      evidence: {
        type: "assertion",
        probe: "native fixture action",
        observed: "regression observed",
        expected: "expected state observed",
        screenshot: null,
      },
      disposition: "open",
    });
  if (fixing)
    findings.forEach((row) => {
      row.disposition = "fixed";
    });
  const critical = [
    ...new Set([
      ...session.task.design_context.critical_states,
      ...session.task.work_units.flatMap(
        (unit) => unit.contract.design_context?.critical_states || []
      ),
    ]),
  ];
  const coverage = (targets) =>
    targets.map((target, index) => ({
      index,
      target,
      assertion_ids: [firstAssertion],
    }));
  const receipt = {
    id: receiptId,
    run,
    kind: "browser",
    commit,
    command: QA_COMMAND,
    exit_code: failing ? 1 : 0,
    assertions,
    output: { path: outputPath, sha256: sha(output), bytes: output.length },
    screenshot_ids: [],
  };
  const runRecord = {
    run,
    kind: previous ? "reverify" : "initial",
    commit,
    checked_at: `2026-10-01T${String(run).padStart(2, "0")}:00:00.000Z`,
    verdict,
    health_score: failing ? 96 : 100,
    assertions,
    finding_ids: findings.map((row) => row.id),
    receipt_ids: [receiptId],
  };
  if (previous) {
    const snapshotPath = path.join(evidenceRoot, `report-run-${run - 1}.json`);
    fs.writeFileSync(snapshotPath, previousBytes);
    Object.assign(runRecord, {
      previous_verdict: previous.verdict,
      previous_health_score: previous.health_score,
      fixed_finding_ids: fixing ? [findingId] : [],
      still_open_finding_ids: [],
      new_finding_ids: failing ? [findingId] : [],
      fixed_finding_evidence: fixing
        ? [{ finding_id: findingId, assertion_ids: [firstAssertion] }]
        : [],
      previous_report: {
        path: snapshotPath,
        sha256: sha(previousBytes),
        bytes: previousBytes.length,
      },
    });
  }
  const report = {
    schema_version: 2,
    commit,
    verdict,
    health_score: failing ? 96 : 100,
    tier: "full",
    platform: "web",
    assertions,
    finding_counts: { critical: 0, high: failing ? 1 : 0, medium: 0, low: 0 },
    findings,
    category_breakdown: categories(failing),
    coverage: {
      acceptance_criteria: coverage(session.task.acceptance_criteria),
      critical_states: coverage(critical),
    },
    receipts: [...(previous?.receipts || []), receipt],
    screenshots: [],
    runs: [...(previous?.runs || []), runRecord],
  };
  writeJson(reportPath, report);
  const checked = checkQaReport({
    session,
    reportPath,
    expectedCommit: commit,
    requirePassing: !failing,
    qaCandidate: "required",
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.issues));
  return reportPath;
}

function qaRecord(reportPath, flags = "") {
  return {
    kind: "test",
    command: `node scripts/qa-report-check.js ${flags}`.trim(),
    exit_code: 0,
    artifact: reportPath,
  };
}
async function recordQa(f, reportPath, status = "passed") {
  const session = readSession(f);
  return f.runtime.record(f.sessionPath, {
    schema_version: 1,
    run_id: session.run_id,
    phase: "qa",
    attempt: session.phase_attempt,
    status,
    summary: `Native QA ${status}`,
    commit: f.head(),
    files_changed: [],
    evidence: [qaRecord(reportPath, status === "passed" ? "" : "--allow-nonpassing")],
    blocker:
      status === "blocked"
        ? {
            code: "qa-environment",
            reason: "QA observation was blocked",
            remediation: "Restore the fixture environment",
          }
        : null,
    runtime: { provider: "codex", model: "fixture", reasoning: "high" },
  });
}
const recertifyQa = (f, reportPath) =>
  f.runtime.recertifyEvidence(f.sessionPath, {
    phases: ["qa"],
    commit: f.head(),
    verificationByPhase: { qa: [qaRecord(reportPath, "--qa-candidate")] },
  });

async function passedQaFixture(t) {
  const f = await qaFixture(t);
  f.reportPath = appendQaReport(f);
  f.session = await recordQa(f, f.reportPath);
  assert.equal(f.session.phase, "review");
  return f;
}

test("native QA passes to review and recertifies fresh HEAD with immutable history", async (t) => {
  const f = await passedQaFixture(t);
  const initial = structuredClone(f.session.evidence.qa);
  const before = fs.readFileSync(f.sessionPath);
  const commit = f.commit("QA review fix");
  await assert.rejects(recertifyQa(f, f.reportPath), /current result commit/);
  assert.deepEqual(fs.readFileSync(f.sessionPath), before);
  appendQaReport(f);
  const next = await recertifyQa(f, f.reportPath);
  assert.equal(next.phase, "review");
  assert.equal(next.evidence.qa.commit, initial.commit);
  assert.equal(next.evidence.qa.verified_commit, commit);
  assert.equal(next.evidence.qa.qa_run_count, 2);
  assert.deepEqual(next.evidence.qa.qa_run_anchors[0], initial.qa_run_anchors[0]);
  assert.deepEqual(next.evidence.qa.records, initial.records);
  const saved = fs.readFileSync(f.sessionPath);
  await assert.rejects(recertifyQa(f, f.reportPath), /exactly 3 runs/);
  assert.deepEqual(fs.readFileSync(f.sessionPath), saved);
  // Compatibility recovery must reconstruct real audited history, not invent it.
  delete next.evidence.qa.qa_run_count;
  delete next.evidence.qa.qa_run_anchors;
  writeJson(f.sessionPath, next);
  const anchored = await f.runtime.anchorQaHistory(f.sessionPath, {
    commit,
    records: [qaRecord(f.reportPath, "--qa-history-anchor")],
  });
  assert.equal(anchored.evidence.qa.qa_run_count, 2);
  assert.deepEqual(anchored.evidence.qa.qa_run_anchors[0], initial.qa_run_anchors[0]);
  const history = JSON.parse(fs.readFileSync(f.reportPath)).runs[1].previous_report;
  const old = fs.readFileSync(history.path);
  fs.appendFileSync(history.path, " ");
  const anchoredBytes = fs.readFileSync(f.sessionPath);
  await assert.rejects(
    f.runtime.anchorQaHistory(f.sessionPath, {
      commit,
      records: [qaRecord(f.reportPath, "--qa-history-anchor")],
    }),
    /history|hash|digest|bytes|snapshot/i
  );
  assert.deepEqual(fs.readFileSync(f.sessionPath), anchoredBytes);
  fs.writeFileSync(history.path, old);
});

for (const status of ["failed", "blocked"]) {
  test(`native ${status} post-QA candidate retains its ledger before fixed recertification`, async (t) => {
    const f = await passedQaFixture(t);
    const initial = structuredClone(f.session.evidence.qa);
    f.commit(`${status} QA candidate`);
    appendQaReport(f, status === "failed" ? "fail" : "blocked");
    const recorded = await f.runtime.recordNonPassingQaCandidate(f.sessionPath, {
      status,
      commit: f.head(),
      records: [qaRecord(f.reportPath, "--qa-candidate --allow-nonpassing")],
    });
    assert.equal(recorded.phase, "review");
    assert.equal(recorded.status, "active");
    assert.equal(recorded.evidence.qa.commit, initial.commit);
    assert.deepEqual(recorded.evidence.qa.records, initial.records);
    assert.equal(recorded.evidence.qa.qa_run_count, 2);
    assert.equal(
      recorded.evidence.qa.qa_run_anchors[1].verdict,
      status === "failed" ? "fail" : "blocked"
    );
    const fixedCommit = f.commit("Fix QA candidate regression");
    appendQaReport(f);
    const fixed = await recertifyQa(f, f.reportPath);
    assert.equal(fixed.evidence.qa.verified_commit, fixedCommit);
    assert.equal(fixed.evidence.qa.qa_run_count, 3);
    assert.deepEqual(
      fixed.evidence.qa.qa_run_anchors.slice(0, 2),
      recorded.evidence.qa.qa_run_anchors
    );
  });
}

test("native blocked QA resumes and records a fixed passing rerun", async (t) => {
  const f = await qaFixture(t);
  const reportPath = appendQaReport(f, "blocked");
  const blocked = await recordQa(f, reportPath, "blocked");
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.evidence.qa.commit, null);
  const resumed = await f.runtime.resumeBlocked(f.sessionPath, "Restored the fixture environment");
  assert.equal(resumed.status, "active");
  assert.ok(resumed.blockers[0].resolved_at);
  assert.equal(resumed.blockers[0].resolution, "Restored the fixture environment");
  f.commit("Restore QA environment");
  appendQaReport(f);
  const passed = await recordQa(f, reportPath);
  assert.equal(passed.phase, "review");
  assert.equal(passed.evidence.qa.qa_run_count, 2);
  assert.deepEqual(passed.evidence.qa.qa_run_anchors[0], blocked.evidence.qa.qa_run_anchors[0]);
});

test("native QA recertification rechecks authority after evidence validation before saving", async (t) => {
  const f = await passedQaFixture(t);
  f.commit("QA authority race candidate");
  appendQaReport(f);
  const before = fs.readFileSync(f.sessionPath);
  const request = f.transport.request;
  let workflowReads = 0;
  f.transport.request = async (input) => {
    if (input.method === "GET" && input.path.includes("/feature_workflow?")) {
      workflowReads++;
      if (workflowReads === 2) f.workflow.owner_id++;
    }
    return request(input);
  };
  const callCount = f.calls.length;
  await assert.rejects(recertifyQa(f, f.reportPath), /approval, scope, owner/);
  assert.equal(workflowReads, 2, "authority must be read again after canonical QA validation");
  assert.deepEqual(fs.readFileSync(f.sessionPath), before);
  assert.ok(f.calls.slice(callCount).every((call) => call.method === "GET"));
});

for (const operation of [
  "recertifyEvidence",
  "recordNonPassingQaCandidate",
  "anchorQaHistory",
  "resumeBlocked",
]) {
  test(`native ${operation} rejects stale remote authority without local mutation`, async (t) => {
    const f = await passedQaFixture(t);
    const before = fs.readFileSync(f.sessionPath);
    const reportBefore = fs.readFileSync(f.reportPath);
    f.workflow.owner_id++;
    const input =
      operation === "recertifyEvidence"
        ? {
            phases: ["qa"],
            commit: f.head(),
            verificationByPhase: { qa: [qaRecord(f.reportPath, "--qa-candidate")] },
          }
        : operation === "recordNonPassingQaCandidate"
          ? {
              status: "failed",
              commit: f.head(),
              records: [qaRecord(f.reportPath, "--qa-candidate --allow-nonpassing")],
            }
          : operation === "anchorQaHistory"
            ? {
                commit: f.head(),
                records: [qaRecord(f.reportPath, "--qa-history-anchor")],
              }
            : "Restore the environment";
    const calls = f.calls.length;
    await assert.rejects(f.runtime[operation](f.sessionPath, input), /approval, scope, owner/);
    assert.deepEqual(fs.readFileSync(f.sessionPath), before);
    assert.deepEqual(fs.readFileSync(f.reportPath), reportBefore);
    assert.ok(f.calls.slice(calls).every((call) => call.method === "GET"));
  });
}
