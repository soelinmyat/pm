#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

const {
  capabilityAdjudicationPath,
  capabilityFixVerificationPath,
  capabilityOracleHash,
  validateCapabilityOracle,
  validateCapabilityReport,
} = require("./design-critique-capability.js");

function sealCapabilityAdjudication(options) {
  const rootDir = fs.realpathSync(path.resolve(options.rootDir || process.cwd()));
  const oracle = options.oracle;
  const capture = options.capture;
  const judgments = options.judgments;
  const reportPath = path.resolve(options.reportPath);
  validateInputs({ oracle, capture, judgments });

  const report = loadOrCreateReport(reportPath, oracle, capture.profile);
  if (report.repeats.some((item) => item.repeat === capture.repeat)) {
    throw new Error(`report already contains repeat ${capture.repeat}`);
  }

  const judgmentByCase = new Map(judgments.cases.map((item) => [item.case_id, item]));
  const captureByCase = new Map(capture.cases.map((item) => [item.case_id, item]));
  const rows = oracle.cases.map((oracleCase) => {
    const evidence = captureByCase.get(oracleCase.id);
    const judgment = judgmentByCase.get(oracleCase.id);
    const fixVerification = sealFixVerification({
      rootDir,
      oracle,
      oracleCase,
      profile: capture.profile,
      repeat: capture.repeat,
      evidence,
      fixVerifier: options.fixVerifier,
      browserPath: options.browserPath,
    });
    const findings = deriveAdjudicatedFindings(
      judgment.findings,
      fixVerification.results,
      `judgments case ${oracleCase.id}`
    );
    const artifact = {
      schema_version: 1,
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
        runtime_profile_sha256: evidence.run.runtime_profile.sha256,
        verdict_sha256: evidence.run.verdict.sha256,
        normalized_transcript_sha256: evidence.normalized_transcript.sha256,
        candidate_output_sha256: evidence.candidate_output.sha256,
        post_subject_sha256: evidence.post_subject.sha256,
        fix_verification_sha256: fixVerification.binding.sha256,
      },
      blocked: judgment.blocked,
      findings,
    };
    const relativeArtifactPath = capabilityAdjudicationPath({
      benchmarkId: oracle.benchmark_id,
      profileId: capture.profile.id,
      repeat: capture.repeat,
      caseId: oracleCase.id,
    });
    const absoluteArtifactPath = path.join(rootDir, relativeArtifactPath);
    writePrivateJson(absoluteArtifactPath, artifact);
    return {
      ...structuredClone(evidence),
      fix_verification: fixVerification.binding,
      adjudication: {
        path: relativeArtifactPath,
        sha256: digest(fs.readFileSync(absoluteArtifactPath)),
      },
      blocked: judgment.blocked,
      findings: structuredClone(findings),
    };
  });

  report.repeats.push({ repeat: capture.repeat, cases: rows });
  report.repeats.sort((left, right) => left.repeat - right.repeat);
  const issues = validateCapabilityReport(report, oracle, {
    rootDir,
    fixVerifier: options.fixVerifier,
    browserPath: options.browserPath,
  });
  if (issues.length > 0) {
    throw new Error(`sealed capability report is invalid:\n${issues.join("\n")}`);
  }
  writePrivateJson(reportPath, report);
  return { report, reportPath };
}

function validateInputs({ oracle, capture, judgments }) {
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
  if (capture.schema_version !== 1) throw new Error("capture.schema_version must equal 1");
  if (capture.benchmark_id !== oracle.benchmark_id) {
    throw new Error("capture benchmark does not match the oracle");
  }
  if (capture.oracle_sha256 !== capabilityOracleHash(oracle)) {
    throw new Error("capture oracle_sha256 does not match the exact capability oracle");
  }
  if (capture.harness_only !== false) {
    throw new Error("harness-only captures cannot be adjudicated for capability claims");
  }
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
    "normalized_transcript",
    "candidate_output",
    "post_subject",
  ]);

  requireClosedObject(judgments, ["schema_version", "repeat", "cases"], "judgments");
  if (judgments.schema_version !== 1) {
    throw new Error("judgments.schema_version must equal 1");
  }
  if (judgments.repeat !== capture.repeat) {
    throw new Error("judgments.repeat must match capture.repeat");
  }
  requireExactCases(judgments.cases, oracle.cases, "judgments.cases", [
    "case_id",
    "blocked",
    "findings",
  ]);
}

function sealFixVerification({
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
  const postBytes = fs.readFileSync(postPath);
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
  writePrivateJson(absolutePath, artifact);
  return {
    binding: { path: relativePath, sha256: digest(fs.readFileSync(absolutePath)) },
    results: structuredClone(artifact.results),
  };
}

function deriveAdjudicatedFindings(findings, verificationResults, where) {
  if (!Array.isArray(findings)) throw new Error(`${where}.findings must be an array`);
  const verificationById = new Map(
    verificationResults.map((result) => [result.oracle_id, result.status])
  );
  return findings.map((finding, index) => {
    const findingWhere = `${where}.findings[${index}]`;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error(`${findingWhere} must be an object`);
    }
    const required = [
      "oracle_id",
      "severity",
      "objective",
      "blocking",
      "location_correct",
      "claimed_fixed",
    ];
    const allowed = new Set([...required, "fix_verified"]);
    for (const key of Object.keys(finding)) {
      if (!allowed.has(key)) throw new Error(`${findingWhere} has unknown field ${key}`);
    }
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(finding, key)) {
        throw new Error(`${findingWhere} is missing field ${key}`);
      }
    }

    let fixVerified = false;
    if (finding.claimed_fixed === true) {
      if (!finding.oracle_id) {
        throw new Error(`${findingWhere}.claimed_fixed requires a matched oracle_id`);
      }
      const status = verificationById.get(finding.oracle_id);
      if (!status || status === "indeterminate") {
        throw new Error(`${findingWhere}.claimed_fixed requires a conclusive fix-verification`);
      }
      fixVerified = status === "pass";
    }
    if (
      Object.prototype.hasOwnProperty.call(finding, "fix_verified") &&
      finding.fix_verified !== fixVerified
    ) {
      throw new Error(
        `${findingWhere}.fix_verified is verifier-derived and must equal ${fixVerified}`
      );
    }
    return { ...structuredClone(finding), fix_verified: fixVerified };
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
      schema_version: 2,
      benchmark_id: oracle.benchmark_id,
      profile: structuredClone(profile),
      repeats: [],
    };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.schema_version !== 2 || report.benchmark_id !== oracle.benchmark_id) {
    throw new Error("existing report does not match this capability benchmark");
  }
  if (!isDeepStrictEqual(report.profile, profile)) {
    throw new Error("existing report uses a different model profile");
  }
  if (!Array.isArray(report.repeats)) throw new Error("existing report repeats must be an array");
  return report;
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
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
    const result = sealCapabilityAdjudication({
      rootDir: options.rootDir,
      oracle: JSON.parse(fs.readFileSync(options.oraclePath, "utf8")),
      capture: JSON.parse(fs.readFileSync(options.capturePath, "utf8")),
      judgments: JSON.parse(fs.readFileSync(options.judgmentsPath, "utf8")),
      reportPath: options.reportPath,
      browserPath: options.browserPath,
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
