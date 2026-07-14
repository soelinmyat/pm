"use strict";

function resolveModelProfile(input) {
  if (!input?.data || typeof input.data !== "object") {
    throw new TypeError("model profile data is required");
  }
  const selected = input.profileName ?? input.data.defaults?.[input.provider];
  if (!selected) throw new Error(`unknown runtime: ${String(input.provider)}`);
  const base = input.data.profiles?.[selected];
  if (!base || base.provider !== input.provider) {
    throw new Error(`unknown ${input.provider} model profile: ${selected}`);
  }
  return { name: selected, ...structuredClone(base), ...(input.overrides || {}) };
}

module.exports = { resolveModelProfile };
