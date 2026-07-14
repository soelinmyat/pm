"use strict";

const { resolveModelProfile } = require("./workflow-runtime/model-profile");

const PROFILES = Object.freeze({
  schema_version: 1,
  defaults: { codex: "gpt-5.6-sol-high", claude: "claude-opus-4-8-xhigh", inline: "inherit" },
  profiles: {
    "gpt-5.6-sol-high": {
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      mode: "workspace-write",
    },
    "claude-opus-4-8-xhigh": {
      provider: "claude",
      model: "claude-opus-4-8",
      effort: "xhigh",
      mode: "auto",
    },
    inherit: { provider: "inline", model: "inherit", effort: "inherit", mode: "inherit" },
  },
});

function resolveGroomProfile(options = {}) {
  const provider = options.runtime || "inline";
  let profile;
  try {
    profile = resolveModelProfile({
      data: PROFILES,
      provider,
      profileName: options.profile,
      overrides: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoning ? { effort: options.reasoning } : {}),
      },
    });
  } catch (error) {
    if (/model profile/.test(error.message))
      throw new Error(`unknown ${provider} Groom profile: ${options.profile}`);
    throw new Error(`unknown Groom runtime: ${provider}`);
  }
  return {
    profile: profile.name,
    runtime: provider,
    model: profile.model,
    reasoning: profile.effort,
    mode: profile.mode,
  };
}

module.exports = { PROFILES, resolveGroomProfile };
