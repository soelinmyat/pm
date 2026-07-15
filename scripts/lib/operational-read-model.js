"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildLoopBoard, COLUMN_ORDER } = require("../loop-board.js");
const { configPath, loadLoopConfig } = require("../loop-config.js");
const { isStopped, readLedgers, runsDirFor, countRunsInLedgers } = require("../loop-worker.js");
const {
  listDevSessions,
  listGroomSessions,
  listRfcSessions,
  listThinkSessions,
} = require("./session-scan.js");
const { stableStringify } = require("./workflow-runtime/records.js");

const SCHEMA_VERSION = 1;
const RECENT_LIMIT = 10;

function portablePath(filePath, roots) {
  if (!filePath) return "";
  for (const [label, root] of roots) {
    const relative = path.relative(root, filePath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return `${label}/${relative.split(path.sep).join("/")}`;
    }
    if (!relative) return label;
  }
  return path.basename(filePath);
}

function portableMessage(message, roots) {
  let result = String(message || "");
  for (const [label, root] of roots) {
    result = result.split(root).join(label);
  }
  return result;
}

function artifactKind(card) {
  if (card.rfc) return "rfc";
  if (["proposal", "task", "bug"].includes(card.kind)) return card.kind;
  return "proposal";
}

function listSection(card) {
  if (
    String(card.status || "")
      .trim()
      .toLowerCase() === "shipped" ||
    card.column === "done"
  ) {
    return "shipped";
  }
  if (card.rfc) return "rfcs";
  return "proposals";
}

function sessionAction(session) {
  const id =
    session.linearId ||
    session.slug ||
    path.basename(session.filePath, path.extname(session.filePath));
  return `/pm:${session.kind} resume ${id}`;
}

function collectSessions(sourceDir, nowSecs) {
  const descriptors = [
    ...listGroomSessions({ sourceDir }),
    ...listRfcSessions({ sourceDir }),
    ...listDevSessions({ sourceDir }),
    ...listThinkSessions({ sourceDir }),
  ];
  return descriptors
    .map((session) => ({
      id:
        session.linearId ||
        `${session.kind}-${session.slug || path.basename(session.filePath, path.extname(session.filePath))}`,
      kind: session.kind,
      slug: session.slug || "",
      linear_id: session.linearId || "",
      topic: session.topic,
      phase: session.stage || "active",
      summary: session.summary || `${session.topic} — ${session.stage || "active"}`,
      updated_epoch: session.updatedEpoch,
      age_seconds: Math.max(0, nowSecs - session.updatedEpoch),
      action: session.next || sessionAction(session),
      source_path: portablePath(session.filePath, [["source", sourceDir]]),
    }))
    .sort(
      (left, right) => right.updated_epoch - left.updated_epoch || left.id.localeCompare(right.id)
    );
}

function durationSeconds(record) {
  const started = Date.parse(record.started_at || "");
  const ended = Date.parse(record.ended_at || "");
  if (Number.isNaN(started) || Number.isNaN(ended)) return null;
  return Math.max(0, Math.round((ended - started) / 1000));
}

function recentRuns(ledgers) {
  return ledgers
    .filter((record) => record.run_id || record.started_at)
    .sort((left, right) =>
      String(right.started_at || "").localeCompare(String(left.started_at || ""))
    )
    .slice(0, RECENT_LIMIT)
    .map((record) => ({
      run_id: record.run_id || null,
      card_id: record.card?.id || null,
      card_title: record.card?.title || null,
      stage: record.stage || null,
      outcome: record.status || null,
      started_at: record.started_at || null,
      ended_at: record.ended_at || null,
      duration_seconds: durationSeconds(record),
    }));
}

function loopState(pmDir, pmStateDir, now, ledgers) {
  const state = {
    installed: fs.existsSync(configPath(pmDir)),
    paused: isStopped(pmDir),
    runs: recentRuns(ledgers),
    budgets: {
      runs_today: countRunsInLedgers(ledgers, now),
      max_runs_per_day: 12,
      ship_cycles_today: countRunsInLedgers(ledgers, now, { stage: "ship" }),
      max_ship_cycles_per_day: 24,
    },
    error: null,
  };
  try {
    const budgets = loadLoopConfig(pmDir).budgets || {};
    state.budgets.max_runs_per_day = Number(budgets.max_runs_per_day) || 12;
    state.budgets.max_ship_cycles_per_day = Number(budgets.max_ship_cycles_per_day) || 24;
  } catch (error) {
    state.error = `loop config unreadable: ${error.message}`;
  }
  return state;
}

function recoveryActions(board, roots) {
  const actions = [];
  for (const lease of board.leases.expired) {
    actions.push({
      code: "inspect-expired-lease",
      target_id: lease.card_id || path.basename(lease.filePath || "expired-lease"),
      reason: "Lease expired without a validated completion or recovery checkpoint.",
      command: "/pm:loop reconcile",
      mutation_authority_required: false,
      source_path: portablePath(lease.filePath, roots),
    });
  }
  for (const lease of board.leases.invalid) {
    actions.push({
      code: "repair-invalid-lease",
      target_id: lease.card_id || path.basename(lease.filePath || "invalid-lease"),
      reason: portableMessage(
        lease.error || "Lease record is invalid and cannot prove ownership.",
        roots
      ),
      command: "/pm:loop reconcile",
      mutation_authority_required: false,
      source_path: portablePath(lease.filePath, roots),
    });
  }
  for (const card of board.cards) {
    if (!card.blockerRemediation) continue;
    actions.push({
      code: card.blockerCode || "resolve-card-blocker",
      target_id: card.id,
      reason: card.blocker || "Card requires recovery before dispatch.",
      command: card.blockerRemediation,
      mutation_authority_required: false,
      source_path: portablePath(card.sourcePath, roots),
    });
  }
  return actions.sort((left, right) =>
    `${left.code}:${left.target_id}`.localeCompare(`${right.code}:${right.target_id}`)
  );
}

function compatibilityCounts(lifecycle) {
  return {
    ideas: lifecycle.inbox + lifecycle.needs_research,
    planned: lifecycle.needs_rfc + lifecycle.ready_for_dev + lifecycle.needs_human,
    in_progress: lifecycle.implementing + lifecycle.reviewing + lifecycle.shipping,
    blocked: lifecycle.blocked,
    shipped: lifecycle.done,
  };
}

function observationRecord(snapshot) {
  return {
    sessions: snapshot.sessions.map(
      ({ id, kind, topic, phase, summary, updated_epoch, action }) => ({
        id,
        kind,
        topic,
        phase,
        summary,
        updated_epoch,
        action,
      })
    ),
    work_items: snapshot.work_items.map((item) => ({
      id: item.id,
      slug: item.slug,
      title: item.title,
      artifact_kind: item.artifact_kind,
      lifecycle: item.lifecycle,
      status: item.status,
      parent: item.parent,
      children: item.childrenSlugs,
      blocker: item.blocker || null,
      lease: item.lease
        ? {
            stage: item.lease.stage,
            holder: item.lease.holder,
            runtime: item.lease.runtime,
            claimed_at: item.lease.claimed_at,
            expires_at: item.lease.expires_at,
          }
        : null,
    })),
    leases: {
      active: snapshot.leases.active.map((lease) => ({
        card_id: lease.card_id || null,
        run_id: lease.run_id || null,
        stage: lease.stage || null,
        holder: lease.holder || null,
        expires_at: lease.expires_at || null,
      })),
      expired: snapshot.leases.expired.map((lease) => ({
        card_id: lease.card_id || null,
        run_id: lease.run_id || null,
        stage: lease.stage || null,
        expires_at: lease.expires_at || null,
      })),
      invalid: snapshot.leases.invalid.map(() => ({ error: "invalid lease record" })),
    },
    loop: snapshot.loop,
    recovery_actions: snapshot.recovery_actions.map(
      ({ code, target_id, reason, command, mutation_authority_required }) => ({
        code,
        target_id,
        reason,
        command,
        mutation_authority_required,
      })
    ),
  };
}

function projectWorkItem(card, roots) {
  return {
    id: card.id,
    slug: card.slug,
    title: card.title,
    kind: card.kind,
    status: card.status,
    priority: card.priority,
    rfc: card.rfc,
    branch: card.branch,
    size: card.size,
    prs: structuredClone(card.prs || []),
    prDispatchAt: card.prDispatchAt || "",
    blockerCode: card.blockerCode || "",
    blockerReason: card.blockerReason || "",
    blockerRemediation: card.blockerRemediation || "",
    loopRunId: card.loopRunId || "",
    loopLogPath: card.loopLogPath || "",
    retryAfter: card.retryAfter || "",
    parent: card.parent || null,
    childrenSlugs: structuredClone(card.childrenSlugs || []),
    implementationApproved: card.implementationApproved === true,
    updatedEpoch: Number(card.updatedEpoch) || 0,
    hasFrontmatter: card.hasFrontmatter !== false,
    origin: card.origin || null,
    column: card.column,
    blocker: card.blocker || null,
    command: card.command || null,
    lease: card.lease
      ? {
          stage: card.lease.stage || null,
          holder: card.lease.holder || null,
          runtime: card.lease.runtime || null,
          claimed_at: card.lease.claimed_at || null,
          expires_at: card.lease.expires_at || null,
        }
      : null,
    artifact_kind: artifactKind(card),
    lifecycle: card.column,
    list_section: listSection(card),
    source_path: portablePath(card.sourcePath, roots),
  };
}

function buildOperationalSnapshot(projectDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const board =
    options.board ||
    buildLoopBoard(projectDir, {
      pmDir: options.pmDir,
      sourceDir: options.sourceDir,
      now,
      includeLocal: false,
    });
  const { pmDir, pmStateDir, sourceDir } = board.meta;
  const roots = [
    ["pm", pmDir],
    ["state", pmStateDir],
    ["source", sourceDir],
  ];
  const ledgers = options.ledgers || readLedgers(runsDirFor({ pmStateDir }));
  const loop = loopState(pmDir, pmStateDir, now, ledgers);
  const sessions = collectSessions(sourceDir, Math.floor(now.getTime() / 1000));
  const workItems = board.cards.map((card) => projectWorkItem(card, roots));
  const columns = Object.fromEntries(
    COLUMN_ORDER.map((name) => [
      name,
      workItems.filter((item) => item.lifecycle === name).map((item) => item.id),
    ])
  );
  const lifecycle = Object.fromEntries(COLUMN_ORDER.map((name) => [name, columns[name].length]));
  const recovery = recoveryActions(board, roots);
  const deliveredItems = workItems
    .filter((item) => item.lifecycle === "done")
    .sort((left, right) => right.updatedEpoch - left.updatedEpoch)
    .slice(0, RECENT_LIMIT)
    .map((item) => ({ id: item.id, title: item.title, artifact_kind: item.artifact_kind }));

  const snapshot = {
    schema_version: SCHEMA_VERSION,
    meta: {
      generated_at: now.toISOString(),
      observation_id: "",
      pm_dir: pmDir,
      pm_state_dir: pmStateDir,
      source_dir: sourceDir,
      durable_source: "git",
    },
    sessions,
    work_items: workItems,
    columns,
    leases: structuredClone(board.leases),
    loop,
    recent_delivery: { items: deliveredItems, runs: loop.runs },
    recovery_actions: recovery,
    counts: { lifecycle, compatibility: compatibilityCounts(lifecycle) },
  };
  snapshot.meta.observation_id = `op_${crypto
    .createHash("sha256")
    .update(stableStringify(observationRecord(snapshot)))
    .digest("hex")}`;
  return snapshot;
}

module.exports = {
  RECENT_LIMIT,
  SCHEMA_VERSION,
  artifactKind,
  buildOperationalSnapshot,
  compatibilityCounts,
  projectWorkItem,
  recentRuns,
};
