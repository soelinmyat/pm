"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { safeCopyTree } = require("../stage.js");
const { parseJsonl } = require("../transcript.js");

const ADAPTER_TIMEOUT_MS = 600_000;
const OUTPUT_MAX_BUFFER = 2 * 1024 * 1024;
const MAX_SYNC_ARTIFACT_BYTES = 1024 * 1024;
const MARKER_ARTIFACT = "pm-source-marker.txt";
const AUTH_FILE_RE = /(auth|credential|session|token)/i;

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

  const writableArtifactsDir = codexWritableArtifactsDir(paths);
  fs.mkdirSync(writableArtifactsDir, { recursive: true });

  const prompt = buildPrompt({ scenarioId, paths });
  const argv = buildCodexArgv({ paths });
  const timeoutMs = adapterTimeoutMs();

  writeJson(path.join(paths.metadataDir, "codex_command.json"), {
    command: codexBin,
    argv,
    timeout_ms: timeoutMs,
    env: {
      HOME: paths.homeDir,
      CODEX_HOME: prepared.codexHome,
      PM_PLUGIN_ROOT: prepared.pmPluginRoot,
      CLAUDE_PLUGIN_ROOT: prepared.pmPluginRoot,
      PM_EVAL_ARTIFACTS_DIR: writableArtifactsDir,
    },
  });

  const result = spawnSync(codexBin, argv, {
    cwd: paths.workdir,
    input: prompt,
    env: codexEnv({ paths, prepared, artifactsDir: writableArtifactsDir }),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: OUTPUT_MAX_BUFFER,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  fs.writeFileSync(paths.transcriptRaw, stdout);
  fs.writeFileSync(path.join(paths.metadataDir, "codex.stderr.log"), stderr);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "codex.stdout.jsonl"), stdout);
  fs.writeFileSync(path.join(paths.artifactsDir, "raw-output", "codex.stderr.log"), stderr);
  syncCodexArtifacts({ paths, sourceDir: writableArtifactsDir });

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

function buildCodexArgv({ paths }) {
  const argv = ["exec"];
  const model = envString("PM_EVAL_CODEX_MODEL");
  const reasoningEffort = envString("PM_EVAL_CODEX_REASONING_EFFORT");
  if (model) argv.push("-m", model);
  if (reasoningEffort) {
    argv.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }
  argv.push(
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
    "-"
  );
  return argv;
}

function adapterTimeoutMs() {
  const raw = envString("PM_EVAL_CODEX_TIMEOUT_MS");
  if (!raw) return ADAPTER_TIMEOUT_MS;
  if (!/^[0-9]+$/.test(raw)) return ADAPTER_TIMEOUT_MS;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1000 ? value : ADAPTER_TIMEOUT_MS;
}

function envString(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
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

function copyAuthTemplate(template, codexHome) {
  if (!templateHasAuthMaterial(template)) return false;

  let stat;
  try {
    stat = fs.lstatSync(template);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;

  fs.mkdirSync(codexHome, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(template)) {
    const source = path.join(template, entry);
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) continue;
    if (!sourceStat.isFile()) continue;
    if (!AUTH_FILE_RE.test(entry)) continue;
    fs.copyFileSync(source, path.join(codexHome, entry));
    fs.chmodSync(path.join(codexHome, entry), sourceStat.mode & 0o600);
    copied += 1;
  }
  return copied > 0;
}

function templateHasAuthMaterial(template) {
  if (!template) return false;
  let stat;
  try {
    stat = fs.lstatSync(template);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;

  for (const entry of fs.readdirSync(template)) {
    const source = path.join(template, entry);
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) continue;
    if (sourceStat.isFile() && AUTH_FILE_RE.test(entry)) return true;
  }
  return false;
}

function readManifestVersion(runtimeDir) {
  const configPath = path.join(runtimeDir, "plugin.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8")).version;
}

function injectSourceMarker(runtimeDir, marker) {
  const skillsDir = path.join(runtimeDir, "skills");
  let injected = 0;
  for (const skill of fs.readdirSync(skillsDir)) {
    const skillPath = path.join(skillsDir, skill, "SKILL.md");
    if (!fs.existsSync(skillPath)) continue;
    fs.appendFileSync(skillPath, `\n\n<!-- PM_EVAL_SOURCE_MARKER ${marker} -->\n`);
    injected += 1;
  }
  if (injected === 0) throw new Error("unable to inject PM eval source marker");
}

function stageSkillAliases(sourceSkillsDir, destSkillsDir) {
  fs.mkdirSync(destSkillsDir, { recursive: true });
  for (const skill of fs.readdirSync(sourceSkillsDir)) {
    const source = path.join(sourceSkillsDir, skill);
    if (!fs.statSync(source).isDirectory()) continue;
    safeCopyTree(source, path.join(destSkillsDir, `pm-${skill}`));
  }
}

function sourceMarkerVerified(paths, marker) {
  const markerPath = path.join(paths.artifactsDir, MARKER_ARTIFACT);
  try {
    const text = fs.readFileSync(markerPath, "utf8").trim();
    return text === marker;
  } catch {
    return false;
  }
}

function buildPrompt({ scenarioId, paths }) {
  const story = fs.readFileSync(path.join(paths.scenarioStageDir, "story.md"), "utf8");
  const artifactNames = expectedArtifacts(paths.scenarioStageDir);
  return [
    "You are running a PM behavioral eval scenario against the staged PM plugin.",
    "Use the PM workflow skills exposed in this isolated Codex environment.",
    "Do not read host paths, credentials, user caches, or eval-results outside the provided run paths.",
    `Scenario id: ${scenarioId}`,
    "",
    story.trim(),
    "",
    "Skill telemetry:",
    "- Codex JSONL has no native PM skill-call event.",
    "- Before you use any PM skill or PM workflow, emit a short agent message that includes the exact skill name, such as: Using `pm:dev`.",
    "- Emit the skill message before running commands or taking actions that depend on that skill.",
    "",
    "Artifacts:",
    "- Write required scenario artifacts under the directory named by PM_EVAL_ARTIFACTS_DIR.",
    "- PM_EVAL_ARTIFACTS_DIR is inside the writable scenario workdir; do not substitute another directory.",
    `- Write the PM source marker to ${MARKER_ARTIFACT}.`,
    "- The marker value is not in this prompt. Read it from the PM skill/runtime text you actually use.",
    ...artifactNames.map((name) => `- Scenario check expects artifact: ${name}`),
    "",
    "Stop when the scenario stop condition is satisfied.",
  ].join("\n");
}

function expectedArtifacts(scenarioStageDir) {
  const checks = fs.readFileSync(path.join(scenarioStageDir, "checks.sh"), "utf8");
  return [...checks.matchAll(/artifact-exists\s+([A-Za-z0-9._-]+)/g)].map((match) => match[1]);
}

function codexWritableArtifactsDir(paths) {
  return path.join(paths.workdir, ".pm-eval-artifacts");
}

function syncCodexArtifacts({ paths, sourceDir }) {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir)) {
    if (entry === "raw-output") continue;
    if (!/^[A-Za-z0-9._-]+$/.test(entry)) continue;

    const source = path.join(sourceDir, entry);
    const dest = path.join(paths.artifactsDir, entry);
    let stat;
    try {
      stat = fs.lstatSync(source);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    if (stat.size > MAX_SYNC_ARTIFACT_BYTES) continue;
    if (fs.existsSync(dest)) continue;

    fs.copyFileSync(source, dest, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dest, stat.mode & 0o666);
  }
}

function codexEnv({ paths, prepared, artifactsDir }) {
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
    PM_EVAL_ARTIFACTS_DIR: artifactsDir,
    PM_EVAL_SOURCE_MARKER_ARTIFACT: MARKER_ARTIFACT,
    PM_EVAL_SCENARIO_ID: paths.scenarioId,
  };
}

function resolveCodexBin() {
  const requested = process.env.PM_EVAL_CODEX_BIN || "codex";
  if (requested.includes(path.sep)) {
    return isExecutableFile(requested) ? requested : "";
  }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, requested);
    if (isExecutableFile(candidate)) return candidate;
  }
  return "";
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function treeContains(root, needle, opts = {}) {
  const skipDirs = opts.skipDirs || new Set();
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    return false;
  }
  if (stat.isSymbolicLink()) return false;
  if (stat.isFile()) {
    if (stat.size > 1024 * 1024) return false;
    try {
      return fs.readFileSync(root, "utf8").includes(needle);
    } catch {
      return false;
    }
  }
  if (!stat.isDirectory()) return false;
  for (const entry of fs.readdirSync(root)) {
    if (skipDirs.has(entry)) continue;
    if (treeContains(path.join(root, entry), needle, opts)) return true;
  }
  return false;
}

function sourceSkipDirs() {
  return new Set([".git", ".worktrees", "node_modules", "eval-results", ".pm"]);
}

function assertUnderRunDir(target, runDir) {
  const realTarget = fs.realpathSync(target);
  const realRunDir = fs.realpathSync(runDir);
  if (realTarget !== realRunDir && !realTarget.startsWith(`${realRunDir}${path.sep}`)) {
    throw new Error(`PM eval path escapes run directory: ${target}`);
  }
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
    adapterTimeoutMs,
    buildCodexArgv,
    buildPrompt,
    codexWritableArtifactsDir,
    copyAuthTemplate,
    resolveCodexBin,
    syncCodexArtifacts,
  },
};
