#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

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

function assertCanonicalEngineArgs(extraArgs) {
  for (const arg of extraArgs) {
    const text = String(arg);
    if (
      text === "--sandbox" ||
      text.startsWith("--sandbox=") ||
      text === "-s" ||
      text.startsWith("-s=")
    ) {
      throw new Error("worker.engine_args must not contain --sandbox; use worker.codex_sandbox");
    }
    if (text === "--add-dir" || text.startsWith("--add-dir=")) {
      throw new Error("worker.engine_args must not contain --add-dir; use worker.codex_add_dirs");
    }
  }
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

module.exports = {
  codexSandbox,
  codexWritableDirs,
  engineCommand,
};
