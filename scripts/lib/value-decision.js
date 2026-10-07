"use strict";

const VALUE_DECISION_SCHEMA_VERSION = 1;
const VALUE_DECISION_RECOMMENDATIONS = Object.freeze(["build", "test-first", "defer"]);
const VALUE_DECISION_LIMITS = Object.freeze({ text: 4096, refs: 32, uncertainties: 32, id: 128 });
const CLAIM_FIELDS = ["statement", "evidence_ids", "assumption_ids"];
const VALUE_FIELDS = [
  "schema_version",
  "beneficiary",
  "buyer",
  "user_outcome",
  "commercial_hypothesis",
  "counterevidence",
  "uncertainties",
  "recommendation",
  "discriminating_test",
];

/**
 * Validate a value decision against the enclosing proposal's evidence/assumption
 * IDs. This verifies bounded structure and provenance links, not the truth or
 * commercial quality of the model's recommendation. It never changes ranking.
 * Historical absence is readable; current producers opt into required: true.
 */
function validateValueDecision(value, options = {}) {
  const at = options.path || "$.decision_brief.value_decision";
  const issues = [];
  const add = (pathname, message) => issues.push({ path: pathname, message });
  if (value === undefined) {
    if (options.required) add(at, "is required for a current value decision brief");
    return { ok: issues.length === 0, issues };
  }
  if (!closed(value, VALUE_FIELDS, at, add)) return { ok: false, issues };
  if (value.schema_version !== VALUE_DECISION_SCHEMA_VERSION) {
    add(`${at}.schema_version`, `must equal ${VALUE_DECISION_SCHEMA_VERSION}`);
  }
  const context = {
    evidence: idSet(options.evidenceIds),
    assumption: idSet(options.assumptionIds),
  };
  for (const field of ["beneficiary", "user_outcome", "commercial_hypothesis"]) {
    validateClaim(value[field], `${at}.${field}`, context, add);
  }
  if (
    isObject(value.commercial_hypothesis) &&
    (!Array.isArray(value.commercial_hypothesis.assumption_ids) ||
      value.commercial_hypothesis.assumption_ids.length === 0)
  ) {
    add(
      `${at}.commercial_hypothesis.assumption_ids`,
      "a commercial hypothesis must cite an explicit assumption; workflow evidence alone does not establish commercial value"
    );
  }
  const buyer = value.buyer;
  if (closed(buyer, ["status", ...CLAIM_FIELDS], `${at}.buyer`, add)) {
    enumValue(buyer.status, ["identified", "unknown", "not-applicable"], `${at}.buyer.status`, add);
    validateBasis(buyer, `${at}.buyer`, context, add, { allowUncited: buyer.status === "unknown" });
    text(buyer.statement, `${at}.buyer.statement`, add);
  }
  const contrary = value.counterevidence;
  if (closed(contrary, ["status", "statement", "evidence_ids"], `${at}.counterevidence`, add)) {
    enumValue(contrary.status, ["found", "not-found"], `${at}.counterevidence.status`, add);
    text(contrary.statement, `${at}.counterevidence.statement`, add);
    refs(contrary.evidence_ids, `${at}.counterevidence.evidence_ids`, "evidence", context, add);
    if (!Array.isArray(contrary.evidence_ids) || contrary.evidence_ids.length === 0) {
      add(`${at}.counterevidence.evidence_ids`, "must cite checked evidence for either status");
    }
  }
  if (!Array.isArray(value.uncertainties) || value.uncertainties.length === 0) {
    add(`${at}.uncertainties`, "must be a non-empty array of explicit uncertainty claims");
  } else {
    if (value.uncertainties.length > VALUE_DECISION_LIMITS.uncertainties) {
      add(
        `${at}.uncertainties`,
        `must contain at most ${VALUE_DECISION_LIMITS.uncertainties} claims`
      );
    }
    for (const [index, claim] of value.uncertainties
      .slice(0, VALUE_DECISION_LIMITS.uncertainties)
      .entries()) {
      validateClaim(claim, `${at}.uncertainties[${index}]`, context, add);
    }
  }
  const recommendation = value.recommendation;
  if (
    closed(
      recommendation,
      ["decision", "rationale", "evidence_ids", "assumption_ids"],
      `${at}.recommendation`,
      add
    )
  ) {
    enumValue(
      recommendation.decision,
      VALUE_DECISION_RECOMMENDATIONS,
      `${at}.recommendation.decision`,
      add
    );
    text(recommendation.rationale, `${at}.recommendation.rationale`, add);
    validateBasis(recommendation, `${at}.recommendation`, context, add);
  }
  const experiment = value.discriminating_test;
  if (
    closed(
      experiment,
      ["action", "observable_result", "reversal_condition", "evidence_ids", "assumption_ids"],
      `${at}.discriminating_test`,
      add
    )
  ) {
    for (const field of ["action", "observable_result", "reversal_condition"]) {
      text(experiment[field], `${at}.discriminating_test.${field}`, add);
    }
    validateBasis(experiment, `${at}.discriminating_test`, context, add);
  }
  return { ok: issues.length === 0, issues };
}

function validateClaim(value, at, context, add) {
  if (!closed(value, CLAIM_FIELDS, at, add)) return;
  text(value.statement, `${at}.statement`, add);
  validateBasis(value, at, context, add);
}

function validateBasis(value, at, context, add, { allowUncited = false } = {}) {
  refs(value.evidence_ids, `${at}.evidence_ids`, "evidence", context, add);
  refs(value.assumption_ids, `${at}.assumption_ids`, "assumption", context, add);
  const count = [value.evidence_ids, value.assumption_ids].reduce(
    (total, entries) => total + (Array.isArray(entries) ? entries.length : 0),
    0
  );
  if (!allowUncited && count === 0) add(at, "must cite at least one evidence or assumption id");
}

function refs(value, at, kind, context, add) {
  if (!Array.isArray(value)) {
    add(at, "must be an array of existing proposal IDs");
    return;
  }
  if (value.length > VALUE_DECISION_LIMITS.refs) {
    add(at, `must contain at most ${VALUE_DECISION_LIMITS.refs} IDs`);
  }
  const pattern = new RegExp(`^${kind}:[a-z0-9][a-z0-9._-]*$`);
  const seen = new Set();
  for (const [index, id] of value.slice(0, VALUE_DECISION_LIMITS.refs).entries()) {
    const itemPath = `${at}[${index}]`;
    if (typeof id !== "string" || id.length > VALUE_DECISION_LIMITS.id || !pattern.test(id)) {
      add(
        itemPath,
        `must be a stable ${kind}: ID of at most ${VALUE_DECISION_LIMITS.id} characters`
      );
      continue;
    }
    if (seen.has(id)) add(itemPath, `duplicate ${kind} id ${id}`);
    seen.add(id);
    if (!context[kind].has(id)) add(itemPath, `unknown ${kind} id ${id}`);
  }
}

function closed(value, fields, at, add) {
  if (!isObject(value)) {
    add(at, "must be an object");
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) add(`${at}.${key}`, `unknown field ${key}`);
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) add(`${at}.${field}`, "is required");
  }
  return true;
}

function text(value, at, add) {
  if (typeof value !== "string" || value.trim().length === 0 || hasControlCharacters(value)) {
    add(at, "must be a non-empty string without control characters");
  } else if (value.length > VALUE_DECISION_LIMITS.text) {
    add(at, `must contain at most ${VALUE_DECISION_LIMITS.text} characters`);
  }
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

function enumValue(value, values, at, add) {
  if (!values.includes(value)) add(at, `must be one of ${values.join(", ")}`);
}

function idSet(value) {
  return value instanceof Set ? value : new Set(Array.isArray(value) ? value : []);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  VALUE_DECISION_SCHEMA_VERSION,
  VALUE_DECISION_RECOMMENDATIONS,
  VALUE_DECISION_LIMITS,
  validateValueDecision,
};
