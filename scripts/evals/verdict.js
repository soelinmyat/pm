"use strict";

const HIGH_PRECEDENCE_REASONS = new Set([
  "unsafe",
  "artifact-boundary",
  "transcript-boundary",
  "network-policy",
  "resource-limit",
  "wrong-source",
  "mutated-source",
  "mutated-scenario",
]);

function composeVerdict(input) {
  const hazards = input.hazards || [];
  const high = hazards.find((hazard) => HIGH_PRECEDENCE_REASONS.has(hazard.reason));
  if (high) return verdict(input, "indeterminate", high.reason);

  const records = [...(input.preRecords || []), ...(input.postRecords || [])];
  const uncertain = records.find((record) => record.status === "indeterminate");
  if (uncertain)
    return verdict(input, "indeterminate", uncertain.reason || "harness-record-missing");

  if (
    (input.preExecuted || input.preRecords) &&
    (!input.preRecords || input.preRecords.length === 0)
  ) {
    return verdict(input, "indeterminate", "harness-record-missing");
  }
  if (
    (input.postExecuted || input.postRecords) &&
    (!input.postRecords || input.postRecords.length === 0)
  ) {
    return verdict(input, "indeterminate", "harness-record-missing");
  }

  const failedPre = (input.preRecords || []).find((record) => record.status === "fail");
  if (failedPre) return verdict(input, "indeterminate", "pre-check-failed");

  const failed = (input.postRecords || []).find((record) => record.status === "fail");
  if (failed) return verdict(input, "fail", failed.reason || "post-check-failed");

  return verdict(input, "pass", "checks passed");
}

function verdict(input, status, reason) {
  const now = new Date().toISOString();
  return {
    scenario: input.scenario,
    agent: input.agent,
    status,
    reason,
    run_id: input.runId,
    source_identity: "metadata/source_identity.json",
    scenario_identity: "metadata/scenario_identity.json",
    artifact_ref: `runs/${input.runId}`,
    started_at: input.startedAt || now,
    ended_at: input.endedAt || now,
  };
}

module.exports = { composeVerdict, HIGH_PRECEDENCE_REASONS };
