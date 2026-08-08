"use strict";

// Authoritative telemetry for canonical v2 workflow sessions. Hook-generated
// runs are engagement spans; the durable session.run_id is the workflow
// identity. A shared, lock-protected registry makes phase and terminal writes
// idempotent across main-checkout/worktree copies of the same session.

const crypto = require("node:crypto");
const path = require("node:path");

const { readAnalyticsFlag, writeActivity, writeStep, startRun } = require("../pm-log.js");
const { workflowStateFilePath } = require("./analytics-paths.js");
const { atomicWriteJson, readJson, withFileLock } = require("./analytics-engagements.js");

const TERMINAL_STATUSES = Object.freeze({
  dev: new Set(["complete", "handoff"]),
  groom: new Set(["complete"]),
  rfc: new Set(["complete"]),
});

const STEP_STATUS_BY_RESULT = Object.freeze({
  passed: "completed",
  failed: "failed",
  blocked: "blocked",
  noop: "completed",
});

function deriveProjectRoot(sessionPath) {
  let current = path.resolve(sessionPath);
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    if (path.basename(current) === ".pm") return parent;
    current = parent;
  }
}

function analyticsEnabled(projectRoot) {
  if (readAnalyticsFlag(projectRoot)) return true;
  const hostRoot = process.env.CLAUDE_PROJECT_DIR;
  return Boolean(hostRoot && hostRoot !== projectRoot && readAnalyticsFlag(hostRoot));
}

function resultIdentity(result) {
  if (!result) return null;
  const digest = crypto.createHash("sha256").update(JSON.stringify(result)).digest("hex");
  return `${result.phase}:${result.attempt}:${result.status}:${digest}`;
}

function initialState(workflow, session) {
  return {
    schema_version: 1,
    identity_kind: "workflow",
    workflow,
    workflow_run_id: session.run_id,
    slug: session.slug,
    status: "running",
    phase: session.phase || null,
    phase_started_at: session.created_at || new Date().toISOString(),
    emitted_results: [],
    emitted_blockers: [],
    terminal_status: null,
  };
}

function workflowMeta(session, extra = {}) {
  return JSON.stringify({
    identity_kind: "workflow",
    workflow_run_id: session.run_id,
    slug: session.slug,
    origin: "session-script",
    ...extra,
  });
}

function ensureStarted(workflow, session, projectRoot, state) {
  if (state.started_at) return;
  startRun(
    {
      skill: workflow,
      runId: session.run_id,
      detail: `slug=${session.slug}`,
      metaJson: workflowMeta(session),
    },
    projectRoot
  );
  state.started_at = new Date().toISOString();
}

function recordSessionTelemetry({ workflow, sessionPath, prevSession, session, result }) {
  try {
    if (!TERMINAL_STATUSES[workflow] || !session?.run_id || !session?.slug) return null;
    const projectRoot = deriveProjectRoot(sessionPath);
    if (!projectRoot || !analyticsEnabled(projectRoot)) return null;
    const statePath = workflowStateFilePath(projectRoot, session.run_id);

    return withFileLock(statePath, () => {
      const state = readJson(statePath, initialState(workflow, session));
      if (state.workflow_run_id !== session.run_id || state.workflow !== workflow) {
        throw new Error(`workflow telemetry identity collision for ${session.run_id}`);
      }
      ensureStarted(workflow, session, projectRoot, state);
      const now = new Date().toISOString();
      const resultId = resultIdentity(result);

      if (result && result.phase && !state.emitted_results.includes(resultId)) {
        writeStep(
          {
            skill: workflow,
            runId: session.run_id,
            phase: result.phase,
            step: result.phase,
            status: STEP_STATUS_BY_RESULT[result.status] || "completed",
            attempt: result.attempt,
            startedAt:
              state.phase === result.phase
                ? state.phase_started_at
                : session.created_at || undefined,
            endedAt: now,
            actor: "orchestrator",
            metaJson: workflowMeta(session, { result_status: result.status }),
          },
          projectRoot
        );
        state.emitted_results.push(resultId);
      }

      const isTerminal = TERMINAL_STATUSES[workflow].has(session.status);
      if (isTerminal && !state.terminal_status) {
        writeActivity(
          {
            skill: workflow,
            event: "completed",
            runId: session.run_id,
            status: "completed",
            detail: session.status,
            metaJson: workflowMeta(session),
          },
          projectRoot
        );
        state.status = "completed";
        state.terminal_status = session.status;
        state.completed_at = now;
      }

      if (session.status === "blocked" && (!prevSession || prevSession.status !== "blocked")) {
        const blocker = Array.isArray(session.blockers) ? session.blockers.at(-1) : null;
        const blockerId = `${resultId || "transition"}:${blocker?.code || blocker?.reason || "blocked"}`;
        if (!state.emitted_blockers.includes(blockerId)) {
          writeActivity(
            {
              skill: workflow,
              event: "blocked",
              runId: session.run_id,
              status: "blocked",
              detail: blocker ? blocker.code || blocker.reason : undefined,
              metaJson: workflowMeta(session),
            },
            projectRoot
          );
          state.emitted_blockers.push(blockerId);
        }
      }

      if (!isTerminal) {
        state.phase = session.phase || state.phase;
        state.phase_started_at = now;
      }
      atomicWriteJson(statePath, state);
      return session.run_id;
    });
  } catch (error) {
    process.stderr.write(`[pm-telemetry] ${error.message}\n`);
    return null;
  }
}

module.exports = { recordSessionTelemetry, deriveProjectRoot, resultIdentity };
