"use strict";

const ASTRA_MODEL = "gpt-6-astra";
const ASTRA_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

function assertAstraProfileIntegrity(input) {
  const profileName = input?.profileName;
  const provider = input?.provider;
  const model = input?.model;
  const effort = input?.effort;
  const base = profileName ? input?.data?.profiles?.[profileName] : null;
  const baseIsAstra = base?.model === ASTRA_MODEL;
  const effectiveIsAstra = model === ASTRA_MODEL;
  const profileWasExplicit = input?.profileWasExplicit !== false && Boolean(profileName);

  if (!baseIsAstra && !effectiveIsAstra) return;
  if (effectiveIsAstra && (!baseIsAstra || base.provider !== provider || !profileWasExplicit)) {
    throw new Error(
      `${ASTRA_MODEL} requires an explicitly selected named base profile that selects ${ASTRA_MODEL}`
    );
  }
  if (baseIsAstra && (base.provider !== provider || !effectiveIsAstra)) {
    throw new Error(`${ASTRA_MODEL} base profiles cannot override model identity or provider`);
  }
  if (effectiveIsAstra && !ASTRA_EFFORTS.has(effort)) {
    throw new Error(`${ASTRA_MODEL} effort must be one of ${[...ASTRA_EFFORTS].join(", ")}`);
  }
}

function assertRuntimeMatchesAstraProfile({ data, execution, runtime }) {
  assertAstraProfileIntegrity({
    data,
    provider: runtime?.provider,
    profileName: execution?.profile,
    model: runtime?.model,
    effort: runtime?.reasoning,
    profileWasExplicit: true,
  });
}

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
  const overrides = input.overrides || {};
  const resolved = { name: selected, ...structuredClone(base), ...overrides };
  assertAstraProfileIntegrity({
    data: input.data,
    provider: input.provider,
    profileName: selected,
    model: resolved.model,
    effort: resolved.effort,
    profileWasExplicit: input.profileName !== undefined && input.profileName !== null,
  });
  return resolved;
}

module.exports = {
  ASTRA_EFFORTS,
  ASTRA_MODEL,
  assertAstraProfileIntegrity,
  assertRuntimeMatchesAstraProfile,
  resolveModelProfile,
};
