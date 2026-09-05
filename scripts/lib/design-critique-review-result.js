"use strict";

const crypto = require("node:crypto");

const REVIEW_ASSURANCE = "workflow-attested-non-cryptographic";
const SCORE_KEYS = Object.freeze({
  "product-ui": Object.freeze([
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "state-clarity",
  ]),
  "pm-artifact": Object.freeze([
    "hierarchy",
    "density",
    "consistency",
    "accessibility",
    "responsive",
    "print-navigation",
  ]),
});
const RAW_FINDING_FIELDS = Object.freeze([
  "subject_id",
  "region",
  "rule",
  "coverage_ids",
  "evidence_ids",
  "priority",
  "owner",
  "basis",
  "confidence",
  "summary",
  "impact",
  "remediation",
]);
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const OWNERS = new Set(["design-critique", "qa", "review"]);
const BASES = new Set(["objective", "craft", "uncertain"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);

function normalizePrimaryReviewResult(rawResult, context) {
  const issues = validatePrimaryRawReviewResult(rawResult, context);
  if (issues.length > 0) {
    const error = new Error(`invalid Primary raw result: ${issues.join("; ")}`);
    error.issues = issues;
    throw error;
  }

  const seen = new Set();
  const findings = rawResult.findings.map((finding) => {
    const id = reviewFindingId(context.reviewId, finding);
    if (seen.has(id)) {
      const error = new Error(`invalid Primary raw result: duplicate normalized finding ${id}`);
      error.issues = [`duplicate normalized finding ${id}`];
      throw error;
    }
    seen.add(id);
    return { id, ...finding };
  });
  return { ...rawResult, findings };
}

function validatePrimaryRawReviewResult(rawResult, context = {}) {
  const issues = [];
  if (!object(rawResult)) return ["result must be an object"];
  exactFields(rawResult, ["summary", "scores", "findings"], "result", issues);
  if (!boundedText(rawResult.summary, 10_000))
    issues.push("result.summary must contain 1 to 10000 UTF-8 bytes");

  const expectedScores = SCORE_KEYS[context.mode];
  if (!expectedScores) issues.push("context.mode must be product-ui or pm-artifact");
  if (!reviewId(context.reviewId))
    issues.push("context.reviewId must be a bounded review identity");
  validateScores(rawResult.scores, expectedScores || [], context, issues);
  validateFindings(rawResult.findings, context, issues);
  return issues;
}

function validateScores(scores, expectedKeys, context, issues) {
  if (!object(scores)) {
    issues.push("result.scores must be an object");
    return;
  }
  exactFields(scores, expectedKeys, "result.scores", issues);
  const allowedEvidence = new Set([
    ...boundedArray(context.input?.capture_ids, 200),
    ...boundedArray(context.input?.evidence_ids, 400),
  ]);
  for (const key of expectedKeys) {
    const score = scores[key];
    const at = `result.scores.${key}`;
    if (!object(score)) {
      issues.push(`${at} must be an object`);
      continue;
    }
    exactFields(score, ["value", "rationale", "evidence_ids"], at, issues);
    if (!Number.isInteger(score.value) || score.value < 1 || score.value > 5)
      issues.push(`${at}.value must be an integer from 1 to 5`);
    if (!boundedText(score.rationale, 10_000))
      issues.push(`${at}.rationale must contain 1 to 10000 UTF-8 bytes`);
    if (!boundedUniqueTextArray(score.evidence_ids, 400))
      issues.push(`${at}.evidence_ids must be a non-empty unique bounded array`);
    else if (score.evidence_ids.some((id) => !allowedEvidence.has(id)))
      issues.push(`${at}.evidence_ids must cite supplied Primary evidence`);
  }
}

function validateFindings(findings, context, issues) {
  if (!Array.isArray(findings) || findings.length > 50) {
    issues.push("result.findings must be an array with at most 50 findings");
    return;
  }
  const subjectIds = new Set(boundedArray(context.route?.subjects, 100).map((item) => item?.id));
  const coverageSubjects = new Map(
    boundedArray(context.route?.coverage, 1_000).map((item) => [item?.id, item?.subject_id])
  );
  const captureSubjects = new Map(
    boundedArray(context.captures?.captures, 2_000).map((item) => [
      item?.id,
      coverageSubjects.get(item?.coverage_id),
    ])
  );
  const evidenceSubjects = new Map(
    boundedArray(context.captures?.evidence, 2_000).map((item) => [item?.id, item?.subject_id])
  );
  const allowedEvidence = new Set([
    ...boundedArray(context.input?.capture_ids, 200),
    ...boundedArray(context.input?.evidence_ids, 400),
  ]);
  const ids = new Set();

  for (const [index, finding] of findings.entries()) {
    const at = `result.findings[${index}]`;
    if (!object(finding)) {
      issues.push(`${at} must be an object`);
      continue;
    }
    exactFields(finding, RAW_FINDING_FIELDS, at, issues);
    if (!subjectIds.has(finding.subject_id))
      issues.push(`${at}.subject_id must reference a route subject`);
    if (!slug(finding.region) || !slug(finding.rule))
      issues.push(`${at}.region and rule must be kebab-case`);
    if (!boundedUniqueTextArray(finding.coverage_ids, 100))
      issues.push(`${at}.coverage_ids must be a non-empty unique bounded array`);
    else if (finding.coverage_ids.some((id) => coverageSubjects.get(id) !== finding.subject_id))
      issues.push(`${at}.coverage_ids must reference coverage for the finding subject`);
    if (!boundedUniqueTextArray(finding.evidence_ids, 400))
      issues.push(`${at}.evidence_ids must be a non-empty unique bounded array`);
    else {
      if (finding.evidence_ids.some((id) => !allowedEvidence.has(id)))
        issues.push(`${at}.evidence_ids must cite supplied Primary evidence`);
      if (
        finding.evidence_ids.some(
          (id) => (captureSubjects.get(id) || evidenceSubjects.get(id)) !== finding.subject_id
        )
      )
        issues.push(`${at}.evidence_ids must belong to the finding subject`);
    }
    if (!PRIORITIES.has(finding.priority)) issues.push(`${at}.priority is invalid`);
    if (!OWNERS.has(finding.owner)) issues.push(`${at}.owner is invalid`);
    if (!BASES.has(finding.basis)) issues.push(`${at}.basis is invalid`);
    if (!CONFIDENCE.has(finding.confidence)) issues.push(`${at}.confidence is invalid`);
    for (const key of ["summary", "impact", "remediation"])
      if (!boundedText(finding[key], 10_000))
        issues.push(`${at}.${key} must contain 1 to 10000 UTF-8 bytes`);

    const id = reviewFindingId(context.reviewId, finding);
    if (ids.has(id)) issues.push(`${at} duplicates normalized finding ${id}`);
    ids.add(id);
  }
}

function createReviewReceipt({
  reviewId: reviewIdValue,
  perspective,
  contextId,
  invocationId,
  inputPayloadSha256,
  promptSha256,
  result,
  startedAt,
  completedAt,
  recordedAt,
}) {
  return {
    schema_version: 1,
    assurance: REVIEW_ASSURANCE,
    review_id: reviewIdValue,
    perspective,
    context_id: contextId,
    invocation_id: invocationId,
    input_payload_sha256: inputPayloadSha256,
    prompt_sha256: promptSha256,
    result_sha256: resultSha256(result),
    started_at: startedAt,
    completed_at: completedAt,
    recorded_at: recordedAt,
  };
}

function resultSha256(result) {
  return crypto.createHash("sha256").update(canonicalJson(result)).digest("hex");
}

function reviewFindingId(reviewIdValue, finding) {
  const material = canonicalJson([
    reviewIdValue || "",
    finding?.subject_id || "",
    finding?.region || "",
    finding?.rule || "",
    uniqueSorted(finding?.coverage_ids),
    uniqueSorted(finding?.evidence_ids),
  ]);
  return `drf-${crypto.createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value === undefined ? null : value);
}

function exactFields(value, fields, at, issues) {
  const expected = new Set(fields);
  for (const field of Object.keys(value))
    if (!expected.has(field)) issues.push(`${at}.${field} is an unknown field`);
  for (const field of fields)
    if (!Object.prototype.hasOwnProperty.call(value, field))
      issues.push(`${at}.${field} is required`);
}

function boundedArray(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function boundedUniqueTextArray(value, max) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= max &&
    value.every((item) => boundedText(item, 500)) &&
    new Set(value).size === value.length
  );
}

function boundedText(value, max) {
  return (
    typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= max
  );
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function slug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function reviewId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{2,127}$/.test(value);
}

function uniqueSorted(value) {
  const items = Array.isArray(value) ? value : [];
  return [...new Set(items.filter((item) => typeof item === "string"))].sort();
}

module.exports = {
  RAW_FINDING_FIELDS,
  REVIEW_ASSURANCE,
  SCORE_KEYS,
  canonicalJson,
  createReviewReceipt,
  normalizePrimaryReviewResult,
  resultSha256,
  reviewFindingId,
  validatePrimaryRawReviewResult,
};
