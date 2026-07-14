#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { readProposal } = require("./lib/proposal-schema");

const GENERIC =
  /^(improve|better|good|nice|user[- ]friendly|tbd|todo|make it work|improve the experience)[ .!]*$/i;

function specific(value, minimum = 24, minimumWords = 5) {
  if (typeof value !== "string" || value.trim().length < minimum || GENERIC.test(value.trim()))
    return false;
  const words = new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) || []).filter((word) => word.length > 2)
  );
  return words.size >= minimumWords;
}

function meaningful(value) {
  return typeof value === "string" && value.trim().length >= 3 && !GENERIC.test(value.trim());
}

function ratio(rows, predicate) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return rows.filter(predicate).length / rows.length;
}

function scoreProposal(proposal) {
  const dimensions = {};
  const evidenceRatio = ratio(
    proposal.evidence,
    (row) =>
      specific(row.summary, 32) &&
      typeof row.path === "string" &&
      row.path.length > 3 &&
      row.observed_at
  );
  dimensions.evidence = Math.round(20 * evidenceRatio);

  const scopeRows = [...proposal.scope.in_scope, ...proposal.scope.non_goals];
  dimensions.scope = Math.round(15 * ratio(scopeRows, (row) => specific(row.statement, 12, 3)));

  dimensions.acceptance = Math.round(
    20 *
      ratio(
        proposal.acceptance_criteria,
        (row) =>
          specific(row.given, 12, 2) &&
          specific(row.when, 12, 3) &&
          specific(row.then, 24) &&
          Array.isArray(row.requirement_ids) &&
          row.requirement_ids.length > 0
      )
  );

  const decisionChecks = [
    ...proposal.alternatives.map(
      (row) => specific(row.name, 12, 3) && specific(row.reason_rejected, 20, 4)
    ),
    ...proposal.risks.map((row) => specific(row.risk, 20, 4) && specific(row.mitigation, 20, 4)),
    ...proposal.success_metrics.map(
      (row) =>
        specific(row.metric, 16, 3) &&
        meaningful(row.baseline) &&
        meaningful(row.target) &&
        meaningful(row.window)
    ),
  ];
  dimensions.decisions = Math.round(20 * ratio(decisionChecks, Boolean));

  dimensions.experience = Math.round(
    10 * ratio(proposal.design_requirements, (row) => specific(row.requirement, 28))
  );

  const traceChecks = [
    proposal.jobs_to_be_done.every((row) => row.audience_ids.length > 0),
    proposal.acceptance_criteria.every((row) => row.requirement_ids.length > 0),
    proposal.question_reviews.every((row) => row.evidence_refs.length > 0),
  ];
  dimensions.traceability = Math.round(
    15 * (traceChecks.filter(Boolean).length / traceChecks.length)
  );

  const total = Object.values(dimensions).reduce((sum, score) => sum + score, 0);
  return {
    schema_version: 1,
    proposal_id: proposal.id,
    revision: proposal.revision,
    score: total,
    maximum: 100,
    threshold: 70,
    quality_passed: total >= 70,
    dimensions,
  };
}

function main(argv = process.argv.slice(2)) {
  const proposalIndex = argv.indexOf("--proposal");
  const rootIndex = argv.indexOf("--project-root");
  const json = argv.includes("--json");
  if (proposalIndex < 0 || !argv[proposalIndex + 1]) {
    process.stderr.write("proposal-quality-check: --proposal is required\n");
    return 2;
  }
  const proposalPath = path.resolve(argv[proposalIndex + 1]);
  const projectRoot =
    rootIndex >= 0 && argv[rootIndex + 1]
      ? path.resolve(argv[rootIndex + 1])
      : path.dirname(proposalPath);
  try {
    const source = readProposal(proposalPath, { projectRoot });
    const result = scoreProposal(source.proposal);
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else
      process.stdout.write(
        `Proposal quality: ${result.score}/${result.maximum} (${result.quality_passed ? "pass" : "fail"})\n`
      );
    return result.quality_passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`proposal-quality-check: ${error.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { scoreProposal, specific, main };
