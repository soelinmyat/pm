"use strict";

// Telemetry emission for the v2 session scripts (dev/groom/rfc).
//
// The automatic hook layer (hooks/analytics-log, hooks/state-step) can only
// observe Skill and Write/Edit tool calls. The v2 session scripts mutate
// session.json through Bash, which those hooks never see — so genuine
// completion terminals and phase step spans must be emitted here, at the
// state-mutation choke point, where phase/status/attempt are known exactly.
//
// Run correlation: hooks/analytics-log starts an activity run per pm:* skill
// invocation and records it in <project>/.pm/analytics/.current-run and
// .current-skill. This module adopts that run when .current-skill matches the
// workflow, and remembers the binding per workflow+slug in .run-map.json in
// the same scratch directory so a nested sub-skill invocation (dev -> review)
// cannot re-attribute the parent workflow's spans. When no hook run exists
// (headless callers, missed hook), it self-starts one so the stream stays
// complete.
//
// Every entry point is best-effort: telemetry must never fail or block a
// session mutation. Errors are reported on stderr and swallowed.

const fs = require("node:fs");
const path = require("node:path");

const { readAnalyticsFlag, writeActivity, writeStep, startRun } = require("../pm-log.js");
const {
  scratchDir: scratchDirFor,
  currentRunFilePath,
  currentSkillFilePath,
  runMapFilePath,
} = require("./analytics-paths.js");

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

// Sessions live at <projectRoot>/.pm/<workflow>-sessions/.../session.json.
// Walking up to the `.pm` ancestor is deterministic and worktree-correct,
// unlike guessing from cwd.
function deriveProjectRoot(sessionPath) {
  let current = path.resolve(sessionPath);
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    if (path.basename(current) === ".pm") {
      return parent;
    }
    current = parent;
  }
}

// Scratch paths must match hooks/analytics-log, which resolves via
// CLAUDE_PROJECT_DIR. Fall back to the session-derived root outside a hook
// environment.
function scratchRoot(projectRoot) {
  return process.env.CLAUDE_PROJECT_DIR || projectRoot;
}

function readScratchFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function readRunMap(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(runMapFilePath(root), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeRunMap(root, map) {
  fs.mkdirSync(scratchDirFor(root), { recursive: true });
  fs.writeFileSync(runMapFilePath(root), `${JSON.stringify(map, null, 2)}\n`);
}

function clearCurrentRun(root, runId) {
  // Only clear when the marker still points at this run: a nested sub-skill
  // may own the marker by now, and session-end must still close that run.
  if (readScratchFile(currentRunFilePath(root)) !== runId) {
    return;
  }
  for (const filePath of [currentRunFilePath(root), currentSkillFilePath(root)]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // already gone
    }
  }
}

function resolveRun({ workflow, slug, projectRoot, root, map }) {
  const key = `${workflow}:${slug}`;
  const currentRun = readScratchFile(currentRunFilePath(root));
  const currentSkill = readScratchFile(currentSkillFilePath(root));
  const entry = map[key];

  // A fresh pm:<workflow> invocation re-binds the workflow to the hook's new
  // run (one activity run per engagement; the workflow may span several).
  if (currentRun && currentSkill === workflow) {
    if (!entry || entry.run_id !== currentRun) {
      map[key] = { run_id: currentRun, phase: null, phase_started_at: null };
    }
    return map[key];
  }
  if (entry && entry.run_id) {
    return entry;
  }
  // No hook-started run to adopt — self-start one so spans and terminals are
  // never dropped (headless callers, missed hook).
  const runId = startRun(
    {
      skill: workflow,
      detail: `slug=${slug}`,
      metaJson: JSON.stringify({ origin: "session-script" }),
    },
    projectRoot
  );
  map[key] = { run_id: runId, phase: null, phase_started_at: null };
  return map[key];
}

// Record telemetry for one session mutation. Call after the mutated session
// has been persisted, with the previous and next session states and, for
// phase recordings, the result envelope that drove the mutation.
function recordSessionTelemetry({ workflow, sessionPath, prevSession, session, result }) {
  try {
    if (!TERMINAL_STATUSES[workflow]) {
      return null;
    }
    const projectRoot = deriveProjectRoot(sessionPath);
    if (!projectRoot || !readAnalyticsFlag(projectRoot)) {
      return null;
    }
    const root = scratchRoot(projectRoot);
    const map = readRunMap(root);
    const key = `${workflow}:${session.slug}`;
    const entry = resolveRun({ workflow, slug: session.slug, projectRoot, root, map });
    const runId = entry.run_id;
    const now = new Date().toISOString();

    if (result && result.phase) {
      writeStep(
        {
          skill: workflow,
          runId,
          phase: result.phase,
          step: result.phase,
          status: STEP_STATUS_BY_RESULT[result.status] || "completed",
          attempt: result.attempt,
          startedAt: entry.phase === result.phase ? entry.phase_started_at : undefined,
          endedAt: now,
          actor: "orchestrator",
          metaJson: JSON.stringify({
            workflow_run_id: session.run_id,
            result_status: result.status,
          }),
        },
        projectRoot
      );
    }

    const wasTerminal = TERMINAL_STATUSES[workflow].has(prevSession ? prevSession.status : "");
    const isTerminal = TERMINAL_STATUSES[workflow].has(session.status);
    if (isTerminal && !wasTerminal) {
      writeActivity(
        {
          skill: workflow,
          event: "completed",
          runId,
          status: "completed",
          detail: session.status,
          metaJson: JSON.stringify({ workflow_run_id: session.run_id, origin: "session-script" }),
        },
        projectRoot
      );
      delete map[key];
      writeRunMap(root, map);
      // A genuinely completed run must not be re-closed as abandoned by
      // hooks/session-end.
      clearCurrentRun(root, runId);
      return runId;
    }

    if (session.status === "blocked" && (!prevSession || prevSession.status !== "blocked")) {
      const blocker = Array.isArray(session.blockers) ? session.blockers.at(-1) : null;
      writeActivity(
        {
          skill: workflow,
          event: "blocked",
          runId,
          status: "blocked",
          detail: blocker ? blocker.code || blocker.reason : undefined,
          metaJson: JSON.stringify({ workflow_run_id: session.run_id }),
        },
        projectRoot
      );
    }

    map[key] = { run_id: runId, phase: session.phase, phase_started_at: now };
    writeRunMap(root, map);
    return runId;
  } catch (error) {
    process.stderr.write(`[pm-telemetry] ${error.message}\n`);
    return null;
  }
}

module.exports = { recordSessionTelemetry, deriveProjectRoot };
