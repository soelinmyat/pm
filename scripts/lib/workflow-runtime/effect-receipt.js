"use strict";

const { isObject, stableStringify } = require("./records");

function bindEffectReceipt(input) {
  if (!isObject(input)) throw new TypeError("effect receipt input must be an object");
  if (typeof input.effect !== "string" || !input.effect.trim()) {
    throw new TypeError("effect receipt requires an effect name");
  }
  if (!isObject(input.target) || !isObject(input.receipt) || !isObject(input.observation)) {
    throw new TypeError("effect receipt requires target, receipt, and observation objects");
  }
  if (!Array.isArray(input.authorityActions) || input.authorityActions.length === 0) {
    throw new TypeError("effect receipt requires authority actions");
  }
  if (!Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new TypeError("effect receipt attempt must be a positive integer");
  }
  if (stableStringify(input.target) !== stableStringify(input.observation.target)) {
    throw new Error("effect receipt target does not match the observation");
  }
  if (stableStringify(input.receipt) !== stableStringify(input.observation.receipt)) {
    throw new Error("effect receipt result does not match the observation");
  }
  return {
    schema_version: 1,
    effect: input.effect.trim(),
    target: structuredClone(input.target),
    authority: { actions: [...new Set(input.authorityActions)] },
    attempt: input.attempt,
    receipt: structuredClone(input.receipt),
    verification: {
      observed_at: input.observedAt || new Date().toISOString(),
      target: structuredClone(input.observation.target),
      receipt: structuredClone(input.observation.receipt),
    },
  };
}

module.exports = { bindEffectReceipt };
