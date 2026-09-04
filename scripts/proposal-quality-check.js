#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { proposalReviewCoverage, readProposal } = require("./lib/proposal-schema");
const {
  normalizeReviewText,
  reviewAnswerQuality,
  reviewEvidenceRelevanceQuality,
  reviewFindingQuality,
} = require("./lib/groom-review-contract");
const { findGitRoot } = require("./loop-git");

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

function minimum(rows, predicate, { applicable = true, label, required = 1 } = {}) {
  const collection = Array.isArray(rows) ? rows : [];
  const substantive = collection.filter(predicate).length;
  const passed = !applicable || (substantive >= required && substantive === collection.length);
  return {
    applicable,
    passed,
    required,
    substantive,
    total: collection.length,
    reason: !applicable
      ? "not applicable at the current lifecycle"
      : passed
        ? `${label} meets its substantive floor`
        : `${label} requires at least ${required} substantive entr${required === 1 ? "y" : "ies"} and no filler entries`,
  };
}

function designContextMinimum(proposal) {
  const context = proposal.design_context;
  const expectedRequirements = Array.isArray(proposal.design_requirements)
    ? proposal.design_requirements.map((row) => row.requirement)
    : [];
  const passed =
    context !== null &&
    typeof context === "object" &&
    !Array.isArray(context) &&
    Array.isArray(context.design_requirements) &&
    JSON.stringify(context.design_requirements) === JSON.stringify(expectedRequirements) &&
    Array.isArray(context.critical_states) &&
    context.critical_states.length > 0 &&
    context.critical_states.every((state) => meaningful(state)) &&
    Array.isArray(context.visual_invariants) &&
    context.visual_invariants.length > 0 &&
    context.visual_invariants.every((invariant) => specific(invariant, 24, 4)) &&
    (context.prototype === null ||
      (typeof context.prototype === "object" &&
        typeof context.prototype.path === "string" &&
        /^sha256:[a-f0-9]{64}$/.test(context.prototype.sha256 || "")));
  return {
    applicable: true,
    passed,
    required: 1,
    substantive: passed ? 1 : 0,
    total: context === undefined ? 0 : 1,
    reason: passed
      ? "Durable design context meets its handoff floor"
      : "Durable design context requires matching requirements, critical states, visual invariants, and a source-bound prototype or null",
  };
}

function reviewCoverageMinimum(proposal, applicable) {
  const coverage = proposalReviewCoverage(proposal);
  const passed =
    !applicable ||
    (coverage.bound &&
      coverage.complete &&
      coverage.session_id === proposal.source?.session_id &&
      proposal.question_reviews.every((row) => row.outcome !== "fail"));
  return {
    applicable,
    passed,
    required: coverage.expected_question_ids.length,
    substantive: coverage.reviewed_question_ids.length,
    total: Array.isArray(proposal.question_reviews) ? proposal.question_reviews.length : 0,
    tier: coverage.tier,
    missing_question_ids: coverage.missing_question_ids,
    unexpected_question_ids: coverage.unexpected_question_ids,
    reason: !applicable
      ? "not applicable at the current lifecycle"
      : passed
        ? "Question reviews exactly cover the bound Groom review contract"
        : "Reviewed proposals require a session-bound tier and exact required question coverage",
  };
}

function questionReviewMinimum(proposal, applicable) {
  const coverage = reviewCoverageMinimum(proposal, applicable);
  const rows = Array.isArray(proposal.question_reviews) ? proposal.question_reviews : [];
  const substance = minimum(
    rows,
    (row) => {
      const answerQuality = reviewAnswerQuality(row.conclusion, row.rationale, row.question);
      const findingQuality =
        row.outcome === "pass"
          ? { ok: row.finding === null }
          : reviewFindingQuality(row.finding, row.conclusion, row.rationale, row.question);
      return (
        answerQuality.ok &&
        ["pass", "advisory"].includes(row.outcome) &&
        ["high", "medium", "low"].includes(row.confidence) &&
        !(row.outcome === "pass" && row.confidence === "low") &&
        Array.isArray(row.evidence) &&
        row.evidence.length > 0 &&
        row.evidence.every(
          (item) =>
            meaningful(item.evidence_id) &&
            meaningful(item.locator) &&
            reviewEvidenceRelevanceQuality(
              item.relevance,
              row.conclusion,
              row.rationale,
              row.question
            ).ok
        ) &&
        findingQuality.ok
      );
    },
    {
      applicable,
      label: "Question reviews",
      required: applicable ? coverage.required || 1 : 1,
    }
  );
  const answerIdentities = rows.map((row) => normalizeReviewText(row.conclusion)).filter(Boolean);
  const rationaleIdentities = rows.map((row) => normalizeReviewText(row.rationale)).filter(Boolean);
  const evidenceLocations = new Set(
    rows.flatMap((row) =>
      Array.isArray(row.evidence)
        ? row.evidence.map((item) => `${item?.evidence_id || ""}\u0000${item?.locator || ""}`)
        : []
    )
  );
  const requiredEvidenceLocations = Math.min(rows.length, 2);
  const evidenceRelevances = new Set(
    rows.flatMap((row) =>
      Array.isArray(row.evidence)
        ? row.evidence.map((item) => normalizeReviewText(item?.relevance))
        : []
    )
  );
  const independencePassed =
    !applicable ||
    (answerIdentities.length === rows.length &&
      new Set(answerIdentities).size === rows.length &&
      rationaleIdentities.length === rows.length &&
      new Set(rationaleIdentities).size === rows.length &&
      evidenceLocations.size >= requiredEvidenceLocations &&
      evidenceRelevances.size >= requiredEvidenceLocations);
  return {
    ...substance,
    passed: substance.passed && coverage.passed && independencePassed,
    tier: coverage.tier,
    missing_question_ids: coverage.missing_question_ids,
    unexpected_question_ids: coverage.unexpected_question_ids,
    distinct_answer_conclusions: new Set(answerIdentities).size,
    distinct_answer_rationales: new Set(rationaleIdentities).size,
    distinct_evidence_locations: evidenceLocations.size,
    distinct_evidence_relevances: evidenceRelevances.size,
    required_evidence_locations: requiredEvidenceLocations,
    independence_passed: independencePassed,
    reason:
      substance.passed && coverage.passed && independencePassed
        ? coverage.reason
        : !coverage.passed
          ? coverage.reason
          : !independencePassed
            ? "Question reviews require distinct answers plus answer-specific evidence locations and relevance explanations"
            : substance.reason,
  };
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

  const reviewedOrLater = new Set(["reviewed", "approved", "planned", "in-progress", "done"]).has(
    proposal.lifecycle
  );
  const minimums = {
    alternatives: minimum(
      proposal.alternatives,
      (row) => specific(row.name, 12, 3) && specific(row.reason_rejected, 20, 4),
      { label: "Alternatives" }
    ),
    risks: minimum(
      proposal.risks,
      (row) => specific(row.risk, 20, 4) && specific(row.mitigation, 20, 4),
      { label: "Material risks" }
    ),
    design_requirements: minimum(
      proposal.design_requirements,
      (row) => specific(row.requirement, 28),
      { label: "Experience or design requirements" }
    ),
    design_context: designContextMinimum(proposal),
    question_reviews: questionReviewMinimum(proposal, reviewedOrLater),
  };

  const traceChecks = [
    Array.isArray(proposal.jobs_to_be_done) &&
      proposal.jobs_to_be_done.length > 0 &&
      proposal.jobs_to_be_done.every(
        (row) => Array.isArray(row.audience_ids) && row.audience_ids.length > 0
      ),
    Array.isArray(proposal.acceptance_criteria) &&
      proposal.acceptance_criteria.length > 0 &&
      proposal.acceptance_criteria.every(
        (row) => Array.isArray(row.requirement_ids) && row.requirement_ids.length > 0
      ),
    Array.isArray(proposal.question_reviews) &&
      proposal.question_reviews.length > 0 &&
      proposal.question_reviews.every(
        (row) =>
          (Array.isArray(row.evidence) && row.evidence.length > 0) ||
          (Array.isArray(row.evidence_refs) && row.evidence_refs.length > 0)
      ),
  ];
  dimensions.traceability = Math.round(
    15 * (traceChecks.filter(Boolean).length / traceChecks.length)
  );

  const total = Object.values(dimensions).reduce((sum, score) => sum + score, 0);
  const minimumsPassed = Object.values(minimums).every((result) => result.passed);
  return {
    schema_version: 1,
    proposal_id: proposal.id,
    revision: proposal.revision,
    score: total,
    maximum: 100,
    threshold: 70,
    quality_passed: total >= 70 && minimumsPassed,
    dimensions,
    minimums,
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
  const requestedProposalPath = path.resolve(argv[proposalIndex + 1]);
  try {
    const proposalPath = fs.realpathSync(requestedProposalPath);
    const requestedProjectRoot =
      rootIndex >= 0 && argv[rootIndex + 1]
        ? path.resolve(argv[rootIndex + 1])
        : findGitRoot(path.dirname(proposalPath)) || path.dirname(proposalPath);
    const projectRoot = fs.existsSync(requestedProjectRoot)
      ? fs.realpathSync(requestedProjectRoot)
      : requestedProjectRoot;
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
