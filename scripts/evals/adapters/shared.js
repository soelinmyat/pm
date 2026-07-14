"use strict";

const { spawnSync } = require("node:child_process");
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

// Post-run tripwire: flag MUTATING activity aimed OUTSIDE the run directory.
// The caught set is deliberately narrow:
//   (a) file write/edit whose resolved target is an absolute path outside runDir
//       (relative targets resolve against the workdir — codex apply_patch paths
//       are workdir-relative, so `../../evil` would otherwise be invisible);
//   (b) a shell command that directs git/rm at an absolute outside path — cd or
//       pushd, git -C, --git-dir=, or git push/commit/rm -rf combined with an
//       outside path that actually EXISTS.
// Everything else passes: reads, mentions of outside paths, OS-temp writes
// (/tmp, /var/folders) and /dev. Both adapters set tool_class (codex natively,
// claude via classifyTool in normalizeClaudeStream), so classification is
// single-sourced. This is an early, attributable signal; the host-repo delta
// check in run.js is the backstop for walk-ups and relative/symlink bypasses the
// transcript cannot show.
function transcriptEscapesRunDir(items, runDir, workdir) {
  if (!runDir) return false;
  const root = path.resolve(runDir);
  const base = workdir ? path.resolve(workdir) : root;
  for (const event of items || []) {
    if (!event || event.type === "skill") continue;
    const toolClass = String(event.tool_class || "");
    const command = String(event.command || "");
    if (toolClass === "edit-file" || toolClass === "write-file") {
      if (!command) continue;
      const target = path.isAbsolute(command) ? command : path.resolve(base, command);
      if (isAbsOutside(target, root)) return true;
    } else if (toolClass === "run-command") {
      if (commandEscapesRunDir(command, root)) return true;
    }
  }
  return false;
}

// OS temp roots and /dev are always allowed — a literal Write to /tmp is
// behaviorally fine and TMPDIR steering does not cover it.
const ALLOWED_OUTSIDE_RE = /^\/(?:tmp|private\/tmp|private\/var\/folders|var\/folders|dev)(?:\/|$)/;

function isAbsOutside(candidate, root) {
  const value = String(candidate || "").trim();
  if (!value || !path.isAbsolute(value)) return false;
  const normalized = path.normalize(value);
  if (normalized === root || normalized.startsWith(`${root}${path.sep}`)) return false;
  if (ALLOWED_OUTSIDE_RE.test(normalized)) return false;
  return true;
}

function commandEscapesRunDir(command, root) {
  // Positional forms directed at an absolute outside path — scanned on RAW text.
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
  // Mutating verbs (git push/commit, rm -rf) combined with an outside path that
  // actually EXISTS. Quoted segments are stripped first so a path inside a commit
  // message or heredoc-style arg is not read as a target, and the existence check
  // keeps message fragments like "/api/users" from tripping the guard.
  const gitMutation =
    /(?:^|[\s;&|])(?:git|\/[^\s;&|]+\/git)\s+(?:-[^\s;&|]+\s+)*(?:push|commit)(?:\s|$)/.test(
      command
    );
  const mutating = gitMutation || /\brm\b[^\n]*\s-[a-z]*[rf]/.test(command);
  if (mutating) {
    const scannable = stripQuotedSegments(command);
    for (const match of scannable.matchAll(/(?:^|[\s"'=(])(\/[^\s"';&|)]+)/g)) {
      const candidate = match[1];
      if (isAbsOutside(candidate, root) && fs.existsSync(candidate)) return true;
    }
  }
  return false;
}

function stripQuotedSegments(command) {
  return String(command)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'[^']*'/g, "''");
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

function spawnCapturedSync(command, argv, options, capture) {
  const maxCaptureBytes = capture.maxBytes || 32 * 1024 * 1024;
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  writeProgress(capture.progressPath, {
    status: "running",
    started_at: startedAt,
    stdout_ref: capture.stdoutPath,
    stderr_ref: capture.stderrPath,
    streaming: true,
  });
  fs.mkdirSync(path.dirname(capture.stdoutPath), { recursive: true });
  fs.mkdirSync(path.dirname(capture.stderrPath), { recursive: true });
  const stdoutFd = fs.openSync(capture.stdoutPath, "w");
  const stderrFd = fs.openSync(capture.stderrPath, "w");
  let result;
  try {
    result = spawnSync(command, argv, {
      ...options,
      stdio: ["pipe", stdoutFd, stderrFd],
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  const stdoutBytes = fs.statSync(capture.stdoutPath).size;
  const stderrBytes = fs.statSync(capture.stderrPath).size;
  const stdoutOverflow = stdoutBytes > maxCaptureBytes;
  const stderrOverflow = stderrBytes > maxCaptureBytes;
  const captureOverflow = stdoutOverflow || stderrOverflow;
  const stdout = stdoutOverflow ? "" : fs.readFileSync(capture.stdoutPath, "utf8");
  const stderr = stderrOverflow ? "" : fs.readFileSync(capture.stderrPath, "utf8");
  const endedAt = new Date().toISOString();
  writeProgress(capture.progressPath, {
    status:
      result.error && result.error.code === "ETIMEDOUT"
        ? "timeout"
        : captureOverflow
          ? "overflow"
          : "complete",
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: Date.now() - startedMs,
    exit_code: result.status,
    signal: result.signal,
    stdout_ref: capture.stdoutPath,
    stderr_ref: capture.stderrPath,
    stdout_bytes: stdoutBytes,
    stderr_bytes: stderrBytes,
    max_capture_bytes: maxCaptureBytes,
    streaming: true,
  });
  return Object.assign(result, {
    stdout,
    stderr,
    captureOverflow,
    stdoutOverflow,
    stderrOverflow,
  });
}

function scanCapturedLines(filePath, visitor, maxLineBytes = 1024 * 1024) {
  const fd = fs.openSync(filePath, "r");
  const chunk = Buffer.alloc(64 * 1024);
  let pending = "";
  let matched = false;
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null);
      pending += chunk.subarray(0, bytesRead).toString("utf8");
      if (Buffer.byteLength(pending) > maxLineBytes && !pending.includes("\n")) {
        return { matched: false, indeterminate: true, reason: "oversized-jsonl-line" };
      }
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (visitor(line)) {
          matched = true;
          return { matched, indeterminate: false };
        }
      }
    } while (bytesRead > 0);
    if (pending.trim() && visitor(pending)) matched = true;
    return { matched, indeterminate: false };
  } finally {
    fs.closeSync(fd);
  }
}

function writeProgress(filePath, value) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
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
  spawnCapturedSync,
  scanCapturedLines,
  templateHasAuthMaterial,
  treeContains,
};
