"use strict";

// Single source of truth for where pm analytics files live and how their
// host-scoped filenames are derived. All writers and readers must go through
// here so worktree-fragmentation (writers creating per-worktree .pm/ trees)
// cannot recur.
//
// Layout under <pmStateDir>/analytics/:
//   activity-<host_id>.jsonl   — append-only activity stream, one per host
//   steps-<host_id>.jsonl      — append-only step stream, one per host
//   .current-step-<host_id>.json — orchestrator's in-flight step (per host)
//   .state-before/             — file snapshots (host-local by nature)
//
// Multi-host: when the storage repo (cleanlog-kb) is synced via git, each
// host's append-only files merge cleanly without conflicts. Readers should
// concatenate all matching files.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolvePmPaths } = require("../resolve-pm-dir.js");

function sanitizeHostId(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readConfigHostId(projectRoot) {
  const candidates = [
    path.join(projectRoot, ".pm", "config.json"),
    path.join(projectRoot, "pm.config.json"),
  ];
  for (const candidate of candidates) {
    try {
      const config = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (config && typeof config.host_id === "string" && config.host_id.trim()) {
        return config.host_id.trim();
      }
    } catch {
      // file missing or unparseable — fall through
    }
  }
  return null;
}

let cachedHostId = null;
let cachedHostIdRoot = null;

function getHostId(projectRoot) {
  if (cachedHostId && cachedHostIdRoot === projectRoot) {
    return cachedHostId;
  }
  let raw = null;
  if (process.env.PM_HOST_ID) {
    raw = process.env.PM_HOST_ID;
  } else if (projectRoot) {
    raw = readConfigHostId(projectRoot);
  }
  if (!raw) {
    raw = os.hostname() || "";
  }
  const sanitized = sanitizeHostId(raw) || "unknown-host";
  cachedHostId = sanitized;
  cachedHostIdRoot = projectRoot;
  return sanitized;
}

function analyticsDir(projectRoot) {
  try {
    const { pmStateDir } = resolvePmPaths(projectRoot);
    return path.join(pmStateDir, "analytics");
  } catch {
    return path.join(projectRoot, ".pm", "analytics");
  }
}

function activityFilePath(projectRoot, hostIdOverride) {
  const hostId = hostIdOverride || getHostId(projectRoot);
  return path.join(analyticsDir(projectRoot), `activity-${hostId}.jsonl`);
}

function stepsFilePath(projectRoot, hostIdOverride) {
  const hostId = hostIdOverride || getHostId(projectRoot);
  return path.join(analyticsDir(projectRoot), `steps-${hostId}.jsonl`);
}

function currentStepFilePath(projectRoot, hostIdOverride) {
  const hostId = hostIdOverride || getHostId(projectRoot);
  return path.join(analyticsDir(projectRoot), `.current-step-${hostId}.json`);
}

function stateBeforeDir(projectRoot) {
  return path.join(analyticsDir(projectRoot), ".state-before");
}

// List all per-host JSONL files for a given stream ("activity" | "steps").
// Returns absolute paths, sorted. Used by readers that need to fold multiple
// hosts together across machines.
function listHostFiles(projectRoot, stream) {
  const dir = analyticsDir(projectRoot);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `${stream}-`;
  return entries
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jsonl"))
    .map((name) => path.join(dir, name))
    .sort();
}

function _resetCacheForTests() {
  cachedHostId = null;
  cachedHostIdRoot = null;
}

module.exports = {
  sanitizeHostId,
  getHostId,
  analyticsDir,
  activityFilePath,
  stepsFilePath,
  currentStepFilePath,
  stateBeforeDir,
  listHostFiles,
  _resetCacheForTests,
};
