#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const os = require("node:os");
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

function verifyManagerIdentity(plan, options) {
  if (typeof options.verifyManager === "function") return options.verifyManager(plan.adapter);
  const manager = plan.adapter?.manager;
  const pinnedPath = plan.adapter?.manager_environment?.PATH;
  if (
    plan.adapter?.hook_contract?.kind !== "direct-manager-pre-push-v1" ||
    !manager?.realpath ||
    !manager?.sha256 ||
    !manager?.version ||
    typeof pinnedPath !== "string" ||
    !pinnedPath
  )
    return false;
  let verificationRoot = null;
  try {
    const stat = fs.lstatSync(manager.path);
    const realpath = fs.realpathSync(manager.path);
    const sha256 = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(realpath)).digest("hex")}`;
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpath !== manager.realpath ||
      sha256 !== manager.sha256
    )
      return false;
    verificationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-manager-verify-"));
    const version = (options.managerSpawnSync || childProcess.spawnSync)(realpath, ["version"], {
      cwd: verificationRoot,
      env: { PATH: pinnedPath },
      encoding: "utf8",
      shell: false,
      timeout: 2000,
      maxBuffer: 8192,
    });
    return version.status === 0 && String(version.stdout || "").trim() === manager.version;
  } catch {
    return false;
  } finally {
    if (verificationRoot) fs.rmSync(verificationRoot, { recursive: true, force: true });
  }
}

function executionEnvironment(source, pinnedPath) {
  const environment = {};
  for (const [name, value] of Object.entries(source || {})) {
    if (
      /^LEFTHOOK(?:_|$)/.test(name) ||
      name === "SKIP_CODEX_REVIEW" ||
      /^PM_REPOSITORY_(?:RECEIPT|IDENTITY)_KEY$/.test(name)
    )
      continue;
    environment[name] = value;
  }
  environment.PATH = pinnedPath;
  return environment;
}

function validatePlannedRefUpdate(plan, options) {
  const stdin = String(plan.remote?.stdin || "");
  const lines = stdin.endsWith("\n") ? stdin.slice(0, -1).split("\n") : [stdin];
  validateGitPushInputs(plan.remote?.name, plan.remote?.url, lines);
  if (
    lines.length !== 1 ||
    !plan.source_ref ||
    !plan.head_commit ||
    typeof plan.source_ref !== "string"
  )
    throw new Error("optimized delivery requires one planned branch update");
  const [localRef, localSha, remoteRef, remoteSha] = lines[0].split(" ");
  if (
    localRef !== plan.source_ref ||
    remoteRef !== plan.source_ref ||
    localSha !== plan.head_commit ||
    remoteSha === localSha
  )
    throw new Error("Git ref update does not match the planned branch head");
  const liveHead =
    typeof options.resolveHead === "function"
      ? options.resolveHead(plan.repository_root)
      : childProcess
          .spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
            cwd: plan.repository_root,
            encoding: "utf8",
            shell: false,
            timeout: 2000,
            maxBuffer: 8192,
          })
          .stdout?.trim();
  if (liveHead !== plan.head_commit) throw new Error("live HEAD differs from the planned push");
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
  if (!verifyManagerIdentity(plan, options))
    return fallback(options, "manager-identity-or-hook-contract-unsupported");
  try {
    validatePlannedRefUpdate(plan, options);
  } catch (error) {
    return {
      status: "blocked",
      reason: "invalid-git-push-input",
      diagnostic: redactText(error.message),
    };
  }
  const args = ["run", "pre-push"];
  for (const command of commands) args.push("--command", command);
  args.push(plan.remote?.name || "", plan.remote?.url || "");
  const executionEnv = executionEnvironment(
    options.env || process.env,
    plan.adapter.manager_environment.PATH
  );
  const result = (options.spawnSync || childProcess.spawnSync)(
    plan.adapter.manager.realpath,
    args,
    {
      cwd: plan.repository_root,
      env: executionEnv,
      input: plan.remote?.stdin || "",
      encoding: "utf8",
      shell: false,
      timeout: options.timeout || 60 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    }
  );
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
  const receiptKey = process.env.PM_REPOSITORY_RECEIPT_KEY;
  if (!receiptKey) throw new Error("PM_REPOSITORY_RECEIPT_KEY is required for optimized execution");
  const result = runRepositoryGates(plan, mode, {
    expectedPlanDigest,
    expectedCapabilityIdentity,
    capabilityDiscovery: discoveryOptions(receipt, {
      receiptKey,
      expectedProtectedCommit: plan.base_commit,
      expectedDefaultRef: plan.expected_default_ref,
    }),
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
