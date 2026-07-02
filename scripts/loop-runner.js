#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");

const { buildLoopBoard } = require("./loop-board.js");
const { parseCliArgs } = require("./loop-args.js");
const { loadLoopConfig } = require("./loop-config.js");
const { claimLease, ensureGitSyncReady, findGitRoot, runGit } = require("./loop-git.js");
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

      const implementingLimit = Number(config.wip_limits && config.wip_limits.implementing);
      if (
        column === "ready_for_dev" &&
        Number.isFinite(implementingLimit) &&
        implementingLimit >= 0 &&
        (board.columns.implementing || []).length >= implementingLimit
      ) {
        skipped.push({
          id: card.id,
          column,
          reason: "wip limit implementing reached",
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

function syncBeforeMutation(pmDir, config, options = {}) {
  if (options.skipPull) return false;
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) throw new Error(`Cannot find git root for ${pmDir}`);
  if (config.sync_required_for_mutation !== false && !options.allowUnsynced) {
    ensureGitSyncReady(gitRoot, pmDir);
  }
  runGit(["pull", "--rebase"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
  return true;
}

function runLoop(projectDir, options = {}) {
  const paths = options.pmDir
    ? { pmDir: options.pmDir, pmStateDir: path.join(path.dirname(options.pmDir), ".pm") }
    : resolvePmPaths(projectDir);
  const now = options.now instanceof Date ? options.now : new Date();
  const config = options.config || loadLoopConfig(paths.pmDir);
  const didPrePull =
    options.dryRun === false && options.claimOnly
      ? syncBeforeMutation(paths.pmDir, config, options)
      : false;
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
          branch: selected.card.branch || "",
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
      reason:
        "loop-runner selects and claims only; use scripts/loop-worker.js to execute, or rerun with --dry-run or --claim-only",
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
      skipPull: didPrePull || options.skipPull,
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

  if (claim.pushed !== true) {
    return {
      ...plan,
      status: "blocked",
      reason: claim.reason || "lease was not pushed; no durable claim",
      lease: claim.lease,
    };
  }

  return {
    ...plan,
    status: "claimed",
    mutation: true,
    dry_run: false,
    lease: claim.lease,
  };
}

function parseArgs(argv) {
  const defaults = {
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
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--mode": { key: "mode", type: "string" },
      "--dry-run": { key: "dryRun", type: "boolean", value: true },
      "--no-dry-run": { key: "dryRun", type: "boolean", value: false },
      "--claim-only": { key: "claimOnly", type: "boolean" },
      "--skip-pull": { key: "skipPull", type: "boolean" },
      "--skip-push": { key: "skipPush", type: "boolean" },
      "--allow-unsynced": { key: "allowUnsynced", type: "boolean" },
      "--format": { key: "format", type: "string" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
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
  runLoop,
  selectNextCard,
  stageForColumn,
  syncBeforeMutation,
};

if (require.main === module) {
  main();
}
