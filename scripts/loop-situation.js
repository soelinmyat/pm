#!/usr/bin/env node
"use strict";

// Read-only situation classifier for the single-command /pm:loop router.
// Reads durable loop state (config, install, kill switch, board) and returns
// ONE JSON situation object with a `state` enum the router switches on.
// Never mutates, never throws — an assessment that fails soft to `unconfigured`.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const { parseCliArgs } = require("./loop-args.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { loadLoopConfig, loadTrustedLoopConfig, configPath } = require("./loop-config.js");
const { buildLoopBoard } = require("./loop-board.js");
const { buildInstallExposure, launchdLabel } = require("./loop-install.js");
const { evaluateCurrentCanaryReleaseGate } = require("./loop-canary.js");
const { isStopped, killSwitchPath, countRunsToday, runsDirFor } = require("./loop-worker.js");

// State precedence, as implemented (config is the precondition for every other
// state, so it's checked first): unconfigured > paused > in-progress >
// canary-required > installed-idle > ready-not-run > no-work.
function assessSituation(projectDir, options = {}) {
  let pmDir;
  let pmStateDir;
  try {
    ({ pmDir, pmStateDir } = resolvePmPaths(projectDir));
  } catch {
    return unconfigured("Not a PM project (no pm/ knowledge base resolved).");
  }
  if (!pmDir || !fs.existsSync(pmDir)) {
    return unconfigured("Not a PM project (no pm/ knowledge base found).");
  }

  const configured = fs.existsSync(configPath(pmDir));
  let config = null;
  if (configured) {
    try {
      config = loadLoopConfig(pmDir);
    } catch (err) {
      // Config present but malformed (bad JSON, or well-formed-but-wrong-type,
      // which loadLoopConfig now rejects) — route the operator to fix it rather
      // than proceed on silently-substituted permissive defaults.
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
  const installed =
    typeof options.installedProbe === "function"
      ? safe(() => Boolean(options.installedProbe(projectDir)), false)
      : detectInstalled(projectDir);

  let board = emptyBoardView();
  try {
    board = summarizeBoard(buildLoopBoard(projectDir, { ...options, pmDir }));
  } catch (err) {
    board = { ...emptyBoardView(), note: `Board unavailable: ${err.message}` };
  }

  const budget = safe(
    () => ({
      runs_today: countRunsToday(runsDirFor({ pmDir, pmStateDir })),
      ship_cycles_today: countRunsToday(runsDirFor({ pmDir, pmStateDir }), undefined, {
        stage: "ship",
      }),
    }),
    { runs_today: null, ship_cycles_today: null }
  );

  const needsReleaseGate = Boolean(
    config && (paused || (installed && board.activeLeases.length === 0))
  );
  const releaseGate = needsReleaseGate
    ? safe(
        () =>
          typeof options.releaseGateProbe === "function"
            ? options.releaseGateProbe({ projectDir, pmDir, pmStateDir, config })
            : evaluateCurrentCanaryReleaseGate(
                pmStateDir,
                loadTrustedLoopConfig(pmDir, pmStateDir)
              ),
        { passed: false, reason: "current canary identity is unavailable" }
      )
    : {
        passed: false,
        applicable: false,
        reason: config
          ? "canary gate is not needed for the current situation"
          : "loop is not configured",
      };

  const summary = {
    configured,
    installed,
    paused,
    board,
    budget,
    config: config ? summarizeConfig(config) : null,
    releaseGate,
    killSwitch: paused ? safe(() => killSwitchPath(pmDir), null) : null,
    note: "",
  };

  // Config is momentarily absent (a reset/reconfigure) but a kill switch or a
  // live lease remains — don't silently walk the operator into fresh setup.
  if (!configured) {
    let note = "";
    if (paused)
      note = "Loop is paused (kill switch set) but has no config — resume or reconfigure.";
    else if (board.activeLeases.length > 0)
      note = "A lease is active but there is no loop config — a prior run may be mid-flight.";
    return { ...summary, state: "unconfigured", note };
  }
  if (paused) return { ...summary, state: "paused" };
  if (board.activeLeases.length > 0) return { ...summary, state: "in-progress" };
  if (installed && !summary.releaseGate.passed) {
    return {
      ...summary,
      state: "canary-required",
      note: `Installed scheduler lacks current canary evidence: ${summary.releaseGate.reason}`,
    };
  }
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
      claimed_at: l.claimed_at || null,
      expires_at: l.expires_at || null,
      // The card may have been deleted at retro close-out while its lease
      // lingers (TTL-bounded). Surface whether the card still exists so the
      // router can flag a stale claim rather than present it as live work.
      cardExists: Boolean((full.cards || []).find((c) => c.id === l.card_id)),
    })),
    note: "",
  };
}

function summarizeConfig(config) {
  const autonomy = config.autonomy || {};
  const budgets = config.budgets || {};
  const worker = config.worker || {};
  const exposure = buildInstallExposure(config);
  return {
    // Mirror the worker's own resolution (engineCommand) so the router reports
    // the engine that will actually run, not a wrong default.
    engine: worker.engine || config.default_runtime || "codex",
    merge_pr: autonomy.merge_pr === true,
    start_dev: autonomy.start_dev === true,
    interval_minutes: Number(config.scheduler_interval_minutes) || 30,
    max_runs_per_day: budgets.max_runs_per_day ?? null,
    max_ship_cycles_per_day: budgets.max_ship_cycles_per_day ?? null,
    ...exposure,
  };
}

// Real scheduler-installed detection, not just "the plist file exists" (which
// is never removed on stop → a dead loop reads as installed). launchd on
// darwin: `launchctl print` a loaded label exits 0; cron elsewhere: the worker
// script appears in the crontab. Fails soft to false.
function detectInstalled(projectDir) {
  const label = safe(() => launchdLabel(projectDir), null);
  if (!label) return false;
  if (process.platform === "darwin") {
    return safe(() => {
      execFileSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], {
        stdio: "ignore",
      });
      return true;
    }, false);
  }
  return safe(() => {
    const crontab = execFileSync("crontab", ["-l"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return crontab.includes("loop-worker") || crontab.includes(label);
  }, false);
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
    releaseGate: { passed: false, reason: "loop is not configured" },
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
  return {
    projectDir: path.resolve(args.projectDir || process.cwd()),
    json: Boolean(args.json),
  };
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
