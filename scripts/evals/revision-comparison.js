"use strict";
const crypto = require("node:crypto");
const hash = (value) =>
  `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
const hashPattern = /^sha256:[a-f0-9]{64}$/;

// A deliberate source treatment is an explicit comparison contract, never an
// implicit relaxation of the existing identical-source baseline rule.
function checkRevisionComparison(baseline, current, design) {
  if (!design || design.schema_version !== 1 || !/^[a-z][a-z0-9-]+$/.test(design.id || ""))
    return "invalid-revision-design";
  if (
    !Array.isArray(design.variants) ||
    design.variants.length !== 2 ||
    design.variants.some(
      (variant) => !variant || typeof variant !== "object" || Array.isArray(variant)
    )
  )
    return "two-source-variants-required";
  if (new Set(design.variants.map((variant) => variant.id)).size !== 2)
    return "duplicate-treatment-id";
  if (new Set(design.variants.map((variant) => variant.source_hash)).size !== 2)
    return "distinct-treatment-sources-required";
  for (const [index, scorecard] of [baseline, current].entries()) {
    const variant = design.variants[index];
    const identity = scorecard.evaluation_identity || {};
    if (
      !/^[a-z][a-z0-9-]+$/.test(variant.id || "") ||
      !hashPattern.test(variant.source_hash || "") ||
      variant.source_hash !== identity.source_hash
    )
      return "treatment-source-mismatch";
    for (const field of [
      "scenario_hash",
      "quality_case_hash",
      "rubric_hash",
      "evaluation_design_hash",
      "environment_hash",
      "profile_hash",
    ]) {
      if (!hashPattern.test(design[field] || "") || design[field] !== identity[field])
        return `treatment-${field}-mismatch`;
    }
  }
  return null;
}
module.exports = { checkRevisionComparison, comparisonDesignHash: hash };

function checkTreatmentCandidates(candidates, rubric, design) {
  if (!design || design.schema_version !== 1 || !/^[a-z][a-z0-9-]+$/.test(design.id || ""))
    return "invalid-treatment-design";
  if (
    !Array.isArray(design.variants) ||
    design.variants.length !== 2 ||
    design.variants.some(
      (variant) => !variant || typeof variant !== "object" || Array.isArray(variant)
    ) ||
    new Set(design.variants.map((v) => v.profile_id)).size !== 2 ||
    new Set(design.variants.map((v) => v.source_hash)).size !== 2
  )
    return "two-distinct-source-profile-variants-required";
  if (hash(rubric) !== design.rubric_hash) return "treatment-rubric-mismatch";
  if (!design.model || !design.model.adapter || !design.model.model || !design.model.effort)
    return "treatment-model-required";
  for (const field of ["scenario_hash", "quality_case_hash", "environment_hash"])
    if (!hashPattern.test(design[field] || "")) return `treatment-${field}-required`;
  for (const item of candidates) {
    const variant = design.variants.find((v) => v.profile_id === item.profile.id);
    if (
      !variant ||
      !hashPattern.test(variant.source_hash || "") ||
      variant.source_hash !== item.source_hash ||
      variant.release !== item.release
    )
      return "treatment-source-release-mismatch";
    for (const field of ["adapter", "model", "effort"])
      if (design.model[field] !== item.profile[field]) return "treatment-model-mismatch";
    if (
      item.environment_hash !== design.environment_hash ||
      item.quality_case_hash !== design.quality_case_hash ||
      item.behavioral.scenario_hash !== design.scenario_hash
    )
      return "treatment-frozen-input-mismatch";
  }
  return null;
}
module.exports.checkTreatmentCandidates = checkTreatmentCandidates;
