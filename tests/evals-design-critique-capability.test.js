"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const {
  capabilityOracleHash,
  capabilityScenarioId,
  scoreCapabilityReport,
  validateCandidateFindingsLedger,
  validateCapabilityOracle,
  validateOracleIsolationArtifact,
  validateCapabilityReport,
} = require("../scripts/evals/design-critique-capability");
const {
  sealCapabilityAdjudication,
} = require("../scripts/evals/design-critique-capability-adjudicate");
const {
  CAPABILITY_JSON_LIMITS,
  encodeCapabilityJson,
  readCapabilityJson,
} = require("../scripts/evals/design-critique-capability-input");
const { hashTree } = require("../scripts/evals/stage");
const { capabilityScenarioFiles } = require("../scripts/evals/design-critique-capability-scenario");

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function write(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  return { path: relative, sha256: digest(fs.readFileSync(target)) };
}

function fakeFixVerifier({ oracleCase }) {
  return oracleCase.defects.map((defect) => ({
    oracle_id: defect.id,
    fix_oracle_sha256: digest(defect.fix_oracle),
    verification_sha256: digest(`verification:${defect.id}`),
    status: "pass",
  }));
}

function evidenceOptions(rootDir) {
  return { rootDir, fixVerifier: fakeFixVerifier };
}

function oracle() {
  return {
    schema_version: 1,
    benchmark_id: "design-critique-hidden-v1",
    minimum_repeats: 3,
    thresholds: {
      p0_p1_recall: 0.9,
      objective_precision: 0.8,
      clean_control_false_block_rate: 0.05,
      locator_accuracy: 0.9,
      severity_accuracy: 0.9,
      claimed_fix_success: 0.9,
    },
    cases: [
      {
        id: "defect-case",
        fixture_ref: "evals/quality/fixtures/design-critique/defect.html",
        fixture_sha256: `sha256:${"a".repeat(64)}`,
        clean_control: false,
        defects: [
          {
            id: "overflow",
            severity: "high",
            objective: true,
            route: "/report",
            state: "narrow",
            locator: ".report",
            fix_oracle: "document.documentElement.scrollWidth <= window.innerWidth",
          },
        ],
      },
      {
        id: "clean-case",
        fixture_ref: "evals/quality/fixtures/design-critique/clean.html",
        fixture_sha256: `sha256:${"b".repeat(64)}`,
        clean_control: true,
        defects: [],
      },
    ],
  };
}

function evidenceFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-evidence-"));
  const expected = oracle();
  for (const [index, item] of expected.cases.entries()) {
    item.fixture_sha256 = digest(`fixture:${item.id}:${index}`);
  }
  const value = {
    schema_version: 4,
    benchmark_id: "design-critique-hidden-v1",
    profile: { id: "sol-high", adapter: "codex", model: "gpt-5.6-sol", effort: "high" },
    repeats: (options.repeats || [1, 2, 3]).map((repeat) => ({
      repeat,
      cases: expected.cases.map((item, caseIndex) => {
        const scenarioId = capabilityScenarioId(item.id, "sol-high", repeat);
        const stamp = `2026090${repeat}T00000${caseIndex}Z`;
        const runId = `${stamp}--${scenarioId}--codex`;
        const runRoot = `eval-results/runs/${runId}`;
        const fixtureContent = `fixture:${item.id}:${caseIndex}`;
        for (const file of capabilityScenarioFiles(scenarioId, Buffer.from(fixtureContent))) {
          write(root, `${runRoot}/scenario/${file.name}`, file.bytes);
        }
        const scenarioIdentity = write(
          root,
          `${runRoot}/metadata/scenario_identity.json`,
          `${JSON.stringify(
            {
              id: scenarioId,
              scenario_hash: hashTree(path.join(root, runRoot, "scenario")).hash,
              scenario_ref: "scenario",
            },
            null,
            2
          )}\n`
        );
        const fixture = write(
          root,
          `${runRoot}/metadata/inputs/design-critique-fixture.html`,
          fixtureContent
        );
        const runtimeProfile = write(
          root,
          `${runRoot}/metadata/runtime_profile_identity.json`,
          `${JSON.stringify(
            {
              schema_version: 1,
              id: "sol-high",
              adapter: "codex",
              model: "gpt-5.6-sol",
              effort: "high",
            },
            null,
            2
          )}\n`
        );
        write(root, `${runRoot}/runtime/pm/runtime-marker.txt`, "same clean runtime\n");
        const sourceIdentity = write(
          root,
          `${runRoot}/metadata/source_identity.json`,
          `${JSON.stringify(
            {
              source_ref: "0123456789abcdef0123456789abcdef01234567",
              branch: "codex/capability-test",
              dirty: false,
              runtime_hash: hashTree(path.join(root, runRoot, "runtime", "pm")).hash,
              runtime_ref: "runtime/pm",
            },
            null,
            2
          )}\n`
        );
        const normalizedTranscript = write(
          root,
          `${runRoot}/metadata/transcript.normalized.jsonl`,
          `${JSON.stringify({ type: "skill", name: "pm:design-critique" })}\n`
        );
        const falseBlock = options.falseBlock === true && item.clean_control;
        const missed = options.miss === true && !item.clean_control;
        const semanticLaundering = options.semanticLaundering === true && !item.clean_control;
        const blocked = falseBlock;
        const candidateRows = item.clean_control
          ? falseBlock
            ? [
                {
                  id: "finding-clean-false-block",
                  severity: "high",
                  objective: true,
                  blocking: true,
                  locator: "/clean at default: main",
                  claimed_fixed: false,
                  summary: "The clean control is incorrectly reported as blocked.",
                },
              ]
            : []
          : missed
            ? []
            : [
                {
                  id: "finding-responsive-overflow",
                  severity: item.defects[0].severity,
                  objective: semanticLaundering ? false : item.defects[0].objective,
                  blocking: !semanticLaundering,
                  locator: "/report at 390px: .report",
                  claimed_fixed: !semanticLaundering,
                  summary: "The report overflows the narrow viewport.",
                },
              ];
        const candidateLedger = {
          schema_version: 1,
          blocked,
          summary: candidateRows.length
            ? `Reported ${candidateRows.length} finding.`
            : "No findings reported.",
          findings: candidateRows,
        };
        const candidateOutput = write(
          root,
          `${runRoot}/artifacts/quality-output.md`,
          `# Critique ${item.id}\n\n${candidateLedger.summary}\n${candidateRows
            .map((finding) => `\n- ${finding.id}: ${finding.summary}`)
            .join("")}\n`
        );
        const candidateFindings = write(
          root,
          `${runRoot}/artifacts/capability-findings.json`,
          `${JSON.stringify(candidateLedger, null, 2)}\n`
        );
        const isolationAttested = options.unattested !== true;
        const isolationBase = `eval-results/capability-isolation/${runId}`;
        const isolationBindings = isolationAttested
          ? {
              policy: write(root, `${isolationBase}/external-policy.json`, '{"deny":"source"}\n'),
              launcher: write(
                root,
                `${isolationBase}/external-launcher.json`,
                '{"boundary":"external-container"}\n'
              ),
              preflight: write(
                root,
                `${isolationBase}/external-preflight.json`,
                '{"source_read_denied":true,"run_read_allowed":true}\n'
              ),
              launch_receipt: write(
                root,
                `${isolationBase}/external-launch-receipt.json`,
                `${JSON.stringify({ run_id: runId, launched: true })}\n`
              ),
              command: write(
                root,
                `${isolationBase}/external-command.json`,
                '{"runtime":"external-container"}\n'
              ),
            }
          : null;
        const oracleIsolation = write(
          root,
          `${runRoot}/metadata/oracle_isolation.json`,
          `${JSON.stringify(
            {
              schema_version: 2,
              run_id: runId,
              mode: isolationAttested ? "external-container" : "unattested",
              os_enforced: isolationAttested,
              source_read_denied: isolationAttested,
              run_read_allowed: isolationAttested,
              preflight: {
                denied_source_read: isolationAttested ? "pass" : "not-run",
                allowed_run_read: isolationAttested ? "pass" : "not-run",
              },
              bindings: isolationBindings,
              producer: {
                id: "pm-capability-oracle-isolation-attestor",
                version: 2,
              },
              reason: isolationAttested
                ? null
                : "candidate process source reads were not OS-isolated",
            },
            null,
            2
          )}\n`
        );
        const postSubject = write(
          root,
          `${runRoot}/workdir/ui/design-critique/capability-case.html`,
          `post-subject:${item.id}:${caseIndex}`
        );
        const verdictPath = `${runRoot}/verdict.json`;
        const verdict = {
          scenario: scenarioId,
          agent: "codex",
          status: "pass",
          reason: "checks passed",
          run_id: runId,
          source_identity: "metadata/source_identity.json",
          scenario_identity: "metadata/scenario_identity.json",
          artifact_ref: `runs/${runId}`,
          started_at: "2026-09-04T00:00:00.000Z",
          ended_at: "2026-09-04T00:01:00.000Z",
        };
        const verdictBinding = write(root, verdictPath, `${JSON.stringify(verdict, null, 2)}\n`);
        const findings = candidateRows.map((candidate) => ({
          candidate_finding_id: candidate.id,
          severity: candidate.severity,
          objective: candidate.objective,
          blocking: candidate.blocking,
          locator: candidate.locator,
          claimed_fixed: candidate.claimed_fixed,
          summary: candidate.summary,
          oracle_id: item.clean_control ? null : item.defects[0].id,
          judge_objective: item.clean_control ? false : item.defects[0].objective,
          location_correct: !item.clean_control,
          fix_verified: !item.clean_control && candidate.claimed_fixed,
        }));
        const fixVerification = write(
          root,
          `eval-results/capabilities/design-critique/fix-verification/${expected.benchmark_id}/sol-high/repeat-${repeat}/${item.id}.json`,
          `${JSON.stringify(
            {
              schema_version: 1,
              benchmark_id: expected.benchmark_id,
              oracle_sha256: capabilityOracleHash(expected),
              profile: {
                id: "sol-high",
                adapter: "codex",
                model: "gpt-5.6-sol",
                effort: "high",
              },
              repeat,
              case_id: item.id,
              run_id: runId,
              fixture_sha256: fixture.sha256,
              post_subject_sha256: postSubject.sha256,
              producer: {
                id: "pm:design-critique-capability-fix-verifier",
                version: 1,
              },
              results: fakeFixVerifier({ oracleCase: item }),
            },
            null,
            2
          )}\n`
        );
        const adjudication = write(
          root,
          `eval-results/capabilities/design-critique/adjudications/${expected.benchmark_id}/sol-high/repeat-${repeat}/${item.id}.json`,
          `${JSON.stringify(
            {
              schema_version: 3,
              benchmark_id: expected.benchmark_id,
              oracle_sha256: capabilityOracleHash(expected),
              profile: {
                id: "sol-high",
                adapter: "codex",
                model: "gpt-5.6-sol",
                effort: "high",
              },
              repeat,
              case_id: item.id,
              evidence: {
                fixture_sha256: fixture.sha256,
                run_id: runId,
                scenario_id: scenarioId,
                adapter: "codex",
                source_identity_sha256: sourceIdentity.sha256,
                scenario_identity_sha256: scenarioIdentity.sha256,
                runtime_profile_sha256: runtimeProfile.sha256,
                verdict_sha256: verdictBinding.sha256,
                normalized_transcript_sha256: normalizedTranscript.sha256,
                candidate_output_sha256: candidateOutput.sha256,
                candidate_findings_sha256: candidateFindings.sha256,
                oracle_isolation_sha256: oracleIsolation.sha256,
                post_subject_sha256: postSubject.sha256,
                fix_verification_sha256: fixVerification.sha256,
              },
              blocked,
              findings,
            },
            null,
            2
          )}\n`
        );
        return {
          case_id: item.id,
          fixture,
          source_identity: sourceIdentity,
          scenario_identity: scenarioIdentity,
          run: {
            run_id: runId,
            scenario_id: scenarioId,
            adapter: "codex",
            status: "pass",
            artifact_ref: `runs/${runId}`,
            runtime_profile: runtimeProfile,
            verdict: verdictBinding,
          },
          normalized_transcript: normalizedTranscript,
          candidate_output: candidateOutput,
          candidate_findings: candidateFindings,
          oracle_isolation: oracleIsolation,
          post_subject: postSubject,
          fix_verification: fixVerification,
          adjudication,
          blocked,
          findings,
        };
      }),
    })),
  };
  return {
    root,
    oracle: expected,
    report: value,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function captureFromFixture(fixture, repeatIndex = 0) {
  const sourceRepeat = fixture.report.repeats[repeatIndex];
  return {
    schema_version: 3,
    benchmark_id: fixture.oracle.benchmark_id,
    oracle_sha256: capabilityOracleHash(fixture.oracle),
    profile: structuredClone(fixture.report.profile),
    requested_profile: structuredClone(fixture.report.profile),
    repeat: sourceRepeat.repeat,
    harness_only: false,
    cases: sourceRepeat.cases.map((item) => ({
      case_id: item.case_id,
      fixture: structuredClone(item.fixture),
      source_identity: structuredClone(item.source_identity),
      scenario_identity: structuredClone(item.scenario_identity),
      run: structuredClone(item.run),
      normalized_transcript: structuredClone(item.normalized_transcript),
      candidate_output: structuredClone(item.candidate_output),
      candidate_findings: structuredClone(item.candidate_findings),
      oracle_isolation: structuredClone(item.oracle_isolation),
      post_subject: structuredClone(item.post_subject),
    })),
    failures: [],
    created_at: "2026-09-04T00:00:00.000Z",
  };
}

function judgmentsFromFixture(fixture, repeatIndex = 0) {
  const sourceRepeat = fixture.report.repeats[repeatIndex];
  return {
    schema_version: 2,
    repeat: sourceRepeat.repeat,
    cases: sourceRepeat.cases.map((item) => ({
      case_id: item.case_id,
      mappings: item.findings.map((finding) => ({
        candidate_finding_id: finding.candidate_finding_id,
        oracle_id: finding.oracle_id,
        judge_objective: finding.judge_objective,
        location_correct: finding.location_correct,
      })),
    })),
  };
}

function exactSizeJson(size) {
  const prefix = '{"payload":"';
  const suffix = '"}';
  return `${prefix}${"x".repeat(size - Buffer.byteLength(prefix) - Buffer.byteLength(suffix))}${suffix}`;
}

function inflateFixtureFinding(fixture, repeatIndex, summaryLength) {
  const row = fixture.report.repeats[repeatIndex].cases.find(
    (item) => item.case_id === "defect-case"
  );
  const summary = `Finding ${"x".repeat(summaryLength - "Finding ".length)}`;
  const ledgerPath = path.join(fixture.root, row.candidate_findings.path);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  ledger.findings[0].summary = summary;
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  row.candidate_findings.sha256 = digest(fs.readFileSync(ledgerPath));
  row.findings[0].summary = summary;

  const adjudicationPath = path.join(fixture.root, row.adjudication.path);
  const adjudication = JSON.parse(fs.readFileSync(adjudicationPath, "utf8"));
  adjudication.evidence.candidate_findings_sha256 = row.candidate_findings.sha256;
  adjudication.findings = structuredClone(row.findings);
  fs.writeFileSync(adjudicationPath, `${JSON.stringify(adjudication, null, 2)}\n`);
  row.adjudication.sha256 = digest(fs.readFileSync(adjudicationPath));
}

function stableArtifactSnapshot(rootDir, report) {
  return new Map(
    report.repeats.flatMap((repeat) =>
      repeat.cases.flatMap((row) =>
        [row.fix_verification.path, row.adjudication.path].map((relativePath) => [
          relativePath,
          fs.readFileSync(path.join(rootDir, relativePath)),
        ])
      )
    )
  );
}

function startAdjudicationWorker(workerData) {
  const worker = new Worker(
    `
      "use strict";
      const crypto = require("node:crypto");
      const { parentPort, workerData } = require("node:worker_threads");
      const { sealCapabilityAdjudication } = require(workerData.modulePath);
      const digest = (value) =>
        "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
      const fakeFixVerifier = ({ oracleCase }) =>
        oracleCase.defects.map((defect) => ({
          oracle_id: defect.id,
          fix_oracle_sha256: digest(defect.fix_oracle),
          verification_sha256: digest("verification:" + defect.id),
          status: "pass",
        }));
      try {
        const sealed = sealCapabilityAdjudication({
          rootDir: workerData.rootDir,
          oracle: workerData.oracle,
          capture: workerData.capture,
          judgments: workerData.judgments,
          reportPath: workerData.reportPath,
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforePublicationLock() {
              parentPort.postMessage({ type: "before-lock" });
            },
            afterReportLoad() {
              if (!workerData.holdAfterLoad) return;
              parentPort.postMessage({ type: "after-load" });
              while (Atomics.load(workerData.release, 0) === 0) {
                Atomics.wait(workerData.release, 0, 0, 1000);
              }
            },
          },
        });
        parentPort.postMessage({
          type: "done",
          repeats: sealed.report.repeats.map((item) => item.repeat),
        });
      } catch (error) {
        parentPort.postMessage({ type: "failure", message: error.stack || error.message });
      }
    `,
    { eval: true, workerData }
  );
  const received = [];
  const waiters = [];
  let failure = null;
  worker.on("message", (message) => {
    if (message.type === "failure") failure = new Error(message.message);
    const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      if (failure) waiter.reject(failure);
      else waiter.resolve(message);
    } else {
      received.push(message);
    }
  });
  worker.on("error", (error) => {
    failure = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  });
  return {
    waitFor(type) {
      if (failure) return Promise.reject(failure);
      const index = received.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(received.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`timed out waiting for adjudication worker event ${type}`));
        }, 10_000);
        waiters.push(waiter);
      });
    },
    worker,
  };
}

test("oracle-withheld capability schemas are closed and validated", () => {
  assert.deepEqual(validateCapabilityOracle(oracle()), []);
  const fixture = evidenceFixture();
  assert.deepEqual(
    validateCapabilityReport(fixture.report, fixture.oracle, evidenceOptions(fixture.root)),
    []
  );
  assert.match(
    validateCapabilityOracle({ ...oracle(), leaked_hint: "overflow" }).join("\n"),
    /unknown field/
  );
  const unbound = oracle();
  delete unbound.cases[0].fixture_sha256;
  assert.match(validateCapabilityOracle(unbound).join("\n"), /missing field fixture_sha256/);
  const legacy = structuredClone(fixture.report);
  legacy.schema_version = 1;
  assert.match(
    validateCapabilityReport(legacy, fixture.oracle, evidenceOptions(fixture.root)).join("\n"),
    /schema_version 1 cannot support staged-scenario, candidate-ledger, and oracle-isolation claims.*rerun/i
  );
  fixture.cleanup();
});

test("capability JSON inputs accept exact ceilings and reject the next byte", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-json-limit-"));
  try {
    for (const [kind, limit] of Object.entries(CAPABILITY_JSON_LIMITS)) {
      const target = path.join(directory, `${kind}.json`);
      fs.writeFileSync(target, exactSizeJson(limit));
      assert.equal(readCapabilityJson(target, kind).payload.length > 0, true, kind);
      fs.appendFileSync(target, " ");
      assert.throws(
        () => readCapabilityJson(target, kind),
        /safe boundary|bounded regular JSON file/,
        `${kind} must reject ${limit + 1} bytes`
      );
    }

    const target = path.join(directory, "target.json");
    const link = path.join(directory, "oracle-link.json");
    fs.writeFileSync(target, "{}\n");
    fs.symlinkSync(target, link);
    assert.throws(() => readCapabilityJson(link, "oracle"), /safe boundary/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("capability JSON output encoding enforces the report read ceiling exactly", () => {
  const limit = CAPABILITY_JSON_LIMITS.report;
  const framingBytes = Buffer.byteLength(`${JSON.stringify({ payload: "" }, null, 2)}\n`);
  const exact = encodeCapabilityJson({ payload: "x".repeat(limit - framingBytes) }, "report");
  assert.equal(exact.length, limit);
  assert.throws(
    () => encodeCapabilityJson({ payload: "x".repeat(limit - framingBytes + 1) }, "report"),
    /report JSON output exceeds.*safe boundary/i
  );
});

test("capability scoring measures quality but keeps unverified isolation nonclaimable", () => {
  const fixture = evidenceFixture();
  const result = scoreCapabilityReport(
    fixture.oracle,
    fixture.report,
    evidenceOptions(fixture.root)
  );
  assert.equal(result.claimable, false);
  assert.equal(result.release_passed, false);
  assert.equal(result.oracle_isolation.attested, false);
  assert.match(result.oracle_isolation.claimability_reason, /network denial.*plugin mirror/i);
  assert.ok(
    result.oracle_isolation.unattested_cases.every((item) => item.mode === "external-container")
  );
  assert.deepEqual(result.metrics, {
    p0_p1_recall: 1,
    objective_precision: 1,
    clean_control_false_block_rate: 0,
    locator_accuracy: 1,
    severity_accuracy: 1,
    claimed_fix_success: 1,
  });

  fixture.cleanup();

  const badFixture = evidenceFixture({ miss: true, falseBlock: true });
  const bad = scoreCapabilityReport(
    badFixture.oracle,
    badFixture.report,
    evidenceOptions(badFixture.root)
  );
  assert.equal(bad.claimable, false);
  assert.equal(bad.release_passed, false);
  assert.equal(bad.metrics.p0_p1_recall, 0);
  assert.equal(bad.metrics.clean_control_false_block_rate, 1);
  badFixture.cleanup();
});

test("adjudication sealing derives report rows from an exact capture and oracle", () => {
  const fixture = evidenceFixture();
  const capture = captureFromFixture(fixture);
  const judgments = judgmentsFromFixture(fixture);
  const reportPath = path.join(fixture.root, "adjudicated-report.json");
  const sealed = sealCapabilityAdjudication({
    rootDir: fixture.root,
    oracle: fixture.oracle,
    capture,
    judgments,
    reportPath,
    fixVerifier: fakeFixVerifier,
  });

  assert.deepEqual(
    validateCapabilityReport(sealed.report, fixture.oracle, evidenceOptions(fixture.root)),
    []
  );
  assert.equal(sealed.report.repeats[0].cases[0].adjudication.sha256.startsWith("sha256:"), true);
  assert.equal(sealed.report.repeats[0].cases[0].findings[0].fix_verified, true);
  assert.throws(
    () =>
      sealCapabilityAdjudication({
        rootDir: fixture.root,
        oracle: fixture.oracle,
        capture: { ...capture, harness_only: true },
        judgments,
        reportPath: path.join(fixture.root, "harness-report.json"),
        fixVerifier: fakeFixVerifier,
      }),
    /harness-only captures cannot be adjudicated/
  );
  assert.throws(
    () =>
      sealCapabilityAdjudication({
        rootDir: fixture.root,
        oracle: fixture.oracle,
        capture,
        judgments,
        reportPath: path.join(fixture.root, "indeterminate-fix-report.json"),
        fixVerifier: ({ oracleCase }) =>
          fakeFixVerifier({ oracleCase }).map((result) => ({
            ...result,
            status: "indeterminate",
          })),
      }),
    /claimed_fixed requires a conclusive fix-verification/
  );
  fixture.cleanup();
});

test("adjudication rejects a traversal profile before creating publication files", () => {
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-profile-escape-"));
  try {
    const capture = captureFromFixture(fixture);
    const profileBase = path.join(
      fixture.root,
      "eval-results",
      "capabilities",
      "design-critique",
      "fix-verification",
      fixture.oracle.benchmark_id
    );
    const traversal = path.relative(profileBase, outside).replaceAll(path.sep, "/");
    capture.profile.id = traversal;
    capture.requested_profile.id = traversal;
    const reportPath = path.join(fixture.root, "traversal-report.json");

    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments: judgmentsFromFixture(fixture),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /capture\.profile\.id must be a lowercase slug/
    );
    assert.equal(fs.existsSync(reportPath), false);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication rejects a symlinked publication parent without writing through it", () => {
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-parent-link-"));
  const capabilities = path.join(fixture.root, "eval-results", "capabilities");
  try {
    fs.rmSync(capabilities, { recursive: true, force: true });
    fs.symlinkSync(outside, capabilities, "dir");
    const reportPath = path.join(fixture.root, "symlink-report.json");

    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /capability publication parent must be a real directory inside the root/
    );
    assert.equal(fs.existsSync(reportPath), false);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication rejects an immutable publication parent swap without writing outside", () => {
  if (process.platform === "win32") return;
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-parent-swap-"));
  const capture = captureFromFixture(fixture);
  const sentinel = Buffer.from("external immutable artifact\n");
  let outsideTarget;
  let swapped = false;
  try {
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments: judgmentsFromFixture(fixture),
          reportPath: path.join(fixture.root, "immutable-parent-swap-report.json"),
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforeImmutablePublication(publication) {
              if (swapped) return;
              const publicationParent = path.dirname(publication.path);
              const originalParent = `${publicationParent}-original`;
              outsideTarget = path.join(outside, path.basename(publication.path));
              fs.writeFileSync(outsideTarget, sentinel, { mode: 0o600 });
              fs.renameSync(publicationParent, originalParent);
              fs.symlinkSync(outside, publicationParent, "dir");
              swapped = true;
            },
          },
        }),
      /project output ancestor is not a real directory|destination parent changed/i
    );
    assert.equal(swapped, true);
    assert.deepEqual(fs.readFileSync(outsideTarget), sentinel);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication recreates an immutable artifact removed after preflight", () => {
  const fixture = evidenceFixture();
  const capture = captureFromFixture(fixture);
  let selectedPath;
  let expected;
  let removed = false;
  try {
    sealCapabilityAdjudication({
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture,
      judgments: judgmentsFromFixture(fixture),
      reportPath: path.join(fixture.root, "removed-after-preflight-report.json"),
      fixVerifier: fakeFixVerifier,
      testingHooks: {
        beforeImmutablePublication(publication) {
          if (removed) return;
          selectedPath = publication.path;
          expected = Buffer.from(publication.bytes);
          fs.rmSync(selectedPath);
          removed = true;
        },
      },
    });
    assert.equal(removed, true);
    assert.deepEqual(fs.readFileSync(selectedPath), expected);
  } finally {
    fixture.cleanup();
  }
});

test("adjudication rejects an out-of-root report before creating its lock or report", () => {
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-report-escape-"));
  try {
    const reportPath = path.join(outside, "report.json");
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /capability report path must be a file inside the root directory/
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication rejects a symlinked report parent before creating a lock", () => {
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-report-link-"));
  try {
    const linkedParent = path.join(fixture.root, "linked-reports");
    fs.symlinkSync(outside, linkedParent, "dir");
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath: path.join(linkedParent, "report.json"),
          fixVerifier: fakeFixVerifier,
        }),
      /capability report path must be a file inside the root directory/
    );
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication rejects a report parent swap without replacing an external file", () => {
  if (process.platform === "win32") return;
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-report-swap-"));
  const reportParent = path.join(fixture.root, "reports");
  const originalParent = path.join(fixture.root, "reports-original");
  const reportPath = path.join(reportParent, "report.json");
  const outsideTarget = path.join(outside, "report.json");
  const sentinel = Buffer.from("external report must remain unchanged\n");
  fs.mkdirSync(reportParent);
  fs.writeFileSync(outsideTarget, sentinel, { mode: 0o600 });
  try {
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath,
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforeReportPublication() {
              fs.renameSync(reportParent, originalParent);
              fs.symlinkSync(outside, reportParent, "dir");
            },
          },
        }),
      /project output ancestor is not a real directory|destination parent changed/i
    );
    assert.deepEqual(fs.readFileSync(outsideTarget), sentinel);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication rejects a report parent swap before loading an existing report", () => {
  if (process.platform === "win32") return;
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-report-read-swap-"));
  const reportParent = path.join(fixture.root, "reports");
  const originalParent = path.join(fixture.root, "reports-original");
  const reportPath = path.join(reportParent, "report.json");
  const outsideTarget = path.join(outside, "report.json");
  let restored = false;
  try {
    sealCapabilityAdjudication({
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture: captureFromFixture(fixture, 0),
      judgments: judgmentsFromFixture(fixture, 0),
      reportPath,
      fixVerifier: fakeFixVerifier,
    });
    const originalReport = fs.readFileSync(reportPath);
    fs.writeFileSync(outsideTarget, originalReport, { mode: 0o600 });

    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture, 1),
          judgments: judgmentsFromFixture(fixture, 1),
          reportPath,
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforeReportLoad() {
              fs.renameSync(reportParent, originalParent);
              fs.symlinkSync(outside, reportParent, "dir");
            },
            afterReportLoad() {
              fs.unlinkSync(reportParent);
              fs.renameSync(originalParent, reportParent);
              restored = true;
            },
          },
        }),
      /report JSON input.*project path contains symlink/i
    );
    assert.equal(restored, false);
    assert.deepEqual(fs.readFileSync(outsideTarget), originalReport);
    assert.deepEqual(fs.readFileSync(path.join(originalParent, "report.json")), originalReport);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication never replaces an existing report changed after its anchored read", () => {
  const fixture = evidenceFixture();
  const reportPath = path.join(fixture.root, "reports", "report.json");
  const concurrent = Buffer.from('{"concurrent":true}\n');
  try {
    sealCapabilityAdjudication({
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture: captureFromFixture(fixture, 0),
      judgments: judgmentsFromFixture(fixture, 0),
      reportPath,
      fixVerifier: fakeFixVerifier,
    });

    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture, 1),
          judgments: judgmentsFromFixture(fixture, 1),
          reportPath,
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforeReportPublication() {
              fs.mkdirSync(path.dirname(reportPath), { recursive: true });
              fs.writeFileSync(reportPath, concurrent, { mode: 0o600 });
            },
          },
        }),
      /atomic write attestation changed/
    );
    assert.deepEqual(fs.readFileSync(reportPath), concurrent);
  } finally {
    fixture.cleanup();
  }
});

test("adjudication never replaces a report created after an absent anchored read", () => {
  const fixture = evidenceFixture();
  const reportPath = path.join(fixture.root, "reports", "report.json");
  const concurrent = Buffer.from('{"concurrent":true}\n');
  try {
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture, 0),
          judgments: judgmentsFromFixture(fixture, 0),
          reportPath,
          fixVerifier: fakeFixVerifier,
          testingHooks: {
            beforeReportPublication() {
              fs.mkdirSync(path.dirname(reportPath), { recursive: true });
              fs.writeFileSync(reportPath, concurrent, { mode: 0o600 });
            },
          },
        }),
      /EEXIST|file exists/i
    );
    assert.deepEqual(fs.readFileSync(reportPath), concurrent);
  } finally {
    fixture.cleanup();
  }
});

test("adjudication rejects unsafe existing report files before lock acquisition", () => {
  const fixture = evidenceFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-report-target-"));
  try {
    const target = path.join(outside, "target.json");
    const targetBytes = Buffer.from("external report must remain unchanged\n");
    fs.writeFileSync(target, targetBytes, { mode: 0o600 });
    const linkedReport = path.join(fixture.root, "linked-report.json");
    fs.symlinkSync(target, linkedReport);
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath: linkedReport,
          fixVerifier: fakeFixVerifier,
        }),
      /capability report path must be a canonical regular file inside the root/
    );
    assert.deepEqual(fs.readFileSync(target), targetBytes);
    assert.equal(fs.existsSync(`${linkedReport}.lock`), false);

    const publicReport = path.join(fixture.root, "public-report.json");
    fs.writeFileSync(publicReport, "{}\n", { mode: 0o600 });
    fs.chmodSync(publicReport, 0o644);
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture),
          judgments: judgmentsFromFixture(fixture),
          reportPath: publicReport,
          fixVerifier: fakeFixVerifier,
        }),
      /existing capability report must use private file permissions/
    );
    assert.equal(fs.existsSync(`${publicReport}.lock`), false);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fixture.cleanup();
  }
});

test("adjudication leaves an unrelated adjacent report lock file untouched", () => {
  const fixture = evidenceFixture();
  const reportPath = path.join(fixture.root, "report-with-unrelated-lock.json");
  const adjacentPath = `${reportPath}.lock`;
  const sentinel = Buffer.from("unrelated application state\n");
  fs.writeFileSync(adjacentPath, sentinel, { mode: 0o600 });
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(adjacentPath, old, old);
  try {
    const sealed = sealCapabilityAdjudication({
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture: captureFromFixture(fixture),
      judgments: judgmentsFromFixture(fixture),
      reportPath,
      fixVerifier: fakeFixVerifier,
    });

    assert.equal(sealed.reportPath, fs.realpathSync(reportPath));
    assert.deepEqual(fs.readFileSync(adjacentPath), sentinel);
  } finally {
    fixture.cleanup();
  }
});

test("adjudication rejects every bound capture input as a report target before side effects", () => {
  const cases = [
    ["fixture", (row) => row.fixture.path],
    ["source identity", (row) => row.source_identity.path],
    ["scenario identity", (row) => row.scenario_identity.path],
    ["runtime profile", (row) => row.run.runtime_profile.path],
    ["run verdict", (row) => row.run.verdict.path],
    ["normalized transcript", (row) => row.normalized_transcript.path],
    ["candidate output", (row) => row.candidate_output.path],
    ["candidate findings", (row) => row.candidate_findings.path],
    ["oracle isolation", (row) => row.oracle_isolation.path],
    [
      "oracle isolation policy",
      (row, fixture) => {
        const isolation = JSON.parse(
          fs.readFileSync(path.join(fixture.root, row.oracle_isolation.path), "utf8")
        );
        return isolation.bindings.policy.path;
      },
    ],
    ["post subject", (row) => row.post_subject.path],
    [
      "retained runtime tree",
      (row) => `eval-results/runs/${row.run.run_id}/runtime/pm/runtime-marker.txt`,
    ],
    ["retained scenario tree", (row) => `eval-results/runs/${row.run.run_id}/scenario/story.md`],
  ];

  for (const [name, selectPath] of cases) {
    const fixture = evidenceFixture();
    const capture = captureFromFixture(fixture);
    const target = path.join(fixture.root, selectPath(capture.cases[0], fixture));
    const sentinel = fs.readFileSync(target);
    fs.chmodSync(target, 0o600);
    let reachedLockHook = false;
    try {
      assert.throws(
        () =>
          sealCapabilityAdjudication({
            rootDir: fixture.root,
            oracle: fixture.oracle,
            capture,
            judgments: judgmentsFromFixture(fixture),
            reportPath: target,
            fixVerifier: fakeFixVerifier,
            testingHooks: {
              beforePublicationLock() {
                reachedLockHook = true;
              },
            },
          }),
        /capability report path conflicts with a protected input or publication namespace/,
        name
      );
      assert.equal(reachedLockHook, false, name);
      assert.deepEqual(fs.readFileSync(target), sentinel, name);
    } finally {
      fixture.cleanup();
    }
  }
});

test("adjudication CLI preserves oracle capture and judgments inputs used as report targets", () => {
  const script = path.join(
    __dirname,
    "..",
    "scripts",
    "evals",
    "design-critique-capability-adjudicate.js"
  );
  for (const input of ["oracle", "capture", "judgments"]) {
    const fixture = evidenceFixture();
    const paths = {
      oracle: path.join(fixture.root, "oracle-input.json"),
      capture: path.join(fixture.root, "capture-input.json"),
      judgments: path.join(fixture.root, "judgments-input.json"),
    };
    fs.writeFileSync(paths.oracle, `${JSON.stringify(fixture.oracle, null, 2)}\n`, { mode: 0o600 });
    fs.writeFileSync(paths.capture, `${JSON.stringify(captureFromFixture(fixture), null, 2)}\n`, {
      mode: 0o600,
    });
    fs.writeFileSync(
      paths.judgments,
      `${JSON.stringify(judgmentsFromFixture(fixture), null, 2)}\n`,
      { mode: 0o600 }
    );
    const sentinel = fs.readFileSync(paths[input]);
    try {
      const result = spawnSync(
        process.execPath,
        [
          script,
          "--root",
          fixture.root,
          "--oracle",
          paths.oracle,
          "--capture",
          paths.capture,
          "--judgments",
          paths.judgments,
          "--report",
          paths[input],
        ],
        { encoding: "utf8" }
      );

      assert.equal(result.status, 1, input);
      assert.match(
        result.stderr,
        /capability report path conflicts with a protected input or publication namespace/,
        input
      );
      assert.deepEqual(fs.readFileSync(paths[input]), sentinel, input);
    } finally {
      fixture.cleanup();
    }
  }
});

test("adjudication CLI preserves an oracle input placed in the global lock namespace", () => {
  const fixture = evidenceFixture();
  const oraclePath = path.join(
    fixture.root,
    "eval-results/capabilities/design-critique/.adjudication-publication.lock"
  );
  const capturePath = path.join(fixture.root, "capture-input.json");
  const judgmentsPath = path.join(fixture.root, "judgments-input.json");
  const reportPath = path.join(fixture.root, "separate-report.json");
  fs.writeFileSync(oraclePath, `${JSON.stringify(fixture.oracle, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(capturePath, `${JSON.stringify(captureFromFixture(fixture), null, 2)}\n`, {
    mode: 0o600,
  });
  fs.writeFileSync(judgmentsPath, `${JSON.stringify(judgmentsFromFixture(fixture), null, 2)}\n`, {
    mode: 0o600,
  });
  const sentinel = fs.readFileSync(oraclePath);
  const old = new Date(Date.now() - 10_000);
  fs.utimesSync(oraclePath, old, old);
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "scripts", "evals", "design-critique-capability-adjudicate.js"),
        "--root",
        fixture.root,
        "--oracle",
        oraclePath,
        "--capture",
        capturePath,
        "--judgments",
        judgmentsPath,
        "--report",
        reportPath,
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /protected capability input conflicts with a publication namespace/
    );
    assert.deepEqual(fs.readFileSync(oraclePath), sentinel);
    assert.equal(fs.existsSync(reportPath), false);
  } finally {
    fixture.cleanup();
  }
});

test("adjudication rejects immutable publication and coordination report namespaces before side effects", () => {
  const cases = [
    {
      name: "planned fix verification",
      reportPath(fixture) {
        return path.join(fixture.root, fixture.report.repeats[0].cases[0].fix_verification.path);
      },
    },
    {
      name: "planned adjudication",
      reportPath(fixture) {
        return path.join(fixture.root, fixture.report.repeats[0].cases[0].adjudication.path);
      },
    },
    {
      name: "unplanned path in immutable tree",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/fix-verification/private-report.json"
        );
      },
    },
    {
      name: "global publication lock",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/.adjudication-publication.lock"
        );
      },
    },
    {
      name: "global publication lock candidate",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/.adjudication-publication.lock.candidate-planted"
        );
      },
    },
    {
      name: "global publication lock recovery successor",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/.adjudication-publication.lock.reclaim.next-planted"
        );
      },
    },
    {
      name: "global publication lock atomic temporary",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/..adjudication-publication.lock.candidate-planted.tmp-planted"
        );
      },
    },
    {
      name: "report lock aliases global publication lock",
      reportPath(fixture) {
        return path.join(
          fixture.root,
          "eval-results/capabilities/design-critique/.adjudication-publication"
        );
      },
    },
  ];

  for (const item of cases) {
    const fixture = evidenceFixture();
    const capture = captureFromFixture(fixture);
    const judgments = judgmentsFromFixture(fixture);
    const capabilityRoot = path.join(fixture.root, "eval-results", "capabilities");
    fs.rmSync(capabilityRoot, { recursive: true, force: true });
    let reachedLockHook = false;
    try {
      assert.throws(
        () =>
          sealCapabilityAdjudication({
            rootDir: fixture.root,
            oracle: fixture.oracle,
            capture,
            judgments,
            reportPath: item.reportPath(fixture),
            fixVerifier: fakeFixVerifier,
            testingHooks: {
              beforePublicationLock() {
                reachedLockHook = true;
              },
            },
          }),
        /capability report path conflicts with a protected input or publication namespace/,
        item.name
      );
      assert.equal(reachedLockHook, false, item.name);
      assert.equal(fs.existsSync(capabilityRoot), false, item.name);
    } finally {
      fixture.cleanup();
    }
  }
});

test("adjudication validates source and transcript bindings before immutable publication", () => {
  const cases = [
    {
      name: "dirty source identity",
      mutate(fixture, capture) {
        const row = capture.cases[0];
        const target = path.join(fixture.root, row.source_identity.path);
        const identity = JSON.parse(fs.readFileSync(target, "utf8"));
        identity.dirty = true;
        fs.writeFileSync(target, `${JSON.stringify(identity, null, 2)}\n`);
        row.source_identity.sha256 = digest(fs.readFileSync(target));
      },
      expected: /source_identity\.dirty must be false/i,
    },
    {
      name: "malformed normalized transcript",
      mutate(fixture, capture) {
        const row = capture.cases[0];
        const target = path.join(fixture.root, row.normalized_transcript.path);
        fs.writeFileSync(target, "{not-json}\n");
        row.normalized_transcript.sha256 = digest(fs.readFileSync(target));
      },
      expected: /normalized_transcript must be valid non-empty JSONL/i,
    },
  ];

  for (const item of cases) {
    const fixture = evidenceFixture();
    const capture = captureFromFixture(fixture);
    const judgments = judgmentsFromFixture(fixture);
    const reportPath = path.join(fixture.root, `${item.name.replaceAll(" ", "-")}-report.json`);
    const prospectiveArtifacts = fixture.report.repeats[0].cases.flatMap((row) => [
      path.join(fixture.root, row.fix_verification.path),
      path.join(fixture.root, row.adjudication.path),
    ]);
    for (const artifactPath of prospectiveArtifacts) fs.rmSync(artifactPath);
    item.mutate(fixture, capture);
    try {
      assert.throws(
        () =>
          sealCapabilityAdjudication({
            rootDir: fixture.root,
            oracle: fixture.oracle,
            capture,
            judgments,
            reportPath,
            fixVerifier: fakeFixVerifier,
          }),
        item.expected,
        item.name
      );
      assert.equal(fs.existsSync(reportPath), false, item.name);
      assert.equal(fs.existsSync(`${reportPath}.lock`), false, item.name);
      for (const artifactPath of prospectiveArtifacts) {
        assert.equal(fs.existsSync(artifactPath), false, `${item.name}: ${artifactPath}`);
      }
    } finally {
      fixture.cleanup();
    }
  }
});

test("adjudication append protects retained report inputs before publishing the new repeat", () => {
  const fixture = evidenceFixture();
  const retainedRow = fixture.report.repeats[0].cases[0];
  const reportPath = path.join(
    fixture.root,
    "eval-results",
    "runs",
    retainedRow.run.run_id,
    "runtime",
    "pm",
    "retained-report.json"
  );
  const initialReport = {
    ...structuredClone(fixture.report),
    repeats: [structuredClone(fixture.report.repeats[0])],
  };
  const initialBytes = encodeCapabilityJson(initialReport, "report");
  fs.writeFileSync(reportPath, initialBytes, { mode: 0o600 });
  const prospectiveArtifacts = fixture.report.repeats[1].cases.flatMap((row) => [
    path.join(fixture.root, row.fix_verification.path),
    path.join(fixture.root, row.adjudication.path),
  ]);
  for (const artifactPath of prospectiveArtifacts) fs.rmSync(artifactPath);
  try {
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture, 1),
          judgments: judgmentsFromFixture(fixture, 1),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /capability report path conflicts with a protected input or publication namespace/
    );
    assert.deepEqual(fs.readFileSync(reportPath), initialBytes);
    for (const artifactPath of prospectiveArtifacts) {
      assert.equal(fs.existsSync(artifactPath), false, artifactPath);
    }
  } finally {
    fixture.cleanup();
  }
});

test("divergent same-repeat adjudication cannot overwrite a sealed artifact namespace", () => {
  const fixture = evidenceFixture();
  const capture = captureFromFixture(fixture);
  const judgments = judgmentsFromFixture(fixture);
  const winnerPath = path.join(fixture.root, "winner-report.json");
  const loserPath = path.join(fixture.root, "loser-report.json");
  try {
    for (const row of fixture.report.repeats[0].cases) {
      fs.rmSync(path.join(fixture.root, row.fix_verification.path));
      fs.rmSync(path.join(fixture.root, row.adjudication.path));
    }
    const winner = sealCapabilityAdjudication({
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture,
      judgments,
      reportPath: winnerPath,
      fixVerifier: fakeFixVerifier,
    });
    const winnerReportBytes = fs.readFileSync(winnerPath);
    const winnerArtifacts = stableArtifactSnapshot(fixture.root, winner.report);

    const divergent = structuredClone(judgments);
    divergent.cases.find((item) => item.case_id === "defect-case").mappings[0].location_correct =
      false;
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments: divergent,
          reportPath: winnerPath,
          fixVerifier: fakeFixVerifier,
        }),
      /already contains repeat 1/
    );
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments: divergent,
          reportPath: loserPath,
          fixVerifier: fakeFixVerifier,
        }),
      /sealed capability artifact conflicts with existing bytes/
    );

    assert.equal(fs.existsSync(loserPath), false);
    assert.deepEqual(fs.readFileSync(winnerPath), winnerReportBytes);
    for (const [relativePath, bytes] of winnerArtifacts) {
      assert.deepEqual(fs.readFileSync(path.join(fixture.root, relativePath)), bytes);
    }
    assert.deepEqual(
      validateCapabilityReport(
        readCapabilityJson(winnerPath, "report"),
        fixture.oracle,
        evidenceOptions(fixture.root)
      ),
      []
    );
  } finally {
    fixture.cleanup();
  }
});

test("idempotent adjudication rejects byte-identical public immutable artifacts", () => {
  const fixture = evidenceFixture();
  const capture = captureFromFixture(fixture);
  const reportPath = path.join(fixture.root, "private-artifact-report.json");
  const artifactPath = path.join(
    fixture.root,
    fixture.report.repeats[0].cases[0].fix_verification.path
  );
  const sentinel = fs.readFileSync(artifactPath);
  fs.chmodSync(artifactPath, 0o644);
  try {
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments: judgmentsFromFixture(fixture),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /sealed capability artifact must use private file permissions/
    );
    assert.equal(fs.existsSync(reportPath), false);
    assert.deepEqual(fs.readFileSync(artifactPath), sentinel);
    assert.notEqual(fs.statSync(artifactPath).mode & 0o077, 0);
  } finally {
    fixture.cleanup();
  }
});

test("concurrent adjudications serialize report updates without losing repeats", async () => {
  const fixture = evidenceFixture();
  const reportPath = path.join(fixture.root, "contended-report.json");
  const publicationLock = path.join(
    fixture.root,
    "eval-results/capabilities/design-critique/.adjudication-publication.lock"
  );
  const release = new Int32Array(new SharedArrayBuffer(4));
  const modulePath = require.resolve("../scripts/evals/design-critique-capability-adjudicate");
  const first = startAdjudicationWorker({
    modulePath,
    rootDir: fixture.root,
    oracle: fixture.oracle,
    capture: captureFromFixture(fixture, 0),
    judgments: judgmentsFromFixture(fixture, 0),
    reportPath,
    holdAfterLoad: true,
    release,
  });
  let second;
  try {
    await first.waitFor("after-load");
    second = startAdjudicationWorker({
      modulePath,
      rootDir: fixture.root,
      oracle: fixture.oracle,
      capture: captureFromFixture(fixture, 1),
      judgments: judgmentsFromFixture(fixture, 1),
      reportPath,
      holdAfterLoad: false,
      release,
    });
    await second.waitFor("before-lock");
    assert.equal(fs.existsSync(publicationLock), false);
    assert.equal(fs.existsSync(`${reportPath}.lock`), false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    Atomics.store(release, 0, 1);
    Atomics.notify(release, 0);
    await Promise.all([first.waitFor("done"), second.waitFor("done")]);

    const report = readCapabilityJson(reportPath, "report");
    assert.deepEqual(
      report.repeats.map((item) => item.repeat),
      [1, 2]
    );
    assert.deepEqual(
      validateCapabilityReport(report, fixture.oracle, evidenceOptions(fixture.root)),
      []
    );
  } finally {
    Atomics.store(release, 0, 1);
    Atomics.notify(release, 0);
    await Promise.allSettled([first.worker.terminate(), second?.worker.terminate()]);
    fixture.cleanup();
  }
});

test("adjudication rejects a boundary-crossing report append before artifact publication", () => {
  const fixture = evidenceFixture({ repeats: [1, 2, 3, 4] });
  const reportPath = path.join(fixture.root, "near-limit-report.json");
  try {
    for (let index = 0; index < fixture.report.repeats.length; index += 1) {
      inflateFixtureFinding(fixture, index, 2_090_000);
    }
    const initialReport = {
      ...structuredClone(fixture.report),
      repeats: structuredClone(fixture.report.repeats.slice(0, 3)),
    };
    const initialBytes = encodeCapabilityJson(initialReport, "report");
    assert.ok(initialBytes.length < CAPABILITY_JSON_LIMITS.report);
    assert.throws(
      () => encodeCapabilityJson(fixture.report, "report"),
      /report JSON output exceeds.*safe boundary/i
    );
    fs.writeFileSync(reportPath, initialBytes, { mode: 0o600 });
    assert.deepEqual(
      validateCapabilityReport(initialReport, fixture.oracle, evidenceOptions(fixture.root)),
      []
    );

    const nextRepeat = fixture.report.repeats[3];
    const prospectiveArtifacts = nextRepeat.cases.flatMap((row) => [
      path.join(fixture.root, row.fix_verification.path),
      path.join(fixture.root, row.adjudication.path),
    ]);
    for (const artifactPath of prospectiveArtifacts) fs.rmSync(artifactPath);

    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture: captureFromFixture(fixture, 3),
          judgments: judgmentsFromFixture(fixture, 3),
          reportPath,
          fixVerifier: fakeFixVerifier,
        }),
      /report JSON output exceeds.*safe boundary/i
    );
    assert.deepEqual(fs.readFileSync(reportPath), initialBytes);
    for (const artifactPath of prospectiveArtifacts) {
      assert.equal(fs.existsSync(artifactPath), false, artifactPath);
    }
  } finally {
    fixture.cleanup();
  }
});

test("adjudication rejects invented incomplete duplicate and semantically false mappings", () => {
  const cases = [
    {
      name: "invented candidate finding",
      mutate(judgments) {
        const row = judgments.cases.find((item) => item.case_id === "defect-case");
        row.mappings.push({
          candidate_finding_id: "finding-invented",
          oracle_id: null,
          judge_objective: false,
          location_correct: false,
        });
      },
      expected: /candidate_finding_id is unknown or invented/,
    },
    {
      name: "omitted candidate finding",
      mutate(judgments) {
        const row = judgments.cases.find((item) => item.case_id === "defect-case");
        row.mappings = [];
      },
      expected: /mappings is missing candidate finding/,
    },
    {
      name: "duplicate candidate finding",
      mutate(judgments) {
        const row = judgments.cases.find((item) => item.case_id === "defect-case");
        row.mappings.push(structuredClone(row.mappings[0]));
      },
      expected: /candidate_finding_id is duplicated/,
    },
    {
      name: "unknown oracle finding",
      mutate(judgments) {
        const row = judgments.cases.find((item) => item.case_id === "defect-case");
        row.mappings[0].oracle_id = "oracle-invented";
      },
      expected: /oracle_id is unknown/,
    },
    {
      name: "judge truth contradicts oracle",
      mutate(judgments) {
        const row = judgments.cases.find((item) => item.case_id === "defect-case");
        row.mappings[0].judge_objective = false;
      },
      expected: /judge_objective must match the oracle truth/,
    },
    {
      name: "judgment-authored blocked outcome",
      mutate(judgments) {
        judgments.cases[0].blocked = true;
      },
      expected: /judgments\.cases\[0\] has unknown field blocked/,
    },
  ];

  for (const item of cases) {
    const fixture = evidenceFixture();
    const capture = captureFromFixture(fixture);
    const judgments = judgmentsFromFixture(fixture);
    item.mutate(judgments);
    assert.throws(
      () =>
        sealCapabilityAdjudication({
          rootDir: fixture.root,
          oracle: fixture.oracle,
          capture,
          judgments,
          reportPath: path.join(fixture.root, `${item.name.replaceAll(" ", "-")}.json`),
          fixVerifier: fakeFixVerifier,
        }),
      item.expected,
      item.name
    );
    fixture.cleanup();
  }
});

test("adjudication rejects a generic user report that omits bound candidate finding IDs", () => {
  const fixture = evidenceFixture();
  const capture = captureFromFixture(fixture);
  const judgments = judgmentsFromFixture(fixture);
  const evidence = capture.cases.find((item) => item.case_id === "defect-case");
  const outputPath = path.join(fixture.root, evidence.candidate_output.path);
  fs.writeFileSync(
    outputPath,
    "# Critique\n\nOnly a longer finding-responsive-overflow-extra token is present.\n"
  );
  evidence.candidate_output.sha256 = digest(fs.readFileSync(outputPath));

  assert.throws(
    () =>
      sealCapabilityAdjudication({
        rootDir: fixture.root,
        oracle: fixture.oracle,
        capture,
        judgments,
        reportPath: path.join(fixture.root, "generic-output-report.json"),
        fixVerifier: fakeFixVerifier,
      }),
    /candidate_output must reference candidate finding finding-responsive-overflow/
  );
  fixture.cleanup();
});

test("capability reports reject missing and tampered run evidence", () => {
  for (const mutation of [
    {
      name: "fixture bytes",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.fixture.path), "tampered");
      },
      expected: /fixture.*sha256.*match/i,
    },
    {
      name: "runtime profile identity",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const target = path.join(fixture.root, row.run.runtime_profile.path);
        const identity = JSON.parse(fs.readFileSync(target, "utf8"));
        identity.model = "different-model";
        fs.writeFileSync(target, `${JSON.stringify(identity)}\n`);
        row.run.runtime_profile.sha256 = digest(fs.readFileSync(target));
      },
      expected: /runtime_profile model must match/i,
    },
    {
      name: "source identity bytes",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.source_identity.path), "tampered");
      },
      expected: /source_identity.*sha256.*match/i,
    },
    {
      name: "dirty source identity",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const target = path.join(fixture.root, row.source_identity.path);
        const identity = JSON.parse(fs.readFileSync(target, "utf8"));
        identity.dirty = true;
        fs.writeFileSync(target, `${JSON.stringify(identity)}\n`);
        row.source_identity.sha256 = digest(fs.readFileSync(target));
      },
      expected: /source_identity\.dirty must be false/i,
    },
    {
      name: "staged runtime mutation",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(
          path.join(
            fixture.root,
            "eval-results",
            "runs",
            row.run.run_id,
            "runtime",
            "pm",
            "runtime-marker.txt"
          ),
          "mutated"
        );
      },
      expected: /runtime_hash must match the retained staged runtime/i,
    },
    {
      name: "mixed repeat source identity",
      apply(fixture) {
        const row = fixture.report.repeats[1].cases[0];
        const target = path.join(fixture.root, row.source_identity.path);
        const identity = JSON.parse(fs.readFileSync(target, "utf8"));
        identity.source_ref = "fedcba9876543210fedcba9876543210fedcba98";
        fs.writeFileSync(target, `${JSON.stringify(identity)}\n`);
        row.source_identity.sha256 = digest(fs.readFileSync(target));
        const adjudicationPath = path.join(fixture.root, row.adjudication.path);
        const adjudication = JSON.parse(fs.readFileSync(adjudicationPath, "utf8"));
        adjudication.evidence.source_identity_sha256 = row.source_identity.sha256;
        fs.writeFileSync(adjudicationPath, `${JSON.stringify(adjudication)}\n`);
        row.adjudication.sha256 = digest(fs.readFileSync(adjudicationPath));
      },
      expected: /source_identity must match every other capability run exactly/i,
    },
    {
      name: "normalized transcript",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.normalized_transcript.path), "{}\n");
      },
      expected: /normalized_transcript.*sha256.*match/i,
    },
    {
      name: "staged scenario identity binding",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.scenario_identity.path), "tampered");
      },
      expected: /scenario_identity.*sha256.*match/i,
    },
    {
      name: "rewritten staged scenario and matching self-declared identity",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const scenarioPath = path.join(
          fixture.root,
          "eval-results",
          "runs",
          row.run.run_id,
          "scenario",
          "checks.sh"
        );
        fs.appendFileSync(scenarioPath, "\n# rewritten scenario\n");
        const identityPath = path.join(fixture.root, row.scenario_identity.path);
        const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
        identity.scenario_hash = hashTree(path.dirname(scenarioPath)).hash;
        fs.writeFileSync(identityPath, `${JSON.stringify(identity)}\n`);
        row.scenario_identity.sha256 = digest(fs.readFileSync(identityPath));

        const adjudicationPath = path.join(fixture.root, row.adjudication.path);
        const adjudication = JSON.parse(fs.readFileSync(adjudicationPath, "utf8"));
        adjudication.evidence.scenario_identity_sha256 = row.scenario_identity.sha256;
        fs.writeFileSync(adjudicationPath, `${JSON.stringify(adjudication)}\n`);
        row.adjudication.sha256 = digest(fs.readFileSync(adjudicationPath));
      },
      expected: /scenario_hash must match the deterministic capability scenario/i,
    },
    {
      name: "candidate output",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.candidate_output.path), "tampered");
      },
      expected: /candidate_output.*sha256.*match/i,
    },
    {
      name: "candidate findings ledger",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.candidate_findings.path), "tampered");
      },
      expected: /candidate_findings.*sha256.*match/i,
    },
    {
      name: "oracle isolation evidence",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.oracle_isolation.path), "tampered");
      },
      expected: /oracle_isolation.*sha256.*match/i,
    },
    {
      name: "self-declared isolation without bound enforcement evidence",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const isolation = JSON.parse(
          fs.readFileSync(path.join(fixture.root, row.oracle_isolation.path), "utf8")
        );
        fs.rmSync(path.join(fixture.root, isolation.bindings.policy.path));
      },
      expected: /oracle_isolation\.bindings\.policy evidence file is missing/i,
    },
    {
      name: "post-run subject",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.appendFileSync(path.join(fixture.root, row.post_subject.path), "tampered");
      },
      expected: /post_subject.*sha256.*match/i,
    },
    {
      name: "fix verification result",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const verificationPath = path.join(fixture.root, row.fix_verification.path);
        const verification = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
        verification.results[0].status = "fail";
        fs.writeFileSync(verificationPath, `${JSON.stringify(verification)}\n`);
        row.fix_verification.sha256 = digest(fs.readFileSync(verificationPath));

        const adjudicationPath = path.join(fixture.root, row.adjudication.path);
        const adjudication = JSON.parse(fs.readFileSync(adjudicationPath, "utf8"));
        adjudication.evidence.fix_verification_sha256 = row.fix_verification.sha256;
        fs.writeFileSync(adjudicationPath, `${JSON.stringify(adjudication)}\n`);
        row.adjudication.sha256 = digest(fs.readFileSync(adjudicationPath));
      },
      expected: /fix_verification.*results must match recomputed post-run fix verification/i,
    },
    {
      name: "missing fix verification",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.rmSync(path.join(fixture.root, row.fix_verification.path));
      },
      expected: /fix_verification.*missing/i,
    },
    {
      name: "independently authored findings",
      apply(fixture) {
        fixture.report.repeats[0].cases[0].findings = [];
      },
      expected: /adjudication.*findings must match the report row/i,
    },
    {
      name: "adjudication evidence substitution",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const target = path.join(fixture.root, row.adjudication.path);
        const adjudication = JSON.parse(fs.readFileSync(target, "utf8"));
        adjudication.evidence.candidate_output_sha256 = `sha256:${"c".repeat(64)}`;
        fs.writeFileSync(target, `${JSON.stringify(adjudication)}\n`);
        row.adjudication.sha256 = digest(fs.readFileSync(target));
      },
      expected: /adjudication.*candidate_output_sha256 must match the bound run evidence/i,
    },
    {
      name: "missing adjudication",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.rmSync(path.join(fixture.root, row.adjudication.path));
      },
      expected: /adjudication.*missing/i,
    },
    {
      name: "verdict identity",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const target = path.join(fixture.root, row.run.verdict.path);
        const verdict = JSON.parse(fs.readFileSync(target, "utf8"));
        verdict.run_id = "different-run";
        fs.writeFileSync(target, `${JSON.stringify(verdict)}\n`);
        row.run.verdict.sha256 = digest(fs.readFileSync(target));
      },
      expected: /verdict.*run_id.*match/i,
    },
    {
      name: "missing output",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.rmSync(path.join(fixture.root, row.candidate_output.path));
      },
      expected: /candidate_output.*missing/i,
    },
    {
      name: "hard-linked output",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        fs.linkSync(
          path.join(fixture.root, row.candidate_output.path),
          path.join(fixture.root, "second-link-to-candidate-output")
        );
      },
      expected: /candidate_output evidence must be a regular non-linked file/i,
    },
    {
      name: "intermediate symlink output",
      apply(fixture) {
        const row = fixture.report.repeats[0].cases[0];
        const artifacts = path.dirname(path.join(fixture.root, row.candidate_output.path));
        const relocated = path.join(fixture.root, "relocated-artifacts");
        fs.renameSync(artifacts, relocated);
        fs.symlinkSync(relocated, artifacts, "dir");
      },
      expected: /candidate_output evidence path must not traverse symlinks/i,
    },
  ]) {
    const fixture = evidenceFixture();
    mutation.apply(fixture);
    const issues = validateCapabilityReport(
      fixture.report,
      fixture.oracle,
      evidenceOptions(fixture.root)
    );
    assert.match(issues.join("\n"), mutation.expected, mutation.name);
    fixture.cleanup();
  }
});

test("candidate findings and oracle isolation evidence use closed fail-closed schemas", () => {
  const ledger = {
    schema_version: 1,
    blocked: false,
    summary: "The responsive report has one blocking layout defect.",
    findings: [
      {
        id: "finding-responsive-overflow",
        severity: "high",
        objective: true,
        blocking: true,
        locator: "/report at 390px: .report",
        claimed_fixed: true,
        summary: "The report overflows the narrow viewport.",
      },
    ],
  };
  assert.deepEqual(validateCandidateFindingsLedger(ledger), []);
  assert.match(
    validateCandidateFindingsLedger({ ...ledger, oracle_id: "overflow" }).join("\n"),
    /unknown field oracle_id/
  );
  assert.match(
    validateCandidateFindingsLedger({
      ...ledger,
      findings: [ledger.findings[0], structuredClone(ledger.findings[0])],
    }).join("\n"),
    /duplicates finding-responsive-overflow/
  );

  const isolation = {
    schema_version: 2,
    run_id: "20260905T000000Z--dc-cap-example-sol-high-r1--codex",
    mode: "external-container",
    os_enforced: true,
    source_read_denied: true,
    run_read_allowed: true,
    preflight: {
      denied_source_read: "pass",
      allowed_run_read: "pass",
    },
    bindings: Object.fromEntries(
      ["policy", "launcher", "preflight", "launch_receipt", "command"].map((field) => [
        field,
        { path: `eval-results/${field}.json`, sha256: `sha256:${"0".repeat(64)}` },
      ])
    ),
    producer: {
      id: "pm-capability-oracle-isolation-attestor",
      version: 2,
    },
    reason: null,
  };
  assert.deepEqual(validateOracleIsolationArtifact(isolation, isolation.run_id), []);
  const unattested = structuredClone(isolation);
  unattested.mode = "unattested";
  unattested.os_enforced = false;
  unattested.source_read_denied = false;
  unattested.preflight.denied_source_read = "not-run";
  unattested.preflight.allowed_run_read = "not-run";
  unattested.run_read_allowed = false;
  unattested.bindings = null;
  unattested.reason = "candidate process source reads were not OS-isolated";
  assert.deepEqual(validateOracleIsolationArtifact(unattested, isolation.run_id), []);
});

test("capability scoring rejects semantic laundering and missing isolation evidence", () => {
  const fixture = evidenceFixture({ semanticLaundering: true });

  const scored = scoreCapabilityReport(
    fixture.oracle,
    fixture.report,
    evidenceOptions(fixture.root)
  );
  assert.equal(scored.release_passed, false);
  assert.equal(scored.metrics.p0_p1_recall, 0);
  assert.equal(scored.metrics.objective_precision, 0);
  assert.equal(scored.metrics.claimed_fix_success, 0);
  fixture.cleanup();

  const unattested = evidenceFixture({ unattested: true });
  const unclaimable = scoreCapabilityReport(
    unattested.oracle,
    unattested.report,
    evidenceOptions(unattested.root)
  );
  assert.equal(unclaimable.oracle_isolation.attested, false);
  assert.equal(unclaimable.claimable, false);
  assert.equal(unclaimable.release_passed, false);
  unattested.cleanup();
});
