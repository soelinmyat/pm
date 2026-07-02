"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MARKER_ARTIFACT = "pm-source-marker.txt";
const AUTH_FILE_RE = /(auth|credential|session|token)/i;

function buildStoryPrompt({ scenarioId, paths, runtimeLabel }) {
  const story = fs.readFileSync(path.join(paths.scenarioStageDir, "story.md"), "utf8");
  const artifactNames = expectedArtifacts(paths.scenarioStageDir);
  return [
    "You are running a PM behavioral eval scenario against the staged PM plugin.",
    `Use the PM workflow skills exposed in this isolated ${runtimeLabel} environment.`,
    "Do not read host paths, credentials, user caches, or eval-results outside the provided run paths.",
    `Scenario id: ${scenarioId}`,
    "",
    story.trim(),
    "",
    "Artifacts:",
    `- Write required scenario artifacts under the directory named by PM_EVAL_ARTIFACTS_DIR.`,
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

function sourceMarkerVerified(paths, marker) {
  const markerPath = path.join(paths.artifactsDir, MARKER_ARTIFACT);
  try {
    const text = fs.readFileSync(markerPath, "utf8").trim();
    return text === marker;
  } catch {
    return false;
  }
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

function copyAuthTemplate(template, destDir) {
  if (!templateHasAuthMaterial(template)) return false;

  let stat;
  try {
    stat = fs.lstatSync(template);
  } catch {
    return false;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;

  fs.mkdirSync(destDir, { recursive: true });
  let copied = 0;
  for (const entry of fs.readdirSync(template)) {
    const source = path.join(template, entry);
    const sourceStat = fs.lstatSync(source);
    if (sourceStat.isSymbolicLink()) continue;
    if (!sourceStat.isFile()) continue;
    if (!AUTH_FILE_RE.test(entry)) continue;
    fs.copyFileSync(source, path.join(destDir, entry));
    fs.chmodSync(path.join(destDir, entry), sourceStat.mode & 0o600);
    copied += 1;
  }
  return copied > 0;
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

// PM analytics is gated on `analytics: true` in $PROJECT_DIR/.claude/pm.local.md.
// Eval runs enable it so telemetry step spans become check evidence.
function enableWorkdirAnalytics(workdir) {
  const dir = path.join(workdir, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pm.local.md"), "analytics: true\n");
}

function resolveBin(requested, fallbackName) {
  const name = requested || fallbackName;
  if (name.includes(path.sep)) {
    return isExecutableFile(name) ? name : "";
  }
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
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

module.exports = {
  MARKER_ARTIFACT,
  AUTH_FILE_RE,
  assertUnderRunDir,
  buildStoryPrompt,
  copyAuthTemplate,
  enableWorkdirAnalytics,
  expectedArtifacts,
  injectSourceMarker,
  resolveBin,
  sourceMarkerVerified,
  sourceSkipDirs,
  templateHasAuthMaterial,
  treeContains,
};
