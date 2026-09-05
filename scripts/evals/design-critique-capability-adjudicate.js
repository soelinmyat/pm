#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { acquireOwnedLock } = require("../lib/owned-lock.js");
const { readBoundedFile } = require("../lib/safe-json-file.js");
const {
  CAPABILITY_JSON_LIMITS,
  encodeCapabilityJson,
  readCapabilityJson,
} = require("./design-critique-capability-input.js");
const {
  expectedCapabilityStagedScenarioHash,
} = require("./design-critique-capability-scenario.js");

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,100}$/;

const {
  capabilityAdjudicationPath,
  capabilityFixVerificationPath,
  capabilityOracleHash,
  validateCandidateFindingsLedger,
  validateCapabilityOracle,
  validateCapabilityReport,
  validateOracleIsolationEvidence,
  validateScenarioIdentityEvidence,
} = require("./design-critique-capability.js");

function sealCapabilityAdjudication(options) {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir || process.cwd()));
  const oracle = options.oracle;
  const capture = options.capture;
  const judgments = options.judgments;
  const reportPath = canonicalOutputPath(path.resolve(options.reportPath));
  validateInputs({ rootDir, oracle, capture, judgments });
  validateReportPath(rootDir, reportPath);
  const plannedPublicationPaths = planImmutablePublicationPaths(rootDir, oracle, capture);
  const protectedInputs = planProtectedInputs(rootDir, capture, options.protectedInputPaths);
  validateReportPublicationNamespace(rootDir, reportPath, plannedPublicationPaths, protectedInputs);
  const publicationDirectories = preparePublicationDirectories(
    rootDir,
    reportPath,
    plannedPublicationPaths
  );
  validateReportPath(rootDir, reportPath);

  options.testingHooks?.beforePublicationLock?.();
  const releasePublication = acquireOwnedLock(capabilityPublicationLockPath(rootDir), {
    attempts: 1_200,
    waitMs: 50,
    timeoutMessage: "timed out waiting to publish capability adjudication artifacts",
  });
  try {
    const report = loadOrCreateReport(reportPath, oracle, capture.profile);
    const retainedInputs = planProtectedInputs(rootDir, {
      cases: report.repeats.flatMap((repeat) => (Array.isArray(repeat?.cases) ? repeat.cases : [])),
    });
    validateReportPublicationNamespace(
      rootDir,
      reportPath,
      plannedPublicationPaths,
      mergeProtectedInputs(protectedInputs, retainedInputs)
    );
    options.testingHooks?.afterReportLoad?.();
    if (report.repeats.some((item) => item.repeat === capture.repeat)) {
      throw new Error(`report already contains repeat ${capture.repeat}`);
    }
    const { rows, publications } = buildAdjudicationRows({
      rootDir,
      oracle,
      capture,
      judgments,
      fixVerifier: options.fixVerifier,
      browserPath: options.browserPath,
    });
    report.repeats.push({ repeat: capture.repeat, cases: rows });
    report.repeats.sort((left, right) => left.repeat - right.repeat);
    const reportBytes = encodeCapabilityJson(report, "report");

    for (const directory of publicationDirectories) assertAnchoredDirectory(rootDir, directory);
    assertPublicationsMatchPlan(publications, plannedPublicationPaths);
    for (const publication of publications) assertImmutablePublication(publication, rootDir);
    const prospectivePublications = new Map(
      publications.map((publication) => [publication.path, publication.bytes])
    );

    const issues = validateCapabilityReport(report, oracle, {
      rootDir,
      fixVerifier: options.fixVerifier,
      browserPath: options.browserPath,
      prospectivePublications,
    });
    if (issues.length > 0) {
      throw new Error(`sealed capability report is invalid:\n${issues.join("\n")}`);
    }
    for (const publication of publications) publishPrivateBytesImmutable(publication, rootDir);
    validateReportPath(rootDir, reportPath);
    writePrivateBytes(reportPath, reportBytes, rootDir);
    return { report, reportPath };
  } finally {
    releasePublication();
  }
}

function buildAdjudicationRows({ rootDir, oracle, capture, judgments, fixVerifier, browserPath }) {
  const publications = [];
  const judgmentByCase = new Map(judgments.cases.map((item) => [item.case_id, item]));
  const captureByCase = new Map(capture.cases.map((item) => [item.case_id, item]));
  const rows = oracle.cases.map((oracleCase) => {
    const evidence = captureByCase.get(oracleCase.id);
    const judgment = judgmentByCase.get(oracleCase.id);
    const candidateLedger = loadCandidateLedger(rootDir, evidence);
    validateCandidateOutput(rootDir, evidence, candidateLedger);
    loadOracleIsolation(rootDir, evidence);
    loadScenarioIdentity(rootDir, evidence, oracleCase);
    const fixVerification = buildFixVerification({
      rootDir,
      oracle,
      oracleCase,
      profile: capture.profile,
      repeat: capture.repeat,
      evidence,
      fixVerifier,
      browserPath,
    });
    publications.push(fixVerification.publication);
    const findings = deriveAdjudicatedFindings({
      candidateLedger,
      mappings: judgment.mappings,
      oracleCase,
      verificationResults: fixVerification.results,
      where: `judgments case ${oracleCase.id}`,
    });
    const artifact = {
      schema_version: 3,
      benchmark_id: oracle.benchmark_id,
      oracle_sha256: capabilityOracleHash(oracle),
      profile: structuredClone(capture.profile),
      repeat: capture.repeat,
      case_id: oracleCase.id,
      evidence: {
        fixture_sha256: evidence.fixture.sha256,
        run_id: evidence.run.run_id,
        scenario_id: evidence.run.scenario_id,
        adapter: evidence.run.adapter,
        source_identity_sha256: evidence.source_identity.sha256,
        scenario_identity_sha256: evidence.scenario_identity.sha256,
        runtime_profile_sha256: evidence.run.runtime_profile.sha256,
        verdict_sha256: evidence.run.verdict.sha256,
        normalized_transcript_sha256: evidence.normalized_transcript.sha256,
        candidate_output_sha256: evidence.candidate_output.sha256,
        candidate_findings_sha256: evidence.candidate_findings.sha256,
        oracle_isolation_sha256: evidence.oracle_isolation.sha256,
        post_subject_sha256: evidence.post_subject.sha256,
        fix_verification_sha256: fixVerification.binding.sha256,
      },
      blocked: candidateLedger.blocked,
      findings,
    };
    const relativeArtifactPath = capabilityAdjudicationPath({
      benchmarkId: oracle.benchmark_id,
      profileId: capture.profile.id,
      repeat: capture.repeat,
      caseId: oracleCase.id,
    });
    const adjudicationBytes = privateJsonBytes(artifact);
    publications.push({
      path: path.join(rootDir, relativeArtifactPath),
      bytes: adjudicationBytes,
    });
    return {
      ...structuredClone(evidence),
      fix_verification: fixVerification.binding,
      adjudication: {
        path: relativeArtifactPath,
        sha256: digest(adjudicationBytes),
      },
      blocked: candidateLedger.blocked,
      findings: structuredClone(findings),
    };
  });
  return { rows, publications };
}

function validateInputs({ rootDir, oracle, capture, judgments }) {
  const oracleIssues = validateCapabilityOracle(oracle);
  if (oracleIssues.length > 0) {
    throw new Error(`invalid design-critique oracle:\n${oracleIssues.join("\n")}`);
  }
  requireClosedObject(
    capture,
    [
      "schema_version",
      "benchmark_id",
      "oracle_sha256",
      "profile",
      "requested_profile",
      "repeat",
      "harness_only",
      "cases",
      "failures",
      "created_at",
    ],
    "capture"
  );
  if (capture.schema_version !== 3) {
    throw new Error(
      `capture.schema_version ${capture.schema_version} cannot bind the staged scenario; rerun the capability benchmark to create schema 3 evidence`
    );
  }
  if (capture.benchmark_id !== oracle.benchmark_id) {
    throw new Error("capture benchmark does not match the oracle");
  }
  if (capture.oracle_sha256 !== capabilityOracleHash(oracle)) {
    throw new Error("capture oracle_sha256 does not match the exact capability oracle");
  }
  if (capture.harness_only !== false) {
    throw new Error("harness-only captures cannot be adjudicated for capability claims");
  }
  validateCapabilityProfile(capture.profile, "capture.profile");
  validateCapabilityProfile(capture.requested_profile, "capture.requested_profile");
  if (!isDeepStrictEqual(capture.profile, capture.requested_profile)) {
    throw new Error("capture runtime profile does not match the requested live profile");
  }
  if (!Number.isInteger(capture.repeat) || capture.repeat < 1) {
    throw new Error("capture.repeat must be a positive integer");
  }
  if (!Array.isArray(capture.failures) || capture.failures.length !== 0) {
    throw new Error("capture must have no failed fixture runs");
  }
  requireExactCases(capture.cases, oracle.cases, "capture.cases", [
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
  ]);

  requireClosedObject(judgments, ["schema_version", "repeat", "cases"], "judgments");
  if (judgments.schema_version !== 2) {
    throw new Error("judgments.schema_version must equal 2");
  }
  if (judgments.repeat !== capture.repeat) {
    throw new Error("judgments.repeat must match capture.repeat");
  }
  requireExactCases(judgments.cases, oracle.cases, "judgments.cases", ["case_id", "mappings"]);
  const oracleByCase = new Map(oracle.cases.map((item) => [item.id, item]));
  for (const item of capture.cases) {
    loadCandidateLedger(rootDir, item);
    loadOracleIsolation(rootDir, item);
    loadScenarioIdentity(rootDir, item, oracleByCase.get(item.case_id));
  }
}

function validateCapabilityProfile(profile, where) {
  requireClosedObject(profile, ["id", "adapter", "model", "effort"], where);
  if (!PROFILE_ID_PATTERN.test(String(profile.id || ""))) {
    throw new Error(`${where}.id must be a lowercase slug`);
  }
  if (!new Set(["codex", "claude"]).has(profile.adapter)) {
    throw new Error(`${where}.adapter must be codex or claude`);
  }
  for (const field of ["model", "effort"]) {
    if (typeof profile[field] !== "string" || profile[field].trim() === "") {
      throw new Error(`${where}.${field} must be a non-empty string`);
    }
  }
}

function buildFixVerification({
  rootDir,
  oracle,
  oracleCase,
  profile,
  repeat,
  evidence,
  fixVerifier,
  browserPath,
}) {
  const expectedPostPath = `eval-results/runs/${evidence.run.run_id}/workdir/ui/design-critique/capability-case.html`;
  if (evidence.post_subject.path !== expectedPostPath) {
    throw new Error(`capture post_subject path must equal ${expectedPostPath}`);
  }
  const postPath = path.join(rootDir, expectedPostPath);
  const postBytes = readBoundedFile(postPath, 4 * 1024 * 1024);
  if (digest(postBytes) !== evidence.post_subject.sha256) {
    throw new Error(`capture post_subject sha256 does not match bytes for ${oracleCase.id}`);
  }
  const verifier = resolveFixVerifier(rootDir, fixVerifier);
  const artifact = {
    schema_version: 1,
    benchmark_id: oracle.benchmark_id,
    oracle_sha256: capabilityOracleHash(oracle),
    profile: structuredClone(profile),
    repeat,
    case_id: oracleCase.id,
    run_id: evidence.run.run_id,
    fixture_sha256: evidence.fixture.sha256,
    post_subject_sha256: evidence.post_subject.sha256,
    producer: { id: "pm:design-critique-capability-fix-verifier", version: 1 },
    results: verifier({ oracleCase, htmlPath: postPath, browserPath }),
  };
  const relativePath = capabilityFixVerificationPath({
    benchmarkId: oracle.benchmark_id,
    profileId: profile.id,
    repeat,
    caseId: oracleCase.id,
  });
  const absolutePath = path.join(rootDir, relativePath);
  const bytes = privateJsonBytes(artifact);
  return {
    binding: { path: relativePath, sha256: digest(bytes) },
    publication: { path: absolutePath, bytes },
    results: structuredClone(artifact.results),
  };
}

function loadCandidateLedger(rootDir, evidence) {
  const runId = evidence?.run?.run_id;
  const expectedPath = `eval-results/runs/${runId}/artifacts/capability-findings.json`;
  const ledger = readBoundCaptureJson(
    rootDir,
    evidence?.candidate_findings,
    expectedPath,
    "capture candidate_findings",
    "candidate-findings"
  );
  const issues = validateCandidateFindingsLedger(ledger);
  if (issues.length > 0) {
    throw new Error(`invalid candidate findings ledger:\n${issues.join("\n")}`);
  }
  return ledger;
}

function loadOracleIsolation(rootDir, evidence) {
  const runId = evidence?.run?.run_id;
  const expectedPath = `eval-results/runs/${runId}/metadata/oracle_isolation.json`;
  const isolation = readBoundCaptureJson(
    rootDir,
    evidence?.oracle_isolation,
    expectedPath,
    "capture oracle_isolation",
    "oracle-isolation"
  );
  const issues = validateOracleIsolationEvidence({ isolation, rootDir, runId });
  if (issues.length > 0) {
    throw new Error(`invalid oracle isolation evidence:\n${issues.join("\n")}`);
  }
  return isolation;
}

function loadScenarioIdentity(rootDir, evidence, oracleCase) {
  const runId = evidence?.run?.run_id;
  const scenarioId = evidence?.run?.scenario_id;
  if (!oracleCase) throw new Error("capture scenario identity has no matching oracle case");
  const fixtureBytes = readBoundCaptureFile(
    rootDir,
    evidence?.fixture,
    `eval-results/runs/${runId}/metadata/inputs/design-critique-fixture.html`,
    "capture fixture",
    4 * 1024 * 1024
  );
  if (digest(fixtureBytes) !== oracleCase.fixture_sha256) {
    throw new Error("capture fixture bytes do not match the exact oracle fixture");
  }
  const expectedPath = `eval-results/runs/${runId}/metadata/scenario_identity.json`;
  const identity = readBoundCaptureJson(
    rootDir,
    evidence?.scenario_identity,
    expectedPath,
    "capture scenario_identity",
    "scenario-identity"
  );
  const issues = validateScenarioIdentityEvidence({
    identity,
    rootDir,
    runId,
    scenarioId,
    expectedScenarioHash: expectedCapabilityStagedScenarioHash(scenarioId, fixtureBytes),
    where: "capture scenario_identity",
  });
  if (issues.length > 0) {
    throw new Error(`invalid staged scenario identity:\n${issues.join("\n")}`);
  }
  return identity;
}

function readBoundCaptureJson(rootDir, binding, expectedPath, where, kind) {
  const bytes = readBoundCaptureFile(
    rootDir,
    binding,
    expectedPath,
    where,
    CAPABILITY_JSON_LIMITS[kind]
  );
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${where} must contain valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must contain a JSON object`);
  }
  return value;
}

function readBoundCaptureFile(rootDir, binding, expectedPath, where, maxBytes) {
  requireClosedObject(binding, ["path", "sha256"], where);
  if (binding.path !== expectedPath) throw new Error(`${where}.path must equal ${expectedPath}`);
  const absolute = path.resolve(rootDir, binding.path);
  if (!inside(rootDir, absolute)) throw new Error(`${where}.path escapes the evidence root`);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`${where} must be a regular non-linked file`);
  }
  const real = fs.realpathSync(absolute);
  if (!inside(rootDir, real) || real !== absolute) {
    throw new Error(`${where} path must not traverse symlinks`);
  }
  const bytes = readBoundedFile(real, maxBytes);
  if (digest(bytes) !== binding.sha256)
    throw new Error(`${where}.sha256 must match evidence bytes`);
  return bytes;
}

function validateCandidateOutput(rootDir, evidence, candidateLedger) {
  const runId = evidence?.run?.run_id;
  const expectedPath = `eval-results/runs/${runId}/artifacts/quality-output.md`;
  const output = readBoundCaptureFile(
    rootDir,
    evidence?.candidate_output,
    expectedPath,
    "capture candidate_output",
    4 * 1024 * 1024
  ).toString("utf8");
  for (const finding of candidateLedger.findings) {
    if (!candidateOutputReferencesFinding(output, finding.id)) {
      throw new Error(`candidate_output must reference candidate finding ${finding.id}`);
    }
  }
}

function candidateOutputReferencesFinding(output, findingId) {
  const escaped = String(findingId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`, "m").test(String(output));
}

function deriveAdjudicatedFindings({
  candidateLedger,
  mappings,
  oracleCase,
  verificationResults,
  where,
}) {
  if (!Array.isArray(mappings)) throw new Error(`${where}.mappings must be an array`);
  const candidates = new Map(candidateLedger.findings.map((finding) => [finding.id, finding]));
  const defects = new Map(oracleCase.defects.map((defect) => [defect.id, defect]));
  const verificationById = new Map(
    verificationResults.map((result) => [result.oracle_id, result.status])
  );
  const mappingByCandidate = new Map();
  const mappedOracles = new Set();

  for (const [index, mapping] of mappings.entries()) {
    const mappingWhere = `${where}.mappings[${index}]`;
    requireClosedObject(
      mapping,
      ["candidate_finding_id", "oracle_id", "judge_objective", "location_correct"],
      mappingWhere
    );
    if (!candidates.has(mapping.candidate_finding_id)) {
      throw new Error(`${mappingWhere}.candidate_finding_id is unknown or invented`);
    }
    if (mappingByCandidate.has(mapping.candidate_finding_id)) {
      throw new Error(`${mappingWhere}.candidate_finding_id is duplicated`);
    }
    if (mapping.oracle_id !== null && !defects.has(mapping.oracle_id)) {
      throw new Error(`${mappingWhere}.oracle_id is unknown for case ${oracleCase.id}`);
    }
    if (mapping.oracle_id !== null && mappedOracles.has(mapping.oracle_id)) {
      throw new Error(`${mappingWhere}.oracle_id duplicates ${mapping.oracle_id}`);
    }
    if (typeof mapping.judge_objective !== "boolean") {
      throw new Error(`${mappingWhere}.judge_objective must be a boolean`);
    }
    if (typeof mapping.location_correct !== "boolean") {
      throw new Error(`${mappingWhere}.location_correct must be a boolean`);
    }
    if (mapping.oracle_id === null && mapping.location_correct) {
      throw new Error(`${mappingWhere}.location_correct cannot be true without an oracle_id`);
    }
    const defect = mapping.oracle_id === null ? null : defects.get(mapping.oracle_id);
    if (defect && mapping.judge_objective !== defect.objective) {
      throw new Error(`${mappingWhere}.judge_objective must match the oracle truth`);
    }
    mappingByCandidate.set(mapping.candidate_finding_id, mapping);
    if (mapping.oracle_id !== null) mappedOracles.add(mapping.oracle_id);
  }

  for (const candidateId of candidates.keys()) {
    if (!mappingByCandidate.has(candidateId)) {
      throw new Error(`${where}.mappings is missing candidate finding ${candidateId}`);
    }
  }
  if (mappingByCandidate.size !== candidates.size) {
    throw new Error(`${where}.mappings must map every candidate finding exactly once`);
  }

  return candidateLedger.findings.map((candidate) => {
    const mapping = mappingByCandidate.get(candidate.id);
    let fixVerified = false;
    if (candidate.claimed_fixed === true && mapping.oracle_id !== null) {
      const status = verificationById.get(mapping.oracle_id);
      if (!status || status === "indeterminate") {
        throw new Error(
          `${where}.mappings ${candidate.id}.claimed_fixed requires a conclusive fix-verification`
        );
      }
      fixVerified = status === "pass";
    }
    return {
      candidate_finding_id: candidate.id,
      severity: candidate.severity,
      objective: candidate.objective,
      blocking: candidate.blocking,
      locator: candidate.locator,
      claimed_fixed: candidate.claimed_fixed,
      summary: candidate.summary,
      oracle_id: mapping.oracle_id,
      judge_objective: mapping.judge_objective,
      location_correct: mapping.location_correct,
      fix_verified: fixVerified,
    };
  });
}

function resolveFixVerifier(rootDir, injected) {
  if (typeof injected === "function") return injected;
  return require(path.join(rootDir, "evals", "capabilities", "design-critique", "verify.js"))
    .verifyPostSubject;
}

function requireExactCases(rows, oracleCases, where, keys) {
  if (!Array.isArray(rows)) throw new Error(`${where} must be an array`);
  const expected = new Set(oracleCases.map((item) => item.id));
  const found = new Set();
  for (const [index, row] of rows.entries()) {
    requireClosedObject(row, keys, `${where}[${index}]`);
    if (!expected.has(row.case_id)) throw new Error(`${where}[${index}].case_id is unknown`);
    if (found.has(row.case_id)) throw new Error(`${where}[${index}].case_id is duplicated`);
    found.add(row.case_id);
  }
  for (const id of expected) {
    if (!found.has(id)) throw new Error(`${where} is missing case ${id}`);
  }
}

function requireClosedObject(value, keys, where) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be an object`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${where} has unknown field ${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${where} is missing field ${key}`);
    }
  }
}

function loadOrCreateReport(reportPath, oracle, profile) {
  if (!fs.existsSync(reportPath)) {
    return {
      schema_version: 4,
      benchmark_id: oracle.benchmark_id,
      profile: structuredClone(profile),
      repeats: [],
    };
  }
  const report = readCapabilityJson(reportPath, "report");
  if (report.schema_version !== 4 || report.benchmark_id !== oracle.benchmark_id) {
    throw new Error("existing report does not match this capability benchmark");
  }
  if (!isDeepStrictEqual(report.profile, profile)) {
    throw new Error("existing report uses a different model profile");
  }
  if (!Array.isArray(report.repeats)) throw new Error("existing report repeats must be an array");
  return report;
}

function capabilityPublicationLockPath(rootDir) {
  return path.join(
    rootDir,
    "eval-results",
    "capabilities",
    "design-critique",
    ".adjudication-publication.lock"
  );
}

function immutablePublicationRoots(rootDir) {
  const base = path.join(rootDir, "eval-results", "capabilities", "design-critique");
  return [path.join(base, "fix-verification"), path.join(base, "adjudications")];
}

function planImmutablePublicationPaths(rootDir, oracle, capture) {
  const publications = [];
  const found = new Set();
  for (const oracleCase of oracle.cases) {
    for (const relativePath of [
      capabilityFixVerificationPath({
        benchmarkId: oracle.benchmark_id,
        profileId: capture.profile.id,
        repeat: capture.repeat,
        caseId: oracleCase.id,
      }),
      capabilityAdjudicationPath({
        benchmarkId: oracle.benchmark_id,
        profileId: capture.profile.id,
        repeat: capture.repeat,
        caseId: oracleCase.id,
      }),
    ]) {
      const absolutePath = path.resolve(rootDir, relativePath);
      if (!inside(rootDir, absolutePath)) {
        throw new Error(`capability publication path escapes the root: ${relativePath}`);
      }
      if (found.has(absolutePath)) {
        throw new Error(`capability publication path is duplicated: ${relativePath}`);
      }
      found.add(absolutePath);
      publications.push(absolutePath);
    }
  }
  return publications;
}

function planProtectedInputs(rootDir, capture, additionalPaths = []) {
  if (!Array.isArray(additionalPaths)) {
    throw new Error("protected capability input paths must be an array");
  }
  const paths = new Set();
  const trees = new Set();
  const addPath = (candidate) => {
    if (typeof candidate !== "string" || candidate.trim() === "") return;
    const absolute = path.resolve(rootDir, candidate);
    paths.add(absolute);
    try {
      paths.add(fs.realpathSync(absolute));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  };

  for (const item of capture.cases) {
    for (const binding of [
      item.fixture,
      item.source_identity,
      item.scenario_identity,
      item.run?.runtime_profile,
      item.run?.verdict,
      item.normalized_transcript,
      item.candidate_output,
      item.candidate_findings,
      item.oracle_isolation,
      item.post_subject,
    ]) {
      addPath(binding?.path);
    }
    const runId = item.run?.run_id;
    if (typeof runId === "string" && runId !== "") {
      trees.add(path.resolve(rootDir, `eval-results/runs/${runId}/runtime/pm`));
      trees.add(path.resolve(rootDir, `eval-results/runs/${runId}/scenario`));
    }
    const isolation = loadOracleIsolation(rootDir, item);
    if (isolation?.bindings && typeof isolation.bindings === "object") {
      for (const binding of Object.values(isolation.bindings)) addPath(binding?.path);
    }
  }
  for (const inputPath of additionalPaths) addPath(inputPath);
  return { paths: [...paths], trees: [...trees] };
}

function mergeProtectedInputs(...groups) {
  return {
    paths: [...new Set(groups.flatMap((group) => group.paths))],
    trees: [...new Set(groups.flatMap((group) => group.trees))],
  };
}

function validateReportPublicationNamespace(
  rootDir,
  reportPath,
  publicationPaths,
  protectedInputs
) {
  const publicationLock = capabilityPublicationLockPath(rootDir);
  // The adjacent report lock was removed because an arbitrary report path must
  // never grant reclamation authority over its sibling. Keep its former alias
  // reserved so older invocations cannot overlap the dedicated global lock.
  const reportLockAlias = `${reportPath}.lock`;
  const conflictsWithImmutableTree = immutablePublicationRoots(rootDir).some((directory) =>
    inside(directory, reportPath)
  );
  const conflictsWithPlannedPath = publicationPaths.some(
    (publicationPath) =>
      generatedPathnamesOverlap(reportPath, publicationPath) ||
      generatedPathnamesOverlap(reportLockAlias, publicationPath)
  );
  const conflictsWithProtectedInput =
    protectedInputs.paths.some((inputPath) => generatedPathnamesOverlap(reportPath, inputPath)) ||
    protectedInputs.trees.some((directory) => inside(directory, reportPath));
  const protectedInputConflictsWithPublication =
    protectedInputs.paths.some(
      (inputPath) =>
        publicationPaths.some((publicationPath) =>
          generatedPathnamesOverlap(inputPath, publicationPath)
        ) ||
        isOwnedLockNamespacePath(publicationLock, inputPath) ||
        isAtomicTemporaryPath(inputPath, publicationLock)
    ) ||
    protectedInputs.trees.some(
      (directory) =>
        publicationPaths.some((publicationPath) => inside(directory, publicationPath)) ||
        inside(directory, publicationLock)
    );
  const conflictsWithPublicationLock =
    isOwnedLockNamespacePath(publicationLock, reportPath) ||
    isOwnedLockNamespacePath(publicationLock, reportLockAlias) ||
    isAtomicTemporaryPath(reportPath, publicationLock) ||
    isAtomicTemporaryPath(reportLockAlias, publicationLock);
  if (protectedInputConflictsWithPublication) {
    throw new Error("protected capability input conflicts with a publication namespace");
  }
  if (
    conflictsWithImmutableTree ||
    conflictsWithPlannedPath ||
    conflictsWithProtectedInput ||
    conflictsWithPublicationLock
  ) {
    throw new Error(
      "capability report path conflicts with a protected input or publication namespace"
    );
  }
}

function generatedPathnamesOverlap(left, right) {
  return left === right || isAtomicTemporaryPath(left, right) || isAtomicTemporaryPath(right, left);
}

function isAtomicTemporaryPath(basePath, candidatePath) {
  if (path.dirname(basePath) !== path.dirname(candidatePath)) return false;
  const basename = path.basename(basePath);
  const candidate = path.basename(candidatePath);
  return candidate.startsWith(`${basename}.tmp-`) || candidate.startsWith(`.${basename}.tmp-`);
}

function isOwnedLockNamespacePath(lockPath, candidatePath) {
  if (path.dirname(lockPath) !== path.dirname(candidatePath)) return false;
  const lockName = path.basename(lockPath);
  const candidate = path.basename(candidatePath);
  return (
    candidate === lockName ||
    candidate.startsWith(`${lockName}.candidate-`) ||
    candidate === `${lockName}.reclaim` ||
    candidate.startsWith(`${lockName}.reclaim.`) ||
    candidate.startsWith(`${lockName}.tmp-`) ||
    (candidate.startsWith(`.${lockName}.`) && candidate.includes(".tmp-"))
  );
}

function assertPublicationsMatchPlan(publications, plannedPublicationPaths) {
  const planned = new Set(plannedPublicationPaths);
  const actual = new Set();
  for (const publication of publications) {
    if (!planned.has(publication.path)) {
      throw new Error(`unexpected capability publication path: ${publication.path}`);
    }
    if (actual.has(publication.path)) {
      throw new Error(`duplicate capability publication path: ${publication.path}`);
    }
    actual.add(publication.path);
  }
  if (actual.size !== planned.size) {
    throw new Error("capability publication plan is incomplete");
  }
}

function preparePublicationDirectories(rootDir, reportPath, publicationPaths) {
  const directories = new Set([
    path.dirname(capabilityPublicationLockPath(rootDir)),
    path.dirname(reportPath),
  ]);
  for (const publicationPath of publicationPaths) directories.add(path.dirname(publicationPath));

  const ordered = [...directories].sort(
    (left, right) =>
      path.relative(rootDir, left).split(path.sep).length -
      path.relative(rootDir, right).split(path.sep).length
  );
  // Inspect every existing ancestry before creating any missing directory. A
  // pre-existing symlink must not turn even directory preparation into an
  // out-of-root write.
  for (const directory of ordered) assertExistingDirectoryAncestry(rootDir, directory);
  for (const directory of ordered) createAnchoredDirectory(rootDir, directory);
  for (const directory of ordered) assertAnchoredDirectory(rootDir, directory);
  return ordered;
}

function assertExistingDirectoryAncestry(rootDir, directory) {
  const relative = path.relative(rootDir, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`capability publication parent must be inside root: ${directory}`);
  }
  if (relative === "") {
    assertRealDirectory(rootDir);
    return;
  }
  let current = rootDir;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      assertRealDirectory(current);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

function createAnchoredDirectory(rootDir, directory) {
  const relative = path.relative(rootDir, directory);
  if (relative === "") return;
  let current = rootDir;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    assertRealDirectory(current);
  }
}

function assertAnchoredDirectory(rootDir, directory) {
  if (!inside(rootDir, directory)) {
    throw new Error(`capability publication parent must be inside root: ${directory}`);
  }
  assertExistingDirectoryAncestry(rootDir, directory);
  assertRealDirectory(directory);
}

function assertRealDirectory(directory) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(directory) !== directory) {
    throw new Error(
      `capability publication parent must be a real directory inside the root: ${directory}`
    );
  }
}

function validateReportPath(rootDir, reportPath) {
  if (!inside(rootDir, reportPath) || reportPath === rootDir) {
    throw new Error("capability report path must be a file inside the root directory");
  }
  const parent = path.dirname(reportPath);
  assertExistingDirectoryAncestry(rootDir, parent);
  let stat;
  try {
    stat = fs.lstatSync(reportPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    fs.realpathSync(reportPath) !== reportPath
  ) {
    throw new Error("capability report path must be a canonical regular file inside the root");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error("existing capability report must use private file permissions");
  }
}

function canonicalOutputPath(filePath) {
  const basename = path.basename(filePath);
  let cursor = path.dirname(filePath);
  const missing = [];
  while (true) {
    try {
      cursor = fs.realpathSync(cursor);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
  return path.join(cursor, ...missing.reverse(), basename);
}

function privateJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function assertImmutablePublication({ path: filePath, bytes }, rootDir) {
  assertAnchoredDirectory(rootDir, path.dirname(filePath));
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(`sealed capability artifact conflicts with unsafe path: ${filePath}`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error(`sealed capability artifact must use private file permissions: ${filePath}`);
  }
  let existing;
  try {
    existing = readBoundedFile(filePath, bytes.length);
  } catch {
    throw new Error(`sealed capability artifact conflicts with existing bytes: ${filePath}`);
  }
  if (!existing.equals(bytes)) {
    throw new Error(`sealed capability artifact conflicts with existing bytes: ${filePath}`);
  }
}

function publishPrivateBytesImmutable({ path: filePath, bytes }, rootDir) {
  assertAnchoredDirectory(rootDir, path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      fs.linkSync(temporary, filePath);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      assertImmutablePublication({ path: filePath, bytes }, rootDir);
      return;
    }
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function writePrivateBytes(filePath, bytes, rootDir) {
  assertAnchoredDirectory(rootDir, path.dirname(filePath));
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function inside(rootDir, candidate) {
  const relative = path.relative(rootDir, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const options = {
    rootDir: process.cwd(),
    oraclePath: null,
    capturePath: null,
    judgmentsPath: null,
    reportPath: null,
    browserPath: null,
  };
  const flags = new Map([
    ["--root", "rootDir"],
    ["--oracle", "oraclePath"],
    ["--capture", "capturePath"],
    ["--judgments", "judgmentsPath"],
    ["--report", "reportPath"],
    ["--browser", "browserPath"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = flags.get(argv[index]);
    if (!key) throw new Error(`unknown argument ${argv[index]}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`${argv[index]} requires a path`);
    options[key] = path.resolve(value);
    index += 1;
  }
  if (
    !options.oraclePath ||
    !options.capturePath ||
    !options.judgmentsPath ||
    !options.reportPath
  ) {
    throw new Error(
      "usage: design-critique-capability-adjudicate.js --oracle <oracle.json> --capture <capture.json> --judgments <judgments.json> --report <report.json> [--browser <chromium>]"
    );
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const protectedInputPaths = [
      fs.realpathSync(options.oraclePath),
      fs.realpathSync(options.capturePath),
      fs.realpathSync(options.judgmentsPath),
    ];
    const result = sealCapabilityAdjudication({
      rootDir: options.rootDir,
      oracle: readCapabilityJson(options.oraclePath, "oracle"),
      capture: readCapabilityJson(options.capturePath, "capture"),
      judgments: readCapabilityJson(options.judgmentsPath, "judgments"),
      reportPath: options.reportPath,
      browserPath: options.browserPath,
      protectedInputPaths,
    });
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "sealed",
          report: result.reportPath,
          repeat_count: result.report.repeats.length,
        },
        null,
        2
      )}\n`
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  parseArgs,
  sealCapabilityAdjudication,
};
