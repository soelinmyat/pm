#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  state-telemetry.js snapshot --project-dir <dir> --file <path>
  state-telemetry.js apply --project-dir <dir> --plugin-root <dir> --file <path>`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      usage(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveTrackedPath(projectDir, targetPath) {
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectDir, targetPath);
  const relative = normalizePath(path.relative(projectDir, absolute));

  const tracked =
    /^\.pm\/groom-sessions\/.+\.md$/.test(relative) ||
    /^\.pm\/dev-sessions\/.+\.md$/.test(relative) ||
    /^\.dev-state-.+\.md$/.test(relative) ||
    /^\.dev-epic-state-.+\.md$/.test(relative) ||
    relative === ".pm/.groom-state.md";

  return tracked
    ? {
        absolute,
        relative,
      }
    : null;
}

function snapshotFilePath(projectDir, relativePath) {
  const key = crypto.createHash("sha256").update(relativePath).digest("hex");
  return path.join(projectDir, ".pm", "analytics", ".state-before", `${key}.json`);
}

function readCurrentFile(projectDir, name) {
  try {
    return fs.readFileSync(path.join(projectDir, ".pm", "analytics", name), "utf8").trim();
  } catch {
    return "";
  }
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? match[1] : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function frontmatterValue(text, key) {
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) {
    return "";
  }
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*"?([^"\\n]+)"?$`, "m"));
  return match ? match[1].trim() : "";
}

function markdownTableValue(text, field) {
  const match = text.match(
    new RegExp(`^\\|\\s*${escapeRegExp(field)}\\s*\\|\\s*(.*?)\\s*\\|$`, "m")
  );
  return match ? match[1].trim() : "";
}

function bulletValue(text, label) {
  const match = text.match(new RegExp(`^-\\s*${escapeRegExp(label)}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function normalizeValue(value) {
  if (!value) {
    return "";
  }
  const cleaned = String(value).trim().replace(/^`|`$/g, "");
  if (
    !cleaned ||
    cleaned === "null" ||
    cleaned === "pending" ||
    cleaned === "none" ||
    cleaned === "—" ||
    cleaned === "-" ||
    cleaned === "(not yet created)"
  ) {
    return "";
  }
  return cleaned;
}

function firstValue(...values) {
  for (const value of values) {
    const normalized = normalizeValue(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeDevStep(step) {
  const value = normalizeValue(step).toLowerCase();
  const map = {
    implement: "implementation",
    implementing: "implementation",
    planning: "plan",
    reviewing: "review",
    fixing: "implementation",
  };
  return map[value] || value;
}

function parseTrackedState(relativePath, content, fallbackSkill, currentRunId) {
  if (!content.trim()) {
    return null;
  }

  if (relativePath === ".pm/.groom-state.md" || relativePath.startsWith(".pm/groom-sessions/")) {
    const phase = normalizeValue(frontmatterValue(content, "phase"));
    if (!phase) {
      return null;
    }
    return {
      skill: "groom",
      runId: firstValue(frontmatterValue(content, "run_id"), currentRunId),
      phase,
      step: phase,
      startedAt: firstValue(
        frontmatterValue(content, "phase_started_at"),
        frontmatterValue(content, "started_at"),
        frontmatterValue(content, "started")
      ),
      completedAt: firstValue(frontmatterValue(content, "completed_at")),
      stateFile: relativePath,
    };
  }

  if (
    relativePath.startsWith(".pm/dev-sessions/") ||
    relativePath.startsWith(".dev-state-") ||
    relativePath.startsWith(".dev-epic-state-")
  ) {
    const rawStage = firstValue(
      markdownTableValue(content, "Stage"),
      bulletValue(content, "Stage"),
      frontmatterValue(content, "stage")
    );
    const step = normalizeDevStep(rawStage);
    if (!step) {
      return null;
    }
    const allowedSkills = new Set(["dev", "review", "ship", "debugging"]);
    const skill = allowedSkills.has(fallbackSkill) ? fallbackSkill : "dev";
    return {
      skill,
      runId: firstValue(
        markdownTableValue(content, "Run ID"),
        frontmatterValue(content, "run_id"),
        currentRunId
      ),
      phase: skill === "dev" ? null : skill,
      step,
      startedAt: firstValue(
        markdownTableValue(content, "Stage started at"),
        bulletValue(content, "Stage started at"),
        frontmatterValue(content, "stage_started_at"),
        markdownTableValue(content, "Started at")
      ),
      completedAt: firstValue(
        markdownTableValue(content, "Completed at"),
        bulletValue(content, "Completed at"),
        frontmatterValue(content, "completed_at")
      ),
      stateFile: relativePath,
    };
  }

  return null;
}

function sameTrackedStep(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    left.skill === right.skill &&
    left.runId === right.runId &&
    left.phase === right.phase &&
    left.step === right.step &&
    left.startedAt === right.startedAt &&
    left.stateFile === right.stateFile
  );
}

function runPmLog(pluginRoot, projectDir, args) {
  childProcess.execFileSync(path.join(pluginRoot, "scripts", "pm-log.sh"), args, {
    cwd: projectDir,
    stdio: "ignore",
  });
}

function snapshotState(projectDir, targetPath) {
  const tracked = resolveTrackedPath(projectDir, targetPath);
  if (!tracked) {
    return;
  }
  const snapshotPath = snapshotFilePath(projectDir, tracked.relative);
  ensureDirectory(path.dirname(snapshotPath));
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        file: tracked.relative,
        content: safeRead(tracked.absolute),
      },
      null,
      2
    )
  );
}

function clearActiveStep(projectDir, pluginRoot, stateFile) {
  runPmLog(pluginRoot, projectDir, ["active-step-clear", "--state-file", stateFile]);
}

function setActiveStep(projectDir, pluginRoot, state) {
  const args = [
    "active-step-set",
    "--skill",
    state.skill,
    "--run-id",
    state.runId || "untracked",
    "--step",
    state.step,
    "--started-at",
    state.startedAt || nowIso(),
    "--state-file",
    state.stateFile,
  ];
  if (state.phase) {
    args.push("--phase", state.phase);
  }
  runPmLog(pluginRoot, projectDir, args);
}

function applyState(projectDir, pluginRoot, targetPath) {
  const tracked = resolveTrackedPath(projectDir, targetPath);
  if (!tracked) {
    return;
  }

  const snapshotPath = snapshotFilePath(projectDir, tracked.relative);
  let previousContent = "";
  if (fileExists(snapshotPath)) {
    try {
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      previousContent = typeof snapshot.content === "string" ? snapshot.content : "";
    } catch {
      previousContent = "";
    }
    fs.rmSync(snapshotPath, { force: true });
  }

  const currentRunId = readCurrentFile(projectDir, ".current-run");
  const currentSkill = readCurrentFile(projectDir, ".current-skill");
  const previousState = parseTrackedState(
    tracked.relative,
    previousContent,
    currentSkill,
    currentRunId
  );
  const nextContent = safeRead(tracked.absolute);
  const nextState = parseTrackedState(tracked.relative, nextContent, currentSkill, currentRunId);
  const shouldClosePrevious =
    previousState &&
    (!nextState || !sameTrackedStep(previousState, nextState) || Boolean(nextState.completedAt));

  if (shouldClosePrevious) {
    const args = [
      "step",
      "--skill",
      previousState.skill,
      "--run-id",
      previousState.runId || currentRunId || "untracked",
      "--step",
      previousState.step,
      "--started-at",
      previousState.startedAt || nowIso(),
      "--ended-at",
      nowIso(),
      "--state-file",
      previousState.stateFile,
    ];
    if (previousState.phase) {
      args.push("--phase", previousState.phase);
    }
    runPmLog(pluginRoot, projectDir, args);
  }

  if (nextState && !nextState.completedAt) {
    setActiveStep(projectDir, pluginRoot, nextState);
    return;
  }

  clearActiveStep(projectDir, pluginRoot, tracked.relative);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    usage();
  }
  const options = parseArgs(rest);
  const projectDir = options["project-dir"];
  const targetPath = options.file;
  if (!projectDir || !targetPath) {
    usage("Both --project-dir and --file are required");
  }

  switch (command) {
    case "snapshot":
      snapshotState(projectDir, targetPath);
      return;
    case "apply":
      if (!options["plugin-root"]) {
        usage("apply requires --plugin-root");
      }
      applyState(projectDir, options["plugin-root"], targetPath);
      return;
    default:
      usage(`Unknown command: ${command}`);
  }
}

main();
