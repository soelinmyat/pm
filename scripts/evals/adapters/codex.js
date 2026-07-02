"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { safeCopyTree } = require("../stage.js");
const { parseJsonl } = require("../transcript.js");
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
const OUTPUT_MAX_BUFFER = 2 * 1024 * 1024;

function preflight() {
  if (!liveEnabled()) return skipNetworkPolicy();
  if (!networkAcknowledged()) return skipNetworkPolicy();
  if (!resolveCodexBin()) return skip("codex-cli-missing");
  if (!templateHasAuthMaterial(process.env.PM_EVAL_CODEX_HOME_TEMPLATE)) {
    return skip("codex-auth-missing");
  }
  return { status: "pass" };
}

function run({ scenarioId, paths }) {
  const ready = preflight();
  if (ready.status !== "pass") return ready;

  const codexBin = resolveCodexBin();
  const prepared = prepareCodexRuntime({ paths });
  if (prepared.status !== "pass") return prepared;

  enableWorkdirAnalytics(paths.workdir);

  const prompt = buildStoryPrompt({ scenarioId, paths, runtimeLabel: "Codex" });
  const argv = [
    "exec",
    "--full-auto",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--json",
    "-C",
    paths.workdir,
    "-o",
    path.join(paths.metadataDir, "codex.last-message.txt"),
    "-",
  ];

  writeJson(path.join(paths.metadataDir, "codex_command.json"), {
    command: codexBin,
    argv,
    env: {
      HOME: paths.homeDir,
      CODEX_HOME: prepared.codexHome,
      PM_PLUGIN_ROOT: prepared.pmPluginRoot,
      CLAUDE_PLUGIN_ROOT: prepared.pmPluginRoot,
      PM_EVAL_ARTIFACTS_DIR: paths.artifactsDir,
    },
  });

  const result = spawnSync(codexBin, argv, {
    cwd: paths.workdir,
    input: prompt,
    env: codexEnv({ paths, prepared }),
    encoding: "utf8",
    timeout: ADAPTER_TIMEOUT_MS,
    maxBuffer: OUTPUT_MAX_BUFFER,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.writeFileSync(paths.transcriptRaw, stdout);
  fs.writeFileSync(path.join(paths.metadataDir, "codex.stderr.log"), stderr);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "codex.stdout.jsonl"), stdout);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "codex.stderr.log"), stderr);

  if (result.error && result.error.code === "ETIMEDOUT") {
    return { status: "indeterminate", reason: "codex-timeout" };
  }
  if (result.status !== 0) {
    return { status: "indeterminate", reason: "codex-exec-failed" };
  }

  const parsed = parseJsonl(stdout);
  if (parsed.status !== "pass") {
    return { status: "indeterminate", reason: parsed.reason || "empty-transcript" };
  }
  fs.writeFileSync(
    paths.transcriptNormalized,
    parsed.events.map((event) => JSON.stringify(event)).join("\n") +
      (parsed.events.length ? "\n" : "")
  );

  if (!sourceMarkerVerified(paths, prepared.marker)) {
    return { status: "indeterminate", reason: "wrong-source" };
  }

  return { status: "pass" };
}

function liveEnabled() {
  return process.env.PM_EVAL_CODEX_LIVE === "1";
}

function networkAcknowledged() {
  return process.env.PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK === "1";
}

function skipNetworkPolicy() {
  return {
    status: "skip",
    reason: "network-policy",
    detail:
      "codex live adapter requires explicit local opt-in and uncontained network acknowledgement",
  };
}

function skip(reason) {
  return { status: "skip", reason };
}

function prepareCodexRuntime({ paths }) {
  const template = path.resolve(process.env.PM_EVAL_CODEX_HOME_TEMPLATE || "");
  const codexHome = path.join(paths.homeDir, ".codex");
  const agentsHome = path.join(paths.homeDir, ".agents");
  const pmPluginRoot = path.join(agentsHome, "vendor", "pm");
  const version = readManifestVersion(paths.runtimeDir);
  const pluginCacheRoot = path.join(codexHome, "plugins", "cache", "pm", "pm", version);
  const marker = `pm-eval-source:${paths.runId}:${crypto.randomBytes(12).toString("hex")}`;

  if (!copyAuthTemplate(template, codexHome)) {
    return skip("codex-auth-missing");
  }

  fs.rmSync(path.join(codexHome, "plugins", "cache", "pm"), {
    recursive: true,
    force: true,
  });

  if (treeContains(paths.rootDir, marker, { skipDirs: sourceSkipDirs() })) {
    return { status: "indeterminate", reason: "wrong-source" };
  }
  if (treeContains(template, marker, { skipDirs: new Set(["node_modules"]) })) {
    return { status: "indeterminate", reason: "wrong-source" };
  }

  safeCopyTree(paths.runtimeDir, pluginCacheRoot);
  safeCopyTree(paths.runtimeDir, pmPluginRoot);
  injectSourceMarker(pluginCacheRoot, marker);
  injectSourceMarker(pmPluginRoot, marker);
  stageSkillAliases(path.join(pmPluginRoot, "skills"), path.join(agentsHome, "skills"));

  for (const exposedRoot of [codexHome, agentsHome, pmPluginRoot, pluginCacheRoot]) {
    assertUnderRunDir(exposedRoot, paths.runDir);
  }

  return {
    status: "pass",
    codexHome,
    agentsHome,
    pmPluginRoot,
    pluginCacheRoot,
    marker,
  };
}

function readManifestVersion(runtimeDir) {
  const configPath = path.join(runtimeDir, "plugin.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")).version;
}

function stageSkillAliases(sourceSkillsDir, destSkillsDir) {
  fs.mkdirSync(destSkillsDir, { recursive: true });
  for (const skill of fs.readdirSync(sourceSkillsDir)) {
    const source = path.join(sourceSkillsDir, skill);
    if (!fs.statSync(source).isDirectory()) continue;
    safeCopyTree(source, path.join(destSkillsDir, `pm-${skill}`));
  }
}

function codexEnv({ paths, prepared }) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: paths.homeDir,
    CODEX_HOME: prepared.codexHome,
    TMPDIR: paths.tmpDir,
    XDG_CACHE_HOME: paths.xdgCacheDir,
    XDG_CONFIG_HOME: paths.xdgConfigDir,
    XDG_DATA_HOME: paths.xdgDataDir,
    PM_PLUGIN_ROOT: prepared.pmPluginRoot,
    CLAUDE_PLUGIN_ROOT: prepared.pmPluginRoot,
    PM_EVAL_ARTIFACTS_DIR: paths.artifactsDir,
    PM_EVAL_SOURCE_MARKER_ARTIFACT: MARKER_ARTIFACT,
    PM_EVAL_SCENARIO_ID: paths.scenarioId,
  };
}

function resolveCodexBin() {
  return resolveBin(process.env.PM_EVAL_CODEX_BIN, "codex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

module.exports = {
  name: "codex",
  live: true,
  preflight,
  run,
  _private: {
    buildPrompt: buildStoryPrompt,
    copyAuthTemplate,
    resolveCodexBin,
  },
};
