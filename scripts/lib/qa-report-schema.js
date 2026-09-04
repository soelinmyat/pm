"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isRfc3339DateTime } = require("./iso-time");

const MAX_QA_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_FINDINGS = 1_000;
const MAX_RUNS = 50;
const MAX_SCREENSHOTS = 15;
const VERDICTS = new Set(["pass", "pass-with-concerns", "fail", "blocked"]);
const TIERS = new Set(["quick", "focused", "full"]);
const PLATFORMS = new Set(["web", "mobile"]);
const SEVERITIES = Object.freeze(["critical", "high", "medium", "low"]);
const CATEGORIES = Object.freeze([
  "console",
  "links",
  "visual",
  "functional",
  "ux",
  "performance",
  "accessibility",
]);
const DISPOSITIONS = new Set(["open", "fixed"]);
const EVIDENCE_TYPES = new Set(["assertion", "structural", "console", "visual"]);
const CATEGORY_WEIGHTS = Object.freeze({
  console: 15,
  links: 10,
  visual: 10,
  functional: 25,
  ux: 15,
  performance: 10,
  accessibility: 15,
});
const SEVERITY_DEDUCTIONS = Object.freeze({ critical: 25, high: 15, medium: 8, low: 3 });
const TOP_LEVEL_FIELDS = Object.freeze([
  "schema_version",
  "commit",
  "verdict",
  "health_score",
  "tier",
  "platform",
  "assertions",
  "finding_counts",
  "findings",
  "category_breakdown",
  "screenshots",
  "runs",
]);
const FINDING_FIELDS = Object.freeze([
  "id",
  "severity",
  "category",
  "summary",
  "route",
  "evidence",
  "disposition",
]);
const FINDING_EVIDENCE_FIELDS = Object.freeze([
  "type",
  "probe",
  "observed",
  "expected",
  "screenshot",
]);
const RUN_FIELDS = Object.freeze([
  "run",
  "kind",
  "checked_at",
  "verdict",
  "health_score",
  "assertions",
  "finding_ids",
]);
const REVERIFY_FIELDS = Object.freeze([
  ...RUN_FIELDS,
  "previous_verdict",
  "previous_health_score",
  "fixed_finding_ids",
  "still_open_finding_ids",
  "new_finding_ids",
]);

function expectedQaReportPath(session) {
  if (!object(session) || !object(session.source)) {
    throw new TypeError("QA report validation requires a Dev session source");
  }
  if (typeof session.source.repo_root !== "string" || !path.isAbsolute(session.source.repo_root)) {
    throw new TypeError("Dev session source.repo_root must be absolute");
  }
  if (typeof session.slug !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(session.slug)) {
    throw new TypeError("Dev session slug must be normalized");
  }
  return path.join(
    session.source.repo_root,
    ".pm",
    "dev-sessions",
    session.slug,
    "qa",
    "report.json"
  );
}

function checkQaReport(options) {
  const issues = [];
  if (!object(options) || !object(options.session)) {
    return { ok: false, issues: [issue("session", "is required")] };
  }
  let expectedPath;
  try {
    expectedPath = expectedQaReportPath(options.session);
  } catch (error) {
    return { ok: false, issues: [issue("session", error.message)] };
  }
  const reportPath = options.reportPath;
  if (typeof reportPath !== "string" || !path.isAbsolute(reportPath)) {
    return {
      ok: false,
      issues: [issue("report", "must be the exact absolute session QA report path")],
    };
  }
  if (reportPath !== expectedPath) {
    issues.push(issue("report", `must equal ${expectedPath}`));
  }
  validateReportLocation(options.session.source.repo_root, expectedPath, issues);
  if (issues.length > 0) return { ok: false, issues, expected_path: expectedPath };

  let bytes;
  try {
    const stat = fs.statSync(expectedPath);
    if (!stat.isFile()) {
      issues.push(issue("report", "must be a regular file"));
      return { ok: false, issues, expected_path: expectedPath };
    }
    if (stat.size > MAX_QA_REPORT_BYTES) {
      issues.push(issue("report", `exceeds ${MAX_QA_REPORT_BYTES} bytes`));
      return { ok: false, issues, expected_path: expectedPath };
    }
    bytes = fs.readFileSync(expectedPath);
  } catch (error) {
    issues.push(issue("report", `could not read QA report: ${error.message}`));
    return { ok: false, issues, expected_path: expectedPath };
  }

  let report;
  try {
    report = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    issues.push(issue("report", `must be valid JSON: ${error.message}`));
    return { ok: false, issues, expected_path: expectedPath };
  }
  issues.push(
    ...validateQaReport(report, {
      expectedCommit: options.expectedCommit,
      requirePassing: options.requirePassing !== false,
    })
  );
  return {
    ok: issues.length === 0,
    issues,
    expected_path: expectedPath,
    verdict: report?.verdict,
    health_score: report?.health_score,
  };
}

function validateReportLocation(repoRoot, expectedPath, issues) {
  const resolvedRoot = path.resolve(repoRoot);
  const sessionDir = path.dirname(path.dirname(expectedPath));
  const relative = path.relative(resolvedRoot, expectedPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    issues.push(issue("report", "must remain inside the Dev session repository"));
    return;
  }
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      issues.push(issue("report", `required path component is unavailable: ${error.message}`));
      return;
    }
    if (stat.isSymbolicLink()) {
      issues.push(issue("report", `symbolic links are not allowed: ${cursor}`));
      return;
    }
  }
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realSession = fs.realpathSync(sessionDir);
    const realReport = fs.realpathSync(expectedPath);
    if (!contained(realRoot, realSession)) {
      issues.push(issue("report", "session directory escapes the repository"));
    }
    if (!contained(realSession, realReport)) {
      issues.push(issue("report", "QA report escapes the session directory"));
    }
  } catch (error) {
    issues.push(issue("report", `could not resolve QA report location: ${error.message}`));
  }
}

function validateQaReport(report, options = {}) {
  const issues = [];
  if (!object(report)) return [issue("report", "must be an object")];
  closed(report, TOP_LEVEL_FIELDS, "report", issues);
  required(report, TOP_LEVEL_FIELDS, "report", issues);
  if (report.schema_version !== 1) add(issues, "report.schema_version", "must equal 1");
  if (!sha(report.commit)) add(issues, "report.commit", "must be a Git object ID");
  if (options.expectedCommit && report.commit !== options.expectedCommit) {
    add(issues, "report.commit", `must equal current result commit ${options.expectedCommit}`);
  }
  if (!VERDICTS.has(report.verdict)) add(issues, "report.verdict", "is invalid");
  integerInRange(report.health_score, 0, 100, "report.health_score", issues);
  if (!TIERS.has(report.tier)) add(issues, "report.tier", "is invalid");
  if (!PLATFORMS.has(report.platform)) add(issues, "report.platform", "is invalid");
  validateAssertions(report.assertions, "report.assertions", issues);
  validateStringArray(report.screenshots, "report.screenshots", issues, {
    maxItems: MAX_SCREENSHOTS,
    absolutePaths: true,
  });

  const findingIds = validateFindings(report.findings, report.screenshots, issues);
  validateFindingCounts(report.finding_counts, report.findings, issues);
  validateCategoryBreakdown(report.category_breakdown, report.findings, issues);
  const expectedHealth = healthScoreFor(report.findings);
  if (Number.isInteger(report.health_score) && report.health_score !== expectedHealth) {
    add(issues, "report.health_score", `must equal the finding-derived score ${expectedHealth}`);
  }
  validateRuns(report.runs, report, findingIds, issues);
  validateVerdict(report, issues, options.requirePassing === true);
  return issues;
}

function validateFindings(findings, screenshots, issues) {
  if (!Array.isArray(findings)) {
    add(issues, "report.findings", "must be an array");
    return new Set();
  }
  if (findings.length > MAX_FINDINGS) {
    add(issues, "report.findings", `must contain no more than ${MAX_FINDINGS} entries`);
  }
  const ids = new Set();
  const screenshotSet = new Set(Array.isArray(screenshots) ? screenshots : []);
  for (const [index, finding] of findings.entries()) {
    const at = `report.findings[${index}]`;
    if (!object(finding)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(finding, FINDING_FIELDS, at, issues);
    required(finding, FINDING_FIELDS, at, issues);
    if (!localId(finding.id)) add(issues, `${at}.id`, "must be a stable local ID");
    else if (ids.has(finding.id)) add(issues, `${at}.id`, "must be unique");
    else ids.add(finding.id);
    if (!SEVERITIES.includes(finding.severity)) add(issues, `${at}.severity`, "is invalid");
    if (!CATEGORIES.includes(finding.category)) add(issues, `${at}.category`, "is invalid");
    boundedText(finding.summary, `${at}.summary`, issues, 1_000);
    boundedText(finding.route, `${at}.route`, issues, 2_048);
    if (!DISPOSITIONS.has(finding.disposition)) add(issues, `${at}.disposition`, "is invalid");
    validateFindingEvidence(finding.evidence, `${at}.evidence`, screenshotSet, issues);
  }
  return ids;
}

function validateFindingEvidence(value, at, screenshots, issues) {
  if (!object(value)) {
    add(issues, at, "must be an object");
    return;
  }
  closed(value, FINDING_EVIDENCE_FIELDS, at, issues);
  required(value, FINDING_EVIDENCE_FIELDS, at, issues);
  if (!EVIDENCE_TYPES.has(value.type)) add(issues, `${at}.type`, "is invalid");
  boundedText(value.probe, `${at}.probe`, issues, 4_096);
  boundedText(value.observed, `${at}.observed`, issues, 20_000);
  boundedText(value.expected, `${at}.expected`, issues, 20_000);
  if (value.screenshot !== null) {
    if (typeof value.screenshot !== "string" || !path.isAbsolute(value.screenshot)) {
      add(issues, `${at}.screenshot`, "must be null or an absolute path");
    } else if (!screenshots.has(value.screenshot)) {
      add(issues, `${at}.screenshot`, "must be listed in report.screenshots");
    }
  }
  if (value.type === "visual" && value.screenshot === null) {
    add(issues, `${at}.screenshot`, "visual evidence requires a screenshot");
  }
}

function validateFindingCounts(counts, findings, issues) {
  const at = "report.finding_counts";
  if (!object(counts)) {
    add(issues, at, "must be an object");
    return;
  }
  closed(counts, SEVERITIES, at, issues);
  required(counts, SEVERITIES, at, issues);
  const openFindings = Array.isArray(findings)
    ? findings.filter((finding) => object(finding) && finding.disposition === "open")
    : [];
  for (const severity of SEVERITIES) {
    integerInRange(counts[severity], 0, MAX_FINDINGS, `${at}.${severity}`, issues);
    const expected = openFindings.filter((finding) => finding.severity === severity).length;
    if (Number.isInteger(counts[severity]) && counts[severity] !== expected) {
      add(issues, `${at}.${severity}`, `must equal ${expected} open findings`);
    }
  }
}

function validateCategoryBreakdown(breakdown, findings, issues) {
  const at = "report.category_breakdown";
  if (!Array.isArray(breakdown)) {
    add(issues, at, "must be an array");
    return;
  }
  if (breakdown.length !== CATEGORIES.length) {
    add(issues, at, `must contain exactly ${CATEGORIES.length} category rows`);
  }
  const observed = new Set();
  const expectedScores = categoryScoresFor(findings);
  for (const [index, row] of breakdown.entries()) {
    const rowAt = `${at}[${index}]`;
    if (!object(row)) {
      add(issues, rowAt, "must be an object");
      continue;
    }
    closed(row, ["category", "score"], rowAt, issues);
    required(row, ["category", "score"], rowAt, issues);
    if (!CATEGORIES.includes(row.category)) add(issues, `${rowAt}.category`, "is invalid");
    else if (observed.has(row.category)) add(issues, `${rowAt}.category`, "must be unique");
    else observed.add(row.category);
    integerInRange(row.score, 0, 100, `${rowAt}.score`, issues);
    if (
      CATEGORIES.includes(row.category) &&
      Number.isInteger(row.score) &&
      row.score !== expectedScores[row.category]
    ) {
      add(
        issues,
        `${rowAt}.score`,
        `must equal the finding-derived score ${expectedScores[row.category]}`
      );
    }
  }
  for (const category of CATEGORIES) {
    if (!observed.has(category)) add(issues, at, `is missing category ${category}`);
  }
}

function validateRuns(runs, report, findingIds, issues) {
  const at = "report.runs";
  if (!Array.isArray(runs) || runs.length === 0) {
    add(issues, at, "must contain at least one run");
    return;
  }
  if (runs.length > MAX_RUNS) add(issues, at, `must contain no more than ${MAX_RUNS} runs`);
  let previous = null;
  for (const [index, run] of runs.entries()) {
    const runAt = `${at}[${index}]`;
    if (!object(run)) {
      add(issues, runAt, "must be an object");
      continue;
    }
    const isReverify = run.kind === "reverify";
    const fields = isReverify ? REVERIFY_FIELDS : RUN_FIELDS;
    closed(run, fields, runAt, issues);
    required(run, fields, runAt, issues);
    if (run.run !== index + 1) add(issues, `${runAt}.run`, `must equal ${index + 1}`);
    if (index === 0 && run.kind !== "initial") {
      add(issues, `${runAt}.kind`, "the first run must be initial");
    } else if (index > 0 && run.kind !== "reverify") {
      add(issues, `${runAt}.kind`, "later runs must be reverify");
    }
    if (!isRfc3339DateTime(run.checked_at)) {
      add(issues, `${runAt}.checked_at`, "must be RFC 3339");
    }
    if (previous && isRfc3339DateTime(run.checked_at) && run.checked_at < previous.checked_at) {
      add(issues, `${runAt}.checked_at`, "must not precede the previous run");
    }
    if (!VERDICTS.has(run.verdict)) add(issues, `${runAt}.verdict`, "is invalid");
    integerInRange(run.health_score, 0, 100, `${runAt}.health_score`, issues);
    validateAssertions(run.assertions, `${runAt}.assertions`, issues);
    validateIdArray(run.finding_ids, `${runAt}.finding_ids`, findingIds, issues);
    validateScoreVerdict(run.verdict, run.health_score, runAt, issues);
    if (isReverify) validateReverifyRun(run, previous, runAt, findingIds, report, issues);
    previous = run;
  }
  const latest = runs.at(-1);
  if (!object(latest)) return;
  if (latest.verdict !== report.verdict) {
    add(issues, `${at}[${runs.length - 1}].verdict`, "must equal the top-level verdict");
  }
  if (latest.health_score !== report.health_score) {
    add(issues, `${at}[${runs.length - 1}].health_score`, "must equal top-level health_score");
  }
  if (!sameAssertions(latest.assertions, report.assertions)) {
    add(issues, `${at}[${runs.length - 1}].assertions`, "must equal top-level assertions");
  }
  if (!sameStringSet(latest.finding_ids, [...findingIds])) {
    add(issues, `${at}[${runs.length - 1}].finding_ids`, "must list every current finding ID");
  }
}

function validateReverifyRun(run, previous, at, findingIds, report, issues) {
  if (!previous) return;
  if (run.previous_verdict !== previous.verdict) {
    add(issues, `${at}.previous_verdict`, "must equal the previous run verdict");
  }
  if (run.previous_health_score !== previous.health_score) {
    add(issues, `${at}.previous_health_score`, "must equal the previous run health_score");
  }
  const groups = [
    ["fixed_finding_ids", run.fixed_finding_ids],
    ["still_open_finding_ids", run.still_open_finding_ids],
    ["new_finding_ids", run.new_finding_ids],
  ];
  for (const [name, values] of groups) validateIdArray(values, `${at}.${name}`, findingIds, issues);
  const grouped = groups.flatMap(([, values]) => (Array.isArray(values) ? values : []));
  if (new Set(grouped).size !== grouped.length) {
    add(issues, at, "fixed, still-open, and new finding IDs must be disjoint");
  }
  const previousIds = new Set(Array.isArray(previous.finding_ids) ? previous.finding_ids : []);
  for (const id of Array.isArray(run.new_finding_ids) ? run.new_finding_ids : []) {
    if (previousIds.has(id)) add(issues, `${at}.new_finding_ids`, `${id} existed in the prior run`);
  }
  if (run === report.runs.at(-1)) {
    const byId = new Map(
      (Array.isArray(report.findings) ? report.findings : [])
        .filter((finding) => object(finding))
        .map((finding) => [finding.id, finding])
    );
    for (const id of Array.isArray(run.fixed_finding_ids) ? run.fixed_finding_ids : []) {
      if (byId.get(id)?.disposition !== "fixed") {
        add(issues, `${at}.fixed_finding_ids`, `${id} must have fixed disposition`);
      }
    }
    for (const id of Array.isArray(run.still_open_finding_ids) ? run.still_open_finding_ids : []) {
      if (byId.get(id)?.disposition !== "open") {
        add(issues, `${at}.still_open_finding_ids`, `${id} must have open disposition`);
      }
    }
  }
}

function validateVerdict(report, issues, requirePassing) {
  const openCritical = openCount(report.findings, "critical");
  const openHigh = openCount(report.findings, "high");
  validateScoreVerdict(report.verdict, report.health_score, "report", issues);
  if (["pass", "pass-with-concerns"].includes(report.verdict)) {
    if (openCritical > 0 || openHigh > 0) {
      add(issues, "report.verdict", "cannot pass with unresolved Critical or High findings");
    }
    if (!object(report.assertions) || !Number.isInteger(report.assertions.total)) return;
    if (report.assertions.total < 1) {
      add(issues, "report.assertions.total", "a passing QA report must execute assertions");
    }
    if (report.assertions.passed < 1) {
      add(issues, "report.assertions.passed", "a passing QA report must pass an assertion");
    }
  }
  if (
    report.verdict === "fail" &&
    Number.isInteger(report.health_score) &&
    report.health_score >= 60 &&
    openCritical === 0 &&
    openHigh === 0
  ) {
    add(issues, "report.verdict", "fail requires health below 60 or an unresolved Critical/High");
  }
  if (requirePassing && !["pass", "pass-with-concerns"].includes(report.verdict)) {
    add(issues, "report.verdict", "must be pass or pass-with-concerns for QA gate evidence");
  }
}

function validateScoreVerdict(verdict, score, at, issues) {
  if (!Number.isInteger(score)) return;
  if (verdict === "pass" && score < 80) {
    add(issues, `${at}.verdict`, "pass requires health_score >= 80");
  }
  if (verdict === "pass-with-concerns" && (score < 60 || score >= 80)) {
    add(issues, `${at}.verdict`, "pass-with-concerns requires health_score from 60 through 79");
  }
}

function categoryScoresFor(findings) {
  const scores = Object.fromEntries(CATEGORIES.map((category) => [category, 100]));
  for (const finding of Array.isArray(findings) ? findings : []) {
    if (
      !object(finding) ||
      finding.disposition !== "open" ||
      !CATEGORIES.includes(finding.category) ||
      !SEVERITIES.includes(finding.severity)
    ) {
      continue;
    }
    scores[finding.category] = Math.max(
      0,
      scores[finding.category] - SEVERITY_DEDUCTIONS[finding.severity]
    );
  }
  return scores;
}

function healthScoreFor(findings) {
  const scores = categoryScoresFor(findings);
  return Math.round(
    CATEGORIES.reduce(
      (total, category) => total + scores[category] * (CATEGORY_WEIGHTS[category] / 100),
      0
    )
  );
}

function validateAssertions(value, at, issues) {
  if (!object(value)) {
    add(issues, at, "must be an object");
    return;
  }
  closed(value, ["passed", "total"], at, issues);
  required(value, ["passed", "total"], at, issues);
  integerInRange(value.passed, 0, 1_000_000, `${at}.passed`, issues);
  integerInRange(value.total, 0, 1_000_000, `${at}.total`, issues);
  if (
    Number.isInteger(value.passed) &&
    Number.isInteger(value.total) &&
    value.passed > value.total
  ) {
    add(issues, `${at}.passed`, "cannot exceed total");
  }
}

function validateIdArray(value, at, allowed, issues) {
  validateStringArray(value, at, issues, { maxItems: MAX_FINDINGS, localIds: true });
  if (!Array.isArray(value)) return;
  for (const id of value) {
    if (localId(id) && !allowed.has(id)) add(issues, at, `references unknown finding ${id}`);
  }
}

function validateStringArray(value, at, issues, options = {}) {
  if (!Array.isArray(value)) {
    add(issues, at, "must be an array");
    return;
  }
  if (options.maxItems !== undefined && value.length > options.maxItems) {
    add(issues, at, `must contain no more than ${options.maxItems} entries`);
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const itemAt = `${at}[${index}]`;
    if (typeof item !== "string" || !item.trim() || item.length > 4_096) {
      add(issues, itemAt, "must be a bounded non-empty string");
      continue;
    }
    if (options.absolutePaths && !path.isAbsolute(item)) {
      add(issues, itemAt, "must be an absolute path");
    }
    if (options.localIds && !localId(item)) add(issues, itemAt, "must be a stable local ID");
    if (seen.has(item)) add(issues, itemAt, "must be unique");
    seen.add(item);
  }
}

function boundedText(value, at, issues, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    add(issues, at, `must be a non-empty string of at most ${maxLength} characters`);
  }
}

function integerInRange(value, min, max, at, issues) {
  if (!Number.isInteger(value) || value < min || value > max) {
    add(issues, at, `must be an integer from ${min} through ${max}`);
  }
}

function openCount(findings, severity) {
  return Array.isArray(findings)
    ? findings.filter(
        (finding) =>
          object(finding) && finding.disposition === "open" && finding.severity === severity
      ).length
    : 0;
}

function sameAssertions(left, right) {
  return (
    object(left) && object(right) && left.passed === right.passed && left.total === right.total
  );
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === left.length && right.every((item) => leftSet.has(item));
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function closed(value, allowed, at, issues) {
  const fields = new Set(allowed);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) add(issues, `${at}.${field}`, "unknown field");
  }
}

function required(value, fields, at, issues) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) add(issues, `${at}.${field}`, "is required");
  }
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha(value) {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

function localId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value);
}

function add(issues, at, message) {
  issues.push(issue(at, message));
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

module.exports = {
  CATEGORIES,
  CATEGORY_WEIGHTS,
  MAX_QA_REPORT_BYTES,
  SEVERITY_DEDUCTIONS,
  checkQaReport,
  expectedQaReportPath,
  healthScoreFor,
  validateQaReport,
};
