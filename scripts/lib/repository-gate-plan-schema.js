"use strict";

const crypto = require("node:crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])])
  );
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex")}`;
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
