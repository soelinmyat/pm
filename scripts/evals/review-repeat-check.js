#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { safeProjectInput } = require("../lib/safe-project-output");
const { checkReview, expandFromReport } = require("../review-check");

const METRIC_NAMES = Object.freeze([
  "finding_set_agreement",
  "finding_count_stability",
  "severity_agreement",
  "outcome_agreement",
]);

function checkReviewRepeats(root, comparisonPath) {
  const projectRoot = fs.realpathSync(path.resolve(root));
  const comparison = readJson(projectRoot, comparisonPath);
  const issues = [];
  if (comparison.schema_version !== 1) issues.push("schema_version must equal 1");
  const runs = Array.isArray(comparison.runs) ? comparison.runs : [];
  if (runs.length !== 3) issues.push("runs must contain exactly three independent Review runs");
  const canonical = readBinding(
    projectRoot,
    comparison.canonical_report,
    "canonical_report",
    issues
  );
  const canonicalPath = ".pm/dev-sessions/feature/review/report.json";
  if (comparison.canonical_report?.path !== canonicalPath)
    issues.push(`canonical_report.path must equal ${canonicalPath}`);
  let canonicalChecked = null;
  if (canonical) {
    canonicalChecked = checkReview(
      expandFromReport({
        root: projectRoot,
        reportPath: canonicalPath,
        fromReport: true,
        verifyGit: false,
        verifyFrozenGit: true,
        verifyBrowser: false,
      })
    );
    if (!canonicalChecked.ok || canonical.value.outcome !== "passed")
      issues.push(
        `canonical_report must be a valid passing Review report: ${canonicalChecked.issues
          .map((item) => `${item.path} ${item.message}`)
          .join("; ")}`
      );
  }
  const runIds = new Set();
  const checkedReports = [];
  let frozenSource = canonicalChecked?.report
    ? JSON.stringify(canonicalChecked.report.source)
    : null;
  for (const [index, run] of runs.entries()) {
    const at = `runs[${index}]`;
    if (!object(run) || !slug(run.run_id)) {
      issues.push(`${at} requires a kebab-case run_id`);
      continue;
    }
    if (runIds.has(run.run_id)) issues.push(`${at}.run_id must be unique`);
    runIds.add(run.run_id);
    const target = readBinding(projectRoot, run.target, `${at}.target`, issues);
    if (!target) continue;
    if (target.value.run_id !== run.run_id) issues.push(`${at}.target run_id mismatch`);
    const sourceIdentity = JSON.stringify(target.value.source);
    if (frozenSource === null) frozenSource = sourceIdentity;
    else if (sourceIdentity !== frozenSource)
      issues.push(`${at}.target must bind the same frozen source as every repeat`);
    const targetPattern = new RegExp(
      `^\\.pm/dev-sessions/feature/review/runs/${escapeRegex(run.run_id)}/round-[1-3]/target\\.json$`
    );
    if (!targetPattern.test(run.target.path)) issues.push(`${at}.target path is not run-scoped`);
    if (!Array.isArray(run.results) || run.results.length !== target.value.allocation?.length) {
      issues.push(`${at}.results must exactly cover target allocation`);
      continue;
    }
    const expectedWorkers = new Set(target.value.allocation.map((item) => item.worker_id));
    const actualWorkers = new Set();
    for (const [resultIndex, binding] of run.results.entries()) {
      const result = readBinding(projectRoot, binding, `${at}.results[${resultIndex}]`, issues);
      if (!result) continue;
      if (
        result.value.run_id !== run.run_id ||
        JSON.stringify(result.value.source) !== JSON.stringify(target.value.source) ||
        result.value.target?.path !== run.target.path ||
        result.value.target?.sha256 !== run.target.sha256
      )
        issues.push(`${at}.results[${resultIndex}] is not bound to its target and source`);
      actualWorkers.add(result.value.worker_id);
    }
    if (
      expectedWorkers.size !== actualWorkers.size ||
      [...expectedWorkers].some((worker) => !actualWorkers.has(worker))
    )
      issues.push(`${at}.results do not match allocated workers`);
    const checked = checkReview({
      root: projectRoot,
      targetPath: run.target.path,
      resultPaths: run.results.map((item) => item.path),
      verifyGit: false,
      verifyFrozenGit: true,
      verifyBrowser: false,
      validateOnly: true,
    });
    if (!checked.ok)
      issues.push(
        `${at} fails canonical Review validation: ${checked.issues
          .map((item) => `${item.path} ${item.message}`)
          .join("; ")}`
      );
    else checkedReports.push(checked.report);
  }
  if (
    canonical &&
    !runs.some(
      (run) =>
        run.target?.path === canonical.value.target?.path &&
        run.target?.sha256 === canonical.value.target?.sha256
    )
  )
    issues.push("one repeat run must exactly match the canonical passing report target");
  const computedMetrics =
    checkedReports.length === 3 ? deriveConsistencyMetrics(checkedReports) : null;
  validateMetrics(comparison.metrics, computedMetrics, issues);
  return { ok: issues.length === 0, issues, computed_metrics: computedMetrics };
}

function deriveConsistencyMetrics(reports) {
  if (!Array.isArray(reports) || reports.length !== 3)
    throw new Error("consistency metrics require exactly three checked Review reports");
  const findingMaps = reports.map(
    (report) => new Map((report.findings || []).map((finding) => [finding.id, finding]))
  );
  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  const setAgreement = pairs.map(([left, right]) => {
    const leftIds = new Set(findingMaps[left].keys());
    const rightIds = new Set(findingMaps[right].keys());
    const union = new Set([...leftIds, ...rightIds]);
    if (union.size === 0) return 1;
    const intersection = [...leftIds].filter((id) => rightIds.has(id)).length;
    return intersection / union.size;
  });
  const counts = findingMaps.map((findings) => findings.size);
  const maxCount = Math.max(...counts);
  let severityMatches = 0;
  let severityComparisons = 0;
  for (const [left, right] of pairs) {
    for (const [id, finding] of findingMaps[left]) {
      const other = findingMaps[right].get(id);
      if (!other) continue;
      severityComparisons += 1;
      if (finding.severity === other.severity) severityMatches += 1;
    }
  }
  const outcomeAgreement = pairs.map(([left, right]) =>
    Number(reports[left].outcome === reports[right].outcome)
  );
  return {
    finding_set_agreement: rounded(mean(setAgreement)),
    finding_count_stability: rounded(maxCount === 0 ? 1 : Math.min(...counts) / maxCount),
    severity_agreement: rounded(
      severityComparisons === 0 ? 1 : severityMatches / severityComparisons
    ),
    outcome_agreement: rounded(mean(outcomeAgreement)),
  };
}

function validateMetrics(submitted, computed, issues) {
  if (!object(submitted)) {
    issues.push(`metrics must contain derived ${METRIC_NAMES.join(", ")}`);
    return;
  }
  const unknown = Object.keys(submitted).filter((name) => !METRIC_NAMES.includes(name));
  for (const name of unknown) issues.push(`metrics.${name} is not a recognized stability metric`);
  for (const name of METRIC_NAMES) {
    const value = submitted[name];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      issues.push(`metrics.${name} must be a number from 0 through 1`);
      continue;
    }
    if (computed && value !== computed[name])
      issues.push(`metrics.${name} must equal derived value ${computed[name]}`);
  }
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function readBinding(root, binding, label, issues) {
  if (!object(binding) || !sha256(binding.sha256)) {
    issues.push(`${label} requires path and SHA-256`);
    return null;
  }
  try {
    const file = safeProjectInput(root, binding.path);
    const bytes = fs.readFileSync(file);
    if (digest(bytes) !== binding.sha256) throw new Error("SHA-256 mismatch");
    return { value: JSON.parse(bytes.toString("utf8")) };
  } catch (error) {
    issues.push(`${label} ${error.message}`);
    return null;
  }
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(safeProjectInput(root, relative), "utf8"));
}
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function slug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (require.main === module) {
  try {
    const result = checkReviewRepeats(process.argv[2] || process.cwd(), process.argv[3]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { checkReviewRepeats, deriveConsistencyMetrics };
