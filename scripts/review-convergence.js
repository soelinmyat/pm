#!/usr/bin/env node
"use strict";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SOURCE = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const OUTCOMES = new Set(["pending", "passed", "blocking", "unavailable"]);

function clone(value) {
  return structuredClone(value);
}

function requireText(value, field, max = 1000) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

function requireTimestamp(value, field) {
  requireText(value, field, 64);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be RFC3339`);
  return value;
}

function requireHead(value) {
  if (!SHA.test(value || "")) throw new TypeError("head must be a 40-character lowercase SHA");
  return value;
}

function requireDigest(value, field = "requirementSetHash") {
  if (!DIGEST.test(value || "")) throw new TypeError(`${field} must be a sha256 digest`);
  return value;
}

function normalizeSources(values) {
  if (!Array.isArray(values) || values.length === 0)
    throw new TypeError("requiredSources must be a non-empty array");
  const sources = [...new Set(values.map((value) => requireText(value, "source", 128)))].sort();
  if (sources.some((source) => !SOURCE.test(source)))
    throw new TypeError(
      "source names must contain only letters, numbers, dot, colon, underscore, or dash"
    );
  return sources;
}

function pendingSources(state) {
  return state.required_sources.filter((source) => state.sources[source]?.outcome !== "passed");
}

function unavailableSources(state) {
  return state.required_sources.filter(
    (source) => state.sources[source]?.outcome === "unavailable"
  );
}

function sourceMap(sources) {
  return Object.fromEntries(
    sources.map((source) => [source, { outcome: "pending", finding: null, recorded_at: null }])
  );
}

function createConvergence(input) {
  const head = requireHead(input?.head);
  const requirementSetHash = requireDigest(input?.requirementSetHash);
  const requiredSources = normalizeSources(input?.requiredSources);
  const now = requireTimestamp(input?.now, "now");
  const deadline = requireTimestamp(input?.deadline, "deadline");
  if (Date.parse(deadline) <= Date.parse(now)) throw new Error("deadline must be after now");
  return {
    schema_version: 1,
    status: "reviewing",
    head,
    requirement_set_hash: requirementSetHash,
    required_sources: requiredSources,
    sources: sourceMap(requiredSources),
    conversations: { checked: false, unresolved: null, recorded_at: null },
    deadline,
    awaiting_decision: null,
    requirement_revisions: [],
    head_mutations: [],
    created_at: now,
    updated_at: now,
  };
}

function assertHead(state, head) {
  requireHead(head);
  if (head !== state.head)
    throw new Error(`review head does not match convergence head ${state.head}`);
}

function recordReviewSource(current, input) {
  const state = clone(current);
  assertHead(state, input?.head);
  const source = requireText(input?.source, "source", 128);
  if (!state.required_sources.includes(source))
    throw new Error(`source is not required: ${source}`);
  if (!OUTCOMES.has(input?.outcome) || input.outcome === "pending")
    throw new Error("outcome must be passed, blocking, or unavailable");
  const at = requireTimestamp(input?.at, "at");
  const finding = input.outcome === "passed" ? null : requireText(input?.finding, "finding", 2000);
  state.sources[source] = { outcome: input.outcome, finding, recorded_at: at };
  state.status = input.outcome === "unavailable" ? "awaiting-decision" : "reviewing";
  state.awaiting_decision =
    input.outcome === "unavailable"
      ? { reason: finding, sources: unavailableSources(state), recorded_at: at }
      : unavailableSources(state).length
        ? {
            reason: "one or more required review sources remain unavailable",
            sources: unavailableSources(state),
            recorded_at: at,
          }
        : null;
  if (state.awaiting_decision) state.status = "awaiting-decision";
  state.updated_at = at;
  return state;
}

function recordConversationCheck(current, input) {
  const state = clone(current);
  assertHead(state, input?.head);
  if (!Number.isInteger(input?.unresolved) || input.unresolved < 0)
    throw new TypeError("unresolved must be a non-negative integer");
  const at = requireTimestamp(input?.at, "at");
  state.conversations = { checked: true, unresolved: input.unresolved, recorded_at: at };
  if (input.unresolved > 0 && unavailableSources(state).length === 0) state.status = "reviewing";
  state.updated_at = at;
  return state;
}

function evaluateConvergence(current, input) {
  const state = clone(current);
  const now = requireTimestamp(input?.now, "now");
  const pending = pendingSources(state);
  const unresolved = state.conversations.checked ? state.conversations.unresolved : null;
  if (pending.length === 0 && unresolved === 0) {
    state.status = "review-converged";
    state.awaiting_decision = null;
  } else if (unavailableSources(state).length > 0) {
    state.status = "awaiting-decision";
    state.awaiting_decision = {
      reason: "one or more required review sources remain unavailable",
      sources: unavailableSources(state),
      recorded_at: now,
    };
  } else if (
    Date.parse(now) >= Date.parse(state.deadline) &&
    (pending.length > 0 || !state.conversations.checked)
  ) {
    const timedOut = [...pending];
    if (!state.conversations.checked) timedOut.push("pr-conversations");
    state.status = "awaiting-decision";
    state.awaiting_decision = {
      reason: !state.conversations.checked
        ? `required review source or conversation check did not complete by deadline ${state.deadline}`
        : `required review sources did not complete by deadline ${state.deadline}`,
      sources: timedOut.sort(),
      recorded_at: now,
    };
  } else {
    state.status = "reviewing";
    state.awaiting_decision = null;
  }
  state.updated_at = now;
  return state;
}

function markHeadMutation(current, input) {
  const state = clone(current);
  const previousHead = state.head;
  const head = requireHead(input?.head);
  if (head === previousHead) throw new Error("head mutation requires a different head");
  const reason = requireText(input?.reason, "reason", 2000);
  const at = requireTimestamp(input?.at, "at");
  const deadline = requireTimestamp(input?.deadline, "deadline");
  if (Date.parse(deadline) <= Date.parse(at))
    throw new Error("deadline must be after mutation time");
  state.head = head;
  state.status = "reviewing";
  state.sources = sourceMap(state.required_sources);
  state.conversations = { checked: false, unresolved: null, recorded_at: null };
  state.deadline = deadline;
  state.awaiting_decision = null;
  state.head_mutations.push({ from: previousHead, to: head, reason, at });
  state.updated_at = at;
  return state;
}

function reviseRequirements(current, input) {
  if (current?.status !== "awaiting-decision")
    throw new Error("requirements may be revised only from awaiting-decision");
  const state = clone(current);
  const approver = requireText(input?.approver, "approver", 256);
  const reason = requireText(input?.reason, "reason", 2000);
  const requirementSetHash = requireDigest(input?.requirementSetHash);
  if (requirementSetHash === state.requirement_set_hash)
    throw new Error("requirement revision requires a new requirement-set hash");
  const requiredSources = normalizeSources(input?.requiredSources);
  const at = requireTimestamp(input?.at, "at");
  const deadline = requireTimestamp(input?.deadline, "deadline");
  if (Date.parse(deadline) <= Date.parse(at))
    throw new Error("deadline must be after revision time");
  state.requirement_revisions.push({
    approver,
    reason,
    previous_requirement_set_hash: state.requirement_set_hash,
    requirement_set_hash: requirementSetHash,
    required_sources: requiredSources,
    at,
  });
  state.requirement_set_hash = requirementSetHash;
  state.required_sources = requiredSources;
  state.sources = sourceMap(requiredSources);
  state.conversations = { checked: false, unresolved: null, recorded_at: null };
  state.deadline = deadline;
  state.awaiting_decision = null;
  state.status = "reviewing";
  state.updated_at = at;
  return state;
}

function selectPublicationRoute(input = {}) {
  if (
    input.comprehensive !== true &&
    process.env.PM_DELIVERY_COMPREHENSIVE !== "1" &&
    input.candidateRoute === true &&
    input.protectedPermission === true &&
    input.exactAdapterCoverage === true
  ) {
    return {
      route: "review-candidate",
      publish_draft: true,
      enter_finalization: true,
      reason: "protected candidate-publication permission and exact adapter coverage are current",
    };
  }
  return {
    route: "comprehensive",
    publish_draft: false,
    enter_finalization: false,
    reason: "select existing comprehensive Ship before candidate publication",
  };
}

module.exports = {
  createConvergence,
  evaluateConvergence,
  markHeadMutation,
  recordConversationCheck,
  recordReviewSource,
  reviseRequirements,
  selectPublicationRoute,
};
