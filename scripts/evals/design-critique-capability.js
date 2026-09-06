#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { readBoundedFile } = require("../lib/safe-json-file.js");
const { readCapabilityJson } = require("./design-critique-capability-input.js");
const {
  expectedCapabilityStagedScenarioHash,
} = require("./design-critique-capability-scenario.js");
const { hashTree } = require("./stage.js");
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
const CANDIDATE_ID_PATTERN = /^finding-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIXTURE_PATTERN =
  /^evals\/quality\/fixtures\/design-critique\/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.html$/;
const RUN_ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z--[a-z0-9][a-z0-9-]{0,80}--[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const CANDIDATE_FINDING_FIELDS = Object.freeze([
  "id",
  "severity",
  "objective",
  "blocking",
  "locator",
  "claimed_fixed",
  "summary",
]);
const REPORT_FINDING_FIELDS = Object.freeze([
  "candidate_finding_id",
  "severity",
  "objective",
  "blocking",
  "locator",
  "claimed_fixed",
  "summary",
  "oracle_id",
  "judge_objective",
  "location_correct",
  "fix_verified",
]);
const ISOLATION_MODES = new Set([
  "stub-harness",
  "unattested",
  "external-container",
  "sandbox-exec",
]);
const ISOLATION_BINDING_FIELDS = Object.freeze([
  "policy",
  "launcher",
  "preflight",
  "launch_receipt",
  "command",
]);

function resolveCapabilitySourceBoundary(rootDir) {
  let commonDir;
  try {
    commonDir = execFileSync(
      "git",
      ["-C", rootDir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
  } catch {
    const legacy = execFileSync("git", ["-C", rootDir, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    commonDir = path.resolve(rootDir, legacy);
  }
  const realCommonDir = fs.realpathSync(commonDir);
  const bare =
    execFileSync("git", ["-C", rootDir, "rev-parse", "--is-bare-repository"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim() === "true";
  return bare ? realCommonDir : path.dirname(realCommonDir);
}

function capabilitySandboxPolicy(sourceBoundary, runDir) {
  const writable = ["workdir", "home", "xdg-cache", "xdg-config", "xdg-data", "tmp"].map((entry) =>
    path.join(runDir, entry)
  );
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read* file-write* (subpath "${seatbeltString(sourceBoundary)}"))`,
    `(allow file-read* (subpath "${seatbeltString(runDir)}"))`,
    ...writable.map((entry) => `(allow file-write* (subpath "${seatbeltString(entry)}"))`),
    "",
  ].join("\n");
}

function capabilitySandboxLauncher({
  sandboxBin,
  policyPath,
  candidateBin,
  receiptPath,
  receiptBytes,
}) {
  return `#!/bin/sh\nset -eu\numask 077\n/bin/printf %s ${shellQuote(
    receiptBytes.toString("base64")
  )} | /usr/bin/base64 -D > ${shellQuote(receiptPath)}\nexec ${shellQuote(
    sandboxBin
  )} -f ${shellQuote(policyPath)} ${shellQuote(candidateBin)} "$@"\n`;
}

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

function validateCandidateFindingsLedger(ledger, where = "candidate_findings") {
  const issues = [];
  if (
    !closedObject(
      ledger,
      ["schema_version", "blocked", "summary", "findings"],
      ["schema_version", "blocked", "summary", "findings"],
      where,
      issues
    )
  ) {
    return issues;
  }
  if (ledger.schema_version !== 1) issues.push(`${where}.schema_version must equal 1`);
  if (typeof ledger.blocked !== "boolean") issues.push(`${where}.blocked must be a boolean`);
  if (!nonempty(ledger.summary)) issues.push(`${where}.summary is required`);
  if (!Array.isArray(ledger.findings)) {
    issues.push(`${where}.findings must be an array`);
    return issues;
  }

  const findingIds = new Set();
  for (const [index, finding] of ledger.findings.entries()) {
    const findingWhere = `${where}.findings[${index}]`;
    if (
      !closedObject(
        finding,
        CANDIDATE_FINDING_FIELDS,
        CANDIDATE_FINDING_FIELDS,
        findingWhere,
        issues
      )
    ) {
      continue;
    }
    if (!CANDIDATE_ID_PATTERN.test(String(finding.id || ""))) {
      issues.push(`${findingWhere}.id must be a lowercase finding-* slug`);
    } else if (findingIds.has(finding.id)) {
      issues.push(`${findingWhere}.id duplicates ${finding.id}`);
    }
    findingIds.add(finding.id);
    if (!SEVERITIES.has(finding.severity)) {
      issues.push(`${findingWhere}.severity must be low, medium, high, or critical`);
    }
    for (const field of ["objective", "blocking", "claimed_fixed"]) {
      if (typeof finding[field] !== "boolean") {
        issues.push(`${findingWhere}.${field} must be a boolean`);
      }
    }
    for (const field of ["locator", "summary"]) {
      if (!nonempty(finding[field])) issues.push(`${findingWhere}.${field} is required`);
    }
  }
  return issues;
}

function candidateOutputReferencesFinding(output, findingId) {
  const escaped = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`, "m").test(String(output));
}

function validateOracleIsolationArtifact(isolation, expectedRunId, where = "oracle_isolation") {
  const issues = [];
  if (
    !closedObject(
      isolation,
      [
        "schema_version",
        "run_id",
        "mode",
        "os_enforced",
        "source_read_denied",
        "run_read_allowed",
        "preflight",
        "bindings",
        "producer",
        "reason",
      ],
      [
        "schema_version",
        "run_id",
        "mode",
        "os_enforced",
        "source_read_denied",
        "run_read_allowed",
        "preflight",
        "bindings",
        "producer",
        "reason",
      ],
      where,
      issues
    )
  ) {
    return issues;
  }
  if (isolation.schema_version !== 2) issues.push(`${where}.schema_version must equal 2`);
  if (isolation.run_id !== expectedRunId) issues.push(`${where}.run_id must match the run`);
  if (!ISOLATION_MODES.has(isolation.mode)) issues.push(`${where}.mode is unsupported`);
  for (const field of ["os_enforced", "source_read_denied", "run_read_allowed"]) {
    if (typeof isolation[field] !== "boolean") issues.push(`${where}.${field} must be a boolean`);
  }
  if (
    closedObject(
      isolation.preflight,
      ["denied_source_read", "allowed_run_read"],
      ["denied_source_read", "allowed_run_read"],
      `${where}.preflight`,
      issues
    )
  ) {
    for (const field of ["denied_source_read", "allowed_run_read"]) {
      if (!["pass", "fail", "not-run"].includes(isolation.preflight[field])) {
        issues.push(`${where}.preflight.${field} must be pass, fail, or not-run`);
      }
    }
  }
  if (isolation.bindings !== null) {
    if (
      closedObject(
        isolation.bindings,
        ISOLATION_BINDING_FIELDS,
        ISOLATION_BINDING_FIELDS,
        `${where}.bindings`,
        issues
      )
    ) {
      for (const field of ISOLATION_BINDING_FIELDS) {
        validateBindingShape(isolation.bindings[field], `${where}.bindings.${field}`, issues);
      }
    }
  }
  if (
    closedObject(
      isolation.producer,
      ["id", "version"],
      ["id", "version"],
      `${where}.producer`,
      issues
    )
  ) {
    if (isolation.producer.id !== "pm-capability-oracle-isolation-attestor") {
      issues.push(`${where}.producer.id must identify the oracle isolation attestor`);
    }
    if (isolation.producer.version !== 2) {
      issues.push(`${where}.producer.version must equal 2`);
    }
  }

  const attested = oracleIsolationAttested(isolation);
  if (attested) {
    if (!["external-container", "sandbox-exec"].includes(isolation.mode)) {
      issues.push(`${where}.mode must identify an OS-enforced boundary`);
    }
    if (!plainObject(isolation.bindings)) {
      issues.push(`${where}.bindings are required when attested`);
    }
    if (isolation.reason !== null) issues.push(`${where}.reason must be null when attested`);
  } else {
    if (isolation.mode === "external-container" || isolation.mode === "sandbox-exec") {
      issues.push(`${where}.${isolation.mode} evidence must pass every isolation check`);
    }
    if (!nonempty(isolation.reason)) issues.push(`${where}.reason is required when unattested`);
  }
  return issues;
}

function oracleIsolationAttested(isolation) {
  return Boolean(
    isolation &&
    isolation.os_enforced === true &&
    isolation.source_read_denied === true &&
    isolation.run_read_allowed === true &&
    isolation.preflight?.denied_source_read === "pass" &&
    isolation.preflight?.allowed_run_read === "pass" &&
    plainObject(isolation.bindings) &&
    ISOLATION_BINDING_FIELDS.every((field) => plainObject(isolation.bindings[field]))
  );
}

function oracleIsolationClaimable(_isolation) {
  // Neither current evidence mode proves that every oracle-bearing host mirror
  // and outbound network path was unavailable to the candidate. `sandbox-exec`
  // proves only the local Git-boundary denial, while `external-container` has
  // no trusted semantic verifier. Keep both useful for diagnostics, but never
  // promote either self-attestation into a capability claim.
  return false;
}

function validateOracleIsolationEvidence({
  isolation,
  rootDir,
  runId,
  where = "oracle_isolation",
}) {
  const issues = validateOracleIsolationArtifact(isolation, runId, where);
  if (issues.length === 0) {
    validateOracleIsolationBindings({ isolation, rootDir, runId, where, issues });
  }
  return issues;
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
  if ([1, 2, 3].includes(report.schema_version)) {
    issues.push(
      `report.schema_version ${report.schema_version} cannot support staged-scenario, candidate-ledger, and oracle-isolation claims; rerun the capability benchmark and adjudication to create schema 4 evidence`
    );
    return issues;
  }
  if (report.schema_version !== 4) issues.push("report.schema_version must equal 4");
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
  let frozenSourceIdentity = null;
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
            "source_identity",
            "scenario_identity",
            "normalized_transcript",
            "candidate_output",
            "candidate_findings",
            "oracle_isolation",
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
            "source_identity",
            "scenario_identity",
            "normalized_transcript",
            "candidate_output",
            "candidate_findings",
            "oracle_isolation",
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
        const sourceIdentity = validateEvidenceRow({
          result,
          expected,
          repeat: repeat.repeat,
          profile: report.profile,
          benchmarkId: oracle.benchmark_id,
          oracleHash: capabilityOracleHash(oracle),
          rootDir,
          fixVerifier: options.fixVerifier,
          browserPath: options.browserPath,
          prospectivePublications: options.prospectivePublications,
          where: caseWhere,
          issues,
        });
        if (sourceIdentity) {
          if (frozenSourceIdentity === null) frozenSourceIdentity = sourceIdentity;
          else if (!isDeepStrictEqual(sourceIdentity, frozenSourceIdentity)) {
            issues.push(
              `${caseWhere}.source_identity must match every other capability run exactly`
            );
          }
        }
      }
      if (typeof result.blocked !== "boolean") issues.push(`${caseWhere}.blocked must be boolean`);
      if (!Array.isArray(result.findings)) {
        issues.push(`${caseWhere}.findings must be an array`);
        continue;
      }
      const knownDefects = new Set((expected?.defects || []).map((item) => item.id));
      const matchedDefects = new Set();
      const candidateFindingIds = new Set();
      for (const [findingIndex, finding] of result.findings.entries()) {
        const findingWhere = `${caseWhere}.findings[${findingIndex}]`;
        if (
          !closedObject(
            finding,
            [...REPORT_FINDING_FIELDS],
            [...REPORT_FINDING_FIELDS],
            findingWhere,
            issues
          )
        ) {
          continue;
        }
        if (!CANDIDATE_ID_PATTERN.test(String(finding.candidate_finding_id || ""))) {
          issues.push(`${findingWhere}.candidate_finding_id must be a lowercase finding-* slug`);
        } else if (candidateFindingIds.has(finding.candidate_finding_id)) {
          issues.push(
            `${findingWhere}.candidate_finding_id duplicates ${finding.candidate_finding_id}`
          );
        }
        candidateFindingIds.add(finding.candidate_finding_id);
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
        const defect = expected?.defects?.find((item) => item.id === finding.oracle_id);
        if (defect && finding.judge_objective !== defect.objective) {
          issues.push(`${findingWhere}.judge_objective must match the oracle truth`);
        }
        if (!SEVERITIES.has(finding.severity)) {
          issues.push(`${findingWhere}.severity must be low, medium, high, or critical`);
        }
        for (const field of [
          "objective",
          "blocking",
          "judge_objective",
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
        for (const field of ["locator", "summary"]) {
          if (!nonempty(finding[field])) issues.push(`${findingWhere}.${field} is required`);
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
  prospectivePublications,
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
    return null;
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
  const sourceIdentityBytes = validateBoundFile(
    rootDir,
    result.source_identity,
    `${runRoot}/metadata/source_identity.json`,
    `${where}.source_identity`,
    issues
  );
  const sourceIdentity = validateSourceIdentity({
    bytes: sourceIdentityBytes,
    rootDir,
    runRoot,
    where: `${where}.source_identity`,
    issues,
  });
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
  if (fixtureBytes && sha256(fixtureBytes) !== expected.fixture_sha256) {
    issues.push(`${where}.fixture bytes must match the oracle fixture`);
  }
  const scenarioIdentityBytes = validateBoundFile(
    rootDir,
    result.scenario_identity,
    `${runRoot}/metadata/scenario_identity.json`,
    `${where}.scenario_identity`,
    issues
  );
  if (scenarioIdentityBytes) {
    const identity = parseJsonEvidence(scenarioIdentityBytes, `${where}.scenario_identity`, issues);
    if (identity) {
      issues.push(
        ...validateScenarioIdentityEvidence({
          identity,
          rootDir,
          runId: run.run_id,
          scenarioId: run.scenario_id,
          expectedScenarioHash: fixtureBytes
            ? expectedCapabilityStagedScenarioHash(run.scenario_id, fixtureBytes)
            : null,
          where: `${where}.scenario_identity`,
        })
      );
    }
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
        source_identity: "metadata/source_identity.json",
        scenario_identity: "metadata/scenario_identity.json",
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

  const candidateFindingsBytes = validateBoundFile(
    rootDir,
    result.candidate_findings,
    `${runRoot}/artifacts/capability-findings.json`,
    `${where}.candidate_findings`,
    issues
  );
  let candidateFindings = null;
  if (candidateFindingsBytes) {
    candidateFindings = parseJsonEvidence(
      candidateFindingsBytes,
      `${where}.candidate_findings`,
      issues
    );
    if (candidateFindings) {
      issues.push(
        ...validateCandidateFindingsLedger(candidateFindings, `${where}.candidate_findings`)
      );
      validateCandidateDerivation(result, candidateFindings, where, issues);
      if (outputBytes) {
        const output = outputBytes.toString("utf8");
        for (const finding of Array.isArray(candidateFindings.findings)
          ? candidateFindings.findings
          : []) {
          if (nonempty(finding?.id) && !candidateOutputReferencesFinding(output, finding.id)) {
            issues.push(`${where}.candidate_output must reference candidate finding ${finding.id}`);
          }
        }
      }
    }
  }

  const oracleIsolationBytes = validateBoundFile(
    rootDir,
    result.oracle_isolation,
    `${runRoot}/metadata/oracle_isolation.json`,
    `${where}.oracle_isolation`,
    issues
  );
  if (oracleIsolationBytes) {
    const isolation = parseJsonEvidence(oracleIsolationBytes, `${where}.oracle_isolation`, issues);
    if (isolation) {
      issues.push(
        ...validateOracleIsolationEvidence({
          isolation,
          rootDir,
          runId: run.run_id,
          where: `${where}.oracle_isolation`,
        })
      );
    }
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
    issues,
    prospectivePublications
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
    issues,
    prospectivePublications
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
            source_identity_sha256: result.source_identity?.sha256,
            scenario_identity_sha256: result.scenario_identity?.sha256,
            runtime_profile_sha256: run.runtime_profile?.sha256,
            verdict_sha256: run.verdict?.sha256,
            normalized_transcript_sha256: result.normalized_transcript?.sha256,
            candidate_output_sha256: result.candidate_output?.sha256,
            candidate_findings_sha256: result.candidate_findings?.sha256,
            oracle_isolation_sha256: result.oracle_isolation?.sha256,
            post_subject_sha256: result.post_subject?.sha256,
            fix_verification_sha256: result.fix_verification?.sha256,
          },
        },
        `${where}.adjudication`,
        issues
      );
    }
  }

  return sourceIdentity;
}

function validateScenarioIdentityEvidence({
  identity,
  rootDir,
  runId,
  scenarioId,
  expectedScenarioHash,
  where,
}) {
  const issues = [];
  const fields = ["id", "scenario_hash", "scenario_ref"];
  if (!closedObject(identity, fields, fields, where, issues)) return issues;
  if (identity.id !== scenarioId) {
    issues.push(`${where}.id must match the bound run scenario_id`);
  }
  if (!HASH_PATTERN.test(String(identity.scenario_hash || ""))) {
    issues.push(`${where}.scenario_hash must be a sha256 digest`);
  }
  if (identity.scenario_ref !== "scenario") {
    issues.push(`${where}.scenario_ref must equal scenario`);
  }
  if (
    expectedScenarioHash !== null &&
    expectedScenarioHash !== undefined &&
    identity.scenario_hash !== expectedScenarioHash
  ) {
    issues.push(`${where}.scenario_hash must match the deterministic capability scenario`);
  }
  try {
    const stagedScenario = path.join(rootDir, "eval-results", "runs", runId, "scenario");
    const observedScenarioHash = hashTree(stagedScenario).hash;
    if (identity.scenario_hash !== observedScenarioHash) {
      issues.push(`${where}.scenario_hash must match the retained staged scenario`);
    }
  } catch (error) {
    issues.push(`${where} could not verify the retained staged scenario: ${error.message}`);
  }
  return issues;
}

function validateSourceIdentity({ bytes, rootDir, runRoot, where, issues }) {
  if (!bytes) return null;
  const identity = parseJsonEvidence(bytes, where, issues);
  if (!identity) return null;
  const fields = ["source_ref", "branch", "dirty", "runtime_hash", "runtime_ref"];
  if (!closedObject(identity, fields, fields, where, issues)) return null;
  if (!nonempty(identity.source_ref)) issues.push(`${where}.source_ref is required`);
  if (!nonempty(identity.branch)) issues.push(`${where}.branch is required`);
  if (identity.dirty !== false) {
    issues.push(`${where}.dirty must be false for capability evidence`);
  }
  if (!HASH_PATTERN.test(String(identity.runtime_hash || ""))) {
    issues.push(`${where}.runtime_hash must be a sha256 digest`);
  }
  if (identity.runtime_ref !== "runtime/pm") {
    issues.push(`${where}.runtime_ref must equal runtime/pm`);
  }
  try {
    const observedRuntimeHash = hashTree(path.join(rootDir, runRoot, "runtime", "pm")).hash;
    if (identity.runtime_hash !== observedRuntimeHash) {
      issues.push(`${where}.runtime_hash must match the retained staged runtime`);
    }
  } catch (error) {
    issues.push(`${where} could not verify the retained staged runtime: ${error.message}`);
  }
  return identity;
}

function validateCandidateDerivation(result, ledger, where, issues) {
  if (result.blocked !== ledger.blocked) {
    issues.push(`${where}.blocked must be derived from candidate_findings.blocked`);
  }
  if (!Array.isArray(result.findings) || !Array.isArray(ledger.findings)) return;

  const resultById = new Map();
  for (const finding of result.findings) {
    if (!finding || !nonempty(finding.candidate_finding_id)) continue;
    resultById.set(finding.candidate_finding_id, finding);
  }
  if (result.findings.length !== ledger.findings.length) {
    issues.push(`${where}.findings must map every candidate finding exactly once`);
  }
  for (const candidate of ledger.findings) {
    const derived = resultById.get(candidate?.id);
    if (!derived) {
      if (nonempty(candidate?.id)) {
        issues.push(`${where}.findings is missing candidate finding ${candidate.id}`);
      }
      continue;
    }
    const expected = {
      candidate_finding_id: candidate.id,
      severity: candidate.severity,
      objective: candidate.objective,
      blocking: candidate.blocking,
      locator: candidate.locator,
      claimed_fixed: candidate.claimed_fixed,
      summary: candidate.summary,
    };
    for (const [field, value] of Object.entries(expected)) {
      if (!isDeepStrictEqual(derived[field], value)) {
        issues.push(`${where}.findings ${candidate.id}.${field} must be derived from the ledger`);
      }
    }
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
  if (adjudication.schema_version !== 3) issues.push(`${where}.schema_version must equal 3`);
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
    "source_identity_sha256",
    "scenario_identity_sha256",
    "runtime_profile_sha256",
    "verdict_sha256",
    "normalized_transcript_sha256",
    "candidate_output_sha256",
    "candidate_findings_sha256",
    "oracle_isolation_sha256",
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

function validateOracleIsolationBindings({ isolation, rootDir, runId, where, issues }) {
  if (!oracleIsolationAttested(isolation)) return;
  const sandboxBase = `eval-results/capability-isolation/${runId}`;
  const expectedPaths =
    isolation.mode === "sandbox-exec"
      ? {
          policy: `${sandboxBase}/sandbox.sb`,
          launcher: `${sandboxBase}/codex-sandboxed`,
          preflight: `${sandboxBase}/preflight.json`,
          launch_receipt: `${sandboxBase}/launch-receipt.json`,
          command: `eval-results/runs/${runId}/metadata/codex_command.json`,
        }
      : Object.fromEntries(
          ISOLATION_BINDING_FIELDS.map((field) => [field, isolation.bindings[field]?.path])
        );
  const bytes = {};
  for (const field of ISOLATION_BINDING_FIELDS) {
    bytes[field] = validateBoundFile(
      rootDir,
      isolation.bindings[field],
      expectedPaths[field],
      `${where}.bindings.${field}`,
      issues
    );
  }
  if (isolation.mode !== "sandbox-exec") return;
  if (Object.values(bytes).some((value) => !value)) return;

  let boundary;
  try {
    boundary = fs.realpathSync(resolveCapabilitySourceBoundary(rootDir));
  } catch (error) {
    issues.push(`${where} cannot resolve the Git common repository boundary: ${error.message}`);
    return;
  }
  const runDir = path.join(rootDir, "eval-results", "runs", runId);
  if (
    boundary === path.parse(boundary).root ||
    !inside(boundary, rootDir) ||
    !inside(boundary, runDir)
  ) {
    issues.push(`${where} Git common repository boundary is not a safe source/read boundary`);
    return;
  }
  if (!bytes.policy.equals(Buffer.from(capabilitySandboxPolicy(boundary, runDir)))) {
    issues.push(`${where}.bindings.policy must deny the Git boundary and allow only the exact run`);
  }

  const preflight = parseJsonEvidence(bytes.preflight, `${where}.bindings.preflight`, issues);
  const receipt = parseJsonEvidence(
    bytes.launch_receipt,
    `${where}.bindings.launch_receipt`,
    issues
  );
  const command = parseJsonEvidence(bytes.command, `${where}.bindings.command`, issues);
  if (!preflight || !receipt || !command) return;
  const preflightFields = [
    "schema_version",
    "run_id",
    "status",
    "policy_sha256",
    "source_canary_sha256",
    "run_canary_sha256",
    "sandbox_exec",
    "candidate_bin",
  ];
  if (
    closedObject(preflight, preflightFields, preflightFields, `${where}.bindings.preflight`, issues)
  ) {
    if (preflight.schema_version !== 1) {
      issues.push(`${where}.bindings.preflight.schema_version must equal 1`);
    }
    if (preflight.run_id !== runId || preflight.status !== "pass") {
      issues.push(`${where}.bindings.preflight must be a passing check for the exact run`);
    }
    if (preflight.policy_sha256 !== isolation.bindings.policy.sha256) {
      issues.push(`${where}.bindings.preflight must bind the exact sandbox policy`);
    }
    for (const field of ["source_canary_sha256", "run_canary_sha256"]) {
      if (!HASH_PATTERN.test(String(preflight[field] || ""))) {
        issues.push(`${where}.bindings.preflight.${field} must be a sha256 digest`);
      }
    }
    if (preflight.sandbox_exec !== "/usr/bin/sandbox-exec") {
      issues.push(`${where}.bindings.preflight.sandbox_exec must be /usr/bin/sandbox-exec`);
    }
    if (
      !path.isAbsolute(String(preflight.candidate_bin || "")) ||
      inside(boundary, path.resolve(String(preflight.candidate_bin || "")))
    ) {
      issues.push(`${where}.bindings.preflight.candidate_bin must be outside the denied boundary`);
    }
  }

  const receiptFields = ["schema_version", "run_id", "launch_nonce", "policy_sha256"];
  if (
    closedObject(receipt, receiptFields, receiptFields, `${where}.bindings.launch_receipt`, issues)
  ) {
    if (receipt.schema_version !== 1 || receipt.run_id !== runId) {
      issues.push(`${where}.bindings.launch_receipt must identify the exact run`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(receipt.launch_nonce || ""))) {
      issues.push(`${where}.bindings.launch_receipt.launch_nonce must be a random 256-bit token`);
    }
    if (receipt.policy_sha256 !== isolation.bindings.policy.sha256) {
      issues.push(`${where}.bindings.launch_receipt must bind the exact sandbox policy`);
    }
  }

  const launcherPath = path.join(rootDir, isolation.bindings.launcher.path);
  const expectedLauncher = capabilitySandboxLauncher({
    sandboxBin: preflight.sandbox_exec,
    policyPath: path.join(rootDir, isolation.bindings.policy.path),
    candidateBin: preflight.candidate_bin,
    receiptPath: path.join(rootDir, isolation.bindings.launch_receipt.path),
    receiptBytes: bytes.launch_receipt,
  });
  if (!bytes.launcher.equals(Buffer.from(expectedLauncher))) {
    issues.push(`${where}.bindings.launcher must match the bound policy, receipt, and candidate`);
  }
  try {
    if ((fs.statSync(launcherPath).mode & 0o111) === 0) {
      issues.push(`${where}.bindings.launcher must remain executable`);
    }
  } catch {
    // validateBoundFile already reported the missing launcher.
  }
  if (path.resolve(String(command.command || "")) !== path.resolve(launcherPath)) {
    issues.push(`${where}.bindings.command must show that the adapter used the bound launcher`);
  }
}

function validateBoundFile(
  rootDir,
  binding,
  expectedPath,
  where,
  issues,
  prospectivePublications = null
) {
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
  if (prospectivePublications instanceof Map && prospectivePublications.has(absolute)) {
    const bytes = prospectivePublications.get(absolute);
    if (!Buffer.isBuffer(bytes)) {
      issues.push(`${where} prospective evidence must be bytes`);
      return null;
    }
    if (bytes.length > MAX_EVIDENCE_BYTES) {
      issues.push(`${where} evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
      return null;
    }
    if (sha256(bytes) !== binding.sha256) {
      issues.push(`${where}.sha256 must match prospective evidence bytes`);
      return null;
    }
    return bytes;
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
  if (real !== absolute) {
    issues.push(`${where} evidence path must not traverse symlinks`);
    return null;
  }
  let bytes;
  try {
    bytes = readBoundedFile(real, MAX_EVIDENCE_BYTES);
  } catch (error) {
    issues.push(`${where} evidence could not be read safely: ${error.message}`);
    return null;
  }
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
    defectsExpected: 0,
    blockingExpected: 0,
    blockingDetected: 0,
    objectiveExpected: 0,
    objectiveReported: 0,
    objectiveMatched: 0,
    cleanRuns: 0,
    cleanFalseBlocks: 0,
    matched: 0,
    correctLocations: 0,
    correctSeverities: 0,
    verifiedBlockingFixes: 0,
  };
  const unattestedCases = [];
  const sourceBoundaryUnattestedCases = [];
  const evidenceRootDir = fs.realpathSync(path.resolve(options.rootDir));

  for (const repeat of report.repeats) {
    for (const result of repeat.cases) {
      const expected = cases.get(result.case_id);
      const defects = new Map(expected.defects.map((item) => [item.id, item]));
      totals.defectsExpected += expected.defects.length;
      const isolation = readCapabilityJson(
        path.join(evidenceRootDir, result.oracle_isolation.path),
        "oracle-isolation"
      );
      if (!oracleIsolationAttested(isolation)) {
        sourceBoundaryUnattestedCases.push({
          repeat: repeat.repeat,
          case_id: result.case_id,
          mode: isolation.mode,
        });
      }
      if (!oracleIsolationClaimable(isolation)) {
        unattestedCases.push({
          repeat: repeat.repeat,
          case_id: result.case_id,
          mode: isolation.mode,
        });
      }
      if (expected.clean_control) {
        totals.cleanRuns += 1;
        if (result.blocked || result.findings.some((finding) => finding.blocking)) {
          totals.cleanFalseBlocks += 1;
        }
      }
      totals.objectiveExpected += expected.defects.filter((defect) => defect.objective).length;
      for (const defect of expected.defects) {
        if (!BLOCKING_SEVERITIES.has(defect.severity)) continue;
        totals.blockingExpected += 1;
        const finding = result.findings.find((candidate) => candidate.oracle_id === defect.id);
        if (
          finding &&
          finding.blocking === true &&
          finding.objective === defect.objective &&
          finding.judge_objective === defect.objective
        ) {
          totals.blockingDetected += 1;
        }
        if (finding?.claimed_fixed === true && finding.fix_verified === true) {
          totals.verifiedBlockingFixes += 1;
        }
      }
      for (const finding of result.findings) {
        const defect = finding.oracle_id === null ? null : defects.get(finding.oracle_id);
        if (finding.objective) {
          totals.objectiveReported += 1;
          if (finding.judge_objective === true && defect?.objective === true) {
            totals.objectiveMatched += 1;
          }
        }
        if (defect) {
          totals.matched += 1;
          if (finding.location_correct) totals.correctLocations += 1;
          if (finding.severity === defect.severity) totals.correctSeverities += 1;
        }
      }
    }
  }

  const metrics = {
    p0_p1_recall: ratio(
      totals.blockingDetected,
      totals.blockingExpected,
      totals.blockingExpected > 0 ? 0 : 1
    ),
    objective_precision: ratio(
      totals.objectiveMatched,
      totals.objectiveReported,
      totals.objectiveExpected > 0 ? 0 : 1
    ),
    clean_control_false_block_rate: ratio(totals.cleanFalseBlocks, totals.cleanRuns, 0),
    locator_accuracy: ratio(
      totals.correctLocations,
      totals.matched,
      totals.defectsExpected > 0 ? 0 : 1
    ),
    severity_accuracy: ratio(
      totals.correctSeverities,
      totals.matched,
      totals.defectsExpected > 0 ? 0 : 1
    ),
    claimed_fix_success: ratio(
      totals.verifiedBlockingFixes,
      totals.blockingExpected,
      totals.blockingExpected > 0 ? 0 : 1
    ),
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
  const repeatSufficient = repeatCount >= oracle.minimum_repeats;
  const isolationAttested = unattestedCases.length === 0;
  const claimable = repeatSufficient && isolationAttested;
  return {
    schema_version: 2,
    benchmark_id: oracle.benchmark_id,
    profile: structuredClone(report.profile),
    repeat_count: repeatCount,
    minimum_repeats: oracle.minimum_repeats,
    claimable,
    release_passed:
      claimable && Object.values(threshold_results).every((result) => result.passed === true),
    metrics,
    threshold_results,
    oracle_isolation: {
      attested: isolationAttested,
      source_boundary_attested: sourceBoundaryUnattestedCases.length === 0,
      claimability_reason:
        "no current mode verifies network denial and every oracle-bearing source/plugin mirror",
      unattested_cases: unattestedCases,
    },
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

function validateBindingShape(binding, where, issues) {
  if (!closedObject(binding, ["path", "sha256"], ["path", "sha256"], where, issues)) {
    return;
  }
  if (!nonempty(binding.path) || path.isAbsolute(binding.path) || binding.path.includes("\\")) {
    issues.push(`${where}.path must be a repository-relative POSIX path`);
  }
  if (!HASH_PATTERN.test(String(binding.sha256 || ""))) {
    issues.push(`${where}.sha256 must be a sha256 digest`);
  }
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

function seatbeltString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
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
    const oracle = readCapabilityJson(options.oracle, "oracle");
    const report = readCapabilityJson(options.report, "report");
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
  candidateOutputReferencesFinding,
  capabilitySandboxLauncher,
  capabilitySandboxPolicy,
  capabilityAdjudicationPath,
  capabilityFixVerificationPath,
  capabilityOracleHash,
  capabilityScenarioId,
  scoreCapabilityReport,
  resolveCapabilitySourceBoundary,
  validateCandidateFindingsLedger,
  validateCapabilityOracle,
  validateCapabilityReport,
  validateOracleIsolationArtifact,
  validateOracleIsolationEvidence,
  validateScenarioIdentityEvidence,
};
