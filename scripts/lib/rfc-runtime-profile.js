"use strict";

const profiles = require("../../skills/rfc/references/model-profiles.json");
const { resolveModelProfile } = require("./workflow-runtime/model-profile");
const { selectExecutionProfile } = require("./execution-policy");

function resolveRfcProfile(options = {}) {
  const provider = options.runtime || "inline";
  if (!Object.prototype.hasOwnProperty.call(profiles.defaults, provider)) {
    throw new Error(`unknown RFC runtime: ${provider}`);
  }
  let profile;
  try {
    const policy =
      !options.profile && (options.sourceDir || options.env?.PM_EXECUTION_POLICY_FILE)
        ? selectExecutionProfile({
            data: profiles,
            provider,
            workflow: "rfc",
            sourceDir: options.sourceDir,
            env: options.env,
          })
        : null;
    profile = resolveModelProfile({
      data: profiles,
      provider,
      profileName: options.profile || policy?.profileName,
      overrides: {
        ...(policy ? { effort: policy.effort } : {}),
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
