#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { parseJsonl } = require("./transcript.js");

const METRICS = Object.freeze([
  "p0_p1_recall",
  "objective_precision",
  "clean_control_false_block_rate",
  "locator_accuracy",
  "severity_accuracy",
  "claimed_fix_success",
]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/;
const FIXTURE_PATTERN =
  /^evals\/quality\/fixtures\/design-critique\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.html$/;
const RUN_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z--[a-z0-9][a-z0-9-]{0,80}--[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

function capabilityScenarioId(caseId, profileId, repeat) {
  const caseToken = sha256(`design-critique-capability:${caseId}`).slice(-12);
  const normalized = `dc-cap-${caseToken}-${profileId}-r${repeat}`;
  if (normalized.length <= 81 && /^[a-z0-9][a-z0-9-]+$/.test(normalized)) return normalized;
  return `dc-cap-${sha256(normalized).slice(-24)}`;
}

function capabilityAdjudicationPath({ benchmarkId, profileId, repeat, caseId }) {
  return [
    "eval-results",
    "capabilities",
    "design-critique",
    "adjudications",
    benchmarkId,
    profileId,
    `repeat-${repeat}`,
    `${caseId}.json`,
  ].join("/");
}

function capabilityFixVerificationPath({ benchmarkId, profileId, repeat, caseId }) {
  return [
    "eval-results",
    "capabilities",
    "design-critique",
    "fix-verification",
    benchmarkId,
    profileId,
    `repeat-${repeat}`,
    `${caseId}.json`,
  ].join("/");
}

function validateCapabilityOracle(oracle) {
  const issues = [];
  if (
    !closedObject(
      oracle,
      ["schema_version", "benchmark_id", "minimum_repeats", "thresholds", "cases"],
      ["schema_version", "benchmark_id", "minimum_repeats", "thresholds", "cases"],
      "oracle",
      issues
    )
  ) {
    return issues;
  }

  if (oracle.schema_version !== 1) issues.push("oracle.schema_version must equal 1");
  if (!ID_PATTERN.test(String(oracle.benchmark_id || ""))) {
    issues.push("oracle.benchmark_id must be a lowercase slug");
  }
  if (!Number.isInteger(oracle.minimum_repeats) || oracle.minimum_repeats < 3) {
    issues.push("oracle.minimum_repeats must be an integer of at least 3");
  }

  if (closedObject(oracle.thresholds, METRICS, METRICS, "oracle.thresholds", issues)) {
    for (const metric of METRICS) {
      if (!numberBetween(oracle.thresholds[metric], 0, 1)) {
        issues.push(`oracle.thresholds.${metric} must be a number from 0 to 1`);
      }
    }
  }

  if (!Array.isArray(oracle.cases) || oracle.cases.length < 2) {
    issues.push("oracle.cases must contain defective cases and a clean control");
    return issues;
  }

  const caseIds = new Set();
  const defectIds = new Set();
  let cleanControls = 0;
  let defectiveCases = 0;
  for (const [index, item] of oracle.cases.entries()) {
    const where = `oracle.cases[${index}]`;
    if (
      !closedObject(
        item,
        ["id", "fixture_ref", "fixture_sha256", "clean_control", "defects"],
        ["id", "fixture_ref", "fixture_sha256", "clean_control", "defects"],
        where,
        issues
      )
    ) {
      continue;
    }
    if (!ID_PATTERN.test(String(item.id || ""))) issues.push(`${where}.id must be a slug`);
    if (caseIds.has(item.id)) issues.push(`${where}.id duplicates case ${item.id}`);
    caseIds.add(item.id);
    if (!FIXTURE_PATTERN.test(String(item.fixture_ref || "")) || item.fixture_ref.includes("..")) {
      issues.push(`${where}.fixture_ref must be a safe design-critique HTML fixture path`);
    }
    if (!HASH_PATTERN.test(String(item.fixture_sha256 || ""))) {
      issues.push(`${where}.fixture_sha256 must be a sha256 digest`);
    }
    if (typeof item.clean_control !== "boolean") {
      issues.push(`${where}.clean_control must be a boolean`);
    }
    if (!Array.isArray(item.defects)) {
      issues.push(`${where}.defects must be an array`);
      continue;
    }
    if (item.clean_control === true) {
      cleanControls += 1;
      if (item.defects.length !== 0) issues.push(`${where} clean control must have no defects`);
    } else {
      defectiveCases += 1;
      if (item.defects.length === 0) issues.push(`${where} defective case must contain defects`);
    }

    for (const [defectIndex, defect] of item.defects.entries()) {
      const defectWhere = `${where}.defects[${defectIndex}]`;
      if (
        !closedObject(
          defect,
          ["id", "severity", "objective", "route", "state", "locator", "fix_oracle"],
          ["id", "severity", "objective", "route", "state", "locator", "fix_oracle"],
          defectWhere,
          issues
        )
      ) {
        continue;
      }
      if (!ID_PATTERN.test(String(defect.id || ""))) {
        issues.push(`${defectWhere}.id must be a slug`);
      }
      if (defectIds.has(defect.id)) {
        issues.push(`${defectWhere}.id duplicates defect ${defect.id}`);
      }
      defectIds.add(defect.id);
      if (!SEVERITIES.has(defect.severity)) {
        issues.push(`${defectWhere}.severity must be low, medium, high, or critical`);
      }
      if (typeof defect.objective !== "boolean") {
        issues.push(`${defectWhere}.objective must be a boolean`);
      }
      if (!nonempty(defect.route) || !defect.route.startsWith("/")) {
        issues.push(`${defectWhere}.route must start with /`);
      }
      for (const field of ["state", "locator", "fix_oracle"]) {
        if (!nonempty(defect[field])) issues.push(`${defectWhere}.${field} is required`);
      }
    }
  }
  if (cleanControls === 0) issues.push("oracle.cases must include a clean control");
  if (defectiveCases === 0) issues.push("oracle.cases must include a defective case");
  return issues;
}

function validateCapabilityReport(report, oracle, options = {}) {
  const issues = [];
  const oracleIssues = validateCapabilityOracle(oracle);
  if (oracleIssues.length > 0) {
    return oracleIssues.map((message) => `invalid oracle: ${message}`);
  }
  if (
    !closedObject(
      report,
      ["schema_version", "benchmark_id", "profile", "repeats"],
      ["schema_version", "benchmark_id", "profile", "repeats"],
      "report",
      issues
    )
  ) {
    return issues;
  }
  if (report.schema_version === 1) {
    issues.push(
      "report.schema_version 1 cannot support evidence-bound claims; rerun the capability benchmark and adjudication to create schema 2 evidence"
    );
    return issues;
  }
  if (report.schema_version !== 2) issues.push("report.schema_version must equal 2");
  if (report.benchmark_id !== oracle.benchmark_id) {
    issues.push("report.benchmark_id must match the oracle");
  }
  if (
    closedObject(
      report.profile,
      ["id", "adapter", "model", "effort"],
      ["id", "adapter", "model", "effort"],
      "report.profile",
      issues
    )
  ) {
    for (const field of ["id", "adapter", "model", "effort"]) {
      if (!nonempty(report.profile[field])) issues.push(`report.profile.${field} is required`);
    }
    if (!ID_PATTERN.test(String(report.profile.id || ""))) {
      issues.push("report.profile.id must be a lowercase slug");
    }
    if (!["codex", "claude"].includes(report.profile.adapter)) {
      issues.push("report.profile.adapter must be codex or claude");
    }
  }
  const rootDir = evidenceRoot(options.rootDir, issues);
  if (!Array.isArray(report.repeats) || report.repeats.length === 0) {
    issues.push("report.repeats must be a non-empty array");
    return issues;
  }

  const expectedCases = new Map(oracle.cases.map((item) => [item.id, item]));
  const repeatIds = new Set();
  for (const [repeatIndex, repeat] of report.repeats.entries()) {
    const repeatWhere = `report.repeats[${repeatIndex}]`;
    if (!closedObject(repeat, ["repeat", "cases"], ["repeat", "cases"], repeatWhere, issues)) {
      continue;
    }
    if (!Number.isInteger(repeat.repeat) || repeat.repeat < 1) {
      issues.push(`${repeatWhere}.repeat must be a positive integer`);
    }
    if (repeatIds.has(repeat.repeat)) {
      issues.push(`${repeatWhere}.repeat duplicates repeat ${repeat.repeat}`);
    }
    repeatIds.add(repeat.repeat);
    if (!Array.isArray(repeat.cases)) {
      issues.push(`${repeatWhere}.cases must be an array`);
      continue;
    }
    const foundCases = new Set();
    for (const [caseIndex, result] of repeat.cases.entries()) {
      const caseWhere = `${repeatWhere}.cases[${caseIndex}]`;
      if (
        !closedObject(
          result,
          [
            "case_id",
            "fixture",
            "run",
            "normalized_transcript",
            "candidate_output",
            "post_subject",
            "fix_verification",
            "adjudication",
            "blocked",
            "findings",
          ],
          [
            "case_id",
            "fixture",
            "run",
            "normalized_transcript",
            "candidate_output",
            "post_subject",
            "fix_verification",
            "adjudication",
            "blocked",
            "findings",
          ],
          caseWhere,
          issues
        )
      ) {
        continue;
      }
      const expected = expectedCases.get(result.case_id);
      if (!expected) issues.push(`${caseWhere}.case_id is unknown`);
      if (foundCases.has(result.case_id)) {
        issues.push(`${caseWhere}.case_id duplicates case ${result.case_id}`);
      }
      foundCases.add(result.case_id);
      if (expected && rootDir && plainObject(report.profile)) {
        validateEvidenceRow({
          result,
          expected,
          repeat: repeat.repeat,
          profile: report.profile,
          benchmarkId: oracle.benchmark_id,
          oracleHash: capabilityOracleHash(oracle),
          rootDir,
          fixVerifier: options.fixVerifier,
          browserPath: options.browserPath,
          where: caseWhere,
          issues,
        });
      }
      if (typeof result.blocked !== "boolean") issues.push(`${caseWhere}.blocked must be boolean`);
      if (!Array.isArray(result.findings)) {
        issues.push(`${caseWhere}.findings must be an array`);
        continue;
      }
      const knownDefects = new Set((expected?.defects || []).map((item) => item.id));
      const matchedDefects = new Set();
      for (const [findingIndex, finding] of result.findings.entries()) {
        const findingWhere = `${caseWhere}.findings[${findingIndex}]`;
        if (
          !closedObject(
            finding,
            [
              "oracle_id",
              "severity",
              "objective",
              "blocking",
              "location_correct",
              "claimed_fixed",
              "fix_verified",
            ],
            [
              "oracle_id",
              "severity",
              "objective",
              "blocking",
              "location_correct",
              "claimed_fixed",
              "fix_verified",
            ],
            findingWhere,
            issues
          )
        ) {
          continue;
        }
        if (finding.oracle_id !== null) {
          if (!knownDefects.has(finding.oracle_id)) {
            issues.push(`${findingWhere}.oracle_id is unknown for case ${result.case_id}`);
          }
          if (matchedDefects.has(finding.oracle_id)) {
            issues.push(`${findingWhere}.oracle_id duplicates ${finding.oracle_id}`);
          }
          matchedDefects.add(finding.oracle_id);
        } else if (finding.location_correct === true) {
          issues.push(`${findingWhere}.location_correct cannot be true without an oracle_id`);
        }
        if (!SEVERITIES.has(finding.severity)) {
          issues.push(`${findingWhere}.severity must be low, medium, high, or critical`);
        }
        for (const field of [
          "objective",
          "blocking",
          "location_correct",
          "claimed_fixed",
          "fix_verified",
        ]) {
          if (typeof finding[field] !== "boolean") {
            issues.push(`${findingWhere}.${field} must be a boolean`);
          }
        }
        if (finding.claimed_fixed === false && finding.fix_verified === true) {
          issues.push(`${findingWhere}.fix_verified requires claimed_fixed`);
        }
      }
    }
    for (const caseId of expectedCases.keys()) {
      if (!foundCases.has(caseId)) issues.push(`${repeatWhere}.cases is missing case ${caseId}`);
    }
  }
  return issues;
}

function validateEvidenceRow({
  result,
  expected,
  repeat,
  profile,
  benchmarkId,
  oracleHash,
  rootDir,
  fixVerifier,
  browserPath,
  where,
  issues,
}) {
  const scenarioId = capabilityScenarioId(expected.id, profile.id, repeat);
  if (
    !closedObject(
      result.run,
      ["run_id", "scenario_id", "adapter", "status", "artifact_ref", "runtime_profile", "verdict"],
      ["run_id", "scenario_id", "adapter", "status", "artifact_ref", "runtime_profile", "verdict"],
      `${where}.run`,
      issues
    )
  ) {
    return;
  }

  const run = result.run;
  const expectedSuffix = `--${scenarioId}--${profile.adapter}`;
  if (!RUN_ID_PATTERN.test(String(run.run_id || "")) || !run.run_id.endsWith(expectedSuffix)) {
    issues.push(
      `${where}.run.run_id must bind scenario ${scenarioId} and adapter ${profile.adapter}`
    );
  }
  if (run.scenario_id !== scenarioId) {
    issues.push(`${where}.run.scenario_id must match ${scenarioId}`);
  }
  if (run.adapter !== profile.adapter) {
    issues.push(`${where}.run.adapter must match report.profile.adapter`);
  }
  if (run.status !== "pass") issues.push(`${where}.run.status must equal pass`);
  if (run.artifact_ref !== `runs/${run.run_id}`) {
    issues.push(`${where}.run.artifact_ref must match run_id`);
  }

  const runRoot = `eval-results/runs/${run.run_id}`;
  const fixtureBytes = validateBoundFile(
    rootDir,
    result.fixture,
    `${runRoot}/metadata/inputs/design-critique-fixture.html`,
    `${where}.fixture`,
    issues
  );
  if (plainObject(result.fixture) && result.fixture.sha256 !== expected.fixture_sha256) {
    issues.push(`${where}.fixture.sha256 must match oracle fixture_sha256`);
  }

  const profileBytes = validateBoundFile(
    rootDir,
    run.runtime_profile,
    `${runRoot}/metadata/runtime_profile_identity.json`,
    `${where}.run.runtime_profile`,
    issues
  );
  if (profileBytes) {
    const identity = parseJsonEvidence(profileBytes, `${where}.run.runtime_profile`, issues);
    if (identity) {
      for (const field of ["id", "adapter", "model", "effort"]) {
        if (identity[field] !== profile[field]) {
          issues.push(`${where}.run.runtime_profile ${field} must match report.profile.${field}`);
        }
      }
      if (identity.harness_only === true) {
        issues.push(`${where}.run.runtime_profile cannot be harness-only evidence`);
      }
    }
  }

  const verdictBytes = validateBoundFile(
    rootDir,
    run.verdict,
    `${runRoot}/verdict.json`,
    `${where}.run.verdict`,
    issues
  );
  if (verdictBytes) {
    const verdict = parseJsonEvidence(verdictBytes, `${where}.run.verdict`, issues);
    if (verdict) {
      const expectedVerdict = {
        run_id: run.run_id,
        scenario: run.scenario_id,
        agent: run.adapter,
        status: run.status,
        artifact_ref: run.artifact_ref,
      };
      for (const [field, value] of Object.entries(expectedVerdict)) {
        if (verdict[field] !== value) {
          issues.push(`${where}.run.verdict ${field} must match report run identity`);
        }
      }
    }
  }

  const transcriptBytes = validateBoundFile(
    rootDir,
    result.normalized_transcript,
    `${runRoot}/metadata/transcript.normalized.jsonl`,
    `${where}.normalized_transcript`,
    issues
  );
  if (transcriptBytes) {
    const parsed = parseJsonl(transcriptBytes.toString("utf8"));
    if (parsed.status !== "pass") {
      issues.push(`${where}.normalized_transcript must be valid non-empty JSONL`);
    } else if (
      !parsed.events.some((event) => event.type === "skill" && event.name === "pm:design-critique")
    ) {
      issues.push(`${where}.normalized_transcript must show pm:design-critique use`);
    }
  }

  const outputBytes = validateBoundFile(
    rootDir,
    result.candidate_output,
    `${runRoot}/artifacts/quality-output.md`,
    `${where}.candidate_output`,
    issues
  );
  if (outputBytes && !outputBytes.toString("utf8").trim()) {
    issues.push(`${where}.candidate_output must not be empty`);
  }

  const postSubjectBytes = validateBoundFile(
    rootDir,
    result.post_subject,
    `${runRoot}/workdir/ui/design-critique/capability-case.html`,
    `${where}.post_subject`,
    issues
  );
  const fixVerificationBytes = validateBoundFile(
    rootDir,
    result.fix_verification,
    capabilityFixVerificationPath({
      benchmarkId,
      profileId: profile.id,
      repeat,
      caseId: expected.id,
    }),
    `${where}.fix_verification`,
    issues
  );
  let verifiedFixes = null;
  if (fixVerificationBytes && postSubjectBytes) {
    const verification = parseJsonEvidence(
      fixVerificationBytes,
      `${where}.fix_verification`,
      issues
    );
    if (verification) {
      verifiedFixes = validateFixVerificationArtifact(
        verification,
        {
          benchmarkId,
          oracleHash,
          profile,
          repeat,
          expected,
          run,
          fixtureSha256: result.fixture?.sha256,
          postSubjectSha256: result.post_subject?.sha256,
          postSubjectPath: path.join(rootDir, result.post_subject.path),
          fixVerifier,
          browserPath,
          rootDir,
        },
        `${where}.fix_verification`,
        issues
      );
    }
  }

  for (const [index, finding] of (Array.isArray(result.findings)
    ? result.findings
    : []
  ).entries()) {
    if (!finding || finding.claimed_fixed !== true) continue;
    const findingWhere = `${where}.findings[${index}]`;
    if (!finding.oracle_id) {
      issues.push(`${findingWhere}.claimed_fixed requires a matched oracle_id`);
      continue;
    }
    const verificationStatus = verifiedFixes?.get(finding.oracle_id);
    if (!verificationStatus) {
      issues.push(`${findingWhere}.claimed_fixed requires independent fix-verification evidence`);
    } else if (verificationStatus === "indeterminate") {
      issues.push(`${findingWhere}.claimed_fixed requires a conclusive fix-verification result`);
    } else if (finding.fix_verified !== (verificationStatus === "pass")) {
      issues.push(`${findingWhere}.fix_verified must match the recomputed fix-verification result`);
    }
  }

  const adjudicationBytes = validateBoundFile(
    rootDir,
    result.adjudication,
    capabilityAdjudicationPath({
      benchmarkId,
      profileId: profile.id,
      repeat,
      caseId: expected.id,
    }),
    `${where}.adjudication`,
    issues
  );
  if (adjudicationBytes) {
    const adjudication = parseJsonEvidence(adjudicationBytes, `${where}.adjudication`, issues);
    if (adjudication) {
      validateAdjudicationArtifact(
        adjudication,
        {
          benchmarkId,
          oracleHash,
          profile,
          repeat,
          caseId: expected.id,
          result,
          expectedEvidence: {
            fixture_sha256: result.fixture?.sha256,
            run_id: run.run_id,
            scenario_id: run.scenario_id,
            adapter: run.adapter,
            runtime_profile_sha256: run.runtime_profile?.sha256,
            verdict_sha256: run.verdict?.sha256,
            normalized_transcript_sha256: result.normalized_transcript?.sha256,
            candidate_output_sha256: result.candidate_output?.sha256,
            post_subject_sha256: result.post_subject?.sha256,
            fix_verification_sha256: result.fix_verification?.sha256,
          },
        },
        `${where}.adjudication`,
        issues
      );
    }
  }

  if (fixtureBytes && sha256(fixtureBytes) !== expected.fixture_sha256) {
    issues.push(`${where}.fixture bytes must match the oracle fixture`);
  }
}

function validateFixVerificationArtifact(verification, expected, where, issues) {
  if (
    !closedObject(
      verification,
      [
        "schema_version",
        "benchmark_id",
        "oracle_sha256",
        "profile",
        "repeat",
        "case_id",
        "run_id",
        "fixture_sha256",
        "post_subject_sha256",
        "producer",
        "results",
      ],
      [
        "schema_version",
        "benchmark_id",
        "oracle_sha256",
        "profile",
        "repeat",
        "case_id",
        "run_id",
        "fixture_sha256",
        "post_subject_sha256",
        "producer",
        "results",
      ],
      where,
      issues
    )
  ) {
    return null;
  }
  if (verification.schema_version !== 1) issues.push(`${where}.schema_version must equal 1`);
  const scalarExpectations = {
    benchmark_id: expected.benchmarkId,
    oracle_sha256: expected.oracleHash,
    repeat: expected.repeat,
    case_id: expected.expected.id,
    run_id: expected.run.run_id,
    fixture_sha256: expected.fixtureSha256,
    post_subject_sha256: expected.postSubjectSha256,
  };
  for (const [field, value] of Object.entries(scalarExpectations)) {
    if (verification[field] !== value) {
      issues.push(`${where}.${field} must match the bound capability evidence`);
    }
  }
  if (!isDeepStrictEqual(verification.profile, expected.profile)) {
    issues.push(`${where}.profile must match the report profile`);
  }
  if (
    !closedObject(
      verification.producer,
      ["id", "version"],
      ["id", "version"],
      `${where}.producer`,
      issues
    ) ||
    verification.producer.id !== "pm:design-critique-capability-fix-verifier" ||
    verification.producer.version !== 1
  ) {
    issues.push(`${where}.producer must identify fix verifier version 1`);
  }
  if (!Array.isArray(verification.results)) {
    issues.push(`${where}.results must be an array`);
    return null;
  }
  const expectedIds = new Set(expected.expected.defects.map((defect) => defect.id));
  const found = new Map();
  for (const [index, result] of verification.results.entries()) {
    const resultWhere = `${where}.results[${index}]`;
    if (
      !closedObject(
        result,
        ["oracle_id", "fix_oracle_sha256", "verification_sha256", "status"],
        ["oracle_id", "fix_oracle_sha256", "verification_sha256", "status"],
        resultWhere,
        issues
      )
    ) {
      continue;
    }
    if (!expectedIds.has(result.oracle_id)) issues.push(`${resultWhere}.oracle_id is unknown`);
    if (found.has(result.oracle_id)) issues.push(`${resultWhere}.oracle_id is duplicated`);
    if (!["pass", "fail", "indeterminate"].includes(result.status)) {
      issues.push(`${resultWhere}.status is invalid`);
    }
    if (!HASH_PATTERN.test(String(result.fix_oracle_sha256 || ""))) {
      issues.push(`${resultWhere}.fix_oracle_sha256 must be a sha256 digest`);
    }
    if (!HASH_PATTERN.test(String(result.verification_sha256 || ""))) {
      issues.push(`${resultWhere}.verification_sha256 must be a sha256 digest`);
    }
    found.set(result.oracle_id, result.status);
  }
  for (const id of expectedIds) {
    if (!found.has(id)) issues.push(`${where}.results is missing oracle defect ${id}`);
  }

  let recomputed;
  try {
    const verifier = resolveFixVerifier(expected.rootDir, expected.fixVerifier);
    recomputed = verifier({
      oracleCase: expected.expected,
      htmlPath: expected.postSubjectPath,
      browserPath: expected.browserPath,
    });
  } catch (error) {
    issues.push(`${where} could not recompute fix verification: ${error.message}`);
    return null;
  }
  if (!isDeepStrictEqual(verification.results, recomputed)) {
    issues.push(`${where}.results must match recomputed post-run fix verification`);
    return null;
  }
  return new Map(recomputed.map((result) => [result.oracle_id, result.status]));
}

function resolveFixVerifier(rootDir, injected) {
  if (typeof injected === "function") return injected;
  const modulePath = path.join(rootDir, "evals", "capabilities", "design-critique", "verify.js");
  return require(modulePath).verifyPostSubject;
}

function validateAdjudicationArtifact(adjudication, expected, where, issues) {
  if (
    !closedObject(
      adjudication,
      [
        "schema_version",
        "benchmark_id",
        "oracle_sha256",
        "profile",
        "repeat",
        "case_id",
        "evidence",
        "blocked",
        "findings",
      ],
      [
        "schema_version",
        "benchmark_id",
        "oracle_sha256",
        "profile",
        "repeat",
        "case_id",
        "evidence",
        "blocked",
        "findings",
      ],
      where,
      issues
    )
  ) {
    return;
  }
  if (adjudication.schema_version !== 1) issues.push(`${where}.schema_version must equal 1`);
  if (adjudication.benchmark_id !== expected.benchmarkId) {
    issues.push(`${where}.benchmark_id must match the report benchmark`);
  }
  if (adjudication.oracle_sha256 !== expected.oracleHash) {
    issues.push(`${where}.oracle_sha256 must match the exact capability oracle`);
  }
  if (adjudication.repeat !== expected.repeat) {
    issues.push(`${where}.repeat must match the report repeat`);
  }
  if (adjudication.case_id !== expected.caseId) {
    issues.push(`${where}.case_id must match the report case`);
  }
  if (
    closedObject(
      adjudication.profile,
      ["id", "adapter", "model", "effort"],
      ["id", "adapter", "model", "effort"],
      `${where}.profile`,
      issues
    ) &&
    !isDeepStrictEqual(adjudication.profile, expected.profile)
  ) {
    issues.push(`${where}.profile must match the report profile`);
  }
  const evidenceFields = [
    "fixture_sha256",
    "run_id",
    "scenario_id",
    "adapter",
    "runtime_profile_sha256",
    "verdict_sha256",
    "normalized_transcript_sha256",
    "candidate_output_sha256",
    "post_subject_sha256",
    "fix_verification_sha256",
  ];
  if (
    closedObject(adjudication.evidence, evidenceFields, evidenceFields, `${where}.evidence`, issues)
  ) {
    for (const field of evidenceFields) {
      if (adjudication.evidence[field] !== expected.expectedEvidence[field]) {
        issues.push(`${where}.evidence.${field} must match the bound run evidence`);
      }
    }
  }
  if (adjudication.blocked !== expected.result.blocked) {
    issues.push(`${where}.blocked must match the report row`);
  }
  if (!isDeepStrictEqual(adjudication.findings, expected.result.findings)) {
    issues.push(`${where}.findings must match the report row`);
  }
}

function evidenceRoot(rootDir, issues) {
  if (!nonempty(rootDir)) {
    issues.push("report evidence validation requires options.rootDir");
    return null;
  }
  try {
    return fs.realpathSync(path.resolve(rootDir));
  } catch (error) {
    issues.push(`report evidence root is unavailable: ${error.code || error.message}`);
    return null;
  }
}

function validateBoundFile(rootDir, binding, expectedPath, where, issues) {
  if (!closedObject(binding, ["path", "sha256"], ["path", "sha256"], where, issues)) {
    return null;
  }
  if (binding.path !== expectedPath) {
    issues.push(`${where}.path must equal ${expectedPath}`);
    return null;
  }
  if (!HASH_PATTERN.test(String(binding.sha256 || ""))) {
    issues.push(`${where}.sha256 must be a sha256 digest`);
  }
  const absolute = path.resolve(rootDir, binding.path);
  if (!inside(rootDir, absolute)) {
    issues.push(`${where}.path escapes the evidence root`);
    return null;
  }
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    issues.push(`${where} evidence file is missing`);
    return null;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    issues.push(`${where} evidence must be a regular non-linked file`);
    return null;
  }
  if (stat.size > MAX_EVIDENCE_BYTES) {
    issues.push(`${where} evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    return null;
  }
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch {
    issues.push(`${where} evidence real path is unavailable`);
    return null;
  }
  if (!inside(rootDir, real)) {
    issues.push(`${where} evidence real path escapes the evidence root`);
    return null;
  }
  const bytes = fs.readFileSync(real);
  if (sha256(bytes) !== binding.sha256) {
    issues.push(`${where}.sha256 must match evidence bytes`);
    return null;
  }
  return bytes;
}

function parseJsonEvidence(bytes, where, issues) {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!plainObject(value)) throw new Error("must be an object");
    return value;
  } catch (error) {
    issues.push(`${where} must contain valid JSON: ${error.message}`);
    return null;
  }
}

function scoreCapabilityReport(oracle, report, options = {}) {
  const oracleIssues = validateCapabilityOracle(oracle);
  const reportIssues =
    oracleIssues.length === 0 ? validateCapabilityReport(report, oracle, options) : [];
  const issues = [...oracleIssues, ...reportIssues];
  if (issues.length > 0)
    throw new Error(`invalid design-critique capability data:\n${issues.join("\n")}`);

  const cases = new Map(oracle.cases.map((item) => [item.id, item]));
  const totals = {
    blockingExpected: 0,
    blockingDetected: 0,
    objectiveReported: 0,
    objectiveMatched: 0,
    cleanRuns: 0,
    cleanFalseBlocks: 0,
    matched: 0,
    correctLocations: 0,
    correctSeverities: 0,
    claimedFixes: 0,
    verifiedFixes: 0,
  };

  for (const repeat of report.repeats) {
    for (const result of repeat.cases) {
      const expected = cases.get(result.case_id);
      const defects = new Map(expected.defects.map((item) => [item.id, item]));
      if (expected.clean_control) {
        totals.cleanRuns += 1;
        if (result.blocked || result.findings.some((finding) => finding.blocking)) {
          totals.cleanFalseBlocks += 1;
        }
      }
      for (const defect of expected.defects) {
        if (!BLOCKING_SEVERITIES.has(defect.severity)) continue;
        totals.blockingExpected += 1;
        if (result.findings.some((finding) => finding.oracle_id === defect.id)) {
          totals.blockingDetected += 1;
        }
      }
      for (const finding of result.findings) {
        const defect = finding.oracle_id === null ? null : defects.get(finding.oracle_id);
        if (finding.objective) {
          totals.objectiveReported += 1;
          if (defect?.objective === true) totals.objectiveMatched += 1;
        }
        if (defect) {
          totals.matched += 1;
          if (finding.location_correct) totals.correctLocations += 1;
          if (finding.severity === defect.severity) totals.correctSeverities += 1;
        }
        if (finding.claimed_fixed) {
          totals.claimedFixes += 1;
          if (finding.fix_verified) totals.verifiedFixes += 1;
        }
      }
    }
  }

  const metrics = {
    p0_p1_recall: ratio(totals.blockingDetected, totals.blockingExpected, 1),
    objective_precision: ratio(totals.objectiveMatched, totals.objectiveReported, 1),
    clean_control_false_block_rate: ratio(totals.cleanFalseBlocks, totals.cleanRuns, 0),
    locator_accuracy: ratio(totals.correctLocations, totals.matched, 1),
    severity_accuracy: ratio(totals.correctSeverities, totals.matched, 1),
    claimed_fix_success: ratio(totals.verifiedFixes, totals.claimedFixes, 1),
  };
  const threshold_results = Object.fromEntries(
    METRICS.map((metric) => {
      const maximum = metric === "clean_control_false_block_rate";
      const threshold = oracle.thresholds[metric];
      const passed = maximum ? metrics[metric] <= threshold : metrics[metric] >= threshold;
      return [
        metric,
        { value: metrics[metric], threshold, comparator: maximum ? "<=" : ">=", passed },
      ];
    })
  );
  const repeatCount = new Set(report.repeats.map((item) => item.repeat)).size;
  const claimable = repeatCount >= oracle.minimum_repeats;
  return {
    schema_version: 1,
    benchmark_id: oracle.benchmark_id,
    profile: structuredClone(report.profile),
    repeat_count: repeatCount,
    minimum_repeats: oracle.minimum_repeats,
    claimable,
    release_passed:
      claimable && Object.values(threshold_results).every((result) => result.passed === true),
    metrics,
    threshold_results,
  };
}

function closedObject(value, allowed, required, where, issues) {
  if (!plainObject(value)) {
    issues.push(`${where} must be an object`);
    return false;
  }
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issues.push(`${where} has unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      issues.push(`${where} is missing field ${key}`);
  }
  return true;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function numberBetween(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function inside(rootDir, candidate) {
  const relative = path.relative(rootDir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function capabilityOracleHash(oracle) {
  return sha256(JSON.stringify(canonicalValue(oracle)));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (!plainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])])
  );
}

function ratio(numerator, denominator, emptyValue) {
  if (denominator === 0) return emptyValue;
  return Number((numerator / denominator).toFixed(6));
}

function parseArgs(argv) {
  const options = { oracle: null, report: null, rootDir: process.cwd(), browserPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--oracle" || arg === "--report" || arg === "--root" || arg === "--browser") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      if (arg === "--root") options.rootDir = path.resolve(value);
      else if (arg === "--browser") options.browserPath = path.resolve(value);
      else options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!options.oracle || !options.report) {
    throw new Error(
      "usage: design-critique-capability.js --oracle <oracle.json> --report <report.json> [--root <repo>] [--browser <chromium>]"
    );
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const oracle = JSON.parse(fs.readFileSync(options.oracle, "utf8"));
    const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
    const result = scoreCapabilityReport(oracle, report, {
      rootDir: options.rootDir,
      browserPath: options.browserPath,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.release_passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  METRICS,
  capabilityAdjudicationPath,
  capabilityFixVerificationPath,
  capabilityOracleHash,
  capabilityScenarioId,
  scoreCapabilityReport,
  validateCapabilityOracle,
  validateCapabilityReport,
};
