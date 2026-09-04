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
  validateCapabilityOracle,
  validateCapabilityReport,
} = require("../scripts/evals/design-critique-capability");
const {
  sealCapabilityAdjudication,
} = require("../scripts/evals/design-critique-capability-adjudicate");

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
    schema_version: 2,
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
        const normalizedTranscript = write(
          root,
          `${runRoot}/metadata/transcript.normalized.jsonl`,
          `${JSON.stringify({ type: "skill", name: "pm:design-critique" })}\n`
        );
        const candidateOutput = write(
          root,
          `${runRoot}/artifacts/quality-output.md`,
          `# Critique ${item.id}\n\nEvidence-bound result.\n`
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
        const falseBlock = options.falseBlock === true && item.clean_control;
        const missed = options.miss === true && !item.clean_control;
        const blocked = falseBlock;
        const findings = item.clean_control
          ? falseBlock
            ? [
                {
                  oracle_id: null,
                  severity: "high",
                  objective: true,
                  blocking: true,
                  location_correct: false,
                  claimed_fixed: false,
                  fix_verified: false,
                },
              ]
            : []
          : missed
            ? []
            : [
                {
                  oracle_id: item.defects[0].id,
                  severity: item.defects[0].severity,
                  objective: item.defects[0].objective,
                  blocking: true,
                  location_correct: true,
                  claimed_fixed: true,
                  fix_verified: true,
                },
              ];
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
              evidence: {
                fixture_sha256: fixture.sha256,
                run_id: runId,
                scenario_id: scenarioId,
                adapter: "codex",
                runtime_profile_sha256: runtimeProfile.sha256,
                verdict_sha256: verdictBinding.sha256,
                normalized_transcript_sha256: normalizedTranscript.sha256,
                candidate_output_sha256: candidateOutput.sha256,
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

test("hidden capability oracle and report schemas are closed and validated", () => {
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
    /schema_version 1 cannot support evidence-bound claims.*rerun/i
  );
  fixture.cleanup();
});

test("capability scoring measures recall precision false blocking location severity and fixes", () => {
  const fixture = evidenceFixture();
  const result = scoreCapabilityReport(
    fixture.oracle,
    fixture.report,
    evidenceOptions(fixture.root)
  );
  assert.equal(result.claimable, true);
  assert.equal(result.release_passed, true);
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
  assert.equal(bad.claimable, true);
  assert.equal(bad.release_passed, false);
  assert.equal(bad.metrics.p0_p1_recall, 0);
  assert.equal(bad.metrics.clean_control_false_block_rate, 1);
  badFixture.cleanup();
});

test("adjudication sealing derives report rows from an exact capture and oracle", () => {
  const fixture = evidenceFixture();
  const sourceRepeat = fixture.report.repeats[0];
  const capture = {
    schema_version: 1,
    benchmark_id: fixture.oracle.benchmark_id,
    oracle_sha256: capabilityOracleHash(fixture.oracle),
    profile: structuredClone(fixture.report.profile),
    requested_profile: structuredClone(fixture.report.profile),
    repeat: sourceRepeat.repeat,
    harness_only: false,
    cases: sourceRepeat.cases.map((item) => ({
      case_id: item.case_id,
      fixture: structuredClone(item.fixture),
      run: structuredClone(item.run),
      normalized_transcript: structuredClone(item.normalized_transcript),
      candidate_output: structuredClone(item.candidate_output),
      post_subject: structuredClone(item.post_subject),
    })),
    failures: [],
    created_at: "2026-09-04T00:00:00.000Z",
  };
  const judgments = {
    schema_version: 1,
    repeat: sourceRepeat.repeat,
    cases: sourceRepeat.cases.map((item) => ({
      case_id: item.case_id,
      blocked: item.blocked,
      findings: item.findings.map(({ fix_verified: _derived, ...finding }) => finding),
    })),
  };
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
