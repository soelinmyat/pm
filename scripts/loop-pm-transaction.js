#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { sha256, stableValue } = require("./loop-config.js");
const {
  buildLease,
  findGitRoot,
  gitRelativePath,
  isLeaseExpired,
  leaseFileName,
  listLeases,
  runGit,
  writeJsonAtomic,
} = require("./loop-git.js");
const { pathChainHasSymlink } = require("./worktree-bootstrap.js");

const RUN_ID_PATTERN = /^loop-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class TransactionAbort extends Error {
  constructor(reason, message, details = {}) {
    super(message || reason);
    this.name = "TransactionAbort";
    this.reason = reason;
    this.details = details;
  }
}

class TransactionDeadlineError extends Error {
  constructor() {
    super("PM transaction exceeded its aggregate deadline");
    this.name = "TransactionDeadlineError";
  }
}

function createRunId() {
  return `loop-${crypto.randomUUID()}`;
}

function assertRunId(runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ""))) {
    throw new Error(`invalid PM loop run id: ${JSON.stringify(runId)}`);
  }
  return runId;
}

function gitPath(value) {
  return String(value).split(path.sep).join("/");
}

function safeRelativePath(value) {
  const text = gitPath(String(value || "").trim());
  if (!text || path.posix.isAbsolute(text)) {
    throw new Error(`transaction path must be repository-relative: ${JSON.stringify(value)}`);
  }
  const normalized = path.posix.normalize(text);
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`transaction path escapes repository root: ${JSON.stringify(value)}`);
  }
  return normalized.replace(/^\.\//, "");
}

function joinRelative(...parts) {
  return safeRelativePath(path.posix.join(...parts.map((part) => gitPath(part))));
}

function isAtOrBelow(candidate, parent) {
  return parent === "." || candidate === parent || candidate.startsWith(`${parent}/`);
}

function assertNoSymlinkPath(root, relativePath) {
  const candidate = path.join(root, ...safeRelativePath(relativePath).split("/"));
  if (pathChainHasSymlink(root, candidate)) {
    throw new Error(`transaction path crosses symlink: ${relativePath}`);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    throw new TransactionAbort("ambiguous-state", `invalid JSON at ${filePath}: ${err.message}`);
  }
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : null;
}

function timeoutValue(timeout) {
  return typeof timeout === "function" ? timeout() : timeout;
}

function changedPaths(workspace, timeout) {
  const tracked = runGit(["diff", "--name-only"], workspace, { timeout: timeoutValue(timeout) })
    .split(/\r?\n/)
    .filter(Boolean);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"], workspace, {
    timeout: timeoutValue(timeout),
  })
    .split(/\r?\n/)
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked].map(safeRelativePath))];
}

function resolveUpstream(gitRoot) {
  let upstream;
  try {
    upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], gitRoot);
  } catch {
    throw new Error("PM Git transaction requires a configured upstream branch");
  }
  const slash = upstream.indexOf("/");
  if (slash <= 0 || slash === upstream.length - 1) {
    throw new Error(`unsupported PM Git upstream ${JSON.stringify(upstream)}`);
  }
  return {
    upstream,
    remote: upstream.slice(0, slash),
    branch: upstream.slice(slash + 1),
  };
}

function fetchUpstream(gitRoot, upstream, timeout) {
  runGit(["fetch", "--no-tags", upstream.remote, upstream.branch], gitRoot, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutValue(timeout),
  });
  return runGit(["rev-parse", `refs/remotes/${upstream.upstream}`], gitRoot, {
    timeout: timeoutValue(timeout),
  });
}

function defaultRemoveWorktree(gitRoot, workspace, timeout) {
  runGit(["worktree", "remove", "--force", workspace], gitRoot, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutValue(timeout),
  });
}

function cleanupAttempt(gitRoot, workspace, tempRoot, options = {}) {
  let error = null;
  try {
    (options.removeWorktree || defaultRemoveWorktree)(
      gitRoot,
      workspace,
      timeoutValue(options.timeoutMs)
    );
  } catch (err) {
    error = err;
  }
  if (!error) fs.rmSync(tempRoot, { recursive: true, force: true });
  return error;
}

function stageAllowlistedChanges(workspace, allowedPaths, timeout) {
  const allowed = new Set(allowedPaths.map(safeRelativePath));
  const changed = changedPaths(workspace, timeout);
  if (changed.length === 0) {
    throw new TransactionAbort("no-transaction-change", "PM transaction produced no changes");
  }
  const unexpected = changed.filter((entry) => !allowed.has(entry));
  if (unexpected.length > 0) {
    throw new TransactionAbort(
      "unexpected-transaction-path",
      `PM transaction changed paths outside its allowlist: ${unexpected.join(", ")}`,
      { unexpected }
    );
  }
  runGit(["add", "-A", "--", ...changed], workspace, { timeout: timeoutValue(timeout) });
  const staged = runGit(["diff", "--cached", "--name-only"], workspace, {
    timeout: timeoutValue(timeout),
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(safeRelativePath);
  const unexpectedStaged = staged.filter((entry) => !allowed.has(entry));
  if (unexpectedStaged.length > 0) {
    throw new TransactionAbort(
      "unexpected-staged-path",
      `PM transaction staged paths outside its allowlist: ${unexpectedStaged.join(", ")}`
    );
  }
  return staged;
}

function runIsolatedTransaction(pmDir, spec, options = {}) {
  const gitRoot = options.gitRoot || findGitRoot(pmDir);
  if (!gitRoot) throw new Error(`Cannot find git root for ${pmDir}`);
  const pmRelative = safeRelativePath(gitRelativePath(gitRoot, pmDir));
  const upstream = resolveUpstream(gitRoot);
  const maxAttempts = Number(options.maxAttempts || spec.maxAttempts || 1);
  const timeoutMs = Number(options.timeoutMs || 180_000);
  const monotonicNow = options.monotonicNow || (() => Number(process.hrtime.bigint() / 1_000_000n));
  const deadline = monotonicNow() + timeoutMs;
  const remainingTimeout = () => {
    const remaining = Math.ceil(deadline - monotonicNow());
    if (remaining <= 0) throw new TransactionDeadlineError();
    return remaining;
  };
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("PM transaction maxAttempts must be a positive integer");
  }

  let lastPushError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let upstreamOid;
    try {
      upstreamOid = fetchUpstream(gitRoot, upstream, remainingTimeout);
    } catch (err) {
      if (err instanceof TransactionDeadlineError || err.code === "ETIMEDOUT") {
        return {
          ok: false,
          pushed: false,
          reason: "transaction-timeout",
          error: err.message,
          attempts: attempt,
          cleanup_ok: true,
          cleanup_error: "",
        };
      }
      return {
        ok: false,
        pushed: false,
        reason: "transaction-failed",
        error: `fetch: ${err.message}`,
        attempts: attempt,
        cleanup_ok: true,
        cleanup_error: "",
      };
    }
    if (spec.expectedUpstreamOid && upstreamOid !== spec.expectedUpstreamOid) {
      return {
        ok: false,
        reason: spec.upstreamMismatchReason || "upstream-conflict",
        expected_upstream_oid: spec.expectedUpstreamOid,
        upstream_oid: upstreamOid,
        attempts: attempt,
      };
    }

    const tempRoot = fs.mkdtempSync(path.join(options.tmpDir || os.tmpdir(), "pm-loop-tx-"));
    fs.chmodSync(tempRoot, 0o700);
    const workspace = path.join(tempRoot, "worktree");
    let result;
    let pushed = false;
    let pushSkipped = false;
    let commitHash = "";
    let abort = null;
    let transactionError = null;
    let phase = "worktree-add";
    try {
      runGit(["worktree", "add", "--detach", workspace, upstreamOid], gitRoot, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: remainingTimeout(),
      });
      const context = {
        attempt,
        gitRoot,
        pmDir: path.join(workspace, ...pmRelative.split("/")),
        pmRelative,
        upstream,
        upstreamOid,
        workspace,
      };
      phase = "validate";
      if (typeof spec.validate === "function") spec.validate(context);
      phase = "mutate";
      result = spec.mutate(context) || {};
      phase = "stage";
      const allowedPaths = spec.allowedPaths(context, result).map(safeRelativePath);
      let staged;
      let alreadyDurable = false;
      try {
        staged = stageAllowlistedChanges(workspace, allowedPaths, remainingTimeout);
      } catch (err) {
        if (
          err instanceof TransactionAbort &&
          err.reason === "no-transaction-change" &&
          result.idempotent
        ) {
          pushed = true;
          commitHash = upstreamOid;
          phase = "idempotent";
          alreadyDurable = true;
          staged = [];
        } else {
          throw err;
        }
      }
      if (!alreadyDurable) {
        phase = "commit";
        runGit(["commit", "-m", spec.commitMessage, "--", ...staged], workspace, {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: remainingTimeout(),
        });
        commitHash = runGit(["rev-parse", "HEAD"], workspace, { timeout: remainingTimeout() });
        if (options.skipPush) {
          pushSkipped = true;
        } else if (typeof options.beforePush === "function") {
          phase = "before-push";
          options.beforePush({ ...context, commitHash });
        }
        if (!pushSkipped) {
          phase = "push";
          const pushTimeout = remainingTimeout();
          runGit(
            [
              "push",
              upstream.remote,
              `HEAD:refs/heads/${upstream.branch}`,
              `--force-with-lease=refs/heads/${upstream.branch}:${upstreamOid}`,
            ],
            workspace,
            { stdio: ["ignore", "pipe", "pipe"], timeout: pushTimeout }
          );
          pushed = true;
        }
      }
    } catch (err) {
      if (err instanceof TransactionAbort) abort = err;
      else if (err instanceof TransactionDeadlineError || err.code === "ETIMEDOUT") {
        transactionError = err;
      } else if (phase === "push") lastPushError = err;
      else transactionError = err;
    }

    const cleanupError = cleanupAttempt(gitRoot, workspace, tempRoot, {
      ...options,
      timeoutMs: remainingTimeout,
    });
    if (abort) {
      return {
        ok: false,
        reason: abort.reason,
        error: abort.message,
        attempts: attempt,
        ...abort.details,
        cleanup_ok: !cleanupError,
        cleanup_error: cleanupError ? cleanupError.message : "",
      };
    }
    if (transactionError) {
      return {
        ok: false,
        pushed: false,
        reason:
          transactionError instanceof TransactionDeadlineError ||
          transactionError.code === "ETIMEDOUT"
            ? "transaction-timeout"
            : "transaction-failed",
        error: `${phase}: ${transactionError.message}`,
        attempts: attempt,
        cleanup_ok: !cleanupError,
        cleanup_error: cleanupError ? cleanupError.message : "",
      };
    }
    if (pushSkipped) {
      return {
        ok: false,
        pushed: false,
        reason: "push-skipped",
        commitHash,
        attempts: attempt,
        ...result,
        cleanup_ok: !cleanupError,
        cleanup_error: cleanupError ? cleanupError.message : "",
      };
    }
    if (pushed) {
      return {
        ok: true,
        pushed: true,
        commitHash,
        upstream_oid: upstreamOid,
        attempts: attempt,
        ...result,
        cleanup_ok: !cleanupError,
        cleanup_error: cleanupError ? cleanupError.message : "",
      };
    }
    if (cleanupError) {
      return {
        ok: false,
        pushed: false,
        reason: "cleanup-failed-after-push-race",
        error: lastPushError ? String(lastPushError.stderr || lastPushError.message) : "",
        attempts: attempt,
        cleanup_ok: false,
        cleanup_error: cleanupError.message,
      };
    }
  }

  return {
    ok: false,
    pushed: false,
    reason: "push-race",
    error: lastPushError ? String(lastPushError.stderr || lastPushError.message) : "",
    attempts: maxAttempts,
    cleanup_ok: true,
    cleanup_error: "",
  };
}

function transactionPaths(pmRelative, runId, cardId, stage) {
  assertRunId(runId);
  return {
    event: joinRelative(pmRelative, "loop", "events", `${runId}.json`),
    lease: joinRelative(pmRelative, "loop", "leases", leaseFileName(cardId, stage)),
    recovery: joinRelative(pmRelative, "loop", "recovery", `${runId}.json`),
  };
}

function leaseForRun(context, paths, runId) {
  const lease = readJsonIfExists(path.join(context.workspace, ...paths.lease.split("/")));
  if (!lease) {
    throw new TransactionAbort("lease-missing", `lease for ${runId} is missing`);
  }
  if (lease.run_id !== runId) {
    throw new TransactionAbort(
      "lease-owner-conflict",
      `lease belongs to ${lease.run_id || "unknown"}`
    );
  }
  return lease;
}

function stableEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function eventMatchesLease(event, lease, runId) {
  return Boolean(
    event &&
    event.run_id === runId &&
    event.card_id === lease.card_id &&
    event.stage === lease.stage &&
    event.config_fingerprint === lease.config_fingerprint &&
    event.expected_card_revision === lease.expected_card_revision
  );
}

function findActiveCardLease(pmDir, cardId, now) {
  for (const lease of listLeases(pmDir, { now })) {
    if (!lease.valid_json) {
      throw new TransactionAbort("ambiguous-state", lease.error || "invalid lease JSON");
    }
    if (lease.card_id === cardId && !lease.expired) return lease;
  }
  return null;
}

function claimRun(pmDir, input, config, options = {}) {
  const runId = assertRunId(input.runId || input.run_id || createRunId());
  const expectedCardRevision = options.expectedCardRevision || input.expectedCardRevision || "";
  const configFingerprint = input.configFingerprint || input.config_fingerprint || "";
  let lease;
  let event;
  let sourceRelative = "";
  const result = runIsolatedTransaction(
    pmDir,
    {
      expectedUpstreamOid: options.expectedHeadOid || "",
      upstreamMismatchReason: "plan-stale-before-claim",
      commitMessage: `pm loop claim ${input.cardId || input.card_id} ${input.stage || "work"}`,
      maxAttempts: 1,
      validate(context) {
        sourceRelative = safeRelativePath(
          path.isAbsolute(input.sourcePath || input.source_path || "")
            ? gitRelativePath(context.gitRoot, input.sourcePath || input.source_path)
            : input.sourcePath || input.source_path
        );
        const cardPath = path.join(context.workspace, ...sourceRelative.split("/"));
        if (!fs.existsSync(cardPath)) {
          throw new TransactionAbort("plan-stale-before-claim", "expected card is missing");
        }
        const currentRevision = sha256(fs.readFileSync(cardPath));
        if (expectedCardRevision && currentRevision !== expectedCardRevision) {
          throw new TransactionAbort("plan-stale-before-claim", "expected card revision changed");
        }
        const active = findActiveCardLease(
          context.pmDir,
          input.cardId || input.card_id,
          options.now instanceof Date ? options.now : new Date()
        );
        if (active) {
          throw new TransactionAbort("active-lease", "card already has an active lease", {
            lease: active,
          });
        }
      },
      mutate(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage || "work"
        );
        if (fs.existsSync(path.join(context.workspace, ...paths.event.split("/")))) {
          throw new TransactionAbort("run-id-conflict", `event already exists for ${runId}`);
        }
        const currentRevision = sha256(
          fs.readFileSync(path.join(context.workspace, ...sourceRelative.split("/")))
        );
        lease = buildLease(
          {
            ...input,
            runId,
            sourcePath: sourceRelative,
            expectedCardRevision: expectedCardRevision || currentRevision,
            configFingerprint,
            upstreamOid: context.upstreamOid,
            phase: "claimed",
          },
          config,
          options
        );
        event = {
          schema_version: 1,
          run_id: runId,
          card_id: lease.card_id,
          stage: lease.stage,
          status: "claimed",
          phase: "claimed",
          terminal: false,
          attempt: Number(input.attempt || 1),
          claimed_at: lease.claimed_at,
          expected_card_revision: lease.expected_card_revision,
          config_fingerprint: lease.config_fingerprint,
          upstream_oid: context.upstreamOid,
        };
        writeJsonAtomic(path.join(context.workspace, ...paths.lease.split("/")), lease);
        writeJsonAtomic(path.join(context.workspace, ...paths.event.split("/")), event);
        return {
          lease,
          event,
          run_id: runId,
          filePath: path.join(pmDir, "loop", "leases", leaseFileName(lease.card_id, lease.stage)),
        };
      },
      allowedPaths(context) {
        const paths = transactionPaths(context.pmRelative, runId, lease.card_id, lease.stage);
        return [paths.lease, paths.event];
      },
    },
    options
  );
  return result;
}

function updateRunPhase(pmDir, input, phase, options = {}) {
  const runId = assertRunId(input.runId || input.run_id);
  const timestamp = input.dispatchedAt || input.dispatched_at || new Date().toISOString();
  let updatedLease;
  let updatedEvent;
  return runIsolatedTransaction(
    pmDir,
    {
      commitMessage: `pm loop ${phase} ${input.cardId || input.card_id} ${input.stage}`,
      maxAttempts: options.maxAttempts || 3,
      mutate(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        const lease = leaseForRun(context, paths, runId);
        const eventPath = path.join(context.workspace, ...paths.event.split("/"));
        const event = readJsonIfExists(eventPath);
        if (!eventMatchesLease(event, lease, runId) || event.terminal === true) {
          throw new TransactionAbort("event-owner-conflict", "claim event is missing or terminal");
        }
        if (
          phase === "dispatched" &&
          lease.phase === "dispatched" &&
          event.status === "dispatched"
        ) {
          return { lease, event, idempotent: true };
        }
        if (phase === "dispatched" && (lease.phase !== "claimed" || event.status !== "claimed")) {
          throw new TransactionAbort(
            "phase-conflict",
            `cannot mark a run dispatched from ${lease.phase || "unknown"}`
          );
        }
        updatedLease = { ...lease, phase, [`${phase}_at`]: timestamp };
        updatedEvent = { ...event, status: phase, phase, [`${phase}_at`]: timestamp };
        writeJsonAtomic(path.join(context.workspace, ...paths.lease.split("/")), updatedLease);
        writeJsonAtomic(eventPath, updatedEvent);
        return { lease: updatedLease, event: updatedEvent };
      },
      allowedPaths(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        return [paths.lease, paths.event];
      },
    },
    options
  );
}

function markRunDispatched(pmDir, input, options = {}) {
  return updateRunPhase(pmDir, input, "dispatched", options);
}

function normalizeTransition(transition) {
  if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
    throw new Error("recovery transition must be an object");
  }
  const card = transition.card_write;
  if (
    !card ||
    typeof card !== "object" ||
    typeof card.relative_path !== "string" ||
    typeof card.expected_revision !== "string" ||
    typeof card.content !== "string"
  ) {
    throw new Error("recovery transition requires a validated card_write");
  }
  const artifacts = transition.artifact_writes || [];
  if (!Array.isArray(artifacts)) throw new Error("artifact_writes must be an array");
  for (const artifact of artifacts) {
    if (
      !artifact ||
      typeof artifact.relative_path !== "string" ||
      typeof artifact.content !== "string"
    ) {
      throw new Error("artifact_writes entries require relative_path and content");
    }
  }
  return {
    card_write: {
      relative_path: safeRelativePath(card.relative_path),
      expected_revision: card.expected_revision,
      content: card.content,
    },
    artifact_writes: artifacts.map((artifact) => ({
      relative_path: safeRelativePath(artifact.relative_path),
      content: artifact.content,
    })),
  };
}

function checkpointRecovery(pmDir, input, options = {}) {
  const runId = assertRunId(input.runId || input.run_id);
  const transition = normalizeTransition(input.transition);
  const checkpointedAt = input.checkpointedAt || input.checkpointed_at || new Date().toISOString();
  const transitionHash = sha256(JSON.stringify(stableValue(transition)));
  let recovery;
  let updatedLease;
  return runIsolatedTransaction(
    pmDir,
    {
      commitMessage: `pm loop checkpoint ${input.cardId || input.card_id} ${input.stage}`,
      maxAttempts: options.maxAttempts || 3,
      mutate(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        const lease = leaseForRun(context, paths, runId);
        const eventPath = path.join(context.workspace, ...paths.event.split("/"));
        const event = readJsonIfExists(eventPath);
        if (!eventMatchesLease(event, lease, runId) || event.terminal === true) {
          throw new TransactionAbort("event-owner-conflict", "claim event is missing or terminal");
        }
        if (!["dispatched", "finalizing"].includes(lease.phase)) {
          throw new TransactionAbort(
            "dispatch-not-recorded",
            `cannot checkpoint lease in ${lease.phase || "unknown"} phase`
          );
        }
        recovery = {
          schema_version: 1,
          run_id: runId,
          card_id: lease.card_id,
          stage: lease.stage,
          status: "ready-to-finalize",
          checkpointed_at: checkpointedAt,
          result_hash: input.resultHash || input.result_hash || "",
          artifact_hashes: input.artifactHashes || input.artifact_hashes || [],
          transition_hash: transitionHash,
          transition,
          expected_card_revision: lease.expected_card_revision,
          config_fingerprint: lease.config_fingerprint,
        };
        const recoveryPath = path.join(context.workspace, ...paths.recovery.split("/"));
        const existingRecovery = readJsonIfExists(recoveryPath);
        if (lease.phase === "finalizing") {
          const sameCheckpoint = Boolean(
            existingRecovery &&
            existingRecovery.run_id === runId &&
            existingRecovery.card_id === lease.card_id &&
            existingRecovery.stage === lease.stage &&
            existingRecovery.status === "ready-to-finalize" &&
            existingRecovery.expected_card_revision === lease.expected_card_revision &&
            existingRecovery.config_fingerprint === lease.config_fingerprint &&
            existingRecovery.result_hash === recovery.result_hash &&
            stableEqual(existingRecovery.artifact_hashes, recovery.artifact_hashes) &&
            existingRecovery.transition_hash === recovery.transition_hash &&
            stableEqual(existingRecovery.transition, recovery.transition) &&
            event.status === "finalizing" &&
            event.phase === "finalizing" &&
            event.result_hash === existingRecovery.result_hash &&
            stableEqual(event.artifact_hashes, existingRecovery.artifact_hashes) &&
            event.transition_hash === existingRecovery.transition_hash
          );
          if (!sameCheckpoint) {
            throw new TransactionAbort(
              "recovery-conflict",
              "an immutable recovery checkpoint already exists for this run"
            );
          }
          recovery = existingRecovery;
          return { recovery: existingRecovery, lease, event, idempotent: true };
        }
        if (event.status !== "dispatched" || event.phase !== "dispatched" || existingRecovery) {
          throw new TransactionAbort(
            "recovery-conflict",
            "dispatch state is inconsistent with a new recovery checkpoint"
          );
        }
        updatedLease = {
          ...lease,
          phase: "finalizing",
          finalizing_at: checkpointedAt,
          result_hash: recovery.result_hash,
          artifact_hashes: recovery.artifact_hashes,
          transition_hash: transitionHash,
        };
        writeJsonAtomic(recoveryPath, recovery);
        writeJsonAtomic(path.join(context.workspace, ...paths.lease.split("/")), updatedLease);
        writeJsonAtomic(eventPath, {
          ...event,
          status: "finalizing",
          phase: "finalizing",
          checkpointed_at: checkpointedAt,
          result_hash: recovery.result_hash,
          artifact_hashes: recovery.artifact_hashes,
          transition_hash: transitionHash,
        });
        return { recovery, lease: updatedLease };
      },
      allowedPaths(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        return [paths.recovery, paths.lease, paths.event];
      },
    },
    options
  );
}

function finalizeRun(pmDir, input, options = {}) {
  const runId = assertRunId(input.runId || input.run_id);
  if (!input.event || input.event.terminal !== true || typeof input.event.status !== "string") {
    throw new Error("finalization requires a terminal durable event");
  }
  const allowedArtifacts = new Set((input.allowedArtifactPaths || []).map(safeRelativePath));
  const finalizedAt = input.finalizedAt || input.finalized_at || new Date().toISOString();
  let terminalEvent;
  return runIsolatedTransaction(
    pmDir,
    {
      commitMessage: `pm loop finalize ${input.cardId || input.card_id} ${input.stage}`,
      maxAttempts: options.maxAttempts || input.maxAttempts || 3,
      mutate(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        const lease = leaseForRun(context, paths, runId);
        const eventPath = path.join(context.workspace, ...paths.event.split("/"));
        const currentEvent = readJsonIfExists(eventPath);
        const recoveryPath = path.join(context.workspace, ...paths.recovery.split("/"));
        const recovery = readJsonIfExists(recoveryPath);
        if (
          !recovery ||
          recovery.run_id !== runId ||
          recovery.card_id !== lease.card_id ||
          recovery.stage !== lease.stage ||
          recovery.expected_card_revision !== lease.expected_card_revision ||
          recovery.config_fingerprint !== lease.config_fingerprint ||
          !eventMatchesLease(currentEvent, lease, runId)
        ) {
          throw new TransactionAbort(
            "recovery-owner-conflict",
            "recovery is missing or mismatched"
          );
        }
        if (
          lease.phase !== "finalizing" ||
          recovery.status !== "ready-to-finalize" ||
          currentEvent.terminal === true ||
          currentEvent.status !== "finalizing" ||
          currentEvent.phase !== "finalizing"
        ) {
          throw new TransactionAbort("recovery-not-finalizing", "run is not ready to finalize");
        }
        const transition = normalizeTransition(recovery.transition);
        const transitionHash = sha256(JSON.stringify(stableValue(transition)));
        if (
          transitionHash !== recovery.transition_hash ||
          transitionHash !== lease.transition_hash ||
          currentEvent.transition_hash !== recovery.transition_hash ||
          recovery.result_hash !== lease.result_hash ||
          currentEvent.result_hash !== recovery.result_hash ||
          !stableEqual(recovery.artifact_hashes, lease.artifact_hashes) ||
          !stableEqual(currentEvent.artifact_hashes, recovery.artifact_hashes)
        ) {
          throw new TransactionAbort("recovery-hash-conflict", "recovery transition hash changed");
        }
        const cardRelative = transition.card_write.relative_path;
        const backlogRoot = joinRelative(context.pmRelative, "backlog");
        if (!isAtOrBelow(cardRelative, backlogRoot)) {
          throw new TransactionAbort(
            "card-path-not-allowlisted",
            `card transition must stay under ${backlogRoot}`
          );
        }
        const cardPath = path.join(context.workspace, ...cardRelative.split("/"));
        assertNoSymlinkPath(context.workspace, cardRelative);
        if (
          !fs.existsSync(cardPath) ||
          sha256(fs.readFileSync(cardPath)) !== transition.card_write.expected_revision ||
          transition.card_write.expected_revision !== recovery.expected_card_revision
        ) {
          throw new TransactionAbort(
            "card-revision-conflict",
            "card revision changed before finalization"
          );
        }
        const reservedArtifactPaths = new Set([
          paths.event,
          paths.recovery,
          paths.lease,
          cardRelative,
        ]);
        const artifactPaths = new Set();
        for (const artifact of transition.artifact_writes) {
          if (
            !allowedArtifacts.has(artifact.relative_path) ||
            !isAtOrBelow(artifact.relative_path, context.pmRelative) ||
            reservedArtifactPaths.has(artifact.relative_path) ||
            artifactPaths.has(artifact.relative_path)
          ) {
            throw new TransactionAbort(
              "artifact-path-not-allowlisted",
              `artifact destination is not allowlisted: ${artifact.relative_path}`
            );
          }
          artifactPaths.add(artifact.relative_path);
          assertNoSymlinkPath(context.workspace, artifact.relative_path);
          const artifactPath = path.join(context.workspace, ...artifact.relative_path.split("/"));
          fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
          fs.writeFileSync(artifactPath, artifact.content);
        }
        fs.writeFileSync(cardPath, transition.card_write.content);
        terminalEvent = {
          ...input.event,
          schema_version: 1,
          run_id: runId,
          card_id: lease.card_id,
          stage: lease.stage,
          terminal: true,
          finalized_at: finalizedAt,
          result_hash: recovery.result_hash,
          artifact_hashes: recovery.artifact_hashes,
          transition_hash: recovery.transition_hash,
        };
        writeJsonAtomic(eventPath, terminalEvent);
        fs.rmSync(recoveryPath);
        fs.rmSync(path.join(context.workspace, ...paths.lease.split("/")));
        return {
          event: terminalEvent,
          transition,
          card_path: cardRelative,
          artifact_paths: transition.artifact_writes.map((entry) => entry.relative_path),
        };
      },
      allowedPaths(context, result) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        return [
          paths.event,
          paths.recovery,
          paths.lease,
          result.card_path,
          ...result.artifact_paths,
        ];
      },
    },
    { ...options, beforePush: input.beforePush || options.beforePush }
  );
}

function releaseClaim(pmDir, input, options = {}) {
  const runId = assertRunId(input.runId || input.run_id);
  const releasedAt = input.releasedAt || input.released_at || new Date().toISOString();
  return runIsolatedTransaction(
    pmDir,
    {
      commitMessage: `pm loop release ${input.cardId || input.card_id} ${input.stage}`,
      maxAttempts: options.maxAttempts || 3,
      mutate(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        const lease = leaseForRun(context, paths, runId);
        const eventPath = path.join(context.workspace, ...paths.event.split("/"));
        const event = readJsonIfExists(eventPath);
        if (!eventMatchesLease(event, lease, runId) || event.terminal === true) {
          throw new TransactionAbort("event-owner-conflict", "claim event is missing or terminal");
        }
        const recoveryPath = path.join(context.workspace, ...paths.recovery.split("/"));
        if (lease.phase === "finalizing" || fs.existsSync(recoveryPath)) {
          throw new TransactionAbort(
            "recovery-authoritative",
            "generic release cannot remove a finalizing recovery checkpoint"
          );
        }
        if (!["claimed", "dispatched"].includes(lease.phase)) {
          throw new TransactionAbort(
            "phase-conflict",
            `cannot release a lease in ${lease.phase || "unknown"} phase`
          );
        }
        writeJsonAtomic(eventPath, {
          ...event,
          status: "released",
          phase: "released",
          terminal: true,
          released_at: releasedAt,
          release_reason: input.reason || "legacy-worker-release",
        });
        fs.rmSync(path.join(context.workspace, ...paths.lease.split("/")));
        return { released: true, lease };
      },
      allowedPaths(context) {
        const paths = transactionPaths(
          context.pmRelative,
          runId,
          input.cardId || input.card_id,
          input.stage
        );
        return [paths.event, paths.lease, paths.recovery];
      },
    },
    options
  );
}

function withRemoteSnapshot(pmDir, callback, options = {}) {
  const gitRoot = options.gitRoot || findGitRoot(pmDir);
  if (!gitRoot) return callback({ pmDir, pmRelative: ".", workspace: path.dirname(pmDir) });
  const upstream = resolveUpstream(gitRoot);
  const timeoutMs = Number(options.timeoutMs || 180_000);
  const upstreamOid = fetchUpstream(gitRoot, upstream, timeoutMs);
  const pmRelative = safeRelativePath(gitRelativePath(gitRoot, pmDir));
  const tempRoot = fs.mkdtempSync(path.join(options.tmpDir || os.tmpdir(), "pm-loop-snapshot-"));
  const workspace = path.join(tempRoot, "worktree");
  runGit(["worktree", "add", "--detach", workspace, upstreamOid], gitRoot, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  try {
    return callback({
      gitRoot,
      pmDir: path.join(workspace, ...pmRelative.split("/")),
      pmRelative,
      upstream,
      upstreamOid,
      workspace,
    });
  } finally {
    defaultRemoveWorktree(gitRoot, workspace, timeoutMs);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function findLeaseByRunId(pmDir, runId) {
  const leaseDir = path.join(pmDir, "loop", "leases");
  if (!fs.existsSync(leaseDir)) return { lease: null, invalid: [] };
  const invalid = [];
  for (const entry of fs.readdirSync(leaseDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const lease = JSON.parse(fs.readFileSync(path.join(leaseDir, entry.name), "utf8"));
      if (lease.run_id === runId) return { lease, invalid };
      if (!lease.run_id) invalid.push(entry.name);
    } catch {
      invalid.push(entry.name);
    }
  }
  return { lease: null, invalid };
}

function inspectSnapshotRunState(pmDir, runId, options = {}) {
  const eventPath = path.join(pmDir, "loop", "events", `${runId}.json`);
  const recoveryPath = path.join(pmDir, "loop", "recovery", `${runId}.json`);
  let event = null;
  let recovery = null;
  let parseError = "";
  try {
    if (fs.existsSync(eventPath)) event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    if (fs.existsSync(recoveryPath)) recovery = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  } catch (err) {
    parseError = err.message;
  }
  const leaseLookup = findLeaseByRunId(pmDir, runId);
  const lease = leaseLookup.lease;
  const now = options.now instanceof Date ? options.now : new Date();
  const leaseExpired = lease ? isLeaseExpired(lease, now) : false;
  const base = {
    run_id: runId,
    event,
    recovery,
    lease,
    lease_expired: leaseExpired,
    redispatch: false,
  };
  if (parseError || leaseLookup.invalid.length > 0) {
    return { ...base, state: "ambiguous", reason: parseError || "invalid orphan lease" };
  }
  if (event && event.run_id === runId && event.terminal === true && !lease && !recovery) {
    return { ...base, state: "finalized" };
  }
  if (recovery) {
    if (
      recovery.run_id === runId &&
      recovery.status === "ready-to-finalize" &&
      recovery.transition &&
      lease &&
      lease.run_id === runId &&
      lease.phase === "finalizing" &&
      eventMatchesLease(event, lease, runId) &&
      event.terminal !== true &&
      event.status === "finalizing" &&
      event.phase === "finalizing" &&
      recovery.card_id === lease.card_id &&
      recovery.stage === lease.stage &&
      recovery.expected_card_revision === lease.expected_card_revision &&
      recovery.config_fingerprint === lease.config_fingerprint &&
      recovery.result_hash === lease.result_hash &&
      event.result_hash === recovery.result_hash &&
      stableEqual(recovery.artifact_hashes, lease.artifact_hashes) &&
      stableEqual(event.artifact_hashes, recovery.artifact_hashes) &&
      recovery.transition_hash === lease.transition_hash &&
      event.transition_hash === recovery.transition_hash
    ) {
      return { ...base, state: "recovery-ready" };
    }
    return { ...base, state: "ambiguous", reason: "recovery ownership or phase mismatch" };
  }
  if (lease && eventMatchesLease(event, lease, runId) && event.terminal !== true) {
    if (lease.phase === "claimed" && event.status === "claimed") {
      return { ...base, state: "never-dispatched", redispatch: leaseExpired };
    }
    if (lease.phase === "dispatched" && event.status === "dispatched") {
      return { ...base, state: "dispatched-without-terminal-result" };
    }
  }
  if (!lease && !event && !recovery) return { ...base, state: "absent" };
  return { ...base, state: "ambiguous", reason: "incomplete durable transaction state" };
}

function inspectRemoteRunState(pmDir, runId, options = {}) {
  assertRunId(runId);
  const state = withRemoteSnapshot(
    pmDir,
    (snapshot) => inspectSnapshotRunState(snapshot.pmDir, runId, options),
    options
  );
  if (state.state === "finalized" && options.localJournalPath) {
    fs.rmSync(options.localJournalPath, { force: true });
    state.local_journal_cleared = true;
  }
  return state;
}

function listRunIds(pmDir) {
  const ids = new Set();
  for (const child of ["events", "recovery", "leases"]) {
    const dir = path.join(pmDir, "loop", child);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      if (child === "leases") {
        try {
          const lease = JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8"));
          if (lease.run_id) ids.add(lease.run_id);
          else ids.add(`ambiguous:${entry.name}`);
        } catch {
          ids.add(`ambiguous:${entry.name}`);
        }
      } else if (child === "events") {
        const runId = entry.name.slice(0, -5);
        try {
          const event = JSON.parse(fs.readFileSync(path.join(dir, entry.name), "utf8"));
          if (event.terminal !== true || event.run_id !== runId) ids.add(runId);
        } catch {
          ids.add(runId);
        }
      } else {
        ids.add(entry.name.slice(0, -5));
      }
    }
  }
  return [...ids].sort();
}

function scanSnapshotTransactions(pmDir, options = {}) {
  return listRunIds(pmDir).map((runId) => {
    if (!RUN_ID_PATTERN.test(runId)) {
      return { run_id: runId, state: "ambiguous", redispatch: false };
    }
    return inspectSnapshotRunState(pmDir, runId, options);
  });
}

function scanRemoteTransactions(pmDir, options = {}) {
  return withRemoteSnapshot(
    pmDir,
    (snapshot) => scanSnapshotTransactions(snapshot.pmDir, options),
    options
  );
}

module.exports = {
  RUN_ID_PATTERN,
  TransactionAbort,
  checkpointRecovery,
  claimRun,
  createRunId,
  finalizeRun,
  inspectRemoteRunState,
  markRunDispatched,
  releaseClaim,
  runIsolatedTransaction,
  safeRelativePath,
  scanRemoteTransactions,
  scanSnapshotTransactions,
  withRemoteSnapshot,
};
