"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
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
const { hashTree } = require("../scripts/evals/stage");

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function write(root, relative, bytes) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
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
    schema_version: 3,
    benchmark_id: "design-critique-hidden-v1",
    profile: { id: "sol-high", adapter: "codex", model: "gpt-5.6-sol", effort: "high" },
    repeats: [1, 2, 3].map((repeat) => ({
      repeat,
      cases: expected.cases.map((item, caseIndex) => {
        const scenarioId = capabilityScenarioId(item.id, "sol-high", repeat);
        const stamp = `2026090${repeat}T00000${caseIndex}Z`;
        const runId = `${stamp}--${scenarioId}--codex`;
        const runRoot = `eval-results/runs/${runId}`;
        const fixture = write(
          root,
          `${runRoot}/metadata/inputs/design-critique-fixture.html`,
          `fixture:${item.id}:${caseIndex}`
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
              schema_version: 2,
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
    schema_version: 2,
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
    /schema_version 1 cannot support candidate-ledger and oracle-isolation claims.*rerun/i
  );
  fixture.cleanup();
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
