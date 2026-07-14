"use strict";

const crypto = require("node:crypto");

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashResult(result) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(result)).digest("hex")}`;
}

function appendTransition(history, input) {
  if (!Array.isArray(history)) throw new TypeError("transition history must be an array");
  const entry = {
    prior_phase: input.priorPhase,
    next_phase: input.nextPhase,
    reason: input.reason,
    result_hash: hashResult(input.result),
    timestamp: input.timestamp,
    runner_version: input.runnerVersion,
  };
  history.push(entry);
  return entry;
}

function currentEvidenceRecords(record, commit) {
  if (!isObject(record) || typeof commit !== "string" || !commit) return null;
  if (record.commit === commit) return Array.isArray(record.records) ? record.records : null;
  if (record.verified_commit === commit) {
    return Array.isArray(record.verification_records) ? record.verification_records : null;
  }
  return null;
}

function hasCurrentEvidence(record, commit, predicate = () => true) {
  const records = currentEvidenceRecords(record, commit);
  return Boolean(records?.some((item) => item?.exit_code === 0 && predicate(item)));
}

module.exports = {
  appendTransition,
  currentEvidenceRecords,
  hashResult,
  hasCurrentEvidence,
  isObject,
  stableStringify,
};
