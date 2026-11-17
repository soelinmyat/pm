"use strict";

const { sign, verify, createPublicKey } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { CORRECTABLE_ENUMS, findingEnums } = require("./design-review-schema");
const { canonicalJson, resultSha256 } = require("./design-critique-review-result");
const { compareRfc3339DateTimes, isRfc3339DateTime } = require("./iso-time");

function correctionFields(raw, perspective, inspect) {
  if (!Array.isArray(raw?.findings)) return [];
  const projection = structuredClone(raw);
  const fields = [];
  const enums = findingEnums(perspective);
  for (const [index, finding] of raw.findings.entries()) {
    for (const field of CORRECTABLE_ENUMS) {
      const value = finding?.[field];
      // Only an invalid, present enum string admits repair. Missing, ill-typed
      // and substantive fields remain invalid, even alongside an enum error.
      if (typeof value === "string" && value.trim() && !enums[field].includes(value)) {
        fields.push({ index, field });
        projection.findings[index][field] = enums[field][0];
      }
    }
  }
  // This projected value only isolates the error class. It is never returned
  // as review evidence, signed, or sent to the reviewer.
  return fields.length && inspect(projection).issues.length === 0 ? fields : [];
}

function checkCorrection(original, corrected, perspective, inspect) {
  const fields = correctionFields(original, perspective, inspect);
  if (!fields.length) throw new Error("original result has non-correctable errors");
  const normalized = inspect(corrected);
  if (normalized.issues.length) throw new Error("corrected nested result is invalid");
  const restored = structuredClone(corrected);
  for (const { index, field } of fields) {
    if (!restored.findings[index]) throw new Error("correction dropped a finding");
    restored.findings[index][field] = original.findings[index][field];
  }
  if (!isDeepStrictEqual(restored, original))
    throw new Error("correction changed fields outside the invalid enums");
  return normalized.result;
}

function signObservation(body, key) {
  return { body, signature: sign(null, Buffer.from(canonicalJson(body)), key).toString("base64") };
}

function verifyObservation(observation, key) {
  if (
    !observation?.body ||
    typeof observation.signature !== "string" ||
    !verify(
      null,
      Buffer.from(canonicalJson(observation.body)),
      key,
      Buffer.from(observation.signature, "base64")
    )
  )
    throw new Error("invalid controller signature on design review observation");
  return observation.body;
}

function checkCorrectionProof(proof, { review, inspect, commit }) {
  if (proof?.schema_version !== 1 || typeof proof.controller_key !== "string")
    throw new Error("invalid correction proof version or controller key");
  const key = createPublicKey({
    key: Buffer.from(proof.controller_key, "base64"),
    type: "spki",
    format: "der",
  });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("unsupported controller key");
  const first = verifyObservation(proof.original, key);
  const next = verifyObservation(proof.corrected, key);
  const execution = review.execution;
  if (
    first.attempt !== 1 ||
    next.attempt !== 2 ||
    next.original_sha256 !== resultSha256(proof.original) ||
    !isDeepStrictEqual(first.scope, next.scope) ||
    first.scope.commit !== commit ||
    first.scope.provider !== "codex" ||
    typeof first.scope.execution_directory !== "string" ||
    first.scope.sandbox !== "read-only" ||
    first.scope.approval_policy !== "never" ||
    first.scope.external_effects !== false ||
    !Array.isArray(first.scope.owns) ||
    first.scope.owns.length !== 1 ||
    first.scope.review_id !== review.review_id ||
    first.scope.perspective !== review.perspective ||
    first.scope.input_payload_sha256 !== review.input.payload_sha256 ||
    first.scope.prompt_sha256 !== review.input.prompt_sha256 ||
    first.context_id !== next.context_id ||
    next.context_id !== execution.context_id ||
    first.invocation_id === next.invocation_id ||
    next.invocation_id !== execution.invocation_id ||
    next.started_at !== execution.started_at ||
    next.completed_at !== execution.completed_at ||
    ![first.started_at, first.completed_at, next.started_at, next.completed_at].every(
      isRfc3339DateTime
    ) ||
    compareRfc3339DateTimes(first.started_at, first.completed_at) > 0 ||
    compareRfc3339DateTimes(first.completed_at, next.started_at) >= 0 ||
    compareRfc3339DateTimes(next.started_at, next.completed_at) > 0 ||
    next.scope.provider !== execution.runtime.provider ||
    next.scope.model !== execution.runtime.model ||
    next.scope.effort !== execution.runtime.reasoning
  )
    throw new Error(
      "correction execution does not preserve the original bound reviewer scope and chronology"
    );
  const result = checkCorrection(first.result, next.result, review.perspective, inspect);
  if (!isDeepStrictEqual(result, review.result))
    throw new Error("correction proof does not match the selected review result");
}

module.exports = { checkCorrection, checkCorrectionProof, correctionFields, signObservation };
