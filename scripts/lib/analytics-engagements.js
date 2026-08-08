"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { closeActiveStep, readAnalyticsFlag, writeActivity, startRun } = require("../pm-log.js");
const {
  engagementAgentStartsDir,
  engagementStateFilePath,
  hostSessionScratchDir,
  normalizeHostSessionId,
} = require("./analytics-paths.js");

const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function withFileLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 30_000) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(LOCK_WAIT, 0, 0, 10);
    }
  }
  if (!acquired) throw new Error(`analytics state lock timeout: ${lockPath}`);
  try {
    return callback();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

function emptyState(hostSessionId) {
  return {
    schema_version: 1,
    host_session_id: normalizeHostSessionId(hostSessionId),
    current_run_id: null,
    open_runs: {},
  };
}

function startEngagement({ projectRoot, hostSessionId, skill, detail }) {
  if (!readAnalyticsFlag(projectRoot)) return null;
  const sessionId = normalizeHostSessionId(hostSessionId);
  const statePath = engagementStateFilePath(projectRoot, sessionId);
  return withFileLock(statePath, () => {
    const state = readJson(statePath, emptyState(sessionId));
    const parentRunId = state.current_run_id || null;
    writeActivity(
      {
        skill,
        event: "invoked",
        detail: detail ? `args=${detail}` : undefined,
        metaJson: JSON.stringify({ identity_kind: "engagement", host_session_id: sessionId }),
      },
      projectRoot
    );
    const runId = startRun(
      {
        skill,
        detail,
        parentRunId,
        metaJson: JSON.stringify({ identity_kind: "engagement", host_session_id: sessionId }),
      },
      projectRoot
    );
    state.current_run_id = runId;
    state.open_runs[runId] = {
      skill,
      parent_run_id: parentRunId,
      started_at: new Date().toISOString(),
    };
    atomicWriteJson(statePath, state);
    return { run_id: runId, parent_run_id: parentRunId, state };
  });
}

function currentEngagement(projectRoot, hostSessionId) {
  const sessionId = normalizeHostSessionId(hostSessionId);
  const state = readJson(engagementStateFilePath(projectRoot, sessionId), null);
  if (!state?.current_run_id) return null;
  const current = state.open_runs?.[state.current_run_id];
  if (current) return { run_id: state.current_run_id, ...current };
  return null;
}

function legacyCurrentEngagement(projectRoot) {
  try {
    const root = path.join(projectRoot, ".pm", "analytics");
    const runId = fs.readFileSync(path.join(root, ".current-run"), "utf8").trim();
    const skill = fs.readFileSync(path.join(root, ".current-skill"), "utf8").trim();
    return runId ? { run_id: runId, skill: skill || "unknown", parent_run_id: null } : null;
  } catch {
    return null;
  }
}

function closeHostSession({ projectRoot, hostSessionId, status = "abandoned", detail }) {
  if (!readAnalyticsFlag(projectRoot)) return [];
  const sessionId = normalizeHostSessionId(hostSessionId);
  const statePath = engagementStateFilePath(projectRoot, sessionId);
  const closedRunIds = withFileLock(statePath, () => {
    const state = readJson(statePath, emptyState(sessionId));
    const runs = Object.entries(state.open_runs || {});
    if (runs.length === 0 && sessionId === "legacy") {
      const legacy = legacyCurrentEngagement(projectRoot);
      if (legacy) runs.push([legacy.run_id, legacy]);
      closeActiveStep(projectRoot, { status, endedAt: new Date().toISOString() });
    }
    for (const [runId, run] of runs.reverse()) {
      writeActivity(
        {
          skill: run.skill,
          event: "completed",
          runId,
          status,
          detail,
          metaJson: JSON.stringify({ identity_kind: "engagement", host_session_id: sessionId }),
        },
        projectRoot
      );
    }
    fs.rmSync(statePath, { force: true });
    fs.rmSync(engagementAgentStartsDir(projectRoot, sessionId), { recursive: true, force: true });
    if (sessionId === "legacy") {
      const legacyRoot = path.join(projectRoot, ".pm", "analytics");
      for (const name of [".current-run", ".current-skill", ".agent-starts"]) {
        fs.rmSync(path.join(legacyRoot, name), { recursive: true, force: true });
      }
    }
    return runs.map(([runId]) => runId);
  });
  // Keep the lock directory alive until withFileLock releases it. Removing the
  // whole session directory inside the critical section lets a concurrent
  // starter recreate the same lock, which the closing process could then
  // accidentally delete in its finally block.
  try {
    fs.rmdirSync(hostSessionScratchDir(projectRoot, sessionId));
  } catch {
    // A concurrent starter may already have recreated state, or the directory
    // may contain future session-scoped scratch files. Both are valid.
  }
  return closedRunIds;
}

module.exports = {
  atomicWriteJson,
  closeHostSession,
  currentEngagement,
  legacyCurrentEngagement,
  readJson,
  startEngagement,
  withFileLock,
};
