#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const {
  verifyPlanDigest,
  validateGitPushInputs,
  readAuthenticatedJson,
  discoveryOptions,
} = require("./repository-delivery-plan");
const {
  verifyEnvironment,
  redactText,
  sanitizeDiagnosticValue,
} = require("./repository-environment-preflight");
const { stable } = require("./lib/repository-gate-plan-schema");
const { discoverRepositoryCapabilities } = require("./lib/repository-capabilities");

function fallback(options, reason) {
  if (typeof options.comprehensivePush !== "function")
    return {
      status: "blocked",
      exit_code: 1,
      reason: "comprehensive-executor-required",
      fallback_reason: reason,
    };
  const result = options.comprehensivePush(reason);
  if (!result || !["comprehensive", "passed"].includes(result.status) || result.exit_code > 0)
    return {
      status: "blocked",
      exit_code: result?.exit_code || 1,
      reason: "comprehensive-executor-failed",
      fallback_reason: reason,
    };
  return result;
}

function verifyHookIdentity(plan) {
  const expected = plan.hook_identity;
  if (!expected || !plan.hook || !expected.realpath || !expected.sha256) return false;
  try {
    const stat = fs.lstatSync(plan.hook);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) return false;
    const realpath = fs.realpathSync(plan.hook);
    const sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(realpath)).digest("hex")}`;
    return realpath === expected.realpath && sha256 === expected.sha256;
  } catch {
    return false;
  }
}

function runRepositoryGates(plan, mode, options = {}) {
  if (!["targeted", "complete"].includes(mode))
    return { status: "blocked", reason: "invalid-gate-mode" };
  const verifyDigest = options.verifyDigest || verifyPlanDigest;
  if (!verifyDigest(plan)) return { status: "blocked", reason: "plan-digest-mismatch" };
  if (!options.expectedPlanDigest || options.expectedPlanDigest !== plan.plan_digest)
    return { status: "blocked", reason: "expected-plan-digest-mismatch" };
  if (
    !options.expectedCapabilityIdentity ||
    options.expectedCapabilityIdentity !== plan.capability_identity
  )
    return { status: "blocked", reason: "expected-capability-identity-mismatch" };
  if (plan.adapter?.supported === false || !plan.hook)
    return fallback(options, "unsupported-or-unclear-hook-contract");
  if (mode === "targeted" && plan.candidate_push?.permitted !== true)
    return fallback(options, "candidate-push-not-authorized");
  const commands = mode === "complete" ? plan.complete_commands : plan.targeted_commands;
  if (!Array.isArray(commands) || commands.length === 0)
    return fallback(options, "empty-command-selection");
  const liveCapabilities = (options.discoverCapabilities || discoverRepositoryCapabilities)(
    plan.repository_root,
    options.capabilityDiscovery || {}
  );
  if (!liveCapabilities || liveCapabilities.identity !== options.expectedCapabilityIdentity)
    return { status: "blocked", reason: "live-capability-identity-mismatch" };
  const preflight = (options.preflight || verifyEnvironment)(plan, {
    requireIdentity: plan.environment_identity || undefined,
    identityKey: options.identityKey || (options.env || process.env).PM_REPOSITORY_IDENTITY_KEY,
    env: options.env || process.env,
  });
  if (preflight.status !== "verified")
    return sanitizeDiagnosticValue({
      status: "blocked",
      reason: "environment-preflight",
      issues: preflight.issues,
    });
  if (
    JSON.stringify(stable(preflight.identity)) !== JSON.stringify(stable(plan.environment_identity))
  )
    return { status: "blocked", reason: "environment-identity-mismatch" };
  if (!verifyHookIdentity(plan)) return { status: "blocked", reason: "hook-identity-mismatch" };
  try {
    validateGitPushInputs(
      plan.remote?.name,
      plan.remote?.url,
      String(plan.remote?.stdin || "").endsWith("\n")
        ? String(plan.remote.stdin).slice(0, -1).split("\n")
        : [String(plan.remote?.stdin || "")]
    );
  } catch (error) {
    return {
      status: "blocked",
      reason: "invalid-git-push-input",
      diagnostic: redactText(error.message),
    };
  }
  const args = [plan.remote?.name || "", plan.remote?.url || ""];
  for (const command of commands) args.push("--command", command);
  const result = (options.spawnSync || childProcess.spawnSync)(plan.hook, args, {
    cwd: plan.repository_root,
    env: options.env || process.env,
    input: plan.remote?.stdin || "",
    encoding: "utf8",
    shell: false,
    timeout: options.timeout || 60 * 60 * 1000,
    maxBuffer: 1024 * 1024,
  });
  if (!result || result.error || result.status !== 0)
    return {
      status: "failed",
      exit_code: result.status ?? 1,
      stderr: redactText(result?.stderr || result?.error?.message || "hook execution failed"),
    };
  return { status: "passed", exit_code: 0, commands, preflight_identity: preflight.identity };
}

function main(argv = process.argv.slice(2)) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const planPath = value("--plan"),
    mode = value("--mode"),
    expectedPlanDigest = value("--expected-plan-digest"),
    expectedCapabilityIdentity = value("--expected-capability-identity"),
    discoveryReceiptPath = value("--discovery-receipt"),
    discoveryReceiptSha256 = value("--discovery-receipt-sha256");
  if (
    !planPath ||
    !["targeted", "complete"].includes(mode) ||
    !expectedPlanDigest ||
    !expectedCapabilityIdentity ||
    !discoveryReceiptPath ||
    !discoveryReceiptSha256
  )
    throw new Error(
      "--plan PATH, --mode targeted|complete, --expected-plan-digest, --expected-capability-identity, and authenticated --discovery-receipt are required"
    );
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8"));
  const receipt = readAuthenticatedJson(discoveryReceiptPath, discoveryReceiptSha256);
  const result = runRepositoryGates(plan, mode, {
    expectedPlanDigest,
    expectedCapabilityIdentity,
    capabilityDiscovery: discoveryOptions(receipt),
  });
  process.stdout.write(`${JSON.stringify(sanitizeDiagnosticValue(result), null, 2)}\n`);
  if (!["passed", "comprehensive"].includes(result.status)) process.exitCode = 1;
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${redactText(error.message)}\n`);
    process.exitCode = 1;
  }
}
module.exports = { runRepositoryGates };
