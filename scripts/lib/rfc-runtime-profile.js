"use strict";

const profiles = require("../../skills/rfc/references/model-profiles.json");
const { resolveModelProfile } = require("./workflow-runtime/model-profile");

function resolveRfcProfile(options = {}) {
  const provider = options.runtime || "inline";
  if (!Object.prototype.hasOwnProperty.call(profiles.defaults, provider)) {
    throw new Error(`unknown RFC runtime: ${provider}`);
  }
  let profile;
  try {
    profile = resolveModelProfile({
      data: profiles,
      provider,
      profileName: options.profile,
      overrides: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoning ? { effort: options.reasoning } : {}),
      },
    });
  } catch (error) {
    if (/model profile/.test(error.message)) {
      throw new Error(`unknown ${provider} RFC profile: ${options.profile}`);
    }
    throw error;
  }
  return {
    profile: profile.name,
    runtime: provider,
    model: profile.model,
    reasoning: profile.effort,
    mode: profile.mode,
  };
}

module.exports = { resolveRfcProfile };
