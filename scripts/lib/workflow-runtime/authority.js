"use strict";

function grantActions(input) {
  if (!input || typeof input !== "object") throw new TypeError("authority grant is required");
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new TypeError("authority grant requires at least one action");
  }
  if (!(input.allowedActions instanceof Set)) {
    throw new TypeError("authority grant requires an action allowlist");
  }
  const actions = [...new Set(input.actions)];
  for (const action of actions) {
    if (!input.allowedActions.has(action)) {
      const message = input.notGrantableMessage
        ? input.notGrantableMessage(action)
        : `authority action is not grantable: ${action}`;
      throw new Error(message);
    }
  }
  if (typeof input.reason !== "string" || !input.reason.trim()) {
    throw new TypeError("authority grant requires a non-empty reason");
  }
  if (!input.authority || typeof input.authority !== "object" || Array.isArray(input.authority)) {
    throw new TypeError("authority envelope must be an object");
  }
  if (!Array.isArray(input.log)) throw new TypeError("authority log must be an array");

  const authority = structuredClone(input.authority);
  for (const action of actions) {
    if (!Object.prototype.hasOwnProperty.call(authority, action)) {
      throw new Error(`authority envelope does not declare action: ${action}`);
    }
    authority[action] = true;
  }
  const canonicalEntry = {
    actions,
    reason: input.reason.trim(),
    granted_at: input.timestamp || new Date().toISOString(),
  };
  const entry = input.entryBuilder ? input.entryBuilder(canonicalEntry) : canonicalEntry;
  return { authority, entry, log: [...structuredClone(input.log), entry] };
}

module.exports = { grantActions };
