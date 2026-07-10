#!/usr/bin/env node
"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");

const { buildLoopBoard } = require("./loop-board.js");
const { parseCliArgs } = require("./loop-args.js");
const {
  executionConfigHash,
  loadLoopConfig,
  loadTrustedLoopConfig,
  sha256,
  stableValue,
} = require("./loop-config.js");
const { claimLease, findGitRoot, runGit } = require("./loop-git.js");
const {
  createRunId,
  scanSnapshotTransactions,
  withRemoteSnapshot,
} = require("./loop-pm-transaction.js");
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
  if (column === "shipping" || column === "reviewing") return `/pm:ship ${card.id}`;
  if (column === "ready_for_dev" || column === "implementing") return `/pm:dev ${card.id}`;
  if (column === "needs_rfc") return `/pm:rfc ${card.id}`;
  if (column === "needs_research") return `/pm:research ${card.id}`;
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
  const now = options.now instanceof Date ? options.now : new Date();

  for (const column of columns) {
    for (const card of board.columns[column] || []) {
      const retryAt = Date.parse(card.retryAfter || "");
      if (!Number.isNaN(retryAt) && retryAt > now.getTime()) {
        skipped.push({
          id: card.id,
          column,
          reason: "waiting until retry_after",
          retry_after: card.retryAfter,
        });
        continue;
      }

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

      if (typeof options.quarantineCheck === "function") {
        const quarantine = options.quarantineCheck(card, column, stageForColumn(column));
        if (quarantine && quarantine.quarantined) {
          skipped.push({
            id: card.id,
            column,
            reason: `preflight quarantine: ${quarantine.blocker_code || "blocked"}`,
            quarantine_expires_at: quarantine.expires_at || "",
          });
          continue;
        }
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

function sourceBaseOid(projectDir, options = {}) {
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot) return "";
  let branch = String(options.defaultBranch || "").trim();
  if (!branch) {
    try {
      const symbolic = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], gitRoot);
      branch = symbolic.replace(/^refs\/remotes\/origin\//, "");
    } catch {
      try {
        const remoteHead = runGit(["ls-remote", "--symref", "origin", "HEAD"], gitRoot);
        const match = remoteHead.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/m);
        branch = match ? match[1] : "";
      } catch {
        return "";
      }
    }
  }
  if (!branch || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) {
    return "";
  }
  try {
    return runGit(["rev-parse", `refs/remotes/origin/${branch}`], gitRoot);
  } catch {
    return "";
  }
}

function pmHeadOid(pmDir) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return "";
  try {
    return runGit(["rev-parse", "HEAD"], gitRoot);
  } catch {
    return "";
  }
}

function cardRevision(card) {
  if (card.sourcePath && fs.existsSync(card.sourcePath)) {
    return sha256(fs.readFileSync(card.sourcePath));
  }
  return sha256(JSON.stringify(stableValue(card)));
}

function fingerprintInput(card, column, stage, config, baseOid, pmHead) {
  return {
    version: 1,
    selected_id: card.id,
    stage,
    card_revision: cardRevision(card),
    eligibility: {
      column,
      status: card.status || "",
      implementation_approved: card.implementationApproved === true,
      command: commandForCard(card, column),
      branch: card.branch || "",
    },
    execution_config_hash: config.execution_config_hash || executionConfigHash(config),
    source_base_oid: baseOid,
    pm_head_oid: pmHead,
  };
}

function planFingerprint(input) {
  return sha256(JSON.stringify(stableValue(input)));
}

function hasUpstream(pmDir) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return false;
  try {
    runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], gitRoot);
    return true;
  } catch {
    return false;
  }
}

function runLoop(projectDir, options = {}) {
  const paths = options.pmDir
    ? {
        pmDir: options.pmDir,
        pmStateDir: options.pmStateDir || path.join(path.dirname(options.pmDir), ".pm"),
      }
    : resolvePmPaths(projectDir);
  const now = options.now instanceof Date ? options.now : new Date();
  let config = options.config || null;
  const baseOid =
    options.sourceBaseOid ||
    options.expectedPlan?.source_base_oid ||
    sourceBaseOid(projectDir, options);
  const planFromPmState = (authoritativePmDir, currentPmHead) => {
    const authoritativeConfigExists = fs.existsSync(
      path.join(authoritativePmDir, "loop", "config.json")
    );
    if ((!options.board && authoritativeConfigExists) || !config) {
      config =
        options.dryRun === false && options.claimOnly
          ? loadTrustedLoopConfig(authoritativePmDir, paths.pmStateDir)
          : loadLoopConfig(authoritativePmDir);
    }
    const board = options.board || buildLoopBoard(projectDir, { pmDir: authoritativePmDir, now });
    const fingerprintMeta = new Map();
    const selected = selectNextCard(board, config, {
      mode: options.mode || "default",
      quarantineCheck:
        typeof options.quarantineCheck === "function"
          ? (card, column, stage) => {
              const input = fingerprintInput(card, column, stage, config, baseOid, currentPmHead);
              const meta = {
                fingerprint: planFingerprint(input),
                fingerprint_input: input,
              };
              fingerprintMeta.set(card, meta);
              return options.quarantineCheck(card, meta);
            }
          : undefined,
    });
    const meta = selected.card ? fingerprintMeta.get(selected.card) : null;
    const fingerprint = selected.card
      ? meta?.fingerprint ||
        planFingerprint(
          fingerprintInput(
            selected.card,
            selected.column,
            selected.stage,
            config,
            baseOid,
            currentPmHead
          )
        )
      : "";
    const fingerprintInputValue = selected.card
      ? meta?.fingerprint_input ||
        fingerprintInput(
          selected.card,
          selected.column,
          selected.stage,
          config,
          baseOid,
          currentPmHead
        )
      : null;
    if (selected.card && authoritativePmDir !== paths.pmDir && selected.card.sourcePath) {
      selected.card.sourcePath = path.join(
        paths.pmDir,
        path.relative(authoritativePmDir, selected.card.sourcePath)
      );
    }
    return { selected, fingerprint, fingerprint_input: fingerprintInputValue };
  };

  const remoteBacked = !options.board && hasUpstream(paths.pmDir);
  const snapshotResult = remoteBacked
    ? withRemoteSnapshot(paths.pmDir, (snapshot) => {
        const pendingRecovery =
          options.skipRecoveryScan === true
            ? null
            : scanSnapshotTransactions(snapshot.pmDir, { now }).find(
                (entry) => entry.state !== "absent" && entry.state !== "finalized"
              );
        return {
          pendingRecovery,
          authoritative: pendingRecovery
            ? null
            : planFromPmState(snapshot.pmDir, snapshot.upstreamOid),
        };
      })
    : {
        pendingRecovery: null,
        authoritative: planFromPmState(paths.pmDir, pmHeadOid(paths.pmDir)),
      };
  if (snapshotResult.pendingRecovery) {
    const pendingRecovery = snapshotResult.pendingRecovery;
    return {
      run_id: options.runId || createRunId(),
      status: "recovery-required",
      mode: options.mode || "default",
      mutation: false,
      dry_run: options.dryRun !== false,
      generated_at: now.toISOString(),
      pmDir: paths.pmDir,
      source_base_oid: baseOid,
      selected: null,
      skipped: [],
      recovery: pendingRecovery,
      reason: `durable run ${pendingRecovery.run_id} requires ${pendingRecovery.state} handling before selection`,
    };
  }
  const authoritative = snapshotResult.authoritative;
  const selected = authoritative.selected;
  const runId = options.runId || options.expectedPlan?.run_id || createRunId();

  const plan = {
    run_id: runId,
    status: selected.card ? "planned" : "idle",
    mode: options.mode || "default",
    mutation: false,
    dry_run: options.dryRun !== false,
    generated_at: now.toISOString(),
    pmDir: paths.pmDir,
    source_base_oid: baseOid,
    selected: selected.card
      ? {
          id: selected.card.id,
          title: selected.card.title,
          kind: selected.card.kind,
          column: selected.column,
          stage: selected.stage,
          command: selected.command,
          branch: selected.card.branch || "",
          prs: selected.card.prs || [],
          prDispatchAt: selected.card.prDispatchAt || "",
          sourcePath: selected.card.sourcePath,
        }
      : null,
    skipped: selected.skipped,
  };

  if (selected.card) {
    plan.fingerprint_input = authoritative.fingerprint_input;
    plan.fingerprint = authoritative.fingerprint;
  }

  if (options.expectedPlan) {
    const expectedId = options.expectedPlan.selected && options.expectedPlan.selected.id;
    if (
      !selected.card ||
      selected.card.id !== expectedId ||
      plan.fingerprint !== options.expectedPlan.fingerprint
    ) {
      return {
        ...plan,
        status: "plan-stale",
        mutation: false,
        dry_run: false,
        reason: "exact plan changed after pull/reselection; refusing to substitute work",
        expected_selected_id: expectedId || "",
        expected_fingerprint: options.expectedPlan.fingerprint || "",
        current_fingerprint: plan.fingerprint || "",
      };
    }
  }

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

  if (!options.expectedPlan) {
    return {
      ...plan,
      status: "blocked",
      reason: "claim requires the exact read-only plan that passed preflight",
    };
  }

  if (typeof options.beforeClaim === "function") options.beforeClaim();

  const claim = claimLease(
    paths.pmDir,
    {
      cardId: selected.card.id,
      stage: selected.stage,
      holder: options.holder || os.hostname(),
      sourcePath: selected.card.sourcePath,
      runId,
      configFingerprint: plan.fingerprint_input.execution_config_hash,
      attempt: options.attempt || 1,
    },
    config,
    {
      skipPull: options.skipPull,
      skipPush: options.skipPush,
      allowUnsynced: options.allowUnsynced,
      expectedHeadOid: plan.fingerprint_input.pm_head_oid,
      expectedCardRevision: plan.fingerprint_input.card_revision,
      timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
    }
  );

  if (!claim.ok) {
    return {
      ...plan,
      status: claim.reason === "plan-stale-before-claim" ? "plan-stale" : "blocked",
      mutation: false,
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
    pmStateDir: "",
    mode: "default",
    dryRun: true,
    claimOnly: false,
    skipPull: false,
    skipPush: false,
    allowUnsynced: false,
    expectedPlanFile: "",
    format: "json",
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--pm-state-dir": { key: "pmStateDir", type: "string" },
      "--mode": { key: "mode", type: "string" },
      "--dry-run": { key: "dryRun", type: "boolean", value: true },
      "--no-dry-run": { key: "dryRun", type: "boolean", value: false },
      "--claim-only": { key: "claimOnly", type: "boolean" },
      "--skip-pull": { key: "skipPull", type: "boolean" },
      "--skip-push": { key: "skipPush", type: "boolean" },
      "--allow-unsynced": { key: "allowUnsynced", type: "boolean" },
      "--expected-plan": { key: "expectedPlanFile", type: "string" },
      "--format": { key: "format", type: "string" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  if (args.pmStateDir) args.pmStateDir = path.resolve(args.pmStateDir);
  if (args.expectedPlanFile) {
    args.expectedPlan = JSON.parse(fs.readFileSync(path.resolve(args.expectedPlanFile), "utf8"));
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
  cardRevision,
  fingerprintInput,
  planFingerprint,
  runLoop,
  selectNextCard,
  sourceBaseOid,
  stageForColumn,
};

if (require.main === module) {
  main();
}
