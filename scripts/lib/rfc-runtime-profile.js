"use strict";

const profiles = require("../../skills/rfc/references/model-profiles.json");

function resolveRfcProfile(options = {}) {
  const provider = options.runtime || "inline";
  if (!Object.prototype.hasOwnProperty.call(profiles.defaults, provider)) {
    throw new Error(`unknown RFC runtime: ${provider}`);
  }
  const profileName = options.profile || profiles.defaults[provider];
  const profile = profiles.profiles[profileName];
  if (!profile || profile.provider !== provider) {
    throw new Error(`unknown ${provider} RFC profile: ${profileName}`);
  }
  return {
    profile: profileName,
    runtime: provider,
    model: options.model || profile.model,
    reasoning: options.reasoning || profile.effort,
    mode: profile.mode,
  };
}

module.exports = { resolveRfcProfile };
