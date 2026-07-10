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
  gitRelativePath,
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
  markRunSuppressed,
  releaseClaim,
  RUN_ID_PATTERN,
  scanSnapshotFinalizedEvents,
  withRemoteSnapshot,
} = require("./loop-pm-transaction.js");
const {
  buildContractFailureResult,
  buildNoProgressResult,
  buildStageTransition,
  buildStoppedResult,
} = require("./loop-card-state.js");
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
const { defaultBranchName, sourceRepository } = require("./source-identity.js");
const { runEngineInterruptibleSync } = require("./loop-process.js");

const ENGINE_MAX_BUFFER = 32 * 1024 * 1024;

function killSwitchPath(pmDir) {
  return path.join(pmDir, "loop", "STOP");
}

function isStopped(pmDir) {
  return fs.existsSync(killSwitchPath(pmDir));
}

function prepareRemoteStopMonitor(pmDir, pmStateDir, runId, config) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return null;
  const upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], gitRoot);
  const separator = upstream.indexOf("/");
  if (separator <= 0 || separator === upstream.length - 1) return null;
  const remoteName = upstream.slice(0, separator);
  const branch = upstream.slice(separator + 1);
  const remote = runGit(["remote", "get-url", remoteName], gitRoot);
  const pmRelative = gitRelativePath(gitRoot, pmDir).replace(/\\/g, "/");
  const stopRelative = path.posix.join(pmRelative === "." ? "" : pmRelative, "loop", "STOP");
  const parent = path.join(pmStateDir, "loop-stop-monitors");
  const gitDir = path.join(parent, `${sanitizeId(runId)}.git`);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  fs.rmSync(gitDir, { recursive: true, force: true });
  runGit(["init", "--bare", gitDir], parent, { timeout: 5000 });
  return {
    gitDir,
    remote,
    ref: `refs/heads/${branch}`,
    path: stopRelative,
    pollMs: Number(config.claim_envelope.remote_stop_poll_seconds) * 1000,
    timeoutMs: 5000,
  };
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
    if (record.status === "unreadable") return true;
    if (opts.stage === "ship") return isShipLedger(record);
    return !isShipLedger(record);
  }).length;
}

function countRunsToday(runsDir, now = new Date(), opts = {}) {
  return countRunsInLedgers(readLedgers(runsDir), now, opts);
}

// Normal waiting/blocked/success terminals do not consume failure attempts.
// Unknown legacy statuses still count so unreadable or old failures fail closed.
function countCardAttemptsInLedgers(ledgers, cardId, stage) {
  const nonFailures = new Set([
    "completed",
    "waiting",
    "artifact-ready",
    "ready-for-human",
    "blocked",
  ]);
  return ledgers.filter(
    (record) =>
      record.card &&
      record.card.id === cardId &&
      (record.stage || "dev") === stage &&
      !nonFailures.has(record.status)
  ).length;
}

function countCardAttempts(runsDir, cardId, stage) {
  return countCardAttemptsInLedgers(readLedgers(runsDir), cardId, stage);
}

function usageEvidence(result) {
  const usage = result && result.usage;
  const available = Boolean(
    usage &&
    typeof usage === "object" &&
    [usage.input_tokens, usage.output_tokens, usage.total_tokens].some(Number.isSafeInteger)
  );
  return available
    ? {
        usage_available: true,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          total_tokens: usage.total_tokens,
        },
      }
    : { usage_available: false };
}

function blockerSignature(result) {
  const blocker = result && result.blocker;
  return sha256(
    JSON.stringify({
      status: String(result && result.status ? result.status : "unknown"),
      code: String(
        blocker && blocker.code ? blocker.code : result && result.status ? result.status : "unknown"
      ),
      reason: String(
        blocker && blocker.reason ? blocker.reason : result && result.summary ? result.summary : ""
      ),
      remediation: String(blocker && blocker.remediation ? blocker.remediation : ""),
    })
  );
}

function noProgressContext(plan) {
  const stage = plan.selected.stage || "dev";
  const cardRevision =
    plan.lease?.expected_card_revision || plan.fingerprint_input?.card_revision || "";
  const executionFingerprint = sha256(
    JSON.stringify({
      execution_config_hash: plan.fingerprint_input?.execution_config_hash || "",
    })
  );
  return {
    card_id: plan.selected.id,
    stage,
    card_revision: cardRevision,
    execution_fingerprint: executionFingerprint,
  };
}

function noProgressEvidence(plan, result, previous = null) {
  const context = noProgressContext(plan);
  const blocker = previous?.blocker_signature || blockerSignature(result);
  const signature = sha256(
    JSON.stringify({
      ...context,
      blocker_signature: blocker,
    })
  );
  return {
    signature,
    blocker_signature: blocker,
    card_revision: context.card_revision,
    execution_fingerprint: context.execution_fingerprint,
    first_run_id: previous?.first_run_id || plan.run_id,
    last_run_id: plan.run_id,
  };
}

function findNoProgressSuppressionInSnapshot(pmDir, plan, maxIdentical) {
  if (!plan.selected || maxIdentical < 1) return null;
  const context = noProgressContext(plan);
  const digest = /^sha256:[a-f0-9]{64}$/;
  const events = scanSnapshotFinalizedEvents(pmDir, {
    cardId: context.card_id,
    stage: context.stage,
  })
    .filter((event) => {
      const evidence = event.no_progress;
      if (
        event.terminal !== true ||
        event.card_id !== context.card_id ||
        event.stage !== context.stage ||
        !RUN_ID_PATTERN.test(String(event.run_id || ""))
      ) {
        return false;
      }
      if (!evidence) return false;
      if (
        evidence.card_revision !== context.card_revision ||
        evidence.execution_fingerprint !== context.execution_fingerprint ||
        !digest.test(String(evidence.blocker_signature || "")) ||
        !RUN_ID_PATTERN.test(String(evidence.first_run_id || "")) ||
        !RUN_ID_PATTERN.test(String(evidence.last_run_id || ""))
      ) {
        throw new Error(`malformed no-progress evidence for ${event.run_id}`);
      }
      const expected = sha256(
        JSON.stringify({ ...context, blocker_signature: evidence.blocker_signature })
      );
      if (evidence.signature !== expected) {
        throw new Error(`malformed no-progress evidence signature for ${event.run_id}`);
      }
      return true;
    })
    .sort((a, b) => String(b.finalized_at || "").localeCompare(String(a.finalized_at || "")));
  const latest = events[0];
  if (!latest) return null;
  const identical = events.filter(
    (event) => event.no_progress.signature === latest.no_progress.signature
  );
  if (identical.length < maxIdentical) return null;
  const oldest = identical.at(-1);
  return {
    ...latest.no_progress,
    first_run_id: oldest.no_progress.first_run_id || oldest.run_id,
    last_run_id: latest.no_progress.last_run_id || latest.run_id,
    count: identical.length,
  };
}

function findNoProgressSuppression(pmDir, plan, maxIdentical, options = {}) {
  return withRemoteSnapshot(
    pmDir,
    (snapshot) => findNoProgressSuppressionInSnapshot(snapshot.pmDir, plan, maxIdentical),
    options
  );
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
      noProgress: options.noProgress || null,
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
  const timedOut = Boolean(
    spawnResult?.timed_out || (spawnResult?.error && spawnResult.error.code === "ETIMEDOUT")
  );
  return {
    exit_code: Number.isInteger(spawnResult?.status) ? spawnResult.status : null,
    signal: spawnResult?.signal || spawnResult?.error?.signal || null,
    timed_out: timedOut,
    timeout_seconds: timeoutMs / 1000,
    error_code: spawnResult?.error?.code || null,
    stopped: Boolean(spawnResult?.stopped),
    stop: spawnResult?.stopped
      ? {
          requested_at: spawnResult.stop?.requested_at || null,
          term_sent_at: spawnResult.stop?.term_sent_at || null,
          term_signal: spawnResult.stop?.term_signal || null,
          kill_sent_at: spawnResult.stop?.kill_sent_at || null,
          kill_signal: spawnResult.stop?.kill_signal || null,
          source: spawnResult.stop?.source || "local",
        }
      : undefined,
    started_at: spawnResult?.started_at || undefined,
    ended_at: spawnResult?.ended_at || undefined,
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

function validProtectedPmSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (typeof value.git_root !== "string") return false;
  if (value.git_root) {
    return (
      typeof value.head === "string" &&
      /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(value.head) &&
      typeof value.refs === "string" &&
      validRefSnapshot(value.refs) &&
      typeof value.protected_status === "string"
    );
  }
  return typeof value.tree_hash === "string" && value.tree_hash.length > 0;
}

function validRefSnapshot(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const match = line.match(
        /^(refs\/(?:heads|remotes)\/[^\s:]+):([a-f0-9]{40}(?:[a-f0-9]{24})?)$/i
      );
      return Boolean(
        match &&
        !match[1].includes("..") &&
        !match[1].includes("@{") &&
        !match[1].includes("//") &&
        !match[1].endsWith(".") &&
        !match[1].endsWith(".lock")
      );
    })
  );
}

function protectedPmStateUnchanged(
  before,
  after,
  sourceBranch = "",
  sourceGitRoot = "",
  options = {}
) {
  if (!validProtectedPmSnapshot(before) || !validProtectedPmSnapshot(after)) return false;
  if (before.git_root !== after.git_root) return false;
  if (!before.git_root) return before.tree_hash === after.tree_hash;
  const normalizeProtectedStatus = (value) =>
    String(value || "")
      .split(/\r?\n/)
      .filter(
        (line) =>
          line &&
          !(options.allowStopControl === true && /(?:^|\s)(?:pm\/)?loop\/STOP(?:\s|$)/.test(line))
      )
      .sort()
      .join("\n");
  let committedStopControl = false;
  if (before.head !== after.head && options.allowStopControl === true) {
    try {
      const changed = runGit(["diff", "--name-only", before.head, after.head], before.git_root)
        .split(/\r?\n/)
        .filter(Boolean);
      committedStopControl =
        changed.length > 0 &&
        changed.every((file) => file === "pm/loop/STOP" || file === "loop/STOP");
    } catch {
      committedStopControl = false;
    }
  }
  if (
    (before.head !== after.head && !committedStopControl) ||
    normalizeProtectedStatus(before.protected_status) !==
      normalizeProtectedStatus(after.protected_status)
  ) {
    return false;
  }
  const sameRepository =
    sourceGitRoot && path.resolve(before.git_root) === path.resolve(sourceGitRoot);
  const allowed = new Set(
    sourceBranch && sameRepository
      ? [`refs/heads/${sourceBranch}`, `refs/remotes/origin/${sourceBranch}`]
      : []
  );
  const left = parseRefSnapshot(before.refs);
  const right = parseRefSnapshot(after.refs);
  for (const ref of new Set([...left.keys(), ...right.keys()])) {
    if (allowed.has(ref) || left.get(ref) === right.get(ref)) continue;
    const isStopControlRefMove =
      committedStopControl && left.get(ref) === before.head && right.get(ref) === after.head;
    if (!isStopControlRefMove) return false;
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
    if (!expectedBase) {
      return {
        ok: false,
        code: "default-branch-unresolved",
        reason: "source default branch could not be verified from the remote HEAD",
      };
    }
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
    noProgress: input.noProgress || null,
  });
  if (!mapped.ok) {
    return { ok: false, status: "failed-contract", reason: mapped.reason };
  }
  const txOptions = {
    maxAttempts: config.claim_envelope.cas_attempts,
    timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
  };
  const terminalEvent = { ...mapped.event, ...(process ? { process } : {}) };
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
  if (options.scheduled === true) {
    try {
      config = withRemoteSnapshot(paths.pmDir, (snapshot) =>
        loadTrustedLoopConfig(snapshot.pmDir, paths.pmStateDir)
      );
      const releaseGate = options.releaseGateProbe
        ? options.releaseGateProbe(paths.pmStateDir, config)
        : require("./loop-canary.js").evaluateCurrentCanaryReleaseGate(paths.pmStateDir, config);
      if (!releaseGate.passed) {
        return {
          status: "canary-required",
          reason: `scheduled wake refused: ${releaseGate.reason}`,
          release_gate: releaseGate,
        };
      }
    } catch (error) {
      return {
        status: "canary-required",
        reason: `scheduled wake could not verify canary evidence: ${String(error.message || error).slice(0, 2000)}`,
      };
    }
  }

  const runsDir = runsDirFor(paths);
  const ledgers = (options.readLedgers || readLedgers)(runsDir);
  const runsToday = countRunsInLedgers(ledgers, now);
  const shipCyclesToday = countRunsInLedgers(ledgers, now, { stage: "ship" });

  const quarantineCheck = (_card, meta) => activeQuarantineForPlan(paths.pmStateDir, meta, now);
  const preview = runLoop(projectDir, {
    pmDir: paths.pmDir,
    config,
    now,
    mode,
    cardId: options.cardId || "",
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

  const maxIdenticalNoProgress =
    Number(config.budgets && config.budgets.max_identical_no_progress) || 1;
  let priorNoProgress = null;
  try {
    const trusted = withRemoteSnapshot(paths.pmDir, (snapshot) => {
      const trustedConfig = loadTrustedLoopConfig(snapshot.pmDir, paths.pmStateDir);
      return {
        config: trustedConfig,
        priorNoProgress: findNoProgressSuppressionInSnapshot(
          snapshot.pmDir,
          preview,
          Number(trustedConfig.budgets?.max_identical_no_progress) || maxIdenticalNoProgress
        ),
      };
    });
    config = trusted.config;
    priorNoProgress = trusted.priorNoProgress;
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
  const maxRuns = Number(config.budgets && config.budgets.max_runs_per_day) || 12;
  if (!previewShipStage && runsToday >= maxRuns) {
    return { status: "budget-exhausted", runs_today: runsToday, max_runs_per_day: maxRuns };
  }
  const maxShipCycles = Number(config.budgets && config.budgets.max_ship_cycles_per_day) || 24;
  if (previewShipStage && shipCyclesToday >= maxShipCycles) {
    return {
      ...preview,
      status: "budget-exhausted",
      reason: `ship cycles today (${shipCyclesToday}) reached max_ship_cycles_per_day (${maxShipCycles})`,
    };
  }
  const maxAttempts = Number(config.budgets && config.budgets.max_attempts_per_stage) || 3;
  const attempts = countCardAttemptsInLedgers(ledgers, preview.selected.id, previewStage);
  if (attempts >= maxAttempts && !priorNoProgress) {
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
    cardId: options.cardId || "",
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
    usage_available: false,
  };

  // Every claimed dispatch gets a ledger — including early rejections — so
  // budgets and the attempts backstop always advance and nothing can livelock
  // the wake cycle for free.
  const bail = (status, reason, includeNoProgress = true) => {
    const evidence = includeNoProgress
      ? noProgressEvidence(plan, { status, summary: reason })
      : null;
    const release = releaseLease(paths.pmDir, plan.lease, {
      ...options,
      config,
      reason: status,
      noProgress: evidence,
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
      ...(evidence ? { no_progress: evidence } : {}),
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
    if (typeof options.afterClaim === "function") options.afterClaim(plan);
    priorNoProgress = (options.findNoProgressSuppression || findNoProgressSuppression)(
      paths.pmDir,
      plan,
      Number(config.budgets?.max_identical_no_progress) || maxIdenticalNoProgress
    );
  } catch (error) {
    return bail(
      "no-progress-check-failed",
      `post-claim no-progress check failed: ${String(error.message || error).slice(0, 2000)}`,
      false
    );
  }
  if (priorNoProgress) {
    writeJsonAtomic(ledgerPath, ledger);
    const suppressionRecord = (options.markRunSuppressed || markRunSuppressed)(
      paths.pmDir,
      { runId, cardId: plan.lease.card_id, stage: plan.lease.stage },
      {
        maxAttempts: config.claim_envelope.cas_attempts,
        timeoutMs: Number(config.claim_envelope.pm_finalization_seconds) * 1000,
      }
    );
    ledger.suppression_record = suppressionRecord;
    if (!suppressionRecord.ok) {
      return bail(
        "suppression-checkpoint-failed",
        suppressionRecord.reason || "failed to durably record no-progress suppression"
      );
    }
    const evidence = noProgressEvidence(plan, null, priorNoProgress);
    const stageResult = buildNoProgressResult({
      runId,
      cardId: plan.selected.id,
      stage,
      noProgress: evidence,
    });
    const finalized = finalizeStageOutcome({
      paths,
      plan,
      config,
      result: stageResult,
      resultHash: resultHashFor(stageResult),
      artifactVerification: { ok: true },
      process: null,
      options,
      now,
      dispatchRecord: suppressionRecord,
      noProgress: evidence,
    });
    ledger.no_progress = evidence;
    ledger.finalization = compactFinalization(finalized);
    ledger.status = finalized.status;
    ledger.reason = finalized.reason || undefined;
    ledger.ended_at = new Date().toISOString();
    Object.assign(ledger, usageEvidence(stageResult));
    writeJsonAtomic(ledgerPath, ledger);
    return {
      status: finalized.status,
      reason: finalized.reason || undefined,
      run_id: runId,
      card: plan.selected,
      exit_code: null,
      workspace: null,
      branch: null,
      ledger: ledgerPath,
      log_dir: logDir,
      result_dir: null,
      fingerprint: plan.fingerprint,
    };
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
    const failureNoProgress = noProgressEvidence(plan, { status, summary: reason });
    ledger.no_progress = failureNoProgress;
    release = releaseLease(paths.pmDir, plan.lease, {
      ...options,
      config,
      reason: status,
      eventStatus: status,
      noProgress: failureNoProgress,
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

      const snapshotPm = options.snapshotProtectedPmState || snapshotProtectedPmState;
      let protectedBefore;
      let protectedBeforeError = "";
      try {
        protectedBefore = snapshotPm(paths.pmDir);
      } catch (err) {
        protectedBeforeError = String(err.message || err).slice(0, 2000);
      }
      let remoteStop = null;
      let remoteStopError = "";
      try {
        remoteStop = prepareRemoteStopMonitor(paths.pmDir, paths.pmStateDir, runId, config);
      } catch (error) {
        remoteStopError = String(error.message || error).slice(0, 2000);
      }
      ledger.stop_control = {
        local_path: killSwitchPath(paths.pmDir),
        remote_available: Boolean(remoteStop),
        remote_error: remoteStopError,
      };
      const spawned = protectedBeforeError
        ? {
            status: null,
            signal: null,
            stdout: "",
            stderr: "",
            error: { code: "EPROTECTEDSNAPSHOT", message: protectedBeforeError },
          }
        : (() => {
            const engineOptions = {
              cwd: workspace.workspacePath,
              input: command.input,
              encoding: "utf8",
              timeout: timeoutMs,
              timeoutMs,
              graceMs: Number(config.claim_envelope.shutdown_grace_seconds) * 1000,
              pollMs: 250,
              stopPath: killSwitchPath(paths.pmDir),
              remoteStop,
              maxBuffer: ENGINE_MAX_BUFFER,
              stdoutPath: path.join(logDir, "stdout.log"),
              stderrPath: path.join(logDir, "stderr.log"),
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
            };
            return typeof options.spawnSync === "function"
              ? options.spawnSync(command.bin, command.args, engineOptions)
              : runEngineInterruptibleSync(command.bin, command.args, engineOptions);
          })();
      if (remoteStop?.gitDir) fs.rmSync(remoteStop.gitDir, { recursive: true, force: true });
      if (!spawned.logs_written) {
        fs.writeFileSync(path.join(logDir, "stdout.log"), spawned.stdout || "", { mode: 0o600 });
        fs.writeFileSync(path.join(logDir, "stderr.log"), spawned.stderr || "", { mode: 0o600 });
      }
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
        !protectedPmStateUnchanged(
          protectedBefore,
          protectedAfter,
          workspace.branch,
          projectGitRoot,
          { allowStopControl: processInfo.stopped }
        );
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
      } else if (processInfo.stopped) {
        stageResult = buildStoppedResult({
          runId,
          cardId: plan.selected.id,
          stage,
          summary: "STOP interrupted the active engine process.",
        });
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
      Object.assign(ledger, usageEvidence(read.ok ? read.result : stageResult));

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

      const currentNoProgress = ["failed", "noop"].includes(stageResult.status)
        ? noProgressEvidence(plan, stageResult)
        : null;
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
        noProgress: currentNoProgress,
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
          noProgress: null,
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
    fingerprint: plan.fingerprint,
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
    cardId: "",
    scheduled: false,
    manual: false,
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
      "--card": { key: "cardId", type: "string" },
      "--scheduled": { key: "scheduled", type: "boolean" },
      "--manual": { key: "manual", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (args.scheduled && args.manual) {
    throw new Error("--scheduled and --manual are mutually exclusive");
  }
  // Legacy scheduler entries did not carry --scheduled. Default every CLI
  // invocation to scheduler-safe gating and require an explicit marker for a
  // human-supervised one-off run. Programmatic canary calls bypass this parser.
  args.scheduled = args.scheduled || !args.manual;
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
  countCardAttemptsInLedgers,
  countRunsInLedgers,
  countRunsToday,
  engineCommand,
  findNoProgressSuppression,
  isDispatchableCommand,
  isStopped,
  killSwitchPath,
  parseArgs,
  prepareWorkspace,
  protectedPmStateUnchanged,
  readLedgers,
  releaseLease,
  runsDirFor,
  runWorker,
  usageEvidence,
};

if (require.main === module) {
  main();
}
