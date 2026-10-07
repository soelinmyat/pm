"use strict";

// Counts trigger diagnosis, never product authority. This is an evidence/resource
// ceiling for one retained lineage, like QA's run budget, not a reapproval rule.
const RECOVERY_POLICY = "scoped-diagnosis-v1";
const MAX_RECOVERY_ROUNDS = 50;
const RECOVERY_THRESHOLDS = Object.freeze({ "design-critique": 2, review: 3 });
const CLASSIFICATIONS = new Set([
  "product-defect",
  "harness-environment",
  "stale-evidence",
  "external-dependency",
  "product-decision",
  "scope-risk-change",
]);
const DECISIONS = new Set(["external-dependency", "product-decision", "scope-risk-change"]);

function recoveryRequiresDecision(recovery) {
  return (
    DECISIONS.has(recovery?.classification) || recovery?.scope_assessment === "decision-required"
  );
}

// A restored external prerequisite is proved by fresh current evidence. Product
// and explicit scope/risk authority stays unresolved inside the same lineage.
function recoveryRequiresAuthority(recovery) {
  return recoveryRequiresDecision(recovery) && recovery?.classification !== "external-dependency";
}

function validateScopedRecovery(recovery, context = {}) {
  const issues = [];
  const at = context.path || "recovery";
  const add = (field, message) => issues.push({ path: field ? `${at}.${field}` : at, message });
  if (!recovery || typeof recovery !== "object" || Array.isArray(recovery)) {
    add("", "recovery diagnosis must be an object");
    return issues;
  }
  const fields = [
    "classification",
    "observed",
    "cause",
    "change",
    "next_check",
    "evidence_ids",
    "scope_assessment",
  ];
  for (const field of Object.keys(recovery))
    if (!fields.includes(field)) add(field, "unknown field");
  for (const field of fields) if (!Object.hasOwn(recovery, field)) add(field, "required");
  if (!CLASSIFICATIONS.has(recovery.classification))
    add(
      "classification",
      "must distinguish scoped defects, harness/evidence failures, and genuine decisions/dependencies"
    );
  for (const field of ["observed", "cause", "change", "next_check"])
    if (
      typeof recovery[field] !== "string" ||
      !recovery[field].trim() ||
      Buffer.byteLength(recovery[field], "utf8") > 4096
    )
      add(field, "must contain 1 through 4096 UTF-8 bytes");
  const allowed = new Set(context.evidenceIds || []);
  if (
    !Array.isArray(recovery.evidence_ids) ||
    !recovery.evidence_ids.length ||
    recovery.evidence_ids.length > 1000 ||
    new Set(recovery.evidence_ids).size !== recovery.evidence_ids.length ||
    recovery.evidence_ids.some((id) => typeof id !== "string" || !allowed.has(id))
  )
    add("evidence_ids", "must ground diagnosis in unique retained predecessor evidence IDs");
  if (!["within-approved-scope", "decision-required"].includes(recovery.scope_assessment))
    add("scope_assessment", "must assess the approved scope boundary");
  if (
    (DECISIONS.has(recovery.classification) || context.previousDecisionRequired) &&
    recovery.scope_assessment !== "decision-required"
  )
    add(
      "scope_assessment",
      "a genuine dependency/product/scope-risk decision or unresolved dispute remains blocked"
    );
  if (context.previousDecisionRequired && recovery.classification === "external-dependency")
    add(
      "classification",
      "unresolved product/dispute/scope-risk authority cannot be reclassified as a restorable dependency"
    );
  if (
    context.previousRecovery &&
    JSON.stringify(approach(context.previousRecovery)) === JSON.stringify(approach(recovery))
  )
    add(
      "",
      "requires a changed recovery approach; fresh IDs or commits alone cannot repeat the same failed remedy"
    );
  return issues;
}

function approach(recovery) {
  return ["change", "next_check"].map((field) =>
    String(recovery?.[field] || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase()
  );
}

module.exports = {
  MAX_RECOVERY_ROUNDS,
  RECOVERY_POLICY,
  RECOVERY_THRESHOLDS,
  recoveryRequiresAuthority,
  recoveryRequiresDecision,
  validateScopedRecovery,
};
