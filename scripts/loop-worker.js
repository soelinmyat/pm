#!/usr/bin/env node
"use strict";

// Loop worker — the execution slice of pm:loop.
//
// One invocation = at most one unit of work: guard (kill switch, budget),
// select + durably claim one card (loop-runner), bootstrap an isolated
// worktree, run the engine CLI headless, record a crash-safe run ledger,
// release the lease, clean up.
//
// Vendor exposure is confined to engineCommand(): the engine is a swappable
// headless CLI (codex exec / claude -p / custom). Everything else — scheduling,
// queue, leases, state — is git + node.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { parseCliArgs } = require("./loop-args.js");
const {
  DEFAULT_LOOP_CONFIG,
  loadLoopConfig,
  loadTrustedLoopConfig,
  sha256,
} = require("./loop-config.js");
const { engineCommand } = require("./loop-engine.js");
const { bootstrapWorktree } = require("./worktree-bootstrap.js");
const {
  findGitRoot,
  removeWorkspace,
  runGit,
  sanitizeId,
  writeJsonAtomic,
} = require("./loop-git.js");
const { runLoop } = require("./loop-runner.js");
const {
  checkpointRecovery,
  finalizeRun,
  markRunDispatched,
  releaseClaim,
  withRemoteSnapshot,
} = require("./loop-pm-transaction.js");
const { buildContractFailureResult, buildStageTransition } = require("./loop-card-state.js");
const {
  activeQuarantineForPlan,
  copyReadContext,
  recordQuarantine,
  runPreflight,
  snapshotProtectedPmState,
} = require("./loop-preflight.js");
const {
  createRunResultCapability,
  readStageResult,
  verifyCommittedGateSidecar,
  verifyDocumentArtifact,
} = require("./loop-result.js");
const { verifyPullRequest } = require("./pr-state.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

const ENGINE_MAX_BUFFER = 32 * 1024 * 1024;

function killSwitchPath(pmDir) {
  return path.join(pmDir, "loop", "STOP");
}

function isStopped(pmDir) {
  return fs.existsSync(killSwitchPath(pmDir));
}

function runsDirFor(paths) {
  // ponytail: run ledger + logs live in the local state dir (.pm), not the
  // committed pm/ tree — budgets are per-machine in this slice.
  return path.join(paths.pmStateDir, "loop-runs");
}

function readLedgers(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const ledgers = [];
  for (const entry of fs.readdirSync(runsDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      ledgers.push(JSON.parse(fs.readFileSync(path.join(runsDir, entry), "utf8")));
    } catch {
      // unreadable ledger entries still count toward budgets: fail closed
      ledgers.push({ status: "unreadable", started_at: "9999-12-31T00:00:00Z" });
    }
  }
  return ledgers;
}

function isShipLedger(record) {
  return record.stage === "ship" || record.stage === "review";
}

// Ship cycles poll external state and get their own budget so a slow PR
// cannot starve dev dispatch (and vice versa). Stage-less legacy ledgers
// count toward the main budget: fail closed.
function countRunsInLedgers(ledgers, now = new Date(), opts = {}) {
  const today = now.toISOString().slice(0, 10);
  return ledgers.filter((record) => {
    const sameDay =
      String(record.started_at || "").slice(0, 10) === today || record.status === "unreadable";
    if (!sameDay) return false;
    if (opts.stage === "ship") return isShipLedger(record);
    return !isShipLedger(record);
  }).length;
}

function countRunsToday(runsDir, now = new Date(), opts = {}) {
  return countRunsInLedgers(readLedgers(runsDir), now, opts);
}

// Normal waiting/blocked/success terminals do not consume failure attempts.
// Unknown legacy statuses still count so unreadable or old failures fail closed.
function countCardAttempts(runsDir, cardId, stage) {
  const nonFailures = new Set([
    "completed",
    "waiting",
    "artifact-ready",
    "ready-for-human",
    "blocked",
  ]);
  return readLedgers(runsDir).filter(
    (record) =>
      record.card &&
      record.card.id === cardId &&
      (record.stage || "dev") === stage &&
      !nonFailures.has(record.status)
  ).length;
}

// Card `command` values are git-synced frontmatter — an injection surface for
// unattended runs. Only dispatch commands the loop itself generates.
const DISPATCHABLE_COMMAND = /^\/pm:(dev|ship|rfc|research) [A-Za-z0-9 ._-]{1,120}$/;

function isDispatchableCommand(command) {
  return DISPATCHABLE_COMMAND.test(String(command || ""));
}

function buildPrompt(plan, config = {}) {
  const card = plan.selected;
  const mergeAutonomy = Boolean(config.autonomy && config.autonomy.merge_pr === true);
  const stage = plan.selected.stage || "dev";

  // Ship is event-driven (CI runs, remote review rounds) and cannot finish in
  // one engine run. Each wake runs ONE bounded ship cycle against the durable
  // PR; the wake cadence is the iteration loop.
  if (stage === "ship" || stage === "review") {
    const mergeRule = mergeAutonomy
      ? "- Merge only when every review gate and CI check is green; never bypass a failing check."
      : "- Do NOT merge. When the PR is green and review threads are resolved, return ready-for-human.";
    return [
      "You are an autonomous PM loop worker running ONE bounded ship cycle for an existing pull request.",
      `Execute: ${card.command}`,
      `Backlog card: ${card.id} — ${card.title} (branch: ${card.branch || "see card"})`,
      "Rules:",
      "- Work only inside this worktree, on the existing branch.",
      "- One cycle only: assess CI status and new review comments, fix what is actionable now, push, then stop.",
      "- If CI is still running or you are waiting on external state, stop and report — the next wake continues.",
      mergeRule,
      "- Do not write backlog/card state. The loop worker is the only canonical durable card-state writer.",
      "- Atomically write the version-1 stage result to PM_LOOP_RESULT_FILE. Allowed statuses: merged, ready-for-human, waiting, blocked, failed, noop.",
      "- If a gate requires human approval or input, stop and state exactly what is needed.",
    ].join("\n");
  }

  if (stage === "rfc" || stage === "research") {
    return [
      "You are an autonomous PM loop worker running unattended in an isolated git worktree.",
      `Execute: ${card.command}`,
      `Backlog card: ${card.id} — ${card.title} (kind: ${card.kind || "unknown"})`,
      "Rules:",
      "- Work only inside this worktree.",
      "- Produce the artifact the workflow defines (RFC draft or research findings); do NOT open pull requests or merge anything.",
      "- Do not write backlog/card state. The loop worker is the only canonical durable card-state writer.",
      `- Create the document under PM_LOOP_RESULT_DIR with mode 0600, then atomically write the version-1 ${stage} result to PM_LOOP_RESULT_FILE with its document payload; RFC approval is always human.`,
      "- If input is needed, stop and state exactly what is required.",
    ].join("\n");
  }

  const terminalRules = [
    "- Open a pull request for the work; do NOT merge it in this run.",
    "- Do not write backlog/card state. The loop worker is the only canonical durable card-state writer.",
    "- Atomically write the version-1 dev result to PM_LOOP_RESULT_FILE. Allowed statuses: shipped, blocked, failed, noop.",
    "- A shipped result includes the pull-request repo, number, URL, base, head, head OID, and creation time; subsequent wakes run ship cycles" +
      (mergeAutonomy ? " and may merge." : "; a human merges."),
  ];
  return [
    "You are an autonomous PM loop worker running unattended in an isolated git worktree.",
    `Execute: ${card.command}`,
    `Backlog card: ${card.id} — ${card.title} (kind: ${card.kind || "unknown"})`,
    "Rules:",
    "- Work only inside this worktree.",
    "- Follow the workflow's gates; never skip or self-approve a gate.",
    ...terminalRules,
    "- If a gate requires human approval or input, stop and state exactly what is needed.",
  ].join("\n");
}

function isSafeBranchRef(branch) {
  if (branch.includes("..") || branch.endsWith(".lock") || branch.endsWith("/")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(branch);
}

function branchRefExists(gitRoot, branch, options = {}) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    try {
      runGit(["rev-parse", "--verify", "--quiet", ref], gitRoot, {
        timeout: options.timeout,
      });
      return true;
    } catch {
      // try the next ref namespace
    }
  }
  return false;
}

function prepareWorkspace(gitRoot, plan, config, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const worker = config.worker || {};
  const envelope = config.claim_envelope || DEFAULT_LOOP_CONFIG.claim_envelope;
  const slug = sanitizeId(plan.selected.id);
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 12);
  const shipStage = plan.selected.stage === "ship" || plan.selected.stage === "review";
  const branchTimeout = Number(envelope.branch_promotion_seconds) * 1000;
  const bootstrapTimeout = Number(envelope.bootstrap_recheck_seconds) * 1000;
  const cleanupTimeout = Number(envelope.workspace_cleanup_seconds) * 1000;
  const existingBranch = String(plan.selected.branch || "");
  if (shipStage) {
    // branch comes from git-synced card frontmatter — same injection surface
    // as the command field. Validate shape, then verify the ref exists.
    if (!existingBranch) return { ok: false, reason: "ship-branch-missing" };
    if (!isSafeBranchRef(existingBranch)) {
      return { ok: false, reason: "ship-branch-invalid" };
    }
    if (!branchRefExists(gitRoot, existingBranch, { timeout: branchTimeout })) {
      return { ok: false, reason: "ship-branch-not-found" };
    }
  }
  const branch = shipStage ? existingBranch : `loop/${slug}-${stamp}`;
  const workspacePath = path.join(gitRoot, ".worktrees", `loop-${slug}-${stamp}`);

  if (fs.existsSync(workspacePath)) {
    return { ok: false, reason: "workspace-exists", workspacePath };
  }

  try {
    runGit(["fetch", "origin"], gitRoot, { timeout: branchTimeout });
    if (shipStage) {
      runGit(["worktree", "add", workspacePath, branch], gitRoot, {
        timeout: branchTimeout,
      });
      // Each cycle starts from the remote tip so pushes from humans or other
      // machines are never ignored or clobbered by a stale local branch.
      runGit(["reset", "--hard", `origin/${branch}`], workspacePath, {
        timeout: branchTimeout,
      });
    } else {
      if (!plan.source_base_oid) {
        return { ok: false, reason: "source-base-missing" };
      }
      runGit(["worktree", "add", workspacePath, "-b", branch, plan.source_base_oid], gitRoot, {
        timeout: branchTimeout,
      });
    }
  } catch (err) {
    return { ok: false, reason: "worktree-add-failed", error: err.message };
  }

  // Fresh worktrees miss gitignored-but-required files (env files, generated
  // specs) — the top recurring field failure. Copy them from the main checkout
  // and run the bootstrap command. Shared with the dev worktree path via
  // scripts/worktree-bootstrap.js so both honor the same worker.bootstrap_*
  // config keys.
  const boot = bootstrapWorktree(gitRoot, workspacePath, worker, {
    timeoutMs: bootstrapTimeout,
  });
  if (!boot.ok) {
    const workspaceRemoved = removeWorkspace(gitRoot, workspacePath, { timeout: cleanupTimeout });
    if (!shipStage && workspaceRemoved) {
      try {
        runGit(["branch", "-D", branch], gitRoot, { timeout: cleanupTimeout });
      } catch {
        // The worktree removal may already have removed the new branch.
      }
    }
    return {
      ok: false,
      reason: boot.reason,
      workspacePath,
      branch,
      error: boot.error,
      workspaceRemoved,
    };
  }

  const readContext = copyReadContext(plan.pmDir, workspacePath, plan);
  if (!readContext.ok) {
    removeWorkspace(gitRoot, workspacePath, { timeout: cleanupTimeout });
    if (!shipStage) {
      try {
        runGit(["branch", "-D", branch], gitRoot);
      } catch {
        // The worktree cleanup may already have removed the new branch.
      }
    }
    return { ok: false, reason: "read-context-unsafe", workspacePath, branch };
  }

  return {
    ok: true,
    workspacePath,
    branch,
    bootstrapFiles: boot.copied,
  };
}

function releaseLease(pmDir, lease, options = {}) {
  const releaseTransaction = options.releaseClaim || releaseClaim;
  const result = releaseTransaction(
    pmDir,
    {
      runId: lease.run_id,
      cardId: lease.card_id,
      stage: lease.stage,
      reason: options.reason || "legacy-worker-release",
      eventStatus: options.eventStatus || options.reason || "released",
    },
    {
      skipPush: options.skipPush,
      maxAttempts: options.maxAttempts || options.config?.claim_envelope?.cas_attempts,
      timeoutMs: options.config?.claim_envelope?.pm_finalization_seconds
        ? Number(options.config.claim_envelope.pm_finalization_seconds) * 1000
        : undefined,
    }
  );
  return { ...result, released: result.ok === true };
}

const RESULT_SUCCESSES = new Set([
  "shipped",
  "merged",
  "ready-for-human",
  "waiting",
  "artifact-ready",
  "needs-approval",
]);

function sourceRepository(gitRoot) {
  let remote;
  try {
    remote = runGit(["remote", "get-url", "origin"], gitRoot);
  } catch {
    return "";
  }
  const match = String(remote).match(
    /(?:github\.com[/:]|^[^/]+\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/
  );
  return match ? match[1].replace(/\.git$/, "") : "";
}

function defaultBranchName(gitRoot) {
  try {
    return runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], gitRoot).replace(
      /^origin\//,
      ""
    );
  } catch {
    return "main";
  }
}

function claimedCardSnapshot(pmDir, lease, options = {}) {
  return withRemoteSnapshot(
    pmDir,
    (snapshot) => {
      const relativePath = lease.source_path;
      const cardPath = path.join(snapshot.workspace, ...relativePath.split("/"));
      if (!fs.existsSync(cardPath)) throw new Error("claimed card is missing from PM snapshot");
      return {
        content: fs.readFileSync(cardPath, "utf8"),
        relativePath,
        pmRelative: snapshot.pmRelative,
      };
    },
    options
  );
}

function processEvidence(spawnResult, timeoutMs) {
  const timedOut = Boolean(spawnResult?.error && spawnResult.error.code === "ETIMEDOUT");
  return {
    exit_code: Number.isInteger(spawnResult?.status) ? spawnResult.status : null,
    signal: spawnResult?.signal || spawnResult?.error?.signal || null,
    timed_out: timedOut,
    timeout_seconds: timeoutMs / 1000,
    error_code: spawnResult?.error?.code || null,
  };
}

function contractFailure(plan, code, reason) {
  return buildContractFailureResult({
    runId: plan.run_id,
    cardId: plan.selected.id,
    stage: plan.selected.stage || "dev",
    code,
    reason,
    remediation: "Inspect the preserved workspace, result directory, and bounded run logs.",
  });
}

function parseRefSnapshot(value) {
  const refs = new Map();
  for (const line of String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)) {
    const separator = line.lastIndexOf(":");
    refs.set(
      separator >= 0 ? line.slice(0, separator) : line,
      separator >= 0 ? line.slice(separator + 1) : ""
    );
  }
  return refs;
}

function protectedPmStateUnchanged(before, after, sourceBranch = "") {
  if (!before || !after) return false;
  for (const field of ["git_root", "head", "tree_hash", "protected_status"]) {
    if (String(before[field] || "") !== String(after[field] || "")) return false;
  }
  const allowed = new Set(
    sourceBranch ? [`refs/heads/${sourceBranch}`, `refs/remotes/origin/${sourceBranch}`] : []
  );
  const left = parseRefSnapshot(before.refs);
  const right = parseRefSnapshot(after.refs);
  for (const ref of new Set([...left.keys(), ...right.keys()])) {
    if (!allowed.has(ref) && left.get(ref) !== right.get(ref)) return false;
  }
  return true;
}

function resultHashFor(result) {
  return sha256(JSON.stringify(result));
}

function compactArtifactVerification(verification) {
  if (!verification || typeof verification !== "object") return verification;
  const compact = { ok: verification.ok === true };
  for (const key of ["code", "reason"]) {
    if (verification[key]) compact[key] = String(verification[key]).slice(0, 2000);
  }
  if (verification.pr) {
    compact.pr = {
      ok: verification.pr.ok === true,
      state: verification.pr.state || verification.pr.pr?.state || "",
      reason: String(verification.pr.reason || "").slice(0, 2000),
    };
  }
  if (verification.gates) {
    compact.gates = {
      ok: verification.gates.ok === true,
      code: verification.gates.code || "",
      reason: String(verification.gates.reason || "").slice(0, 2000),
      headOid: verification.gates.headOid || "",
    };
  }
  if (verification.artifact) {
    compact.artifact = {
      ok: verification.artifact.ok === true,
      filePath: verification.artifact.filePath || "",
      sha256: verification.artifact.sha256 || "",
      bytes: verification.artifact.bytes || 0,
    };
  }
  return compact;
}

function compactFinalization(finalization) {
  if (!finalization || typeof finalization !== "object") return finalization;
  const compactTransaction = (transaction) =>
    transaction && typeof transaction === "object"
      ? {
          ok: transaction.ok === true,
          pushed: transaction.pushed === true,
          reason: transaction.reason || "",
          commit: transaction.commit || transaction.commitOid || "",
        }
      : transaction;
  return {
    ok: finalization.ok === true,
    status: finalization.status || "",
    reason: finalization.reason || "",
    checkpoint: compactTransaction(finalization.checkpoint),
    finalized: compactTransaction(finalization.finalized),
  };
}

function verifyResultArtifactsUnchecked(input) {
  const { result, workspace, projectGitRoot, dispatchRecord, options, resultDir, plan } = input;
  const prStatus = new Set(["shipped", "merged", "ready-for-human", "waiting"]);
  if (prStatus.has(result.status)) {
    const headOid = runGit(["rev-parse", "HEAD"], workspace.workspacePath);
    const expectedRepo =
      options.expectedRepository ||
      (options.verifyPullRequest ? result.artifacts.repo : sourceRepository(projectGitRoot));
    if (!expectedRepo) {
      return { ok: false, code: "repository-unresolved", reason: "source repository is unknown" };
    }
    const verifyPr = options.verifyPullRequest || verifyPullRequest;
    const expectedBase = defaultBranchName(projectGitRoot);
    const dispatchedAt = dispatchRecord.event && dispatchRecord.event.dispatched_at;
    const originalDispatchAt =
      result.stage === "dev" ? dispatchedAt : plan.selected.prDispatchAt || dispatchedAt;
    if (
      result.stage !== "dev" &&
      Array.isArray(plan.selected.prs) &&
      plan.selected.prs.length > 0 &&
      !plan.selected.prs.includes(`#${result.artifacts.number}`)
    ) {
      return {
        ok: false,
        code: "pr-verification-failed",
        reason: "pull request number does not match the durable card",
      };
    }
    const pr = verifyPr(result.artifacts, {
      requiredState: result.status === "merged" ? "MERGED" : "OPEN",
      expectedRepo,
      expectedBase,
      expectedHead: workspace.branch,
      expectedHeadOid: headOid,
      dispatchedAt,
      createdAfter: originalDispatchAt,
      mergedAfter: dispatchedAt,
    });
    if (!pr.ok) {
      return {
        ok: false,
        code: "pr-verification-failed",
        reason: pr.reason || `pull request verification returned ${pr.state || "UNKNOWN"}`,
        pr,
      };
    }
    const verifyGates = options.verifyGateSidecar || verifyCommittedGateSidecar;
    const gates = verifyGates(workspace.workspacePath, {
      expectedHeadOid: headOid,
      expectedHead: workspace.branch,
      baseRef: `origin/${expectedBase}`,
    });
    if (!gates.ok) {
      return {
        ok: false,
        code: gates.code || "gate-verification-failed",
        reason: gates.reason || "committed gate evidence could not be verified",
        gates,
      };
    }
    return { ok: true, pr, gates };
  }
  if (["artifact-ready", "needs-approval"].includes(result.status)) {
    const artifact = verifyDocumentArtifact(resultDir, result.artifacts);
    return artifact.ok
      ? { ok: true, artifact }
      : { ok: false, code: artifact.code, reason: artifact.reason, artifact };
  }
  return { ok: true };
}

function verifyResultArtifacts(input) {
  try {
    return verifyResultArtifactsUnchecked(input);
  } catch (err) {
    return {
      ok: false,
      code: "artifact-verification-threw",
      reason: String(err && err.message ? err.message : err).slice(0, 2000),
    };
  }
}

function finalizeStageOutcome(input) {
  const { paths, plan, config, result, resultHash, artifactVerification, process, options } = input;
  let card;
  try {
    card = claimedCardSnapshot(paths.pmDir, plan.lease, {
      timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
    });
  } catch (err) {
    return { ok: false, status: "finalization-blocked", reason: err.message };
  }
  const mapped = buildStageTransition({
    result,
    cardContent: card.content,
    cardRelativePath: card.relativePath,
    expectedCardRevision: plan.lease.expected_card_revision,
    pmRelative: card.pmRelative,
    runId: plan.run_id,
    logPath: `.pm/loop-runs/${plan.run_id}/stdout.log`,
    now: input.now,
    shipPollHorizonSeconds:
      Number(config.budgets && config.budgets.max_runtime_seconds_per_ship_cycle) || 1800,
    dispatchAt: input.dispatchRecord.event && input.dispatchRecord.event.dispatched_at,
    prDispatchAt: plan.selected.prDispatchAt || "",
    verifiedArtifact: artifactVerification && artifactVerification.artifact,
  });
  if (!mapped.ok) {
    return { ok: false, status: "failed-contract", reason: mapped.reason };
  }
  const txOptions = {
    maxAttempts: config.claim_envelope.cas_attempts,
    timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
  };
  const terminalEvent = { ...mapped.event, process };
  const checkpoint = (options.checkpointRecovery || checkpointRecovery)(
    paths.pmDir,
    {
      runId: plan.run_id,
      cardId: plan.lease.card_id,
      stage: plan.lease.stage,
      resultHash,
      artifactHashes: mapped.artifactHashes,
      transition: mapped.transition,
      terminalEvent,
    },
    txOptions
  );
  if (!checkpoint.ok) {
    return {
      ok: false,
      status: "finalization-blocked",
      reason: checkpoint.reason || "recovery checkpoint was not durably confirmed",
      checkpoint,
    };
  }
  const finalized = (options.finalizeRun || finalizeRun)(
    paths.pmDir,
    {
      runId: plan.run_id,
      cardId: plan.lease.card_id,
      stage: plan.lease.stage,
      event: terminalEvent,
      allowedArtifactPaths: mapped.allowedArtifactPaths,
    },
    txOptions
  );
  if (!finalized.ok) {
    return {
      ok: false,
      status: "finalization-blocked",
      reason: finalized.reason || "finalization was not durably confirmed",
      checkpoint,
      finalized,
    };
  }
  return {
    ok: true,
    status: mapped.event.status,
    reason: "",
    checkpoint,
    finalized,
    transition: mapped.transition,
  };
}

function runWorker(projectDir, options = {}) {
  const paths = options.pmDir
    ? {
        pmDir: options.pmDir,
        pmStateDir: options.pmStateDir || path.join(path.dirname(options.pmDir), ".pm"),
      }
    : resolvePmPaths(projectDir);
  const now = options.now instanceof Date ? options.now : new Date();
  let config = loadLoopConfig(paths.pmDir);
  const mode = options.mode || "default";

  if (config.enabled === false) {
    return { status: "disabled", reason: "loop disabled in config" };
  }
  if (isStopped(paths.pmDir)) {
    return { status: "stopped", reason: `kill switch present: ${killSwitchPath(paths.pmDir)}` };
  }

  const runsDir = runsDirFor(paths);
  const runsToday = countRunsToday(runsDir, now);
  const maxRuns = Number(config.budgets && config.budgets.max_runs_per_day) || 12;
  if (runsToday >= maxRuns) {
    return { status: "budget-exhausted", runs_today: runsToday, max_runs_per_day: maxRuns };
  }
  const shipCyclesToday = countRunsToday(runsDir, now, { stage: "ship" });
  const maxShipCycles = Number(config.budgets && config.budgets.max_ship_cycles_per_day) || 24;

  const quarantineCheck = (_card, meta) => activeQuarantineForPlan(paths.pmStateDir, meta, now);
  const preview = runLoop(projectDir, {
    pmDir: paths.pmDir,
    config,
    now,
    mode,
    dryRun: true,
    quarantineCheck,
  });

  if (options.dryRun) {
    if (!preview.selected) return preview;
    const command = engineCommand(config, buildPrompt(preview, config));
    return {
      ...preview,
      status: "dry-run",
      engine: { bin: command.bin, args: command.args },
    };
  }

  if (preview.status === "recovery-required" && preview.recovery?.state === "recovery-ready") {
    const recovery = preview.recovery.recovery;
    const terminalEvent = recovery && recovery.terminal_event;
    if (terminalEvent && terminalEvent.terminal === true) {
      const recoveredFinalization = (options.finalizeRun || finalizeRun)(
        paths.pmDir,
        {
          runId: recovery.run_id,
          cardId: recovery.card_id,
          stage: recovery.stage,
          event: terminalEvent,
          allowedArtifactPaths: (recovery.transition?.artifact_writes || []).map(
            (artifact) => artifact.relative_path
          ),
        },
        {
          maxAttempts: config.claim_envelope.cas_attempts,
          timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
        }
      );
      return {
        ...preview,
        run_id: recovery.run_id,
        status: recoveredFinalization.ok ? terminalEvent.status : "finalization-blocked",
        reason: recoveredFinalization.ok
          ? undefined
          : recoveredFinalization.reason || "recovery finalization was not durably confirmed",
        recovered: recoveredFinalization.ok,
        finalization: compactFinalization(recoveredFinalization),
      };
    }
  }

  if (!preview.selected) return preview;

  try {
    config = withRemoteSnapshot(paths.pmDir, (snapshot) =>
      loadTrustedLoopConfig(snapshot.pmDir, paths.pmStateDir)
    );
  } catch (err) {
    const blocked = {
      blocker_code: "execution-config-unapproved",
      remediation: String(err.message || err),
    };
    return {
      ...preview,
      status: "preflight-failed",
      mutation: false,
      dry_run: false,
      ...blocked,
      quarantine: recordQuarantine(paths.pmStateDir, preview, blocked, config, { now }),
    };
  }

  const previewStage = preview.selected.stage || "dev";
  const previewShipStage = previewStage === "ship" || previewStage === "review";
  if (previewShipStage && shipCyclesToday >= maxShipCycles) {
    return {
      ...preview,
      status: "budget-exhausted",
      reason: `ship cycles today (${shipCyclesToday}) reached max_ship_cycles_per_day (${maxShipCycles})`,
    };
  }
  const maxAttempts = Number(config.budgets && config.budgets.max_attempts_per_stage) || 3;
  const attempts = countCardAttempts(runsDir, preview.selected.id, previewStage);
  if (attempts >= maxAttempts) {
    return {
      ...preview,
      status: "attempts-exhausted",
      reason: `card ${preview.selected.id} failed ${attempts}x at stage ${previewStage} (max_attempts_per_stage ${maxAttempts}); needs a human look`,
    };
  }

  const preflight = runPreflight(projectDir, preview, config, {
    pmDir: paths.pmDir,
    pmStateDir: paths.pmStateDir,
    now,
    runProbe: options.runProbe,
    spawnSync: options.preflightSpawnSync,
  });
  if (!preflight.ok) {
    return {
      ...preview,
      status: "preflight-failed",
      mutation: false,
      dry_run: false,
      blocker_code: preflight.blocker_code,
      remediation: preflight.remediation,
      quarantine: preflight.quarantine,
      preflight,
    };
  }

  const plan = runLoop(projectDir, {
    pmDir: paths.pmDir,
    config,
    now,
    mode,
    dryRun: false,
    claimOnly: true,
    holder: options.holder || os.hostname(),
    skipPull: options.skipPull,
    skipPush: options.skipPush,
    allowUnsynced: options.allowUnsynced,
    expectedPlan: preview,
    quarantineCheck,
    pmStateDir: paths.pmStateDir,
    reloadConfigAfterPull: true,
  });
  if (plan.status !== "claimed") return plan;

  const stage = plan.selected.stage || "dev";
  const shipStage = stage === "ship" || stage === "review";
  const runId = plan.run_id;
  const ledgerPath = path.join(runsDir, `${runId}.json`);
  const logDir = path.join(runsDir, runId);
  fs.mkdirSync(logDir, { recursive: true });
  fs.chmodSync(logDir, 0o700);
  let resultDir = "";
  let resultFile = "";

  const ledger = {
    version: 1,
    run_id: runId,
    status: "running",
    pid: process.pid,
    card: plan.selected,
    lease: plan.lease,
    mode,
    stage,
    started_at: now.toISOString(),
    log_dir: logDir,
  };

  // Every claimed dispatch gets a ledger — including early rejections — so
  // budgets and the attempts backstop always advance and nothing can livelock
  // the wake cycle for free.
  const bail = (status, reason) => {
    const release = releaseLease(paths.pmDir, plan.lease, {
      ...options,
      config,
      reason: status,
    });
    const durableStatus = release.released ? status : "finalization-blocked";
    const durableReason = release.released
      ? reason
      : `lease release was not durably confirmed: ${release.reason || "unknown error"}`;
    writeJsonAtomic(ledgerPath, {
      ...ledger,
      status: durableStatus,
      reason: durableReason,
      ended_at: new Date().toISOString(),
      lease_release: release,
    });
    return {
      ...plan,
      status: durableStatus,
      reason: durableReason,
      run_id: runId,
      ledger: ledgerPath,
    };
  };

  if (!isDispatchableCommand(plan.selected.command)) {
    return bail(
      "rejected",
      `card command is not a dispatchable /pm:* shape: ${JSON.stringify(plan.selected.command)}`
    );
  }

  const projectGitRoot = findGitRoot(projectDir);
  if (!projectGitRoot) {
    return bail("failed", "project is not a git repository");
  }
  try {
    const capability = createRunResultCapability(paths.pmStateDir, runId);
    resultDir = capability.runDir;
    resultFile = capability.resultFile;
  } catch (err) {
    return bail("failed-contract", `result capability could not be created: ${err.message}`);
  }
  // Crash-safe: written before the engine starts. If this process dies, the
  // "running" record + lease TTL tell the next scout what happened; merged-PR
  // recovery is handled by the reconcile-merged session hook.
  writeJsonAtomic(ledgerPath, ledger);

  let workspace = null;
  let status = "failed";
  let reason = "";
  let exitCode = null;
  let release = null;
  let processInfo = null;

  workspace = prepareWorkspace(projectGitRoot, plan, config, { now, ...options });
  if (!workspace.ok) {
    status = "bootstrap-failed";
    reason = workspace.reason;
    release = releaseLease(paths.pmDir, plan.lease, {
      ...options,
      config,
      reason: status,
      eventStatus: status,
    });
    if (!release.released) {
      status = "finalization-blocked";
      reason = `lease release was not durably confirmed: ${release.reason || "unknown error"}`;
    }
  } else {
    const dispatchRecord = markRunDispatched(
      paths.pmDir,
      {
        runId,
        cardId: plan.lease.card_id,
        stage: plan.lease.stage,
      },
      {
        maxAttempts: config.claim_envelope.cas_attempts,
        timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
      }
    );
    ledger.dispatch_record = dispatchRecord;
    if (!dispatchRecord.ok) {
      status = "dispatch-checkpoint-failed";
      reason = dispatchRecord.reason || "failed to durably record engine dispatch";
      release = releaseLease(paths.pmDir, plan.lease, {
        ...options,
        config,
        reason: status,
        eventStatus: status,
      });
      if (!release.released) {
        status = "finalization-blocked";
        reason = `lease release was not durably confirmed: ${release.reason || "unknown error"}`;
      }
    } else {
      const command = engineCommand(config, buildPrompt(plan, config), {
        workspacePath: workspace.workspacePath,
        resultDir,
      });
      const timeoutSeconds = shipStage
        ? Number(config.budgets.max_runtime_seconds_per_ship_cycle) || 1800
        : Number(config.budgets.max_runtime_seconds_per_run) || 5400;
      const timeoutMs = timeoutSeconds * 1000;
      ledger.engine = { bin: command.bin, args: command.args };
      ledger.workspace = { path: workspace.workspacePath, branch: workspace.branch };
      writeJsonAtomic(ledgerPath, ledger);

      const runEngine = options.spawnSync || spawnSync;
      const snapshotPm = options.snapshotProtectedPmState || snapshotProtectedPmState;
      let protectedBefore;
      let protectedBeforeError = "";
      try {
        protectedBefore = snapshotPm(paths.pmDir);
      } catch (err) {
        protectedBeforeError = String(err.message || err).slice(0, 2000);
      }
      const spawned = protectedBeforeError
        ? {
            status: null,
            signal: null,
            stdout: "",
            stderr: "",
            error: { code: "EPROTECTEDSNAPSHOT", message: protectedBeforeError },
          }
        : runEngine(command.bin, command.args, {
            cwd: workspace.workspacePath,
            input: command.input,
            encoding: "utf8",
            timeout: timeoutMs,
            maxBuffer: ENGINE_MAX_BUFFER,
            env: {
              ...process.env,
              PM_LOOP_WORKER: "1",
              PM_LOOP_STAGE: plan.selected.stage || "dev",
              PM_LOOP_CARD_ID: plan.selected.id,
              PM_LOOP_RUN_ID: runId,
              PM_LOOP_RESULT_DIR: resultDir,
              PM_LOOP_RESULT_FILE: resultFile,
              PM_LOOP_LOG_DIR: logDir,
            },
          });
      fs.writeFileSync(path.join(logDir, "stdout.log"), spawned.stdout || "", { mode: 0o600 });
      fs.writeFileSync(path.join(logDir, "stderr.log"), spawned.stderr || "", { mode: 0o600 });
      processInfo = processEvidence(spawned, timeoutMs);
      exitCode = processInfo.exit_code;
      ledger.process = processInfo;

      let protectedAfter;
      let protectedAfterError = "";
      if (!protectedBeforeError) {
        try {
          protectedAfter = snapshotPm(paths.pmDir);
        } catch (err) {
          protectedAfterError = String(err.message || err).slice(0, 2000);
        }
      }
      const protectedPmChanged =
        !protectedBeforeError &&
        !protectedAfterError &&
        !protectedPmStateUnchanged(protectedBefore, protectedAfter, workspace.branch);
      const protectedPmVerification = {
        ok: !protectedBeforeError && !protectedAfterError && !protectedPmChanged,
        code: protectedBeforeError
          ? "protected-pm-snapshot-failed"
          : protectedAfterError
            ? "protected-pm-post-run-snapshot-failed"
            : protectedPmChanged
              ? "protected-pm-state-changed"
              : "",
        reason: protectedBeforeError || protectedAfterError || "",
      };
      ledger.protected_pm_verification = protectedPmVerification;

      const read = readStageResult(resultFile, {
        runId,
        cardId: plan.selected.id,
        stage,
      });
      ledger.stage_result = read;
      let stageResult;
      let resultHash;
      if (!protectedPmVerification.ok) {
        stageResult = contractFailure(
          plan,
          protectedPmVerification.code,
          protectedPmVerification.reason ||
            "engine execution changed PM refs or protected PM path status"
        );
        resultHash = resultHashFor(stageResult);
      } else if (!read.ok) {
        const processDescription = processInfo.timed_out
          ? "engine timed out"
          : processInfo.signal
            ? `engine stopped with ${processInfo.signal}`
            : `engine exited ${processInfo.exit_code === null ? "without a code" : processInfo.exit_code}`;
        stageResult = contractFailure(plan, read.code, `${processDescription}; ${read.reason}`);
        resultHash = resultHashFor(stageResult);
      } else if (
        RESULT_SUCCESSES.has(read.result.status) &&
        (processInfo.exit_code !== 0 ||
          processInfo.timed_out ||
          processInfo.signal ||
          spawned.error)
      ) {
        stageResult = contractFailure(
          plan,
          "process-result-mismatch",
          `engine process did not exit 0 for successful result ${read.result.status}`
        );
        resultHash = resultHashFor(stageResult);
      } else {
        stageResult = read.result;
        resultHash = `sha256:${read.sha256}`;
      }

      let artifactVerification = { ok: true };
      if (stageResult.status !== "failed-contract") {
        artifactVerification = verifyResultArtifacts({
          result: stageResult,
          workspace,
          projectGitRoot,
          dispatchRecord,
          options,
          resultDir,
          plan,
        });
        ledger.artifact_verification = compactArtifactVerification(artifactVerification);
        if (!artifactVerification.ok) {
          stageResult = contractFailure(
            plan,
            artifactVerification.code || "artifact-verification-failed",
            artifactVerification.reason || "result artifacts could not be verified"
          );
          resultHash = resultHashFor(stageResult);
        }
      }

      let finalized = finalizeStageOutcome({
        paths,
        plan,
        config,
        result: stageResult,
        resultHash,
        artifactVerification,
        process: processInfo,
        options,
        now,
        dispatchRecord,
      });
      if (!finalized.ok && finalized.status === "failed-contract") {
        stageResult = contractFailure(plan, "transition-invalid", finalized.reason);
        resultHash = resultHashFor(stageResult);
        finalized = finalizeStageOutcome({
          paths,
          plan,
          config,
          result: stageResult,
          resultHash,
          artifactVerification: { ok: true },
          process: processInfo,
          options,
          now,
          dispatchRecord,
        });
      }
      ledger.finalization = compactFinalization(finalized);
      status = finalized.status;
      reason = finalized.reason || "";
    }
  }

  ledger.status = status;
  ledger.reason = reason || undefined;
  ledger.exit_code = exitCode;
  ledger.ended_at = new Date().toISOString();
  if (release) ledger.lease_release = release;
  writeJsonAtomic(ledgerPath, ledger);

  const keepWorkspace = Boolean(config.worker && config.worker.keep_workspace);
  const preserveEvidence = status === "failed-contract" || status === "finalization-blocked";
  if (!keepWorkspace && !preserveEvidence && workspace && workspace.ok) {
    ledger.workspace_removed = removeWorkspace(projectGitRoot, workspace.workspacePath, {
      timeout: Number(config.claim_envelope.workspace_cleanup_seconds) * 1000,
    });
    if (!shipStage && status !== "completed" && ledger.workspace_removed) {
      try {
        runGit(["branch", "-D", workspace.branch], projectGitRoot);
      } catch {
        // branch may be gone already
      }
    }
    writeJsonAtomic(ledgerPath, ledger);
  }

  return {
    status,
    reason: reason || undefined,
    run_id: runId,
    card: plan.selected,
    exit_code: exitCode,
    workspace: workspace && workspace.ok ? workspace.workspacePath : null,
    branch: workspace && workspace.ok ? workspace.branch : null,
    ledger: ledgerPath,
    log_dir: logDir,
    result_dir: resultDir,
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    pmStateDir: "",
    mode: "default",
    dryRun: false,
    holder: os.hostname(),
    skipPull: false,
    skipPush: false,
    allowUnsynced: false,
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--pm-state-dir": { key: "pmStateDir", type: "string" },
      "--mode": { key: "mode", type: "string" },
      "--dry-run": { key: "dryRun", type: "boolean" },
      "--holder": { key: "holder", type: "string" },
      "--skip-pull": { key: "skipPull", type: "boolean" },
      "--skip-push": { key: "skipPush", type: "boolean" },
      "--allow-unsynced": { key: "allowUnsynced", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  if (args.pmStateDir) args.pmStateDir = path.resolve(args.pmStateDir);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = runWorker(args.projectDir, args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const ok = ["completed", "dry-run", "idle", "stopped", "disabled"].includes(result.status);
    process.exit(ok ? 0 : 2);
  } catch (err) {
    process.stderr.write(`loop-worker: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildPrompt,
  isSafeBranchRef,
  countCardAttempts,
  countRunsInLedgers,
  countRunsToday,
  engineCommand,
  isDispatchableCommand,
  isStopped,
  killSwitchPath,
  prepareWorkspace,
  protectedPmStateUnchanged,
  readLedgers,
  releaseLease,
  runsDirFor,
  runWorker,
};

if (require.main === module) {
  main();
}
