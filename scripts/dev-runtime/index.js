const path = require("node:path");
const profiles = require("../../skills/dev/references/model-profiles.json");
const { buildCodexLaunch, extractCodexResult } = require("./codex");
const { buildClaudeLaunch, extractClaudeResult } = require("./claude");
const { buildInlinePackage } = require("./inline");
const { requireCapabilities } = require("./capabilities");
const { validateWorkerResult } = require("./result");
const { resolveModelProfile } = require("../lib/workflow-runtime/model-profile");

const BROAD = {
  codex: new Set(["danger-full-access"]),
  claude: new Set(["bypassPermissions"]),
};

function resolveProfile({ provider, profileName, overrides = {}, env = process.env }) {
  const environment = environmentOverrides(provider, env);
  const resolved = resolveModelProfile({
    data: profiles,
    provider,
    profileName,
    overrides: { ...environment, ...overrides },
  });
  delete resolved.allowBroadPermissions;
  const permission = provider === "codex" ? resolved.sandbox : resolved.permissionMode;
  if (BROAD[provider]?.has(permission) && !overrides.allowBroadPermissions) {
    throw new Error(`${provider} broad permission requires explicit allowBroadPermissions`);
  }
  return resolved;
}

function buildLaunch(request) {
  validateRequest(request);
  if (request.capabilities) {
    const required = ["structuredOutput", "eventStream", "safePermissions"];
    if (request.resumeId) required.push("resume");
    requireCapabilities(request.capabilities, required);
  }
  const profile = resolveProfile({
    provider: request.provider,
    profileName: request.profileName,
    overrides: request.profileOverrides,
    env: request.env,
  });
  if (request.provider === "codex") return buildCodexLaunch({ ...request, profile });
  if (request.provider === "claude") return buildClaudeLaunch({ ...request, profile });
  return buildInlinePackage({ ...request, profile });
}

function extractResult(request) {
  let extracted;
  if (request.provider === "codex") extracted = extractCodexResult(request);
  else if (request.provider === "claude") extracted = extractClaudeResult(request);
  else throw new Error("inline execution returns its result through the interactive runner");
  return { ...extracted, result: validateWorkerResult(extracted.result) };
}

function validateRequest(request) {
  if (!request || !["codex", "claude", "inline"].includes(request.provider)) {
    throw new Error("provider must be codex, claude, or inline");
  }
}

function defaultSchemaPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "skills",
    "dev",
    "references",
    "worker-result.schema.json"
  );
}

function environmentOverrides(provider, env) {
  const generic = {
    ...(env.PM_DEV_MODEL ? { model: env.PM_DEV_MODEL } : {}),
    ...(env.PM_DEV_EFFORT ? { effort: env.PM_DEV_EFFORT } : {}),
  };
  if (provider === "codex") {
    return {
      ...generic,
      ...(env.PM_DEV_CODEX_MODEL ? { model: env.PM_DEV_CODEX_MODEL } : {}),
      ...(env.PM_DEV_CODEX_REASONING_EFFORT ? { effort: env.PM_DEV_CODEX_REASONING_EFFORT } : {}),
      ...(env.PM_DEV_CODEX_SANDBOX ? { sandbox: env.PM_DEV_CODEX_SANDBOX } : {}),
    };
  }
  if (provider === "claude") {
    return {
      ...generic,
      ...(env.PM_DEV_CLAUDE_MODEL ? { model: env.PM_DEV_CLAUDE_MODEL } : {}),
      ...(env.PM_DEV_CLAUDE_EFFORT ? { effort: env.PM_DEV_CLAUDE_EFFORT } : {}),
      ...(env.PM_DEV_CLAUDE_PERMISSION_MODE
        ? { permissionMode: env.PM_DEV_CLAUDE_PERMISSION_MODE }
        : {}),
    };
  }
  return generic;
}

module.exports = {
  buildLaunch,
  defaultSchemaPath,
  extractResult,
  resolveProfile,
  validateWorkerResult,
};
