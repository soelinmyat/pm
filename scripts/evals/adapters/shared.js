"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { classifyTool } = require("../transcript.js");

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
    `- Write the PM source marker to ${MARKER_ARTIFACT} inside that same PM_EVAL_ARTIFACTS_DIR directory.`,
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

// Skills reference ${CLAUDE_PLUGIN_ROOT}/${PM_PLUGIN_ROOT} in prose and shell
// snippets. If those resolve empty inside the engine's skill context, the
// engine goes hunting and can find the HOST-installed copy of the same plugin
// (observed: reads from ~/.claude/plugins/cache/pm/...), silently testing the
// wrong code. Bake the staged absolute path into every staged markdown file.
function bakePluginRootPaths(runtimeDir) {
  const stack = [runtimeDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.(md|json)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        if (text.includes("${CLAUDE_PLUGIN_ROOT}") || text.includes("${PM_PLUGIN_ROOT}")) {
          fs.writeFileSync(
            full,
            text
              .replaceAll("${CLAUDE_PLUGIN_ROOT}", runtimeDir)
              .replaceAll("${PM_PLUGIN_ROOT}", runtimeDir)
          );
        }
      }
    }
  }
}

// Post-run guard: any command or path touching a host plugin install means
// the run exercised the wrong code, regardless of marker evidence.
const HOST_PLUGIN_RE = /\.claude\/plugins\/(cache|repos|marketplaces)\b/;

function transcriptTouchesHostPlugin(events) {
  return events.some((event) => HOST_PLUGIN_RE.test(`${event.command || ""} ${event.name || ""}`));
}

// Post-run guard: flag MUTATING activity outside the run directory. Reads and
// mentions of outside paths (the staged plugin under home/, /etc lookups) are
// legitimate and never flagged — only file writes/edits to, and shell commands
// directed at, absolute paths outside runDir. Works on both adapter event
// shapes (codex carries tool_class; claude tool names classify via classifyTool).
function transcriptEscapesRunDir(items, runDir) {
  if (!runDir) return false;
  const root = path.resolve(runDir);
  for (const event of items || []) {
    if (!event || event.type === "skill") continue;
    const toolClass = event.tool_class ? String(event.tool_class) : classifyTool(event.name);
    const command = String(event.command || "");
    if (toolClass === "edit-file" || toolClass === "write-file") {
      if (isAbsOutside(command, root)) return true;
    } else if (toolClass === "run-command") {
      if (commandEscapesRunDir(command, root)) return true;
    }
  }
  return false;
}

function isAbsOutside(candidate, root) {
  const value = String(candidate || "").trim();
  if (!value || !path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  return normalized !== root && !normalized.startsWith(`${root}${path.sep}`);
}

function commandEscapesRunDir(command, root) {
  // Commands explicitly directed at an absolute outside path.
  const directed = [
    /\b(?:cd|pushd)\s+(["']?)(\/[^\s"';&|)]+)\1/g,
    /--git-dir[=\s]+(["']?)(\/[^\s"';&|)]+)\1/g,
  ];
  for (const re of directed) {
    let match;
    while ((match = re.exec(command)) !== null) {
      if (isAbsOutside(match[2], root)) return true;
    }
  }
  // `git -C <abs>` — only meaningful on a git invocation.
  if (/\bgit\b/.test(command)) {
    const gitC = /-C\s+(["']?)(\/[^\s"';&|)]+)\1/g;
    let match;
    while ((match = gitC.exec(command)) !== null) {
      if (isAbsOutside(match[2], root)) return true;
    }
  }
  // Mutating verbs (git push/commit, rm -rf) combined with any absolute outside
  // path elsewhere in the command. The preceding-char guard keeps URLs
  // (https://…) from reading as bare absolute paths.
  const mutating =
    (/\bgit\b/.test(command) && /\b(?:push|commit)\b/.test(command)) ||
    /\brm\b[^\n]*\s-[a-z]*[rf]/.test(command);
  if (mutating) {
    for (const match of command.matchAll(/(?:^|[\s"'=(])(\/[^\s"';&|)]+)/g)) {
      if (isAbsOutside(match[1], root)) return true;
    }
  }
  return false;
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
  // The marker proves the agent read the staged runtime; its exact location
  // is incidental. Accept the artifacts dir or the scenario workdir.
  for (const dir of [paths.artifactsDir, paths.workdir]) {
    try {
      const text = fs.readFileSync(path.join(dir, MARKER_ARTIFACT), "utf8").trim();
      if (text === marker) return true;
    } catch {
      // try next location
    }
  }
  return false;
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
  bakePluginRootPaths,
  transcriptTouchesHostPlugin,
  transcriptEscapesRunDir,
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
