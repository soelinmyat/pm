"use strict";

const { resolveModelProfile } = require("./workflow-runtime/model-profile");
const { selectExecutionProfile } = require("./execution-policy");

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
    "gpt-6-astra-high": {
      provider: "codex",
      model: "gpt-6-astra",
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
    const policy =
      !options.profile && (options.sourceDir || options.env?.PM_EXECUTION_POLICY_FILE)
        ? selectExecutionProfile({
            data: PROFILES,
            provider,
            workflow: "groom",
            sourceDir: options.sourceDir,
            env: options.env,
          })
        : null;
    profile = resolveModelProfile({
      data: PROFILES,
      provider,
      profileName: options.profile || policy?.profileName,
      overrides: {
        ...(policy ? { effort: policy.effort } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoning ? { effort: options.reasoning } : {}),
      },
    });
  } catch (error) {
    if (/model profile/.test(error.message))
      throw new Error(`unknown ${provider} Groom profile: ${options.profile}`);
    if (/unknown runtime/.test(error.message))
      throw new Error(`unknown Groom runtime: ${provider}`);
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

module.exports = { PROFILES, resolveGroomProfile };
