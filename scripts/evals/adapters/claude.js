"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { safeCopyTree } = require("../stage.js");
const {
  MARKER_ARTIFACT,
  assertUnderRunDir,
  buildStoryPrompt,
  copyAuthTemplate,
  enableWorkdirAnalytics,
  injectSourceMarker,
  resolveBin,
  sourceMarkerVerified,
  sourceSkipDirs,
  templateHasAuthMaterial,
  treeContains,
} = require("./shared.js");

const ADAPTER_TIMEOUT_MS = 600_000;
const OUTPUT_MAX_BUFFER = 16 * 1024 * 1024;

function preflight() {
  if (!liveEnabled()) return skipNetworkPolicy();
  if (!networkAcknowledged()) return skipNetworkPolicy();
  if (!resolveBin(process.env.PM_EVAL_CLAUDE_BIN, "claude")) return skip("claude-cli-missing");
  if (!hasAuthPath()) return skip("claude-auth-missing");
  return { status: "pass" };
}

function run({ scenarioId, paths }) {
  const ready = preflight();
  if (ready.status !== "pass") return ready;

  const claudeBin = resolveBin(process.env.PM_EVAL_CLAUDE_BIN, "claude");
  const prepared = prepareClaudeRuntime({ paths });
  if (prepared.status !== "pass") return prepared;

  enableWorkdirAnalytics(paths.workdir);

  const prompt = buildStoryPrompt({ scenarioId, paths, runtimeLabel: "Claude Code" });
  const argv = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--no-session-persistence",
    "--plugin-dir",
    prepared.pluginRoot,
  ];
  if (process.env.PM_EVAL_CLAUDE_MODEL) {
    argv.push("--model", process.env.PM_EVAL_CLAUDE_MODEL);
  }

  writeJson(path.join(paths.metadataDir, "claude_command.json"), {
    command: claudeBin,
    argv,
    env: {
      HOME: paths.homeDir,
      PM_PLUGIN_ROOT: prepared.pluginRoot,
      CLAUDE_PLUGIN_ROOT: prepared.pluginRoot,
      PM_EVAL_ARTIFACTS_DIR: paths.artifactsDir,
    },
  });

  const result = spawnSync(claudeBin, argv, {
    cwd: paths.workdir,
    input: prompt,
    env: claudeEnv({ paths, prepared }),
    encoding: "utf8",
    timeout: ADAPTER_TIMEOUT_MS,
    maxBuffer: OUTPUT_MAX_BUFFER,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.writeFileSync(paths.transcriptRaw, stdout);
  fs.writeFileSync(path.join(paths.metadataDir, "claude.stderr.log"), stderr);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "claude.stdout.jsonl"), stdout);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "claude.stderr.log"), stderr);

  if (result.error && result.error.code === "ETIMEDOUT") {
    return { status: "indeterminate", reason: "claude-timeout" };
  }
  if (result.status !== 0) {
    return { status: "indeterminate", reason: "claude-exec-failed" };
  }

  const events = normalizeClaudeStream(stdout);
  if (events.length === 0) {
    return { status: "indeterminate", reason: "empty-transcript" };
  }
  fs.writeFileSync(
    paths.transcriptNormalized,
    events.map((event) => JSON.stringify(event)).join("\n") + "\n"
  );

  if (!sourceMarkerVerified(paths, prepared.marker)) {
    return { status: "indeterminate", reason: "wrong-source" };
  }

  return { status: "pass" };
}

// Claude Code stream-json → normalized {type: skill|tool} events.
// Skill tool_use blocks become typed skill events; tool_result blocks
// backfill exit_code (is_error) onto the matching tool event.
function normalizeClaudeStream(stdout) {
  const events = [];
  const byToolUseId = new Map();

  for (const line of String(stdout || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const content =
      parsed && parsed.message && Array.isArray(parsed.message.content)
        ? parsed.message.content
        : [];

    if (parsed.type === "assistant") {
      for (const block of content) {
        if (!block || block.type !== "tool_use") continue;
        const input = block.input || {};
        if (block.name === "Skill") {
          events.push({ type: "skill", name: String(input.skill || "").trim() });
          continue;
        }
        const event = {
          type: "tool",
          name: String(block.name || "").trim(),
          command: String(input.command || input.file_path || input.path || ""),
        };
        events.push(event);
        if (block.id) byToolUseId.set(block.id, event);
      }
    } else if (parsed.type === "user") {
      for (const block of content) {
        if (!block || block.type !== "tool_result" || !block.tool_use_id) continue;
        const event = byToolUseId.get(block.tool_use_id);
        if (event && event.exit_code === undefined) {
          event.exit_code = block.is_error ? 1 : 0;
        }
      }
    }
  }
  return events;
}

function prepareClaudeRuntime({ paths }) {
  const template = process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE
    ? path.resolve(process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE)
    : "";
  const claudeHome = path.join(paths.homeDir, ".claude");
  const pluginRoot = path.join(paths.homeDir, ".agents", "vendor", "pm");
  const marker = `pm-eval-source:${paths.runId}:${crypto.randomBytes(12).toString("hex")}`;

  if (template && !copyAuthTemplate(template, claudeHome)) {
    return skip("claude-auth-missing");
  }

  if (treeContains(paths.rootDir, marker, { skipDirs: sourceSkipDirs() })) {
    return { status: "indeterminate", reason: "wrong-source" };
  }

  safeCopyTree(paths.runtimeDir, pluginRoot);
  injectSourceMarker(pluginRoot, marker);

  for (const exposedRoot of [claudeHome, pluginRoot]) {
    if (fs.existsSync(exposedRoot)) assertUnderRunDir(exposedRoot, paths.runDir);
  }

  return { status: "pass", claudeHome, pluginRoot, marker };
}

function claudeEnv({ paths, prepared }) {
  const env = {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: paths.homeDir,
    TMPDIR: paths.tmpDir,
    XDG_CACHE_HOME: paths.xdgCacheDir,
    XDG_CONFIG_HOME: paths.xdgConfigDir,
    XDG_DATA_HOME: paths.xdgDataDir,
    PM_PLUGIN_ROOT: prepared.pluginRoot,
    CLAUDE_PLUGIN_ROOT: prepared.pluginRoot,
    PM_EVAL_ARTIFACTS_DIR: paths.artifactsDir,
    PM_EVAL_SOURCE_MARKER_ARTIFACT: MARKER_ARTIFACT,
    PM_EVAL_SCENARIO_ID: paths.scenarioId,
    DISABLE_AUTOUPDATER: "1",
  };
  if (process.env.PM_EVAL_CLAUDE_API_KEY) {
    env.ANTHROPIC_API_KEY = process.env.PM_EVAL_CLAUDE_API_KEY;
  }
  return env;
}

function hasAuthPath() {
  if (process.env.PM_EVAL_CLAUDE_API_KEY) return true;
  if (templateHasAuthMaterial(process.env.PM_EVAL_CLAUDE_HOME_TEMPLATE)) return true;
  // macOS keychain OAuth survives HOME isolation; require explicit opt-in.
  if (process.env.PM_EVAL_CLAUDE_ALLOW_KEYCHAIN === "1") return true;
  return false;
}

function liveEnabled() {
  return process.env.PM_EVAL_CLAUDE_LIVE === "1";
}

function networkAcknowledged() {
  return process.env.PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK === "1";
}

function skipNetworkPolicy() {
  return {
    status: "skip",
    reason: "network-policy",
    detail:
      "claude live adapter requires explicit local opt-in and uncontained network acknowledgement; " +
      "live runs execute the agent with permission checks bypassed on this host (isolation is " +
      "HOME/XDG redirection only) — prefer a disposable machine or container",
  };
}

function skip(reason) {
  return { status: "skip", reason };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

module.exports = {
  name: "claude",
  live: true,
  preflight,
  run,
  _private: {
    normalizeClaudeStream,
    prepareClaudeRuntime,
  },
};
