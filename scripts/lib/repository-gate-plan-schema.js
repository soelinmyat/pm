"use strict";

const { hashResult, stableValue } = require("./workflow-runtime/records");

function stable(value) {
  return stableValue(value);
}

function digest(value) {
  return hashResult(value);
}

function planMaterial(plan) {
  const copy = { ...plan };
  delete copy.plan_digest;
  return copy;
}

function validatePlan(plan) {
  const issues = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan))
    issues.push("plan must be an object");
  else {
    if (plan.schema_version !== 1) issues.push("schema_version must be 1");
    for (const key of ["targeted_commands", "complete_commands"])
      if (!Array.isArray(plan[key]) || plan[key].some((x) => typeof x !== "string"))
        issues.push(`${key} must be a string array`);
    if (typeof plan.plan_digest !== "string") issues.push("plan_digest is required");
  }
  return { ok: issues.length === 0, issues };
}

module.exports = { stable, digest, planMaterial, validatePlan };
