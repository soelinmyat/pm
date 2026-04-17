"use strict";

const fs = require("fs");
const path = require("path");

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? match[1] : "";
}

function frontmatterValue(text, key) {
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) return "";
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

function dateToEpoch(dateStr) {
  if (!dateStr) return 0;
  const parsed = Date.parse(dateStr);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function listMarkdownFiles(dirPath) {
  if (!fileExists(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name));
}

function collectSessionFiles(sessionsDir) {
  if (!fileExists(sessionsDir)) return [];
  return fs
    .readdirSync(sessionsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(sessionsDir, entry.name));
}

function buildGroomDescriptor(filePath, stat, text) {
  const topic = frontmatterValue(text, "topic") || path.basename(filePath, ".md");
  const phase = frontmatterValue(text, "phase") || "active";
  const updated = frontmatterValue(text, "updated");
  const updatedEpoch = dateToEpoch(updated) || Math.floor(stat.mtimeMs / 1000);
  const linearId = frontmatterValue(text, "linear_id");
  return {
    kind: "groom",
    filePath,
    topic,
    stage: phase,
    updated,
    updatedEpoch,
    linearId,
    summary: `groom in progress: ${topic} (${phase})`,
    next: `resume grooming (${topic})`,
  };
}

function buildDevDescriptor(filePath, stat, text) {
  const baseName = path.basename(filePath, ".md");
  const stage = markdownTableValue(text, "Stage") || bulletValue(text, "Stage") || "active";
  const nextAction = bulletValue(text, "Next action");
  const ticket = markdownTableValue(text, "Ticket") || markdownTableValue(text, "Parent Issue");
  const parentTitle = markdownTableValue(text, "Parent Title");
  const currentSubIssue = bulletValue(text, "Current sub-issue");

  const cleanName = baseName.replace(/^(epic|bugfix)-/, "");
  let label = ticket || cleanName;
  if (parentTitle) label = `${ticket || cleanName}: ${parentTitle}`;

  let summary = `delivery in progress: ${label} (${stage})`;
  if (currentSubIssue) {
    summary = `delivery in progress: ${label} \u2014 ${currentSubIssue} (${stage})`;
  }

  return {
    kind: "dev",
    filePath,
    topic: label,
    stage,
    updated: "",
    updatedEpoch: Math.floor(stat.mtimeMs / 1000),
    linearId: ticket,
    summary,
    next: nextAction || "resume active delivery work",
  };
}

function buildRfcDescriptor(filePath, stat, text) {
  const baseName = path.basename(filePath, ".md");
  const stage = markdownTableValue(text, "Stage") || bulletValue(text, "Stage") || "active";
  const slug = markdownTableValue(text, "Slug") || baseName;
  const topic = slug;
  const linearId = frontmatterValue(text, "linear_id") || markdownTableValue(text, "Linear ID");

  return {
    kind: "rfc",
    filePath,
    topic,
    stage,
    updated: "",
    updatedEpoch: Math.floor(stat.mtimeMs / 1000),
    linearId,
    slug,
    summary: `rfc in progress: ${topic} (${stage})`,
    next: `resume rfc (${topic})`,
  };
}

function buildThinkDescriptor(filePath, stat, text) {
  const topic = frontmatterValue(text, "topic") || path.basename(filePath, ".md");
  const updated = frontmatterValue(text, "updated");
  const updatedEpoch = dateToEpoch(updated) || Math.floor(stat.mtimeMs / 1000);
  const linearId = frontmatterValue(text, "linear_id");

  return {
    kind: "think",
    filePath,
    topic,
    stage: "active",
    updated,
    updatedEpoch,
    linearId,
    summary: `thinking in progress: ${topic}`,
    next: `resume thinking (${topic})`,
  };
}

function resolveSourceDir(paths) {
  if (!paths || !paths.sourceDir) {
    throw new Error("session-scan helpers require { sourceDir }");
  }
  return paths.sourceDir;
}

function listGroomSessions(paths) {
  const sourceDir = resolveSourceDir(paths);
  const runtimeDir = path.join(sourceDir, ".pm");
  const sessionsDir = path.join(runtimeDir, "groom-sessions");

  const candidates = collectSessionFiles(sessionsDir);
  const legacyPath = path.join(runtimeDir, ".groom-state.md");
  if (fileExists(legacyPath)) candidates.push(legacyPath);

  const out = [];
  for (const filePath of candidates) {
    const stat = safeStat(filePath);
    if (!stat) continue;
    const text = safeRead(filePath);
    out.push(buildGroomDescriptor(filePath, stat, text));
  }
  return out;
}

function listDevSessions(paths) {
  const sourceDir = resolveSourceDir(paths);
  const runtimeDir = path.join(sourceDir, ".pm");
  const sessionsDir = path.join(runtimeDir, "dev-sessions");

  const candidates = collectSessionFiles(sessionsDir);
  const legacyFiles = listMarkdownFiles(sourceDir).filter((filePath) => {
    const name = path.basename(filePath);
    return name.startsWith(".dev-state-") || name.startsWith(".dev-epic-state-");
  });
  candidates.push(...legacyFiles);

  const out = [];
  for (const filePath of candidates) {
    const stat = safeStat(filePath);
    if (!stat) continue;
    const text = safeRead(filePath);
    out.push(buildDevDescriptor(filePath, stat, text));
  }
  return out;
}

function listRfcSessions(paths) {
  const sourceDir = resolveSourceDir(paths);
  const sessionsDir = path.join(sourceDir, ".pm", "rfc-sessions");

  const out = [];
  for (const filePath of collectSessionFiles(sessionsDir)) {
    const stat = safeStat(filePath);
    if (!stat) continue;
    const text = safeRead(filePath);
    out.push(buildRfcDescriptor(filePath, stat, text));
  }
  return out;
}

function listThinkSessions(paths) {
  const sourceDir = resolveSourceDir(paths);
  const sessionsDir = path.join(sourceDir, ".pm", "think-sessions");

  const out = [];
  for (const filePath of collectSessionFiles(sessionsDir)) {
    const stat = safeStat(filePath);
    if (!stat) continue;
    const text = safeRead(filePath);
    out.push(buildThinkDescriptor(filePath, stat, text));
  }
  return out;
}

function pickMostRecent(list) {
  let best = null;
  for (const entry of list) {
    if (!best || entry.updatedEpoch > best.updatedEpoch) best = entry;
  }
  return best;
}

module.exports = {
  listGroomSessions,
  listDevSessions,
  listRfcSessions,
  listThinkSessions,
  pickMostRecent,
  // Re-exported helpers so start-status.js (and other scripts) share one source.
  safeRead,
  safeStat,
  fileExists,
  frontmatterValue,
  markdownTableValue,
  bulletValue,
  dateToEpoch,
  listMarkdownFiles,
  extractFrontmatter,
  escapeRegExp,
};
