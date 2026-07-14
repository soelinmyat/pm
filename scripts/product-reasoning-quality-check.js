#!/usr/bin/env node
"use strict";

const { readBoundedJsonFile } = require("./lib/safe-json-file");
const {
  validateDecisionBrief,
  validateFeatureInventory,
} = require("./lib/product-reasoning-schema");

function scoreDecisionBrief(brief) {
  const schemaIssues = validateDecisionBrief(brief);
  if (schemaIssues.length)
    return { valid: false, passed: false, score: 0, max_score: 10, issues: schemaIssues };
  const checks = [
    ["specific_problem", brief.problem.length >= 60],
    ["multiple_evidence_refs", brief.evidence_refs.length >= 2],
    ["ledger_bound_evidence", brief.evidence_refs.some((item) => item.evidence_id)],
    ["distinct_alternatives", new Set(brief.alternatives.map((item) => item.tradeoff)).size >= 2],
    [
      "confirmed_decision",
      brief.decision.status === "confirmed" && brief.decision.rationale.length >= 40,
    ],
    ["confidence_basis", brief.confidence.basis.length >= 2],
    ["explicit_non_goals", brief.non_goals.length >= 2],
    [
      "actionable_trigger",
      brief.next_trigger.lane !== "none" && brief.next_trigger.condition.length >= 20,
    ],
    ["artifact_binding", brief.source_artifacts.length >= 1],
    [
      "consistency",
      brief.kind !== "idea" ||
        (brief.alignment.non_goal_conflicts.length === 0 &&
          brief.alignment.priority_ids.length > 0),
    ],
  ];
  return {
    valid: true,
    passed: checks.filter(([, passed]) => passed).length >= 7,
    score: checks.filter(([, passed]) => passed).length,
    max_score: checks.length,
    checks: Object.fromEntries(checks),
  };
}

function scoreFeatureInventory(inventory) {
  const schemaIssues = validateFeatureInventory(inventory);
  if (schemaIssues.length)
    return { valid: false, passed: false, score: 0, max_score: 10, issues: schemaIssues };
  const features = inventory.areas.flatMap((area) => area.features);
  const sourceRefs = features.flatMap((feature) => feature.source_refs);
  const bannedAreas = new Set(["backend", "core", "frontend", "misc", "other"]);
  const confidenceLevels = new Set(features.map((feature) => feature.confidence));
  const checks = [
    ["scan_coverage", inventory.scan.files_scanned / inventory.scan.files_total >= 0.6],
    [
      "source_snapshot_bound",
      inventory.scan.mode === "git"
        ? inventory.scan.commit !== null
        : inventory.scan.snapshot_sha256 !== null,
    ],
    ["concrete_outcomes", features.every((feature) => feature.outcome.length >= 50)],
    [
      "detailed_highlights",
      features.every((feature) => feature.highlights.every((highlight) => highlight.length >= 20)),
    ],
    [
      "multi_source_evidence",
      features.filter((feature) => feature.source_refs.length >= 2).length >=
        Math.ceil(features.length / 2),
    ],
    ["source_diversity", new Set(sourceRefs).size >= Math.ceil(features.length * 1.5)],
    ["calibrated_confidence", confidenceLevels.size >= 2 && !confidenceLevels.has("low")],
    [
      "journey_grouping",
      inventory.areas.every((area) => !bannedAreas.has(area.name.trim().toLowerCase())),
    ],
    [
      "distinct_outcomes",
      new Set(features.map((feature) => feature.outcome)).size === features.length,
    ],
    ["reader_binding", inventory.markdown_binding.path === "product/features.md"],
  ];
  return {
    valid: true,
    passed: checks.filter(([, passed]) => passed).length >= 7,
    score: checks.filter(([, passed]) => passed).length,
    max_score: checks.length,
    checks: Object.fromEntries(checks),
  };
}

function main(argv = process.argv.slice(2)) {
  const input = argv[0];
  if (!input) throw new Error("usage: product-reasoning-quality-check <artifact.json>");
  const brief = readBoundedJsonFile(input);
  let result;
  if (brief === null || typeof brief !== "object" || Array.isArray(brief))
    result = scoreDecisionBrief(brief);
  else if (brief.document_type === "decision-brief") result = scoreDecisionBrief(brief);
  else if (brief.document_type === "feature-inventory") result = scoreFeatureInventory(brief);
  else throw new Error("document_type must be decision-brief or feature-inventory");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 2;
  else if (!result.passed) process.exitCode = 3;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { scoreDecisionBrief, scoreFeatureInventory };
