"use strict";

const { reviewQuestionForTier } = require("../../scripts/lib/groom-review-contract.js");

const ANSWERS = Object.freeze({
  "assumption-risk": {
    conclusion: "Long-term retention remains the main reversal risk for this recommendation.",
    rationale:
      "Current observations cover initial usage but contain no longitudinal evidence about sustained adoption.",
    relevance:
      "Baseline retention observations show the unresolved long-term usage gap behind the main reversal risk.",
  },
  "problem-evidence": {
    conclusion: "Repeated stale approvals establish a decision-worthy user problem.",
    rationale:
      "Two observed approval failures connect changed proposal bytes to a misleading trusted state.",
    relevance:
      "Baseline incident observations document approval failures that support the stated problem and stale-decision chain.",
  },
  scope: {
    conclusion: "The launch scope is coherent and deliberately narrow.",
    rationale:
      "It limits work to review capture while explicitly excluding unrelated workflow automation.",
    relevance:
      "Baseline boundary notes name the excluded workflow automation and the deliberately limited review-capture scope.",
  },
  acceptance: {
    conclusion: "The criteria define observable product behavior at every approval transition.",
    rationale:
      "Each rule names a visible lifecycle change together with its expected user-facing outcome.",
    relevance:
      "Baseline criteria enumerate visible lifecycle outcomes for every acceptance transition in the proposed flow.",
  },
  experience: {
    conclusion: "The proposed experience covers the consequential user states.",
    rationale:
      "The contract specifies the primary flow, failure recovery, and every approval state the user encounters.",
    relevance:
      "Baseline flow evidence documents the primary path, failure recovery, and consequential approval states.",
  },
  feasibility: {
    conclusion: "Existing artifact primitives make the proposal technically credible.",
    rationale:
      "The work relies on established validation and rendering boundaries instead of introducing a new subsystem.",
    relevance:
      "Baseline implementation evidence confirms the existing artifact validation and rendering boundaries used by the proposal.",
  },
  reversal: {
    conclusion: "No sampled counterexample currently overturns the recommendation.",
    rationale:
      "Every examined team expected approval to become stale after substantive proposal edits.",
    relevance:
      "Baseline counterexample sampling contains no team accepting stale approval after substantive proposal edits.",
  },
});

function reviewRow(question, index = 0, options = {}) {
  const answer = ANSWERS[question.id];
  if (!answer) throw new Error(`missing review fixture answer for ${question.id}`);
  return {
    id: `review:${question.id}`,
    question_id: question.id,
    question: question.text,
    conclusion: answer.conclusion,
    rationale: answer.rationale,
    outcome: options.outcome || "pass",
    evidence: [
      {
        evidence_id: options.evidenceId || "evidence:baseline",
        locator: options.locator || `F${(index % 2) + 1}`,
        relevance: answer.relevance,
      },
    ],
    confidence: options.confidence || "high",
    finding: options.finding ?? null,
    advisory_debt_ids: options.advisoryDebtIds || [],
  };
}

function reviewRowForTier(tier, questionId, index = 0, options = {}) {
  const question = reviewQuestionForTier(tier, questionId);
  if (!question) throw new Error(`unknown ${tier} review question ${questionId}`);
  return reviewRow(question, index, options);
}

function reviewOutcome(question, proposalHash, index = 0, options = {}) {
  const row = reviewRow(question, index, options);
  return {
    question_id: row.question_id,
    proposal_hash: proposalHash,
    verdict: row.outcome,
    conclusion: row.conclusion,
    rationale: row.rationale,
    evidence: row.evidence,
    confidence: row.confidence,
    finding: row.finding,
  };
}

module.exports = { ANSWERS, reviewOutcome, reviewRow, reviewRowForTier };
