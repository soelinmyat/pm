#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { verifyPlanDigest } = require("./repository-delivery-plan");
const { verifyEnvironment } = require("./repository-environment-preflight");

function fallback(options, reason) {
  if (typeof options.comprehensivePush === "function") return options.comprehensivePush(reason);
  return { status: "comprehensive", reason };
}

function runRepositoryGates(plan, mode, options = {}) {
  const verifyDigest = options.verifyDigest || verifyPlanDigest;
  if (!verifyDigest(plan)) return { status: "blocked", reason: "plan-digest-mismatch" };
  const preflight = (options.preflight || verifyEnvironment)(plan, {
    requireIdentity: plan.environment_identity || undefined,
  });
  if (preflight.status === "blocked")
    return { status: "blocked", reason: "environment-preflight", issues: preflight.issues };
  if (plan.adapter?.supported === false || !plan.hook)
    return fallback(options, "unsupported-or-unclear-hook-contract");
  if (mode === "targeted" && plan.candidate_push?.permitted !== true)
    return fallback(options, "candidate-push-not-authorized");
  const commands = mode === "complete" ? plan.complete_commands : plan.targeted_commands;
  if (!Array.isArray(commands) || commands.length === 0)
    return fallback(options, "empty-command-selection");
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
  if (result.error || result.status !== 0)
    return {
      status: "failed",
      exit_code: result.status ?? 1,
      stderr: String(result.stderr || result.error?.message || "").slice(0, 8192),
    };
  return { status: "passed", exit_code: 0, commands, preflight_identity: preflight.identity };
}

function main(argv = process.argv.slice(2)) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const planPath = value("--plan"),
    mode = value("--mode");
  if (!planPath || !["targeted", "complete"].includes(mode))
    throw new Error("--plan PATH and --mode targeted|complete are required");
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8"));
  const result = runRepositoryGates(plan, mode);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!["passed", "comprehensive"].includes(result.status)) process.exitCode = 1;
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { runRepositoryGates };
