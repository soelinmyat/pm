#!/usr/bin/env node
"use strict";

// Read-only situation classifier for the single-command /pm:loop router.
// Reads durable loop state (config, install, kill switch, board) and returns
// ONE JSON situation object with a `state` enum the router switches on.
// Never mutates, never throws — an assessment that fails soft to `unconfigured`.

const fs = require("node:fs");
const path = require("node:path");

const { parseCliArgs } = require("./loop-args.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { loadLoopConfig } = require("./loop-config.js");
const { buildLoopBoard } = require("./loop-board.js");
const { launchdLabel, plistInstallPath } = require("./loop-install.js");
const { isStopped, killSwitchPath } = require("./loop-worker.js");

// State precedence — the first that holds wins:
//   paused > in-progress > unconfigured > installed-idle > ready-not-run > no-work
function assessSituation(projectDir, options = {}) {
  let pmDir;
  try {
    ({ pmDir } = resolvePmPaths(projectDir));
  } catch {
    return unconfigured("Not a PM project (no pm/ knowledge base resolved).");
  }
  if (!pmDir || !fs.existsSync(pmDir)) {
    return unconfigured("Not a PM project (no pm/ knowledge base found).");
  }

  const configPath = path.join(pmDir, "loop", "config.json");
  const configured = fs.existsSync(configPath);
  let config = null;
  if (configured) {
    try {
      config = loadLoopConfig(pmDir);
    } catch (err) {
      // Config present but malformed — treat as configured-but-broken so the
      // router can send the user to fix it, not silently ignore it.
      return {
        state: "unconfigured",
        configured: true,
        installed: false,
        paused: false,
        board: emptyBoardView(),
        config: null,
        note: `Loop config is present but unreadable: ${err.message}`,
      };
    }
  }

  const paused = safe(() => isStopped(pmDir), false);
  const installed = safe(() => fs.existsSync(plistInstallPath(launchdLabel(projectDir))), false);

  let board = emptyBoardView();
  try {
    const full = buildLoopBoard(projectDir, options);
    board = summarizeBoard(full);
  } catch (err) {
    board = { ...emptyBoardView(), note: `Board unavailable: ${err.message}` };
  }

  const summary = {
    configured,
    installed,
    paused,
    board,
    config: config ? summarizeConfig(config) : null,
    killSwitch: paused ? safe(() => killSwitchPath(pmDir), null) : null,
    note: "",
  };

  if (!configured) return { ...summary, state: "unconfigured" };
  if (paused) return { ...summary, state: "paused" };
  if (board.activeLeases.length > 0) return { ...summary, state: "in-progress" };
  if (installed) return { ...summary, state: "installed-idle" };
  if (board.ready.length > 0) return { ...summary, state: "ready-not-run" };
  return { ...summary, state: "no-work" };
}

function summarizeBoard(full) {
  const columns = full.columns || {};
  const counts = {};
  for (const [name, cards] of Object.entries(columns)) counts[name] = cards.length;
  const ready = (columns.ready_for_dev || []).map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    parent: c.parent || null,
  }));
  const active = (full.leases && full.leases.active) || [];
  return {
    counts,
    ready,
    needsRfc: (columns.needs_rfc || []).length,
    needsHuman: (columns.needs_human || []).length,
    activeLeases: active.map((l) => ({
      card_id: l.card_id,
      stage: l.stage,
      holder: l.holder || null,
      runtime: l.runtime || null,
    })),
    note: "",
  };
}

function summarizeConfig(config) {
  const autonomy = config.autonomy || {};
  const budgets = config.budgets || {};
  const worker = config.worker || {};
  return {
    engine: worker.engine || "claude",
    merge_pr: autonomy.merge_pr === true,
    start_dev: autonomy.start_dev === true,
    interval_minutes: Number(config.scheduler_interval_minutes) || 30,
    max_runs_per_day: budgets.max_runs_per_day ?? null,
    max_ship_cycles_per_day: budgets.max_ship_cycles_per_day ?? null,
  };
}

function emptyBoardView() {
  return { counts: {}, ready: [], needsRfc: 0, needsHuman: 0, activeLeases: [], note: "" };
}

function unconfigured(note) {
  return {
    state: "unconfigured",
    configured: false,
    installed: false,
    paused: false,
    board: emptyBoardView(),
    config: null,
    note,
  };
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function parseArgs(argv) {
  const { args } = parseCliArgs(argv, {
    "--project-dir": { key: "projectDir", type: "string" },
    "--json": { key: "json", type: "boolean" },
  });
  return { projectDir: args.projectDir || process.cwd(), json: Boolean(args.json) };
}

function main() {
  const { projectDir, json } = parseArgs(process.argv.slice(2));
  const situation = assessSituation(projectDir);
  if (json) {
    process.stdout.write(`${JSON.stringify(situation, null, 2)}\n`);
  } else {
    process.stdout.write(`${situation.state}\n`);
  }
}

module.exports = { assessSituation };

if (require.main === module) {
  main();
}
