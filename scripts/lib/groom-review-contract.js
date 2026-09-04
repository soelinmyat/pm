"use strict";

const REVIEW_QUESTIONS = Object.freeze({
  quick: Object.freeze([
    Object.freeze({
      id: "assumption-risk",
      text: "Which evidence gap or assumption is most likely to reverse this recommendation?",
    }),
    Object.freeze({
      id: "experience",
      text: "Are the primary experience, consequential states, and design requirements complete?",
    }),
  ]),
  standard: Object.freeze([
    Object.freeze({
      id: "problem-evidence",
      text: "Is the problem and evidence chain sufficient for this decision?",
    }),
    Object.freeze({
      id: "scope",
      text: "Is the scope coherent, minimal, and explicit about non-goals?",
    }),
    Object.freeze({
      id: "acceptance",
      text: "Are acceptance criteria observable and implementation-neutral?",
    }),
    Object.freeze({
      id: "experience",
      text: "Are user flows, failure states, and design requirements complete?",
    }),
    Object.freeze({
      id: "feasibility",
      text: "Is feasibility credible without smuggling in an engineering design?",
    }),
  ]),
  full: Object.freeze([
    Object.freeze({
      id: "problem-evidence",
      text: "Is the problem and evidence chain sufficient for this decision?",
    }),
    Object.freeze({
      id: "scope",
      text: "Is the scope coherent, minimal, and explicit about non-goals?",
    }),
    Object.freeze({
      id: "acceptance",
      text: "Are acceptance criteria observable and implementation-neutral?",
    }),
    Object.freeze({
      id: "experience",
      text: "Are user flows, failure states, and design requirements complete?",
    }),
    Object.freeze({
      id: "feasibility",
      text: "Is feasibility credible without smuggling in an engineering design?",
    }),
    Object.freeze({
      id: "reversal",
      text: "What assumption, counterexample, or competitive fact could reverse the recommendation?",
    }),
  ]),
});

const REVIEW_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "which",
  "with",
  "without",
]);

const EVIDENCE_BOILERPLATE = new Set([
  "answer",
  "conclusion",
  "direct",
  "directly",
  "evidence",
  "finding",
  "item",
  "question",
  "record",
  "relevant",
  "review",
  "source",
  "support",
]);

function questionTier(tier) {
  return tier === "agent" ? "full" : tier;
}

function reviewQuestionsForTier(tier) {
  const questions = REVIEW_QUESTIONS[questionTier(tier)];
  return questions ? structuredClone(questions) : null;
}

function reviewQuestionIdsForTier(tier) {
  return reviewQuestionsForTier(tier)?.map((question) => question.id) || null;
}

function reviewQuestionForTier(tier, questionId) {
  return reviewQuestionsForTier(tier)?.find((question) => question.id === questionId) || null;
}

function normalizeReviewText(value) {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
    : "";
}

function reviewTextTokens(value, extraStopWords = null) {
  return new Set(
    normalizeReviewText(value)
      .split(" ")
      .filter(Boolean)
      .map(stemReviewToken)
      .filter(
        (token) =>
          token.length > 2 &&
          !REVIEW_STOP_WORDS.has(token) &&
          !(extraStopWords && extraStopWords.has(token))
      )
  );
}

function stemReviewToken(token) {
  if (token.length > 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 5 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 5 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function reviewTextIsSubstantive(value, minimumLength = 32, minimumWords = 5) {
  if (typeof value !== "string" || value.trim().length < minimumLength) return false;
  return reviewTextTokens(value).size >= minimumWords;
}

function reviewAnswerQuality(conclusion, rationale, questionText) {
  if (!reviewTextIsSubstantive(conclusion, 20, 3)) {
    return { ok: false, reason: "requires a substantive conclusion" };
  }
  const normalizedConclusion = normalizeReviewText(conclusion);
  const normalizedQuestion = normalizeReviewText(questionText);
  if (!normalizedQuestion || normalizedConclusion === normalizedQuestion) {
    return { ok: false, reason: "conclusion must answer the question rather than repeat it" };
  }
  const conclusionTokens = reviewTextTokens(conclusion);
  const questionTokens = reviewTextTokens(questionText);
  const shared = [...questionTokens].filter((token) => conclusionTokens.has(token)).length;
  const novel = [...conclusionTokens].filter((token) => !questionTokens.has(token)).length;
  if (questionTokens.size > 0 && shared / questionTokens.size >= 0.7 && novel < 3) {
    return { ok: false, reason: "conclusion is too close to the canonical question" };
  }
  if (novel < 2) {
    return {
      ok: false,
      reason: "conclusion must contain a decision beyond the question wording",
    };
  }
  if (!reviewTextIsSubstantive(rationale, 28, 4)) {
    return { ok: false, reason: "requires a substantive rationale" };
  }
  const normalizedRationale = normalizeReviewText(rationale);
  if (normalizedRationale === normalizedQuestion || normalizedRationale === normalizedConclusion) {
    return {
      ok: false,
      reason: "rationale must explain rather than repeat the prompt or conclusion",
    };
  }
  const rationaleTokens = reviewTextTokens(rationale);
  const rationaleNovel = [...rationaleTokens].filter((token) => !questionTokens.has(token)).length;
  if (rationaleNovel < 3) {
    return { ok: false, reason: "rationale must add concrete reasons beyond the question" };
  }
  return { ok: true, reason: "contains a distinct conclusion and rationale" };
}

function reviewEvidenceRelevanceQuality(relevance, conclusion, rationale, questionText) {
  if (!reviewTextIsSubstantive(relevance, 20, 4)) {
    return { ok: false, reason: "requires a substantive relevance explanation" };
  }
  const relevanceTokens = reviewTextTokens(relevance, EVIDENCE_BOILERPLATE);
  const answerTokens = new Set([
    ...reviewTextTokens(conclusion, EVIDENCE_BOILERPLATE),
    ...reviewTextTokens(rationale, EVIDENCE_BOILERPLATE),
    ...reviewTextTokens(questionText, EVIDENCE_BOILERPLATE),
  ]);
  if (relevanceTokens.size < 2 || ![...relevanceTokens].some((token) => answerTokens.has(token))) {
    return {
      ok: false,
      reason: "must explain how this evidence bears on this specific answer",
    };
  }
  return { ok: true, reason: "connects the evidence to the answer" };
}

function reviewFindingQuality(finding, conclusion, rationale, questionText) {
  if (!reviewTextIsSubstantive(finding, 20, 4)) {
    return { ok: false, reason: "requires a substantive finding" };
  }
  const normalizedFinding = normalizeReviewText(finding);
  if (
    normalizedFinding === normalizeReviewText(conclusion) ||
    normalizedFinding === normalizeReviewText(rationale) ||
    normalizedFinding === normalizeReviewText(questionText)
  ) {
    return { ok: false, reason: "must identify the gap rather than copy the answer or question" };
  }
  const comparisonTokens = new Set([
    ...reviewTextTokens(conclusion),
    ...reviewTextTokens(rationale),
    ...reviewTextTokens(questionText),
  ]);
  const novel = [...reviewTextTokens(finding)].filter((token) => !comparisonTokens.has(token));
  if (novel.length < 2) {
    return { ok: false, reason: "must identify a concrete finding beyond the answer wording" };
  }
  return { ok: true, reason: "identifies a concrete review finding" };
}

module.exports = {
  REVIEW_QUESTIONS,
  normalizeReviewText,
  questionTier,
  reviewAnswerQuality,
  reviewEvidenceRelevanceQuality,
  reviewFindingQuality,
  reviewQuestionForTier,
  reviewQuestionIdsForTier,
  reviewQuestionsForTier,
  reviewTextIsSubstantive,
  reviewTextTokens,
};
