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
    ["specific_problem", substantive(brief.problem, 60, 8, 6)],
    [
      "multiple_evidence_refs",
      brief.evidence_refs.length >= 2 &&
        allDistinctSubstantive(
          brief.evidence_refs.map((item) => item.note),
          20,
          4,
          3
        ),
    ],
    ["ledger_bound_evidence", brief.evidence_refs.some((item) => item.evidence_id)],
    [
      "distinct_alternatives",
      brief.alternatives.length >= 2 &&
        allDistinctSubstantive(
          brief.alternatives.map((item) => item.tradeoff),
          20,
          5,
          4
        ),
    ],
    [
      "confirmed_decision",
      brief.decision.status === "confirmed" &&
        substantive(brief.decision.rationale, 40, 7, 5) &&
        rationaleNamesChoice(brief),
    ],
    [
      "confidence_basis",
      brief.confidence.basis.length >= 2 &&
        allDistinctSubstantive(brief.confidence.basis, 20, 4, 3),
    ],
    [
      "explicit_non_goals",
      brief.non_goals.length >= 2 && allDistinctSubstantive(brief.non_goals, 15, 3, 3),
    ],
    [
      "actionable_trigger",
      brief.next_trigger.lane !== "none" && substantive(brief.next_trigger.condition, 20, 5, 4),
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
    ["concrete_outcomes", features.every((feature) => substantive(feature.outcome, 50, 8, 6))],
    [
      "detailed_highlights",
      features.every(
        (feature) =>
          feature.highlights.length >= 2 && allDistinctSubstantive(feature.highlights, 20, 4, 3)
      ),
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
      allDistinctSubstantive(
        features.map((feature) => feature.outcome),
        50,
        8,
        6
      ),
    ],
    [
      "nonduplicative_highlights",
      allDistinctSubstantive(
        features.flatMap((feature) => feature.highlights),
        20,
        4,
        3
      ),
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

function normalizedTokens(value) {
  return (
    String(value || "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  );
}

function substantive(value, minLength, minTokens, minUnique) {
  const text = String(value || "").trim();
  const tokens = normalizedTokens(text);
  const uniqueTokens = new Set(tokens);
  const uniqueCharacters = new Set(text.toLowerCase().match(/[\p{L}\p{N}]/gu) || []).size;
  return (
    text.length >= minLength &&
    tokens.length >= minTokens &&
    uniqueTokens.size >= minUnique &&
    uniqueTokens.size / tokens.length >= 0.35 &&
    uniqueCharacters >= 8 &&
    !hasRepeatedNgram(tokens, 3)
  );
}

function allDistinctSubstantive(values, minLength, minTokens, minUnique) {
  const normalized = values.map((value) => normalizedTokens(value).join(" "));
  return (
    values.every((value) => substantive(value, minLength, minTokens, minUnique)) &&
    new Set(normalized).size === normalized.length &&
    normalized.every((value, index) =>
      normalized.slice(index + 1).every((other) => tokenJaccard(value, other) < 0.7)
    )
  );
}

function hasRepeatedNgram(tokens, width) {
  if (tokens.length < width * 2) return false;
  const seen = new Set();
  for (let index = 0; index <= tokens.length - width; index += 1) {
    const gram = tokens.slice(index, index + width).join("\u0000");
    if (seen.has(gram)) return true;
    seen.add(gram);
  }
  return false;
}

function tokenJaccard(left, right) {
  const leftTokens = new Set(normalizedTokens(left));
  const rightTokens = new Set(normalizedTokens(right));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / union.size;
}

function rationaleNamesChoice(brief) {
  const choice = brief.alternatives.find((item) => item.id === brief.decision.choice);
  if (!choice) return false;
  const rationale = new Set(normalizedTokens(brief.decision.rationale));
  const otherTokens = new Set(
    brief.alternatives
      .filter((item) => item.id !== choice.id)
      .flatMap((item) => normalizedTokens(`${item.id} ${item.title}`))
  );
  return normalizedTokens(`${choice.id} ${choice.title}`)
    .filter((token) => token.length >= 4 && !otherTokens.has(token))
    .some((token) => rationale.has(token));
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
