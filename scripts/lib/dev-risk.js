"use strict";

const DIMENSION_NAMES = Object.freeze([
  "behavioral",
  "security",
  "auth",
  "data",
  "external_contract",
  "operational",
  "ui",
  "reversibility",
  "cross_module",
]);
const SPECIAL_FACTS = new Set(["destructive_data"]);
const VALID_KINDS = new Set(["proposal", "task", "bug"]);
const VALID_SIZES = new Set(["XS", "S", "M", "L", "XL"]);
const FULL_REVIEW_SIZES = new Set(["M", "L", "XL"]);

function assessRisk(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("risk must be an object");
  }

  for (const name of Object.keys(input)) {
    if (!DIMENSION_NAMES.includes(name) && !SPECIAL_FACTS.has(name)) {
      throw new Error(`unknown risk dimension: ${name}`);
    }
  }

  const dimensions = {};
  for (const name of DIMENSION_NAMES) {
    const value = input[name] === undefined ? 0 : input[name];
    if (!Number.isInteger(value) || value < 0 || value > 3) {
      throw new TypeError(`${name} must be an integer from 0 to 3`);
    }
    dimensions[name] = value;
  }

  if (input.destructive_data !== undefined && typeof input.destructive_data !== "boolean") {
    throw new TypeError("destructive_data must be a boolean");
  }

  const total = DIMENSION_NAMES.reduce((sum, name) => sum + dimensions[name], 0);
  const max = Math.max(...DIMENSION_NAMES.map((name) => dimensions[name]));
  const reasons = [];
  let forcedTier = null;

  if (dimensions.security === 3 || dimensions.auth === 3) {
    forcedTier = "critical";
    reasons.push("critical security or authorization boundary");
  } else if (input.destructive_data && dimensions.data === 3) {
    forcedTier = "critical";
    reasons.push("destructive data change with maximum data impact");
  } else {
    if (dimensions.security >= 2) reasons.push("security boundary requires high-risk handling");
    if (dimensions.auth >= 1) reasons.push("authorization change requires high-risk handling");
    if (dimensions.external_contract >= 2) {
      reasons.push("public contract change requires high-risk handling");
    }
    if (input.destructive_data) {
      reasons.push("destructive data change requires high-risk handling");
    }
    if (dimensions.reversibility === 3) {
      reasons.push("irreversible change requires high-risk handling");
    }
    if (reasons.length > 0) forcedTier = "high";
  }

  let tier;
  if (forcedTier) tier = forcedTier;
  else if (max === 3 || total >= 6) tier = "high";
  else if (max === 2 || total >= 3) tier = "medium";
  else tier = "low";

  if (reasons.length === 0) {
    if (tier === "high") reasons.push(`aggregate risk score ${total} requires high-risk handling`);
    else if (tier === "medium") reasons.push(`risk score ${total} requires standard safeguards`);
    else reasons.push(`risk score ${total} is low`);
  }

  return {
    tier,
    total,
    maximum: max,
    dimensions,
    destructive_data: input.destructive_data === true,
    reasons,
  };
}

function routeDevWork(facts = {}) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    throw new TypeError("dev routing facts must be an object");
  }

  const kind = facts.kind === undefined || facts.kind === null ? "proposal" : facts.kind;
  const size = facts.size;
  if (!VALID_KINDS.has(kind)) throw new Error(`invalid dev kind: ${kind}`);
  if (!VALID_SIZES.has(size)) throw new Error(`invalid dev size: ${size}`);

  const risk = assessRisk(facts.risk || {});
  const requiredPhases = ["intake", "workspace"];
  const requiredGates = [];
  const reasons = [...risk.reasons];

  if (kind === "proposal" && FULL_REVIEW_SIZES.has(size)) {
    requiredPhases.push("readiness");
    reasons.push(`${size} proposal requires groom and RFC readiness`);
  } else if (kind !== "proposal") {
    reasons.push(`${kind} uses supplied task context instead of proposal readiness`);
  }

  requiredPhases.push("implementation");

  const nonBehavioralReason = normalizeReason(facts.non_behavioral_reason);
  if (risk.dimensions.behavioral > 0 || !nonBehavioralReason) {
    requiredGates.push("tdd");
    reasons.push(
      risk.dimensions.behavioral > 0
        ? "behavior change requires regression evidence"
        : "TDD required because no non-behavioral exception was recorded"
    );
  } else {
    reasons.push(`TDD skipped: ${nonBehavioralReason}`);
  }

  if (risk.dimensions.ui > 0) {
    requiredGates.push("design-critique", "qa");
    requiredPhases.push("design-critique", "qa");
    reasons.push("UI impact requires design critique and QA");
  }

  requiredPhases.push("review", "ship", "retro");

  const highRisk = risk.tier === "high" || risk.tier === "critical";
  const reviewMode = highRisk || FULL_REVIEW_SIZES.has(size) ? "full" : "code-scan";
  if (highRisk) reasons.push(`${risk.tier} risk requires full review`);
  else if (FULL_REVIEW_SIZES.has(size)) reasons.push(`${size} size requires full review`);
  else reasons.push(`${size} low-scope work uses a code scan`);

  requiredGates.push("review", "verification");

  return {
    decision_version: 1,
    kind,
    size,
    risk_tier: risk.tier,
    risk,
    review_mode: reviewMode,
    required_phases: requiredPhases,
    required_gates: unique(requiredGates),
    reasons: unique(reasons),
  };
}

function normalizeReason(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values) {
  return [...new Set(values)];
}

module.exports = {
  DIMENSION_NAMES,
  assessRisk,
  routeDevWork,
};
