#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function validateCapabilityReport(report, oracle) {
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
  if (report.schema_version !== 1) issues.push("report.schema_version must equal 1");
  if (report.benchmark_id !== oracle.benchmark_id) {
    issues.push("report.benchmark_id must match the oracle");
  }
  if (
    closedObject(
      report.profile,
      ["id", "model", "effort"],
      ["id", "model", "effort"],
      "report.profile",
      issues
    )
  ) {
    for (const field of ["id", "model", "effort"]) {
      if (!nonempty(report.profile[field])) issues.push(`report.profile.${field} is required`);
    }
  }
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
          ["case_id", "blocked", "findings"],
          ["case_id", "blocked", "findings"],
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

function scoreCapabilityReport(oracle, report) {
  const oracleIssues = validateCapabilityOracle(oracle);
  const reportIssues = oracleIssues.length === 0 ? validateCapabilityReport(report, oracle) : [];
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

function ratio(numerator, denominator, emptyValue) {
  if (denominator === 0) return emptyValue;
  return Number((numerator / denominator).toFixed(6));
}

function parseArgs(argv) {
  const options = { oracle: null, report: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--oracle" || arg === "--report") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      options[arg.slice(2)] = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (!options.oracle || !options.report) {
    throw new Error(
      "usage: design-critique-capability.js --oracle <oracle.json> --report <report.json>"
    );
  }
  return options;
}

function main(argv) {
  try {
    const options = parseArgs(argv);
    const oracle = JSON.parse(fs.readFileSync(options.oracle, "utf8"));
    const report = JSON.parse(fs.readFileSync(options.report, "utf8"));
    const result = scoreCapabilityReport(oracle, report);
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
  scoreCapabilityReport,
  validateCapabilityOracle,
  validateCapabilityReport,
};
