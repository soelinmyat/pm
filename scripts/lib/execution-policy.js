"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeJsonAtomic } = require("./atomic-file");

const WORKFLOWS = new Set(["dev", "groom", "rfc", "review"]);
const PROVIDERS = new Set(["codex", "claude"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
}

function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`unknown ${label} field: ${key}`);
}

function selections(value, label) {
  keys(value, PROVIDERS, label);
  for (const [provider, selection] of Object.entries(value)) {
    keys(selection, new Set(["model", "effort"]), `${label}.${provider}`);
    if (typeof selection.model !== "string" || !/^[a-z0-9][a-z0-9._-]{1,99}$/.test(selection.model))
      throw new Error(`${label}.${provider}.model must name an exact model`);
    if (!EFFORTS.has(selection.effort))
      throw new Error(`${label}.${provider}.effort must be a supported reasoning level`);
  }
}

function validateExecutionPolicy(value) {
  keys(value, new Set(["schema_version", "defaults", "workflows"]), "execution policy");
  if (value.schema_version !== 1) throw new Error("execution policy schema_version must equal 1");
  selections(value.defaults, "defaults");
  keys(value.workflows, WORKFLOWS, "workflows");
  for (const [workflow, selection] of Object.entries(value.workflows))
    selections(selection, `workflows.${workflow}`);
  return value;
}

function userPolicyPath(env = process.env) {
  return path.join(
    env.XDG_CONFIG_HOME || path.join(env.HOME || os.homedir(), ".config"),
    "pm",
    "execution-policy.json"
  );
}

function readPolicy(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384)
    throw new Error(`execution policy must be a regular file of at most 16384 bytes: ${file}`);
  const bytes = fs.readFileSync(file);
  return {
    value: validateExecutionPolicy(JSON.parse(bytes)),
    path: file,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function selectExecutionProfile({ data, provider, workflow, sourceDir, env = process.env }) {
  if (provider === "inline") return null;
  if (!WORKFLOWS.has(workflow)) throw new Error(`unknown execution workflow: ${workflow}`);
  if (!PROVIDERS.has(provider)) throw new Error(`unknown execution provider: ${provider}`);
  // Explicit files fail closed. Project policy replaces user policy for each provider;
  // an absent project entry still inherits the user's selection.
  const files = env.PM_EXECUTION_POLICY_FILE
    ? [path.resolve(env.PM_EXECUTION_POLICY_FILE)]
    : [
        userPolicyPath(env),
        ...(sourceDir ? [path.join(path.resolve(sourceDir), ".pm", "execution-policy.json")] : []),
      ];
  let selected = null;
  for (const file of files) {
    const policy = readPolicy(file);
    if (!policy && env.PM_EXECUTION_POLICY_FILE)
      throw new Error(`execution policy not found: ${file}`);
    if (!policy) continue;
    const selection =
      policy.value.workflows[workflow]?.[provider] || policy.value.defaults[provider];
    if (selection)
      selected = {
        ...selection,
        scope: policy.value.workflows[workflow]?.[provider] ? "workflow" : "default",
        path: policy.path,
        sha256: policy.sha256,
      };
  }
  if (!selected) return null;
  const entry = Object.entries(data.profiles || {}).find(
    ([, profile]) => profile.provider === provider && profile.model === selected.model
  );
  if (!entry)
    throw new Error(
      `execution policy selects unsupported ${provider} model ${selected.model} for ${workflow}`
    );
  return {
    profileName: entry[0],
    effort: selected.effort,
    scope: selected.scope,
    path: selected.path,
    sha256: selected.sha256,
  };
}

function saveExecutionPolicy(file, value) {
  validateExecutionPolicy(value);
  try {
    if (!fs.lstatSync(file).isFile())
      throw new Error("execution policy destination must be a regular file");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  writeJsonAtomic(file, value, { directoryMode: 0o700, fileMode: 0o600 });
}

module.exports = {
  selectExecutionProfile,
  validateExecutionPolicy,
  saveExecutionPolicy,
  userPolicyPath,
};
