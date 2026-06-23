#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("./loop-board.js");
const { loadLoopConfig } = require("./loop-config.js");
const { claimLease } = require("./loop-git.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

const MODE_COLUMNS = {
  default: [
    "shipping",
    "reviewing",
    "implementing",
    "ready_for_dev",
    "needs_rfc",
    "needs_research",
  ],
  ship: ["shipping", "reviewing"],
  dev: ["implementing", "ready_for_dev"],
  research: ["needs_research"],
};

function commandForCard(card, column) {
  if (card.command) return card.command;
  if (column === "ready_for_dev" || column === "implementing") return `/pm:dev ${card.id}`;
  if (column === "needs_rfc") return `/pm:rfc ${card.id}`;
  if (column === "needs_research") return `/pm:research ${card.title}`;
  return "";
}

function stageForColumn(column) {
  if (column === "shipping") return "ship";
  if (column === "reviewing") return "review";
  if (column === "ready_for_dev" || column === "implementing") return "dev";
  if (column === "needs_rfc") return "rfc";
  if (column === "needs_research") return "research";
  return "work";
}

function selectNextCard(board, config, options = {}) {
  const mode = options.mode || "default";
  const columns = MODE_COLUMNS[mode] || MODE_COLUMNS.default;
  const skipped = [];

  for (const column of columns) {
    for (const card of board.columns[column] || []) {
      if (card.lease) {
        skipped.push({
          id: card.id,
          column,
          reason: "active lease",
        });
        continue;
      }

      if (
        (column === "ready_for_dev" || column === "implementing") &&
        !card.implementationApproved
      ) {
        skipped.push({
          id: card.id,
          column,
          reason: "implementation_approved: true required",
        });
        continue;
      }

      if (column === "ready_for_dev" && config.autonomy.start_dev !== true) {
        skipped.push({
          id: card.id,
          column,
          reason: "autonomy.start_dev disabled",
        });
        continue;
      }

      if (column === "needs_rfc" && config.autonomy.draft_rfc !== true) {
        skipped.push({
          id: card.id,
          column,
          reason: "autonomy.draft_rfc disabled",
        });
        continue;
      }

      if (column === "needs_research" && config.autonomy.research !== true) {
        skipped.push({
          id: card.id,
          column,
          reason: "autonomy.research disabled",
        });
        continue;
      }

      return {
        card,
        column,
        command: commandForCard(card, column),
        stage: stageForColumn(column),
        skipped,
      };
    }
  }

  return {
    card: null,
    column: "",
    command: "",
    stage: "",
    skipped,
  };
}

function appendEvent(pmDir, event) {
  const runId = event.run_id || event.runId || new Date().toISOString().replace(/[^0-9]/g, "");
  const dir = path.join(pmDir, "loop", "events");
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, `${runId}.jsonl`), `${JSON.stringify(event)}\n`);
}

function runLoop(projectDir, options = {}) {
  const paths = options.pmDir
    ? { pmDir: options.pmDir, pmStateDir: path.join(path.dirname(options.pmDir), ".pm") }
    : resolvePmPaths(projectDir);
  const now = options.now instanceof Date ? options.now : new Date();
  const config = options.config || loadLoopConfig(paths.pmDir);
  const board = options.board || buildLoopBoard(projectDir, { pmDir: paths.pmDir, now });
  const selected = selectNextCard(board, config, { mode: options.mode || "default" });
  const runId = options.runId || `loop-${now.toISOString().replace(/[^0-9]/g, "")}`;

  const plan = {
    run_id: runId,
    status: selected.card ? "planned" : "idle",
    mode: options.mode || "default",
    mutation: false,
    dry_run: options.dryRun !== false,
    generated_at: now.toISOString(),
    pmDir: paths.pmDir,
    selected: selected.card
      ? {
          id: selected.card.id,
          title: selected.card.title,
          kind: selected.card.kind,
          column: selected.column,
          stage: selected.stage,
          command: selected.command,
          sourcePath: selected.card.sourcePath,
        }
      : null,
    skipped: selected.skipped,
  };

  if (!selected.card || options.dryRun !== false) {
    return plan;
  }

  if (!options.claimOnly) {
    return {
      ...plan,
      status: "blocked",
      reason: "worker dispatch is not enabled; rerun with --dry-run or --claim-only",
    };
  }

  const claim = claimLease(
    paths.pmDir,
    {
      cardId: selected.card.id,
      stage: selected.stage,
      holder: options.holder || os.hostname(),
      sourcePath: selected.card.sourcePath,
      runId,
    },
    config,
    {
      skipPull: options.skipPull,
      skipPush: options.skipPush,
      allowUnsynced: options.allowUnsynced,
    }
  );

  if (!claim.ok) {
    return {
      ...plan,
      status: "blocked",
      reason: claim.reason,
      activeLease: claim.lease || null,
    };
  }

  const event = {
    run_id: runId,
    type: "lease_claimed",
    ts: now.toISOString(),
    card_id: selected.card.id,
    stage: selected.stage,
    lease_path: claim.filePath,
  };
  appendEvent(paths.pmDir, event);

  return {
    ...plan,
    status: "claimed",
    mutation: true,
    dry_run: false,
    lease: claim.lease,
  };
}

function parseArgs(argv) {
  const args = {
    projectDir: process.cwd(),
    pmDir: "",
    mode: "default",
    dryRun: true,
    claimOnly: false,
    skipPull: false,
    skipPush: false,
    allowUnsynced: false,
    format: "json",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--project-dir" && argv[index + 1]) {
      args.projectDir = path.resolve(argv[++index]);
    } else if (arg === "--pm-dir" && argv[index + 1]) {
      args.pmDir = path.resolve(argv[++index]);
    } else if (arg === "--mode" && argv[index + 1]) {
      args.mode = argv[++index];
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--no-dry-run") {
      args.dryRun = false;
    } else if (arg === "--claim-only") {
      args.claimOnly = true;
    } else if (arg === "--skip-pull") {
      args.skipPull = true;
    } else if (arg === "--skip-push") {
      args.skipPush = true;
    } else if (arg === "--allow-unsynced") {
      args.allowUnsynced = true;
    } else if (arg === "--format" && argv[index + 1]) {
      args.format = argv[++index];
    }
  }

  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = runLoop(args.projectDir, args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.status === "blocked" ? 2 : 0);
  } catch (err) {
    process.stderr.write(`loop-runner: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  MODE_COLUMNS,
  appendEvent,
  runLoop,
  selectNextCard,
  stageForColumn,
};

if (require.main === module) {
  main();
}
