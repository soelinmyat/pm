#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { assertCanonicalEngineArgs } = require("./loop-config.js");

const CODEX_SANDBOXES = new Set(["read-only", "workspace-write", "danger-full-access"]);

function uniqueExistingDirs(values) {
  const seen = new Set();
  const dirs = [];
  for (const value of values) {
    if (!value || typeof value !== "string") continue;
    const resolved = path.resolve(value);
    if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
    seen.add(resolved);
    dirs.push(resolved);
  }
  return dirs;
}

function codexSandbox(worker = {}) {
  const requested = String(worker.codex_sandbox || "workspace-write");
  if (!CODEX_SANDBOXES.has(requested)) {
    throw new Error(`unsupported worker.codex_sandbox: ${JSON.stringify(requested)}`);
  }
  return requested;
}

function codexWritableDirs(worker = {}, context = {}) {
  const configured = Array.isArray(worker.codex_add_dirs) ? worker.codex_add_dirs : [];
  // PM content/state roots are deliberately absent. The engine receives copied
  // read context in its disposable worktree and one private result capability.
  return uniqueExistingDirs([...configured, context.resultDir]);
}

function engineCommand(config, prompt, context = {}) {
  const worker = config.worker || {};
  const extraArgs = Array.isArray(worker.engine_args) ? worker.engine_args : [];
  assertCanonicalEngineArgs(extraArgs);
  if (worker.engine_bin) {
    return { bin: worker.engine_bin, args: extraArgs, input: prompt };
  }
  const kind = worker.engine || config.default_runtime || "codex";
  if (kind === "claude") {
    const permissionMode = worker.claude_permission_mode || "acceptEdits";
    return {
      bin: "claude",
      args: ["-p", "--permission-mode", permissionMode, "--no-session-persistence", ...extraArgs],
      input: prompt,
    };
  }
  const args = ["exec", "--sandbox", codexSandbox(worker), "--skip-git-repo-check"];
  for (const dir of codexWritableDirs(worker, context)) {
    args.push("--add-dir", dir);
  }
  args.push(...extraArgs, "-");
  return { bin: "codex", args, input: prompt };
}

function canonicalEngineCommand(config, recorded = null, context = {}) {
  const command = recorded || engineCommand(config, "PM loop engine identity");
  const normalized = { bin: command.bin, args: [...(command.args || [])] };
  const worker = config.worker || {};
  const kind = worker.engine || config.default_runtime || "codex";
  if (worker.engine_bin || kind === "claude") return normalized;
  if (context.resultDir) {
    for (let index = 0; index < normalized.args.length - 1; index += 1) {
      if (
        normalized.args[index] === "--add-dir" &&
        path.resolve(normalized.args[index + 1]) === path.resolve(context.resultDir)
      ) {
        normalized.args[index + 1] = "<PM_LOOP_RESULT_DIR>";
        return normalized;
      }
    }
  }
  const inputIndex = normalized.args.lastIndexOf("-");
  normalized.args.splice(
    inputIndex < 0 ? normalized.args.length : inputIndex,
    0,
    "--add-dir",
    "<PM_LOOP_RESULT_DIR>"
  );
  return normalized;
}

module.exports = {
  canonicalEngineCommand,
  codexSandbox,
  codexWritableDirs,
  engineCommand,
};
