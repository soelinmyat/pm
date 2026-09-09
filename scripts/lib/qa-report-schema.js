"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { sessionUsesFocusedUiQa } = require("./dev-risk");
const FOCUSED_UI_STATES = ["Desktop layout", "Narrow layout", "Keyboard focus and navigation"];
const { readDescriptorBounded } = require("./bounded-descriptor-read");
const { compareRfc3339DateTimes, isRfc3339DateTime } = require("./iso-time");
const { inspectPngBytes, inspectPngHeaderBytes } = require("./media-inspect");
const { validateWebViewport } = require("./product-ui-viewport");

const MAX_QA_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_QA_EVIDENCE_BYTES = 16 * 1024 * 1024;
const MAX_QA_EVIDENCE_TOTAL_BYTES = 64 * 1024 * 1024;
const QA_EVIDENCE_TOTAL_LIMIT_CODE = "ERR_QA_EVIDENCE_TOTAL_BYTES";
const MAX_ASSERTION_RESULTS = 2_000;
const MAX_FINDINGS = 1_000;
const MAX_RUNS = 50;
const MAX_RECEIPTS = 100;
const MAX_SCREENSHOTS = 15;
const MAX_SCREENSHOTS_TOTAL = MAX_RUNS * MAX_SCREENSHOTS;
const MAX_QA_VALIDATION_ISSUES = 256;
// Accommodates one run of fifteen 4K RGBA captures while bounding all retained history.
const MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL = 512 * 1024 * 1024;
const MAX_QA_OBJECT_FIELDS = 256;
const QA_VALIDATION_ISSUE_LIMIT_MESSAGE = `validation diagnostics were capped at ${MAX_QA_VALIDATION_ISSUES} issues`;
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
const RECEIPT_KINDS = new Set(["deterministic", "browser"]);
const QA_EVIDENCE_ASSURANCE = "workflow-attested-non-cryptographic";
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
  "coverage",
  "receipts",
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
  "commit",
  "checked_at",
  "verdict",
  "health_score",
  "assertions",
  "finding_ids",
  "receipt_ids",
]);
const RECEIPT_FIELDS = Object.freeze([
  "id",
  "run",
  "kind",
  "commit",
  "command",
  "exit_code",
  "assertions",
  "output",
  "screenshot_ids",
]);
const OUTPUT_FIELDS = Object.freeze(["path", "sha256", "bytes"]);
const SCREENSHOT_FIELDS = Object.freeze([
  "id",
  "run",
  "commit",
  "path",
  "sha256",
  "bytes",
  "width",
  "height",
]);
const COVERAGE_FIELDS = Object.freeze(["acceptance_criteria", "critical_states"]);
const COVERAGE_ROW_FIELDS = Object.freeze(["index", "target", "assertion_ids"]);
const FIXED_FINDING_EVIDENCE_FIELDS = Object.freeze(["finding_id", "assertion_ids"]);
const EXECUTION_OUTPUT_FIELDS = Object.freeze([
  "schema_version",
  "assurance",
  "receipt_id",
  "commit",
  "kind",
  "command",
  "exit_code",
  "assertions",
]);
const ASSERTION_RESULT_FIELDS = Object.freeze([
  "id",
  "status",
  "probe",
  "observed",
  "expected",
  "finding_ids",
]);
const REVERIFY_FIELDS = Object.freeze([
  ...RUN_FIELDS,
  "previous_verdict",
  "previous_health_score",
  "fixed_finding_ids",
  "still_open_finding_ids",
  "new_finding_ids",
  "fixed_finding_evidence",
  "previous_report",
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
    add(issues, "report", `must equal ${expectedPath}`);
  }
  validateReportLocation(options.session.source.repo_root, expectedPath, issues);
  if (issues.length > 0) return { ok: false, issues, expected_path: expectedPath };

  let bytes;
  try {
    bytes = readCanonicalQaReport(expectedPath);
  } catch (error) {
    add(issues, "report", `could not read QA report: ${error.message}`);
    return { ok: false, issues, expected_path: expectedPath };
  }
  validateReportLocation(options.session.source.repo_root, expectedPath, issues);
  if (issues.length > 0) return { ok: false, issues, expected_path: expectedPath };

  let report;
  try {
    report = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    add(issues, "report", `must be valid JSON: ${error.message}`);
    return { ok: false, issues, expected_path: expectedPath };
  }
  addIssues(
    issues,
    validateQaReport(report, {
      expectedCommit: options.expectedCommit,
      requirePassing: options.requirePassing !== false,
      evidenceRoot: path.join(path.dirname(expectedPath), "evidence"),
      session: options.session,
      qaCandidate: options.qaCandidate,
      qaHistoryAnchor: options.qaHistoryAnchor === true,
      reportSha256: digest(bytes),
    })
  );
  return {
    ok: issues.length === 0,
    issues,
    expected_path: expectedPath,
    verdict: report?.verdict,
    health_score: report?.health_score,
    run_count: Array.isArray(report?.runs) ? report.runs.length : null,
    run_anchors: buildQaRunAnchors(report, digest(bytes)),
  };
}

function readCanonicalQaReport(reportPath) {
  const flags =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_NOCTTY || 0);
  let descriptor;
  try {
    const initial = fs.lstatSync(reportPath, { bigint: true });
    if (!initial.isFile()) throw new Error("must be a regular file");
    if (initial.size > BigInt(MAX_QA_REPORT_BYTES)) {
      throw new Error(`exceeds ${MAX_QA_REPORT_BYTES} bytes`);
    }

    descriptor = fs.openSync(reportPath, flags);
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("must be a regular file");
    if (!sameFileMetadata(initial, before)) {
      throw new Error("report changed before it could be opened safely");
    }
    if (before.size > BigInt(MAX_QA_REPORT_BYTES)) {
      throw new Error(`exceeds ${MAX_QA_REPORT_BYTES} bytes`);
    }

    const bytes = readDescriptorBounded(descriptor, MAX_QA_REPORT_BYTES, {
      overflowMessage: `exceeds ${MAX_QA_REPORT_BYTES} bytes`,
    });
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileMetadata(before, after)) {
      throw new Error("report changed during validation");
    }

    const final = fs.lstatSync(reportPath, { bigint: true });
    if (!final.isFile() || !sameFileMetadata(after, final)) {
      throw new Error("report path changed during validation");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function sameFileMetadata(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function validateReportLocation(repoRoot, expectedPath, issues) {
  const resolvedRoot = path.resolve(repoRoot);
  const sessionDir = path.dirname(path.dirname(expectedPath));
  const relative = path.relative(resolvedRoot, expectedPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    add(issues, "report", "must remain inside the Dev session repository");
    return;
  }
  let cursor = resolvedRoot;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      add(issues, "report", `required path component is unavailable: ${error.message}`);
      return;
    }
    if (stat.isSymbolicLink()) {
      add(issues, "report", `symbolic links are not allowed: ${cursor}`);
      return;
    }
  }
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realSession = fs.realpathSync(sessionDir);
    const realReport = fs.realpathSync(expectedPath);
    if (!contained(realRoot, realSession)) {
      add(issues, "report", "session directory escapes the repository");
    }
    if (!contained(realSession, realReport)) {
      add(issues, "report", "QA report escapes the session directory");
    }
  } catch (error) {
    add(issues, "report", `could not resolve QA report location: ${error.message}`);
  }
}

function validateQaReport(report, options = {}) {
  const issues = [];
  if (!object(report)) return [issue("report", "must be an object")];
  closed(report, TOP_LEVEL_FIELDS, "report", issues);
  required(report, TOP_LEVEL_FIELDS, "report", issues);
  if (report.schema_version !== 2) add(issues, "report.schema_version", "must equal 2");
  if (!sha(report.commit)) add(issues, "report.commit", "must be a Git object ID");
  if (options.expectedCommit && report.commit !== options.expectedCommit) {
    add(issues, "report.commit", `must equal current result commit ${options.expectedCommit}`);
  }
  if (!VERDICTS.has(report.verdict)) add(issues, "report.verdict", "is invalid");
  integerInRange(report.health_score, 0, 100, "report.health_score", issues);
  if (!TIERS.has(report.tier)) add(issues, "report.tier", "is invalid");
  if (!PLATFORMS.has(report.platform)) add(issues, "report.platform", "is invalid");
  validateAssertions(report.assertions, "report.assertions", issues);
  const screenshots = validateScreenshots(report.screenshots, issues);
  const receipts = validateReceipts(report.receipts, report, screenshots, issues);

  const findingIds = validateFindings(report.findings, [...screenshots.paths], issues);
  validateFindingCounts(report.finding_counts, report.findings, issues);
  validateCategoryBreakdown(report.category_breakdown, report.findings, issues);
  validateCoverageShape(report.coverage, issues);
  const expectedHealth = healthScoreFor(report.findings);
  if (Number.isInteger(report.health_score) && report.health_score !== expectedHealth) {
    add(issues, "report.health_score", `must equal the finding-derived score ${expectedHealth}`);
  }
  validateRuns(report.runs, report, findingIds, receipts, issues);
  validateVerdict(report, issues, options.requirePassing === true);
  if (diagnosticsCapped(issues)) return issues;
  let retained = emptyRetainedEvidence();
  if (typeof options.evidenceRoot === "string") {
    retained = validateRetainedEvidence(report, options.evidenceRoot, issues);
  }
  if (diagnosticsCapped(issues)) return issues;
  validateSessionCoverage(report, options.session, receipts, retained, issues);
  if (diagnosticsCapped(issues)) return issues;
  validateReverifyEvidence(report, retained, issues);
  if (diagnosticsCapped(issues)) return issues;
  validateSessionQaHistory(report, options.session, issues, {
    qaCandidate: options.qaCandidate,
    qaHistoryAnchor: options.qaHistoryAnchor,
    reportSha256: options.reportSha256,
  });
  if (diagnosticsCapped(issues)) return issues;
  validateGitCommitLineage(report, options.session?.source?.repo_root, issues);
  return issues;
}

function validateScreenshots(screenshots, issues) {
  const ids = new Set();
  const paths = new Set();
  const byId = new Map();
  if (!Array.isArray(screenshots)) {
    add(issues, "report.screenshots", "must be an array");
    return { ids, paths, byId };
  }
  if (screenshots.length > MAX_SCREENSHOTS_TOTAL) {
    add(
      issues,
      "report.screenshots",
      `must contain no more than ${MAX_SCREENSHOTS_TOTAL} historical entries`
    );
  }
  for (const [index, screenshot] of boundedEntries(screenshots, MAX_SCREENSHOTS_TOTAL)) {
    const at = `report.screenshots[${index}]`;
    if (!object(screenshot)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(screenshot, SCREENSHOT_FIELDS, at, issues);
    required(screenshot, SCREENSHOT_FIELDS, at, issues);
    if (!localId(screenshot.id)) add(issues, `${at}.id`, "must be a stable local ID");
    else if (ids.has(screenshot.id)) add(issues, `${at}.id`, "must be unique");
    else {
      ids.add(screenshot.id);
      byId.set(screenshot.id, screenshot);
    }
    integerInRange(screenshot.run, 1, MAX_RUNS, `${at}.run`, issues);
    if (!sha(screenshot.commit)) add(issues, `${at}.commit`, "must be a Git object ID");
    validateArtifactBinding(screenshot, at, issues);
    integerInRange(screenshot.width, 1, 20_000, `${at}.width`, issues);
    integerInRange(screenshot.height, 1, 20_000, `${at}.height`, issues);
    if (typeof screenshot.path === "string") {
      if (paths.has(screenshot.path)) add(issues, `${at}.path`, "must be unique");
      else paths.add(screenshot.path);
    }
  }
  return { ids, paths, byId };
}

function validateReceipts(receipts, report, screenshots, issues) {
  const ids = new Set();
  const byId = new Map();
  const outputPaths = new Set();
  const screenshotReferenceCounts = new Map();
  const screenshotIdsByRun = new Map();
  if (!Array.isArray(receipts)) {
    add(issues, "report.receipts", "must be an array");
    return { ids, byId };
  }
  if (receipts.length === 0 && ["pass", "pass-with-concerns"].includes(report.verdict)) {
    add(issues, "report.receipts", "must contain at least one executed evidence receipt");
    return { ids, byId };
  }
  if (receipts.length > MAX_RECEIPTS) {
    add(issues, "report.receipts", `must contain no more than ${MAX_RECEIPTS} entries`);
  }
  for (const [index, receipt] of boundedEntries(receipts, MAX_RECEIPTS)) {
    const at = `report.receipts[${index}]`;
    if (!object(receipt)) {
      add(issues, at, "must be an object");
      continue;
    }
    closed(receipt, RECEIPT_FIELDS, at, issues);
    required(receipt, RECEIPT_FIELDS, at, issues);
    if (!localId(receipt.id)) add(issues, `${at}.id`, "must be a stable local ID");
    else if (ids.has(receipt.id)) add(issues, `${at}.id`, "must be unique");
    else {
      ids.add(receipt.id);
      byId.set(receipt.id, receipt);
    }
    integerInRange(receipt.run, 1, MAX_RUNS, `${at}.run`, issues);
    if (!RECEIPT_KINDS.has(receipt.kind)) add(issues, `${at}.kind`, "is invalid");
    if (!sha(receipt.commit)) add(issues, `${at}.commit`, "must be a Git object ID");
    validateReceiptCommand(receipt, at, issues);
    integerInRange(receipt.exit_code, 0, 255, `${at}.exit_code`, issues);
    validateAssertions(receipt.assertions, `${at}.assertions`, issues);
    if (!object(receipt.output)) add(issues, `${at}.output`, "must be an object");
    else {
      closed(receipt.output, OUTPUT_FIELDS, `${at}.output`, issues);
      required(receipt.output, OUTPUT_FIELDS, `${at}.output`, issues);
      validateArtifactBinding(receipt.output, `${at}.output`, issues);
      if (typeof receipt.output.path === "string") {
        if (outputPaths.has(receipt.output.path))
          add(issues, `${at}.output.path`, "must be unique to this receipt");
        else outputPaths.add(receipt.output.path);
      }
    }
    validateStringArray(receipt.screenshot_ids, `${at}.screenshot_ids`, issues, {
      maxItems: MAX_SCREENSHOTS,
      localIds: true,
    });
    if (Array.isArray(receipt.screenshot_ids) && receipt.screenshot_ids.length > MAX_SCREENSHOTS) {
      add(
        issues,
        "report.screenshots",
        `run ${receipt.run} must contain no more than ${MAX_SCREENSHOTS} screenshots`
      );
    }
    if (Array.isArray(receipt.screenshot_ids)) {
      for (const screenshotId of boundedArray(receipt.screenshot_ids, MAX_SCREENSHOTS)) {
        if (!localId(screenshotId)) continue;
        if (!screenshots.ids.has(screenshotId)) {
          add(issues, `${at}.screenshot_ids`, `references unknown screenshot ${screenshotId}`);
          continue;
        }
        const screenshot = screenshots.byId.get(screenshotId);
        screenshotReferenceCounts.set(
          screenshotId,
          (screenshotReferenceCounts.get(screenshotId) || 0) + 1
        );
        if (screenshot?.run !== receipt.run) {
          add(
            issues,
            `${at}.screenshot_ids`,
            `screenshot ${screenshotId} must identify run ${receipt.run}`
          );
        }
        if (screenshot?.commit !== receipt.commit) {
          add(
            issues,
            `${at}.screenshot_ids`,
            `screenshot ${screenshotId} must match the receipt commit`
          );
        }
        const runIds = screenshotIdsByRun.get(receipt.run) || new Set();
        runIds.add(screenshotId);
        screenshotIdsByRun.set(receipt.run, runIds);
      }
    }
  }
  for (const screenshotId of screenshots.ids) {
    const count = screenshotReferenceCounts.get(screenshotId) || 0;
    if (count === 0) {
      add(issues, "report.screenshots", `screenshot ${screenshotId} is not bound to a receipt`);
    } else if (count > 1) {
      add(
        issues,
        "report.screenshots",
        `screenshot ${screenshotId} must be bound to exactly one receipt`
      );
    }
  }
  for (const [run, screenshotIds] of screenshotIdsByRun) {
    if (screenshotIds.size > MAX_SCREENSHOTS) {
      add(
        issues,
        "report.screenshots",
        `run ${run} must contain no more than ${MAX_SCREENSHOTS} screenshots`
      );
    }
  }
  return { ids, byId };
}

function validateReceiptCommand(receipt, at, issues) {
  boundedText(receipt.command, `${at}.command`, issues, 4_096);
  if (typeof receipt.command !== "string" || !receipt.command.trim()) return;
  const command = receipt.command.trim();
  if (
    /(?:^|[/\\])qa-report-check(?:\.js)?(?:\s|$)/i.test(command) ||
    /^(?:true|:|manual(?:\s+qa|\s+check|\s+inspection)?|none|null|n\/a|not run)$/i.test(command)
  ) {
    add(
      issues,
      `${at}.command`,
      "must identify the executed QA probe, not a manual or report-check placeholder"
    );
  }
  if (
    receipt.kind === "browser" &&
    !/(?:playwright|webdriver|cypress|selenium|appium|chrom(?:e|ium)|browser|cdp|cua)/i.test(
      command
    )
  ) {
    add(issues, `${at}.command`, "browser receipts must identify the browser automation driver");
  }
}

function validateArtifactBinding(binding, at, issues) {
  if (typeof binding.path !== "string" || !path.isAbsolute(binding.path)) {
    add(issues, `${at}.path`, "must be an absolute path");
  }
  if (!sha256(binding.sha256)) add(issues, `${at}.sha256`, "must be a SHA-256 digest");
  integerInRange(binding.bytes, 1, MAX_QA_EVIDENCE_BYTES, `${at}.bytes`, issues);
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
  for (const [index, finding] of boundedEntries(findings, MAX_FINDINGS)) {
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
  const openFindings = boundedArray(findings, MAX_FINDINGS).filter(
    (finding) => object(finding) && finding.disposition === "open"
  );
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
  for (const [index, row] of boundedEntries(breakdown, CATEGORIES.length)) {
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

function validateRuns(runs, report, findingIds, receipts, issues) {
  const at = "report.runs";
  if (!Array.isArray(runs) || runs.length === 0) {
    add(issues, at, "must contain at least one run");
    return;
  }
  if (runs.length > MAX_RUNS) add(issues, at, `must contain no more than ${MAX_RUNS} runs`);
  const retainedRuns = boundedArray(runs, MAX_RUNS);
  let previous = null;
  const usedReceiptIds = new Set();
  for (const [index, run] of retainedRuns.entries()) {
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
    if (!sha(run.commit)) add(issues, `${runAt}.commit`, "must be a Git object ID");
    const checkedAtValid = isRfc3339DateTime(run.checked_at);
    if (!checkedAtValid) {
      add(issues, `${runAt}.checked_at`, "must be RFC 3339");
    }
    if (
      previous &&
      checkedAtValid &&
      isRfc3339DateTime(previous.checked_at) &&
      compareRfc3339DateTimes(run.checked_at, previous.checked_at) < 0
    ) {
      add(issues, `${runAt}.checked_at`, "must not precede the previous run");
    }
    if (!VERDICTS.has(run.verdict)) add(issues, `${runAt}.verdict`, "is invalid");
    integerInRange(run.health_score, 0, 100, `${runAt}.health_score`, issues);
    validateAssertions(run.assertions, `${runAt}.assertions`, issues);
    validateIdArray(run.finding_ids, `${runAt}.finding_ids`, findingIds, issues, MAX_FINDINGS);
    validateIdArray(run.receipt_ids, `${runAt}.receipt_ids`, receipts.ids, issues, MAX_RECEIPTS);
    const retainedReceiptIds = boundedArray(run.receipt_ids, MAX_RECEIPTS);
    const runReceipts = Array.isArray(run.receipt_ids)
      ? retainedReceiptIds.map((id) => receipts.byId.get(id)).filter(Boolean)
      : [];
    if (
      Array.isArray(run.receipt_ids) &&
      run.receipt_ids.length === 0 &&
      ["pass", "pass-with-concerns"].includes(run.verdict)
    ) {
      add(issues, `${runAt}.receipt_ids`, "must bind at least one executed evidence receipt");
    }
    for (const receiptId of retainedReceiptIds) {
      if (usedReceiptIds.has(receiptId))
        add(issues, `${runAt}.receipt_ids`, `receipt ${receiptId} cannot be reused across runs`);
      usedReceiptIds.add(receiptId);
      const receipt = receipts.byId.get(receiptId);
      if (receipt && receipt.run !== run.run)
        add(issues, `${runAt}.receipt_ids`, `receipt ${receiptId} must identify run ${run.run}`);
      if (receipt && receipt.commit !== run.commit)
        add(issues, `${runAt}.receipt_ids`, `receipt ${receiptId} must match run commit`);
    }
    const receiptAssertions = runReceipts.reduce(
      (total, receipt) => ({
        passed:
          total.passed +
          (Number.isInteger(receipt.assertions?.passed) ? receipt.assertions.passed : 0),
        total:
          total.total +
          (Number.isInteger(receipt.assertions?.total) ? receipt.assertions.total : 0),
      }),
      { passed: 0, total: 0 }
    );
    if (object(run.assertions) && !sameAssertions(run.assertions, receiptAssertions)) {
      add(issues, `${runAt}.assertions`, "must equal the sum of its bound receipt assertions");
    }
    if (["pass", "pass-with-concerns"].includes(run.verdict)) {
      if (runReceipts.some((receipt) => receipt.exit_code !== 0))
        add(issues, `${runAt}.receipt_ids`, "passing runs require successful receipt exit codes");
      if (
        runReceipts.some((receipt) => !object(receipt.assertions) || receipt.assertions.total < 1)
      )
        add(issues, `${runAt}.receipt_ids`, "passing runs require executed receipt assertions");
      if (
        runReceipts.some(
          (receipt) =>
            !object(receipt.assertions) || receipt.assertions.passed !== receipt.assertions.total
        )
      )
        add(issues, `${runAt}.receipt_ids`, "passing runs require every receipt assertion to pass");
    }
    validateScoreVerdict(run.verdict, run.health_score, runAt, issues);
    if (isReverify) {
      validateReverifyRun(run, previous, runAt, findingIds, report, issues);
      if (!object(run.previous_report)) {
        add(issues, `${runAt}.previous_report`, "must bind the exact prior QA report bytes");
      } else {
        closed(run.previous_report, OUTPUT_FIELDS, `${runAt}.previous_report`, issues);
        required(run.previous_report, OUTPUT_FIELDS, `${runAt}.previous_report`, issues);
        validateArtifactBinding(run.previous_report, `${runAt}.previous_report`, issues);
        if (
          Number.isInteger(run.previous_report.bytes) &&
          run.previous_report.bytes > MAX_QA_REPORT_BYTES
        ) {
          add(
            issues,
            `${runAt}.previous_report.bytes`,
            `must not exceed the ${MAX_QA_REPORT_BYTES}-byte QA report limit`
          );
        }
      }
      validateFixedFindingEvidenceShape(run, runAt, issues);
    }
    previous = run;
  }
  const latest = retainedRuns.at(-1);
  if (!object(latest)) return;
  if (latest.verdict !== report.verdict) {
    add(issues, `${at}[${retainedRuns.length - 1}].verdict`, "must equal the top-level verdict");
  }
  if (latest.commit !== report.commit) {
    add(
      issues,
      `${at}[${retainedRuns.length - 1}].commit`,
      "must equal the top-level report commit"
    );
  }
  if (latest.health_score !== report.health_score) {
    add(
      issues,
      `${at}[${retainedRuns.length - 1}].health_score`,
      "must equal top-level health_score"
    );
  }
  if (!sameAssertions(latest.assertions, report.assertions)) {
    add(issues, `${at}[${retainedRuns.length - 1}].assertions`, "must equal top-level assertions");
  }
  if (!sameStringSet(latest.finding_ids, [...findingIds])) {
    add(
      issues,
      `${at}[${retainedRuns.length - 1}].finding_ids`,
      "must list every current finding ID"
    );
  }
  for (const receiptId of receipts.ids) {
    if (!usedReceiptIds.has(receiptId))
      add(issues, "report.receipts", `receipt ${receiptId} is unused`);
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
  for (const [name, values] of groups) {
    validateIdArray(values, `${at}.${name}`, findingIds, issues, MAX_FINDINGS);
  }
  const grouped = groups.flatMap(([, values]) => boundedArray(values, MAX_FINDINGS));
  if (new Set(grouped).size !== grouped.length) {
    add(issues, at, "fixed, still-open, and new finding IDs must be disjoint");
  }
  const previousIds = new Set(boundedArray(previous.finding_ids, MAX_FINDINGS));
  for (const id of boundedArray(run.new_finding_ids, MAX_FINDINGS)) {
    if (previousIds.has(id)) add(issues, `${at}.new_finding_ids`, `${id} existed in the prior run`);
  }
  if (run === boundedArray(report.runs, MAX_RUNS).at(-1)) {
    const byId = new Map(
      boundedArray(report.findings, MAX_FINDINGS)
        .filter((finding) => object(finding))
        .map((finding) => [finding.id, finding])
    );
    for (const id of boundedArray(run.fixed_finding_ids, MAX_FINDINGS)) {
      if (byId.get(id)?.disposition !== "fixed") {
        add(issues, `${at}.fixed_finding_ids`, `${id} must have fixed disposition`);
      }
    }
    for (const id of boundedArray(run.still_open_finding_ids, MAX_FINDINGS)) {
      if (byId.get(id)?.disposition !== "open") {
        add(issues, `${at}.still_open_finding_ids`, `${id} must have open disposition`);
      }
    }
  }
}

function validateFixedFindingEvidenceShape(run, at, issues) {
  const rows = run.fixed_finding_evidence;
  if (!Array.isArray(rows)) {
    add(issues, `${at}.fixed_finding_evidence`, "must be an array");
    return;
  }
  if (rows.length > MAX_FINDINGS) {
    add(issues, `${at}.fixed_finding_evidence`, `must contain no more than ${MAX_FINDINGS} rows`);
  }
  const findingIds = [];
  for (const [index, row] of boundedEntries(rows, MAX_FINDINGS)) {
    const rowAt = `${at}.fixed_finding_evidence[${index}]`;
    if (!object(row)) {
      add(issues, rowAt, "must be an object");
      continue;
    }
    closed(row, FIXED_FINDING_EVIDENCE_FIELDS, rowAt, issues);
    required(row, FIXED_FINDING_EVIDENCE_FIELDS, rowAt, issues);
    if (!localId(row.finding_id)) add(issues, `${rowAt}.finding_id`, "must be a stable local ID");
    else findingIds.push(row.finding_id);
    validateStringArray(row.assertion_ids, `${rowAt}.assertion_ids`, issues, {
      maxItems: MAX_ASSERTION_RESULTS,
      localIds: true,
    });
    if (Array.isArray(row.assertion_ids) && row.assertion_ids.length === 0) {
      add(issues, `${rowAt}.assertion_ids`, "must bind at least one re-verification assertion");
    }
  }
  if (!sameStringSet(findingIds, boundedArray(run.fixed_finding_ids, MAX_FINDINGS))) {
    add(
      issues,
      `${at}.fixed_finding_evidence`,
      "must contain exactly one evidence row for every fixed finding ID"
    );
  }
}

function validateCoverageShape(coverage, issues) {
  if (!object(coverage)) {
    add(issues, "report.coverage", "must be an object");
    return;
  }
  closed(coverage, COVERAGE_FIELDS, "report.coverage", issues);
  required(coverage, COVERAGE_FIELDS, "report.coverage", issues);
  validateCoverageRows(coverage.acceptance_criteria, "report.coverage.acceptance_criteria", issues);
  validateCoverageRows(coverage.critical_states, "report.coverage.critical_states", issues);
}

function validateCoverageRows(rows, at, issues) {
  if (!Array.isArray(rows)) {
    add(issues, at, "must be an array");
    return;
  }
  if (rows.length > MAX_ASSERTION_RESULTS) {
    add(issues, at, `must contain no more than ${MAX_ASSERTION_RESULTS} coverage rows`);
  }
  for (const [index, row] of boundedEntries(rows, MAX_ASSERTION_RESULTS)) {
    const rowAt = `${at}[${index}]`;
    if (!object(row)) {
      add(issues, rowAt, "must be an object");
      continue;
    }
    closed(row, [...COVERAGE_ROW_FIELDS, "screenshot_id"], rowAt, issues);
    required(row, COVERAGE_ROW_FIELDS, rowAt, issues);
    if (row.screenshot_id !== undefined && !localId(row.screenshot_id))
      add(issues, `${rowAt}.screenshot_id`, "must be a stable local ID");
    if (row.index !== index) add(issues, `${rowAt}.index`, `must equal ${index}`);
    boundedText(row.target, `${rowAt}.target`, issues, 20_000);
    validateStringArray(row.assertion_ids, `${rowAt}.assertion_ids`, issues, {
      maxItems: MAX_ASSERTION_RESULTS,
      localIds: true,
    });
  }
}

function validateSessionCoverage(report, session, receipts, retained, issues) {
  if (!new Set(["pass", "pass-with-concerns"]).has(report.verdict) || !object(session)) return;
  const latest = boundedArray(report.runs, MAX_RUNS).at(-1) || null;
  if (!object(latest)) return;
  const expectedTier = qaTierForSize(session.task?.size);
  if (expectedTier && report.tier !== expectedTier) {
    add(
      issues,
      "report.tier",
      `must equal ${expectedTier} for session task size ${session.task.size}`
    );
  }
  const currentAssertions = assertionResultsForRun(report, latest, retained, issues);
  const acceptanceCriteria = Array.isArray(session.task?.acceptance_criteria)
    ? session.task.acceptance_criteria
    : [];
  const criticalStates = sessionCriticalStates(session);
  const uiImpact =
    session.task?.design_context?.ui_impact === true ||
    (typeof session.task?.risk?.ui === "number" && session.task.risk.ui > 0);
  validateExactCoverage(
    report.coverage?.acceptance_criteria,
    acceptanceCriteria,
    "report.coverage.acceptance_criteria",
    currentAssertions,
    retained.enforced,
    null,
    issues
  );
  validateExactCoverage(
    report.coverage?.critical_states,
    criticalStates,
    "report.coverage.critical_states",
    currentAssertions,
    retained.enforced,
    uiImpact ? "browser" : null,
    issues
  );

  if (uiImpact) {
    const currentReceipts = Array.isArray(latest.receipt_ids)
      ? boundedArray(latest.receipt_ids, MAX_RECEIPTS)
          .map((id) => receipts.byId.get(id))
          .filter(Boolean)
      : [];
    const browserReceipt = currentReceipts.find(
      (receipt) =>
        receipt.kind === "browser" &&
        receipt.exit_code === 0 &&
        object(receipt.assertions) &&
        receipt.assertions.total > 0
    );
    if (!browserReceipt) {
      add(
        issues,
        "report.runs",
        "passing UI-impact QA requires a current-run browser evidence receipt"
      );
    } else if (retained.enforced && !retained.assertionsByReceipt.has(browserReceipt.id)) {
      add(
        issues,
        "report.runs",
        "current-run browser receipt must bind retained assertion-result bytes"
      );
    }
  }
  if (sessionUsesFocusedUiQa(session)) {
    const used = new Set();
    const screenshots = new Map(
      boundedArray(report.screenshots, MAX_SCREENSHOTS_TOTAL)
        .filter(object)
        .map((screenshot) => [screenshot.id, screenshot])
    );
    for (const target of FOCUSED_UI_STATES) {
      const row = boundedArray(report.coverage?.critical_states, MAX_ASSERTION_RESULTS).find(
        (entry) => entry?.target === target
      );
      const ids = boundedArray(row?.assertion_ids, MAX_ASSERTION_RESULTS);
      for (const id of ids) {
        if (used.has(id))
          add(
            issues,
            "report.coverage.critical_states",
            "focused UI checks require distinct assertions"
          );
        used.add(id);
      }
      if (target === "Keyboard focus and navigation") continue;
      const screenshot = screenshots.get(row?.screenshot_id);
      let capture;
      const hasScreenshot =
        screenshot &&
        ids.some((id) => {
          const assertion = currentAssertions.get(id);
          const receipt = receipts.byId.get(assertion?.receipt_id);
          const linked =
            receipt?.kind === "browser" &&
            boundedArray(receipt.screenshot_ids, MAX_SCREENSHOTS).includes(screenshot.id) &&
            screenshot.run === latest.run &&
            screenshot.commit === report.commit &&
            assertion?.capture?.screenshot_id === screenshot.id;
          if (linked) capture = assertion.capture;
          return linked;
        });
      if (!hasScreenshot)
        add(
          issues,
          "report.coverage.critical_states",
          `${target} requires a current browser screenshot`
        );
      else {
        try {
          if (!capture || capture.scale !== "css" || capture.full_page !== false)
            throw new Error("requires browser-observed CSS-scale viewport capture metadata");
          validateWebViewport(
            target === "Desktop layout" ? "desktop" : "narrow",
            capture.css_width,
            capture.css_height
          );
          if (screenshot.width !== capture.css_width || screenshot.height !== capture.css_height)
            throw new Error("PNG dimensions must match the observed CSS viewport");
        } catch (error) {
          add(issues, "report.coverage.critical_states", `${target}: ${error.message}`);
        }
      }
    }
  }
}

function qaTierForSize(size) {
  if (size === "XS") return "quick";
  if (size === "S") return "focused";
  if (new Set(["M", "L", "XL"]).has(size)) return "full";
  return null;
}

function sessionCriticalStates(session) {
  const contexts = [
    session.task?.design_context,
    ...(Array.isArray(session.task?.work_units)
      ? session.task.work_units.map((unit) => unit?.contract?.design_context)
      : []),
  ];
  const states = [];
  const seen = new Set();
  if (sessionUsesFocusedUiQa(session)) {
    for (const state of FOCUSED_UI_STATES) {
      states.push(state);
      seen.add(state);
    }
  }
  for (const context of contexts) {
    for (const state of Array.isArray(context?.critical_states) ? context.critical_states : []) {
      if (typeof state === "string" && !seen.has(state)) {
        seen.add(state);
        states.push(state);
      }
    }
  }
  return states;
}

function validateExactCoverage(
  rows,
  expectedTargets,
  at,
  assertions,
  enforceAssertions,
  requiredReceiptKind,
  issues
) {
  if (!Array.isArray(rows)) return;
  if (rows.length !== expectedTargets.length) {
    add(issues, at, `must contain exactly ${expectedTargets.length} session-bound rows`);
  }
  for (const [index, target] of boundedEntries(expectedTargets, MAX_ASSERTION_RESULTS)) {
    const row = rows[index];
    if (!object(row)) continue;
    if (row.index !== index || row.target !== target) {
      add(issues, `${at}[${index}]`, "must match the exact session target at this index");
    }
    if (!Array.isArray(row.assertion_ids) || row.assertion_ids.length === 0) {
      add(issues, `${at}[${index}].assertion_ids`, "must bind at least one current-run assertion");
      continue;
    }
    if (!enforceAssertions) continue;
    for (const assertionId of boundedArray(row.assertion_ids, MAX_ASSERTION_RESULTS)) {
      const assertion = assertions.get(assertionId);
      if (!assertion) {
        add(
          issues,
          `${at}[${index}].assertion_ids`,
          `references assertion ${assertionId} outside the current run`
        );
      } else if (assertion.status !== "passed") {
        add(
          issues,
          `${at}[${index}].assertion_ids`,
          `assertion ${assertionId} did not pass in the current run`
        );
      } else if (requiredReceiptKind && assertion.receipt_kind !== requiredReceiptKind) {
        add(
          issues,
          `${at}[${index}].assertion_ids`,
          `assertion ${assertionId} must come from a ${requiredReceiptKind} receipt`
        );
      }
    }
  }
}

function assertionResultsForRun(report, run, retained, issues) {
  const assertions = new Map();
  if (!object(run) || !Array.isArray(run.receipt_ids)) return assertions;
  const retainedReceipts = boundedArray(report.receipts, MAX_RECEIPTS);
  for (const receiptId of boundedArray(run.receipt_ids, MAX_RECEIPTS)) {
    const receiptAssertions = retained.assertionsByReceipt.get(receiptId);
    if (!receiptAssertions) continue;
    const receipt = retainedReceipts.find((candidate) => candidate?.id === receiptId);
    for (const [assertionId, assertion] of receiptAssertions) {
      if (assertions.has(assertionId)) {
        add(
          issues,
          `report.runs[${run.run - 1}].receipt_ids`,
          `assertion ID ${assertionId} must be unique across current-run receipts`
        );
      } else {
        assertions.set(assertionId, {
          ...assertion,
          receipt_id: receiptId,
          receipt_kind: receipt?.kind,
        });
      }
    }
  }
  return assertions;
}

function validateReverifyEvidence(report, retained, issues) {
  if (!retained.enforced || !Array.isArray(report.runs)) return;
  const retainedRuns = boundedArray(report.runs, MAX_RUNS);
  for (const [index, run] of retainedRuns.entries()) {
    if (diagnosticsCapped(issues)) break;
    if (index === 0 || run?.kind !== "reverify") continue;
    const at = `report.runs[${index}]`;
    const before = retained.priorReportsByRun.get(run.run);
    if (!object(before)) {
      add(issues, `${at}.previous_report`, "must resolve to the retained prior QA report");
      continue;
    }
    validatePriorReportPrefix(before, report, run, index, at, issues);
    const after =
      index === retainedRuns.length - 1
        ? report
        : retained.priorReportsByRun.get(retainedRuns[index + 1]?.run);
    if (!object(after)) {
      add(issues, at, "cannot resolve the post-run report state from the retained hash chain");
      continue;
    }
    const assertions = assertionResultsForRun(report, run, retained, issues);
    validateFindingTransition(run, before, after, assertions, at, issues);
  }
}

function validatePriorReportPrefix(prior, report, run, index, at, issues) {
  const priorIssues = validateQaReport(prior, {
    expectedCommit: prior.commit,
    requirePassing: false,
  });
  for (const priorIssue of priorIssues) {
    add(
      issues,
      `${at}.previous_report`,
      `retained predecessor ${priorIssue.path}: ${priorIssue.message}`
    );
    if (diagnosticsCapped(issues)) return;
  }
  if (prior.commit !== report.runs[index - 1]?.commit) {
    add(issues, `${at}.previous_report`, "commit must equal the immediately preceding run commit");
  }
  const expectedRuns = boundedArray(report.runs, MAX_RUNS).slice(0, index);
  const expectedReceipts = boundedArray(report.receipts, MAX_RECEIPTS).filter(
    (receipt) => receipt?.run < run.run
  );
  const expectedScreenshots = boundedArray(report.screenshots, MAX_SCREENSHOTS_TOTAL).filter(
    (screenshot) => screenshot?.run < run.run
  );
  if (!sameValue(boundedArray(prior.runs, MAX_RUNS), expectedRuns)) {
    add(issues, `${at}.previous_report`, "runs must equal the immutable current-history prefix");
  }
  if (!sameValue(boundedArray(prior.receipts, MAX_RECEIPTS), expectedReceipts)) {
    add(
      issues,
      `${at}.previous_report`,
      "receipts must equal the immutable current-history prefix"
    );
  }
  if (!sameValue(boundedArray(prior.screenshots, MAX_SCREENSHOTS_TOTAL), expectedScreenshots)) {
    add(
      issues,
      `${at}.previous_report`,
      "screenshots must equal the immutable current-history prefix"
    );
  }
}

function validateFindingTransition(run, before, after, assertions, at, issues) {
  const beforeById = findingMap(before.findings);
  const afterById = findingMap(after.findings);
  const priorOpen = [...beforeById.values()]
    .filter((finding) => finding.disposition === "open")
    .map((finding) => finding.id);
  const expectedFixed = priorOpen.filter((id) => afterById.get(id)?.disposition === "fixed");
  const expectedStillOpen = priorOpen.filter((id) => afterById.get(id)?.disposition === "open");
  const expectedNew = [...afterById.keys()].filter((id) => !beforeById.has(id));

  requireSameIdSet(run.fixed_finding_ids, expectedFixed, `${at}.fixed_finding_ids`, issues);
  requireSameIdSet(
    run.still_open_finding_ids,
    expectedStillOpen,
    `${at}.still_open_finding_ids`,
    issues
  );
  requireSameIdSet(run.new_finding_ids, expectedNew, `${at}.new_finding_ids`, issues);
  requireSameIdSet(run.finding_ids, [...afterById.keys()], `${at}.finding_ids`, issues);

  for (const [id, priorFinding] of beforeById) {
    const currentFinding = afterById.get(id);
    if (!currentFinding) {
      add(issues, `${at}.finding_ids`, `prior finding ${id} must remain in report history`);
      continue;
    }
    for (const field of ["severity", "category", "summary", "route"]) {
      if (currentFinding[field] !== priorFinding[field]) {
        add(issues, `${at}.finding_ids`, `prior finding ${id} changed immutable field ${field}`);
      }
    }
    if (!sameValue(currentFinding.evidence, priorFinding.evidence)) {
      add(issues, `${at}.finding_ids`, `prior finding ${id} changed immutable field evidence`);
    }
    if (priorFinding.disposition === "fixed" && currentFinding.disposition !== "fixed") {
      add(issues, `${at}.finding_ids`, `previously fixed finding ${id} cannot reopen implicitly`);
    }
  }
  for (const id of expectedNew) {
    if (afterById.get(id)?.disposition !== "open") {
      add(issues, `${at}.new_finding_ids`, `new finding ${id} must begin open`);
    }
  }

  const evidenceByFinding = new Map(
    boundedArray(run.fixed_finding_evidence, MAX_FINDINGS)
      .filter((row) => object(row) && localId(row.finding_id))
      .map((row) => [row.finding_id, row])
  );
  for (const findingId of expectedFixed) {
    const evidence = evidenceByFinding.get(findingId);
    if (!evidence || !Array.isArray(evidence.assertion_ids)) continue;
    for (const assertionId of boundedArray(evidence.assertion_ids, MAX_ASSERTION_RESULTS)) {
      const assertion = assertions.get(assertionId);
      if (!assertion) {
        add(
          issues,
          `${at}.fixed_finding_evidence`,
          `fixed finding ${findingId} references assertion ${assertionId} outside this run`
        );
      } else if (assertion.status !== "passed") {
        add(
          issues,
          `${at}.fixed_finding_evidence`,
          `fixed finding ${findingId} requires passed assertion ${assertionId}`
        );
      } else if (
        !Array.isArray(assertion.finding_ids) ||
        !boundedArray(assertion.finding_ids, MAX_FINDINGS).includes(findingId)
      ) {
        add(
          issues,
          `${at}.fixed_finding_evidence`,
          `assertion ${assertionId} does not identify fixed finding ${findingId}`
        );
      }
    }
  }
}

function validateSessionQaHistory(report, session, issues, options = {}) {
  if (!object(session) || !Array.isArray(session.attempts) || !Array.isArray(report.runs)) return;
  const attempts = [];
  for (const attempt of session.attempts) {
    if (attempt?.phase === "qa") attempts.push(attempt);
    if (attempts.length === MAX_RUNS) break;
  }
  const qaEvidence = session.evidence?.qa;
  const anchoredRuns = Number.isInteger(session.evidence?.qa?.qa_run_count)
    ? session.evidence.qa.qa_run_count
    : session.evidence?.qa?.commit
      ? Math.max(1, attempts.length)
      : attempts.length;
  const recordedRuns = Math.max(attempts.length, anchoredRuns);
  const qaCandidate = options.qaCandidate;
  if (options.qaHistoryAnchor === true && !Number.isInteger(qaEvidence?.qa_run_count)) {
    const minimumRuns = Math.max(attempts.length, qaEvidence?.commit ? 1 : 0);
    if (report.runs.length < minimumRuns) {
      add(
        issues,
        "report.runs",
        `must contain at least ${minimumRuns} runs to cover the runner-recorded QA history`
      );
      return;
    }
  } else {
    const allowedRunCounts = qaCandidate === "required" ? [recordedRuns + 1] : [recordedRuns];
    if (!allowedRunCounts.includes(report.runs.length)) {
      const expectation =
        qaCandidate === "required"
          ? `exactly ${recordedRuns + 1} runs: one per runner-recorded QA run plus the current candidate`
          : `exactly ${recordedRuns} runs: one per runner-recorded QA run`;
      add(issues, "report.runs", `must contain ${expectation}`);
      return;
    }
  }
  for (const [index, attempt] of attempts.entries()) {
    const expectedVerdicts =
      attempt.status === "passed"
        ? new Set(["pass", "pass-with-concerns"])
        : attempt.status === "blocked"
          ? new Set(["blocked"])
          : new Set(["fail"]);
    const run = report.runs[index];
    if (
      !expectedVerdicts.has(run?.verdict) ||
      (attempt.commit !== null && attempt.commit !== undefined && run?.commit !== attempt.commit)
    ) {
      add(
        issues,
        `report.runs[${index}]`,
        "must equal the corresponding runner-recorded QA attempt"
      );
    }
  }
  validateSessionQaRunAnchors(report, qaEvidence, issues, options);
}

function validateSessionQaRunAnchors(report, qaEvidence, issues, options) {
  if (!object(qaEvidence)) return;
  const anchors = qaEvidence.qa_run_anchors;
  const runCount = qaEvidence.qa_run_count;
  if (!Array.isArray(anchors)) {
    if (Number.isInteger(runCount) && options.qaHistoryAnchor !== true) {
      add(
        issues,
        "session.evidence.qa.qa_run_anchors",
        "must immutably bind every accepted QA run; run dev-session anchor-qa-history"
      );
    }
    return;
  }
  if (!Number.isInteger(runCount) || anchors.length !== runCount) {
    add(
      issues,
      "session.evidence.qa.qa_run_anchors",
      "must contain exactly one anchor per accepted QA run"
    );
    return;
  }
  for (const [index, anchor] of boundedEntries(anchors, MAX_RUNS)) {
    const at = `session.evidence.qa.qa_run_anchors[${index}]`;
    const run = report.runs[index];
    if (
      !object(anchor) ||
      anchor.run !== index + 1 ||
      anchor.commit !== run?.commit ||
      anchor.verdict !== run?.verdict
    ) {
      add(issues, at, "must equal the accepted QA run identity");
      continue;
    }
    const observedReportSha256 =
      index === report.runs.length - 1
        ? options.reportSha256
        : report.runs[index + 1]?.previous_report?.sha256;
    if (typeof observedReportSha256 !== "string" || anchor.report_sha256 !== observedReportSha256) {
      add(issues, `${at}.report_sha256`, "must bind the exact accepted QA report bytes");
    }
  }
}

function buildQaRunAnchors(report, currentReportSha256) {
  if (!object(report) || !Array.isArray(report.runs) || !sha256(currentReportSha256)) return null;
  return boundedArray(report.runs, MAX_RUNS).map((run, index) => ({
    run: index + 1,
    commit: run?.commit,
    verdict: run?.verdict,
    report_sha256:
      index === report.runs.length - 1
        ? currentReportSha256
        : report.runs[index + 1]?.previous_report?.sha256,
  }));
}

function validateGitCommitLineage(report, repoRoot, issues) {
  if (typeof repoRoot !== "string" || !path.isAbsolute(repoRoot)) return;
  if (!fs.existsSync(path.join(repoRoot, ".git"))) return;
  const probe = git(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (probe.status !== 0) {
    add(issues, "report.runs", "could not resolve the session Git repository");
    return;
  }
  const runs = boundedArray(report.runs, MAX_RUNS);
  const resolved = new Set();
  for (const [index, run] of runs.entries()) {
    if (!sha(run?.commit)) continue;
    const commit = git(repoRoot, ["cat-file", "-e", `${run.commit}^{commit}`]);
    if (commit.status !== 0) {
      add(
        issues,
        `report.runs[${index}].commit`,
        "must resolve to a Git commit in the session repository"
      );
    } else {
      resolved.add(run.commit);
    }
  }
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1]?.commit;
    const current = runs[index]?.commit;
    if (!resolved.has(previous) || !resolved.has(current)) continue;
    const ancestry = git(repoRoot, ["merge-base", "--is-ancestor", previous, current]);
    if (ancestry.status !== 0) {
      add(
        issues,
        `report.runs[${index}].commit`,
        "must descend from the immediately preceding QA run commit"
      );
    }
  }
}

function git(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function findingMap(findings) {
  return new Map(
    boundedArray(findings, MAX_FINDINGS)
      .filter((finding) => object(finding) && localId(finding.id))
      .map((finding) => [finding.id, finding])
  );
}

function requireSameIdSet(actual, expected, at, issues) {
  if (!sameStringSet(actual, expected)) {
    add(issues, at, `must equal the exact set: ${expected.join(", ") || "(empty)"}`);
  }
}

function sameValue(left, right) {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return boundedArray(value, MAX_ASSERTION_RESULTS).map(canonicalValue);
  }
  if (object(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .slice(0, MAX_QA_OBJECT_FIELDS)
        .sort()
        .map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value;
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
  for (const finding of boundedArray(findings, MAX_FINDINGS)) {
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

function validateIdArray(value, at, allowed, issues, maxItems = MAX_FINDINGS) {
  validateStringArray(value, at, issues, { maxItems, localIds: true });
  if (!Array.isArray(value)) return;
  for (const id of boundedArray(value, maxItems)) {
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
  const maxItems = options.maxItems ?? MAX_ASSERTION_RESULTS;
  for (const [index, item] of boundedEntries(value, maxItems)) {
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

function validateRetainedEvidence(report, evidenceRoot, issues) {
  const retained = emptyRetainedEvidence(true);
  const resolvedEvidenceRoot = path.resolve(evidenceRoot);
  const reportFindingIds = new Set(
    boundedArray(report.findings, MAX_FINDINGS)
      .filter((finding) => object(finding) && localId(finding.id))
      .map((finding) => finding.id)
  );
  const expectedPriorPaths = new Set(
    boundedArray(report.runs, MAX_RUNS)
      .filter((run) => run?.kind === "reverify" && Number.isInteger(run.run))
      .map((run) => path.join(resolvedEvidenceRoot, `report-run-${run.run - 1}.json`))
  );
  const bindings = [];
  for (const [index, receipt] of boundedEntries(report.receipts, MAX_RECEIPTS)) {
    if (object(receipt?.output)) {
      bindings.push({
        binding: receipt.output,
        receipt,
        at: `report.receipts[${index}].output`,
        kind: "execution",
      });
    }
  }
  for (const [index, screenshot] of boundedEntries(report.screenshots, MAX_SCREENSHOTS_TOTAL)) {
    if (object(screenshot)) {
      bindings.push({
        binding: screenshot,
        at: `report.screenshots[${index}]`,
        kind: "screenshot",
      });
    }
  }
  for (const [index, run] of boundedEntries(report.runs, MAX_RUNS)) {
    if (run?.kind === "reverify" && object(run.previous_report)) {
      bindings.push({
        binding: run.previous_report,
        at: `report.runs[${index}].previous_report`,
        kind: "previous-report",
        run: run.run,
      });
    }
  }
  const observedPaths = new Set();
  let totalBytes = 0;
  let totalScreenshotDecodedBytes = 0n;
  let screenshotDecodedBudgetExceeded = false;
  for (const row of bindings) {
    if (diagnosticsCapped(issues)) break;
    const binding = row.binding;
    if (typeof binding.path !== "string" || !path.isAbsolute(binding.path)) continue;
    const candidate = path.resolve(binding.path);
    if (
      row.kind === "previous-report" &&
      candidate !== path.join(resolvedEvidenceRoot, `report-run-${row.run - 1}.json`)
    ) {
      add(
        issues,
        `${row.at}.path`,
        `must equal the canonical prior snapshot report-run-${row.run - 1}.json`
      );
      continue;
    }
    const relative = path.relative(resolvedEvidenceRoot, candidate);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      add(
        issues,
        `${row.at}.path`,
        "must be a retained file inside the canonical QA evidence directory"
      );
      continue;
    }
    if (observedPaths.has(candidate)) {
      add(issues, `${row.at}.path`, "cannot reuse a retained file binding");
      continue;
    }
    observedPaths.add(candidate);
    if (!validateNoSymlinkPath(resolvedEvidenceRoot, candidate, row.at, issues)) continue;
    const maxBytes = row.kind === "previous-report" ? MAX_QA_REPORT_BYTES : MAX_QA_EVIDENCE_BYTES;
    const remainingBytes = MAX_QA_EVIDENCE_TOTAL_BYTES - totalBytes;
    if (remainingBytes < 1 || (Number.isInteger(binding.bytes) && binding.bytes > remainingBytes)) {
      add(
        issues,
        "report.receipts",
        `retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`
      );
      break;
    }
    let bytes;
    try {
      bytes = readRetainedEvidenceFile(
        resolvedEvidenceRoot,
        candidate,
        maxBytes,
        remainingBytes,
        row.at,
        issues
      );
    } catch (error) {
      if (error.code === QA_EVIDENCE_TOTAL_LIMIT_CODE) {
        add(
          issues,
          "report.receipts",
          `retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`
        );
        break;
      }
      add(issues, `${row.at}.path`, `could not read retained evidence: ${error.message}`);
      continue;
    }
    if (bytes === null) continue;
    totalBytes += bytes.length;
    if (totalBytes > MAX_QA_EVIDENCE_TOTAL_BYTES) {
      add(
        issues,
        "report.receipts",
        `retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`
      );
      break;
    }
    if (binding.bytes !== bytes.length)
      add(issues, `${row.at}.bytes`, "does not match retained file bytes");
    if (binding.sha256 !== digest(bytes))
      add(issues, `${row.at}.sha256`, "does not match retained file bytes");
    if (row.kind === "screenshot") {
      if (screenshotDecodedBudgetExceeded) continue;
      try {
        const header = inspectPngHeaderBytes(bytes);
        if (binding.width !== header.width || binding.height !== header.height) {
          add(issues, row.at, "screenshot dimensions do not match retained PNG bytes");
        }
        const decodedBytes = pngDecodedByteBudget(header);
        const decodedLimit = BigInt(MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL);
        if (decodedBytes > decodedLimit - totalScreenshotDecodedBytes) {
          add(
            issues,
            "report.screenshots",
            `retained screenshots exceed ${MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL} cumulative decoded bytes`
          );
          screenshotDecodedBudgetExceeded = true;
          continue;
        }
        totalScreenshotDecodedBytes += decodedBytes;
        inspectPngBytes(bytes);
      } catch (error) {
        add(issues, `${row.at}.path`, `must be a strict PNG screenshot: ${error.message}`);
      }
    } else if (row.kind === "execution") {
      retained.assertionsByReceipt.set(
        row.receipt?.id,
        validateExecutionOutput(bytes, row.receipt, reportFindingIds, row.at, issues)
      );
    } else {
      retained.priorReportsByRun.set(row.run, parsePriorReport(bytes, row.at, issues));
    }
  }
  if (!diagnosticsCapped(issues)) {
    try {
      for (const entry of fs.readdirSync(resolvedEvidenceRoot, { withFileTypes: true })) {
        if (!/^report-run-\d+\.json$/.test(entry.name)) continue;
        const candidate = path.join(resolvedEvidenceRoot, entry.name);
        if (!expectedPriorPaths.has(candidate)) {
          add(
            issues,
            "report.runs",
            `orphan prior-report snapshot ${entry.name} is not represented in the hash chain`
          );
        }
      }
    } catch (error) {
      add(issues, "report.receipts", `could not inspect QA evidence history: ${error.message}`);
    }
  }
  return retained;
}

function readRetainedEvidenceFile(evidenceRoot, candidate, maxBytes, remainingBytes, at, issues) {
  const flags =
    fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0) |
    (fs.constants.O_NONBLOCK || 0) |
    (fs.constants.O_NOCTTY || 0);
  let descriptor;
  try {
    const initial = fs.lstatSync(candidate, { bigint: true });
    if (!initial.isFile()) throw new Error("must be a regular file");
    descriptor = fs.openSync(candidate, flags);
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("must be a regular file");
    if (initial.dev !== before.dev || initial.ino !== before.ino) {
      throw new Error("retained evidence changed before it could be opened safely");
    }
    if (before.size < 1n || before.size > BigInt(maxBytes)) {
      throw new Error(`retained evidence must contain 1 through ${maxBytes} bytes`);
    }
    if (before.size > BigInt(remainingBytes)) throw retainedEvidenceTotalLimitError();
    if (!validateNoSymlinkPath(evidenceRoot, candidate, at, issues)) return null;
    const current = fs.lstatSync(candidate, { bigint: true });
    if (!current.isFile() || before.dev !== current.dev || before.ino !== current.ino) {
      throw new Error("retained evidence changed during containment validation");
    }
    const readLimit = Math.min(maxBytes, remainingBytes);
    let bytes;
    try {
      bytes = readDescriptorBounded(descriptor, readLimit, {
        overflowMessage:
          readLimit < maxBytes
            ? `retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`
            : `retained evidence must contain 1 through ${maxBytes} bytes`,
      });
    } catch (error) {
      if (
        readLimit < maxBytes &&
        error.message === `retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`
      ) {
        error.code = QA_EVIDENCE_TOTAL_LIMIT_CODE;
      }
      throw error;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error("retained evidence changed during validation");
    }
    if (!validateNoSymlinkPath(evidenceRoot, candidate, at, issues)) return null;
    const final = fs.lstatSync(candidate, { bigint: true });
    if (
      !final.isFile() ||
      after.dev !== final.dev ||
      after.ino !== final.ino ||
      after.size !== final.size ||
      after.mtimeNs !== final.mtimeNs ||
      after.ctimeNs !== final.ctimeNs
    ) {
      throw new Error("retained evidence path changed during validation");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function retainedEvidenceTotalLimitError() {
  const error = new Error(`retained evidence exceeds ${MAX_QA_EVIDENCE_TOTAL_BYTES} total bytes`);
  error.code = QA_EVIDENCE_TOTAL_LIMIT_CODE;
  return error;
}

function pngDecodedByteBudget(header) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const bitsPerRow = BigInt(header.width) * BigInt(channels) * BigInt(header.bitDepth);
  const rowBytes = (bitsPerRow + 7n) / 8n;
  return (rowBytes + 1n) * BigInt(header.height);
}

function emptyRetainedEvidence(enforced = false) {
  return {
    enforced,
    assertionsByReceipt: new Map(),
    priorReportsByRun: new Map(),
  };
}

function parsePriorReport(bytes, at, issues) {
  try {
    const report = JSON.parse(bytes.toString("utf8"));
    if (!object(report)) {
      add(issues, `${at}.path`, "must contain a prior QA report object");
      return null;
    }
    return report;
  } catch (error) {
    add(issues, `${at}.path`, `must contain a prior QA report: ${error.message}`);
    return null;
  }
}

function validateExecutionOutput(bytes, receipt, findingIds, at, issues) {
  const assertionResults = new Map();
  let output;
  try {
    output = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    add(issues, `${at}.path`, `must contain a structured QA execution result: ${error.message}`);
    return assertionResults;
  }
  if (!object(output)) {
    add(issues, `${at}.path`, "must contain a structured QA execution result object");
    return assertionResults;
  }
  closed(output, EXECUTION_OUTPUT_FIELDS, `${at}.result`, issues);
  required(output, EXECUTION_OUTPUT_FIELDS, `${at}.result`, issues);
  if (output.schema_version !== 1) add(issues, `${at}.result.schema_version`, "must equal 1");
  if (output.assurance !== QA_EVIDENCE_ASSURANCE)
    add(issues, `${at}.result.assurance`, `must equal ${QA_EVIDENCE_ASSURANCE}`);
  const expected = {
    receipt_id: receipt?.id,
    commit: receipt?.commit,
    kind: receipt?.kind,
    command: receipt?.command,
    exit_code: receipt?.exit_code,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (output[field] !== value)
      add(issues, `${at}.result.${field}`, "must match the bound receipt");
  }
  if (!Array.isArray(output.assertions) || output.assertions.length === 0) {
    add(issues, `${at}.result.assertions`, "must contain at least one assertion result");
    return assertionResults;
  }
  if (output.assertions.length > MAX_ASSERTION_RESULTS) {
    add(
      issues,
      `${at}.result.assertions`,
      `must contain no more than ${MAX_ASSERTION_RESULTS} assertion results`
    );
  }
  const ids = new Set();
  let passed = 0;
  const retainedAssertions = boundedArray(output.assertions, MAX_ASSERTION_RESULTS);
  for (const [index, assertion] of retainedAssertions.entries()) {
    if (diagnosticsCapped(issues)) break;
    const assertionAt = `${at}.result.assertions[${index}]`;
    if (!object(assertion)) {
      add(issues, assertionAt, "must be an object");
      continue;
    }
    closed(assertion, [...ASSERTION_RESULT_FIELDS, "capture"], assertionAt, issues);
    required(assertion, ASSERTION_RESULT_FIELDS, assertionAt, issues);
    if (assertion.capture !== undefined) {
      const capture = assertion.capture;
      const captureAt = `${assertionAt}.capture`;
      const fields = [
        "screenshot_id",
        "css_width",
        "css_height",
        "device_pixel_ratio",
        "scale",
        "full_page",
      ];
      if (!object(capture)) add(issues, captureAt, "must be an object");
      else {
        closed(capture, fields, captureAt, issues);
        required(capture, fields, captureAt, issues);
        if (receipt.kind !== "browser") add(issues, captureAt, "requires a browser receipt");
        if (
          !localId(capture.screenshot_id) ||
          !boundedArray(receipt.screenshot_ids, MAX_SCREENSHOTS).includes(capture.screenshot_id)
        )
          add(issues, `${captureAt}.screenshot_id`, "must bind a screenshot in this receipt");
        integerInRange(capture.css_width, 1, 8192, `${captureAt}.css_width`, issues);
        integerInRange(capture.css_height, 1, 8192, `${captureAt}.css_height`, issues);
        if (
          !Number.isFinite(capture.device_pixel_ratio) ||
          capture.device_pixel_ratio <= 0 ||
          capture.device_pixel_ratio > 8
        )
          add(issues, `${captureAt}.device_pixel_ratio`, "must be finite, positive, and at most 8");
        if (!["css", "device"].includes(capture.scale))
          add(issues, `${captureAt}.scale`, "must be css or device");
        if (typeof capture.full_page !== "boolean")
          add(issues, `${captureAt}.full_page`, "must be boolean");
      }
    }
    if (!localId(assertion.id)) add(issues, `${assertionAt}.id`, "must be a stable local ID");
    else if (ids.has(assertion.id)) add(issues, `${assertionAt}.id`, "must be unique");
    else {
      ids.add(assertion.id);
      assertionResults.set(assertion.id, assertion);
    }
    if (!new Set(["passed", "failed"]).has(assertion.status))
      add(issues, `${assertionAt}.status`, "must be passed or failed");
    else if (assertion.status === "passed") passed += 1;
    boundedText(assertion.probe, `${assertionAt}.probe`, issues, 4_096);
    boundedText(assertion.observed, `${assertionAt}.observed`, issues, 20_000);
    boundedText(assertion.expected, `${assertionAt}.expected`, issues, 20_000);
    validateStringArray(assertion.finding_ids, `${assertionAt}.finding_ids`, issues, {
      maxItems: MAX_FINDINGS,
      localIds: true,
    });
    for (const findingId of boundedArray(assertion.finding_ids, MAX_FINDINGS)) {
      if (diagnosticsCapped(issues)) break;
      if (localId(findingId) && !findingIds.has(findingId)) {
        add(issues, `${assertionAt}.finding_ids`, `references unknown finding ${findingId}`);
      }
    }
  }
  if (
    object(receipt?.assertions) &&
    (receipt.assertions.passed !== passed || receipt.assertions.total !== retainedAssertions.length)
  ) {
    add(issues, `${at}.result.assertions`, "pass and total counts must match the bound receipt");
  }
  return assertionResults;
}

function validateNoSymlinkPath(evidenceRoot, candidate, at, issues) {
  const parent = path.dirname(evidenceRoot);
  const relative = path.relative(parent, candidate);
  let cursor = parent;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      add(
        issues,
        `${at}.path`,
        `required evidence path component is unavailable: ${error.message}`
      );
      return false;
    }
    if (stat.isSymbolicLink()) {
      add(issues, `${at}.path`, `symbolic links are not allowed: ${cursor}`);
      return false;
    }
  }
  return true;
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
  return boundedArray(findings, MAX_FINDINGS).filter(
    (finding) => object(finding) && finding.disposition === "open" && finding.severity === severity
  ).length;
}

function sameAssertions(left, right) {
  return (
    object(left) && object(right) && left.passed === right.passed && left.total === right.total
  );
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (left.length > MAX_FINDINGS) return false;
  const retainedLeft = boundedArray(left, MAX_FINDINGS);
  const retainedRight = boundedArray(right, MAX_FINDINGS);
  const leftSet = new Set(retainedLeft);
  return leftSet.size === retainedLeft.length && retainedRight.every((item) => leftSet.has(item));
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function closed(value, allowed, at, issues) {
  const fields = new Set(allowed);
  let inspected = 0;
  for (const field in value) {
    if (!Object.hasOwn(value, field)) continue;
    if (inspected === MAX_QA_OBJECT_FIELDS) {
      add(issues, at, `must contain no more than ${MAX_QA_OBJECT_FIELDS} fields`);
      break;
    }
    inspected += 1;
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

function sha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function localId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value);
}

function add(issues, at, message) {
  if (issues.length < MAX_QA_VALIDATION_ISSUES) {
    issues.push(issue(at, message));
    return;
  }
  if (issues[MAX_QA_VALIDATION_ISSUES - 1]?.message !== QA_VALIDATION_ISSUE_LIMIT_MESSAGE) {
    issues[MAX_QA_VALIDATION_ISSUES - 1] = issue("report", QA_VALIDATION_ISSUE_LIMIT_MESSAGE);
  }
}

function addIssues(issues, additions) {
  for (const addition of additions) add(issues, addition.path, addition.message);
}

function diagnosticsCapped(issues) {
  return issues[MAX_QA_VALIDATION_ISSUES - 1]?.message === QA_VALIDATION_ISSUE_LIMIT_MESSAGE;
}

function boundedArray(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return value.length > maxItems ? value.slice(0, maxItems) : value;
}

function boundedEntries(value, maxItems) {
  return boundedArray(value, maxItems).entries();
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

module.exports = {
  CATEGORIES,
  CATEGORY_WEIGHTS,
  MAX_QA_REPORT_BYTES,
  MAX_QA_SCREENSHOT_DECODED_BYTES_TOTAL,
  MAX_QA_VALIDATION_ISSUES,
  SEVERITY_DEDUCTIONS,
  checkQaReport,
  expectedQaReportPath,
  healthScoreFor,
  validateQaReport,
};
