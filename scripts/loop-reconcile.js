#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseFrontmatter } = require("./kb-frontmatter.js");
const { parseCliArgs } = require("./loop-args.js");
const { MANAGED_FIELDS, normalizeStatus, rewriteFrontmatter } = require("./loop-card-state.js");
const { sha256 } = require("./loop-config.js");
const {
  ensureGitSyncReady,
  findGitRoot,
  gitRelativePath,
  listLeases,
  runGit,
  writeJsonAtomic,
} = require("./loop-git.js");
const {
  assertNoSymlinkPath,
  createRunId,
  finalizeRun,
  planFinalization,
  runIsolatedTransaction,
  safeRelativePath,
  scanSnapshotTransactions,
  withRemoteSnapshot,
} = require("./loop-pm-transaction.js");
const { inspectPullRequest } = require("./pr-state.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { validatePrArtifact } = require("./loop-result.js");
const { defaultBranchName, sourceRepository } = require("./source-identity.js");
const {
  runOperationalEffect,
  sharedGitRepositorySerialization,
} = require("./lib/operational-effect-journal.js");
const { stableStringify } = require("./lib/workflow-runtime/records.js");

const STALE_STATUSES = new Set([
  "in-progress",
  "implementing",
  "implementation",
  "dev",
  "shipping",
  "ship",
  "review",
  "reviewing",
]);

const BLOCKED_TERMINALS = new Set(["blocked", "failed-contract"]);
const FAILED_TERMINALS = new Set([
  "failed",
  "noop",
  "bootstrap-failed",
  "timeout",
  "stopped",
  "crashed",
]);
const MAX_RECOVERY_ARTIFACTS = 64;
const MAX_MUTATION_PATH_LENGTH = 512;

function asList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function pullRequestArtifact(data) {
  const number = Number(data.pr_number || String(asList(data.prs)[0] || "").replace(/^#/, ""));
  const artifact = {
    type: "pull-request",
    repo: String(data.pr_repo || ""),
    number,
    url: String(data.pr_url || ""),
    base: String(data.pr_base || ""),
    head: String(data.branch || ""),
    head_oid: String(data.pr_head_oid || ""),
    created_at: String(data.pr_created_at || ""),
  };
  return validatePrArtifact(artifact, "shipped") ? null : artifact;
}

function evidenceCardId(entry) {
  return entry.recovery?.card_id || entry.lease?.card_id || entry.event?.card_id || "";
}

function transactionsForCard(card, transactions) {
  const runId = String(card.data.loop_run_id || "");
  return (transactions || []).filter((entry) => {
    const cardId = evidenceCardId(entry);
    return cardId ? cardId === card.id : Boolean(runId && entry.run_id === runId);
  });
}

function leasesForCard(card, leases) {
  const runId = String(card.data.loop_run_id || "");
  return (leases || []).filter(
    (lease) =>
      (lease.card_id && lease.card_id === card.id) ||
      (!lease.card_id && runId && lease.run_id === runId)
  );
}

function appendIndex(index, key, value) {
  if (!key) return;
  const current = index.get(key) || [];
  current.push(value);
  index.set(key, current);
}

function indexEvidence(leases, transactions) {
  const transactionByCard = new Map();
  const transactionByRun = new Map();
  const globalAmbiguous = [];
  for (const transaction of transactions || []) {
    appendIndex(transactionByRun, transaction.run_id, transaction);
    const cardId = evidenceCardId(transaction);
    appendIndex(transactionByCard, cardId, transaction);
    if (!cardId && transaction.state === "ambiguous") globalAmbiguous.push(transaction);
  }
  const leaseByCard = new Map();
  const leaseByRun = new Map();
  for (const lease of leases || []) {
    appendIndex(leaseByCard, lease.card_id, lease);
    appendIndex(leaseByRun, lease.run_id, lease);
  }
  return { transactionByCard, transactionByRun, globalAmbiguous, leaseByCard, leaseByRun };
}

function evidenceForCard(card, index) {
  const runId = String(card.data.loop_run_id || "");
  return {
    transactions: [
      ...(index.transactionByCard.get(card.id) || []),
      ...(index.transactionByRun.get(runId) || []),
      ...index.globalAmbiguous,
    ].filter((entry, position, entries) => entries.indexOf(entry) === position),
    leases: [
      ...(index.leaseByCard.get(card.id) || []),
      ...(index.leaseByRun.get(runId) || []),
    ].filter((entry, position, entries) => entries.indexOf(entry) === position),
  };
}

function noAction(classification, remediation, extra = {}) {
  return { classification, operation: "none", remediation, ...extra };
}

function needsHuman(classification, reason, remediation, runId, extra = {}) {
  return {
    classification,
    operation: "update-card",
    next_status: "needs-human",
    blocker: {
      code: classification,
      reason: String(reason || classification).slice(0, 2000),
      remediation: String(remediation || "Inspect durable run evidence before retrying.").slice(
        0,
        4000
      ),
    },
    run_id: runId || "",
    ...extra,
  };
}

function classifyStaleCard(card, evidence = {}, options = {}) {
  const runId = String(card.data.loop_run_id || "");
  const candidates = transactionsForCard(card, evidence.transactions);
  const recoveries = candidates.filter((entry) => entry.recovery);
  const cardLeases = leasesForCard(card, evidence.leases);

  if (recoveries.length > 0) {
    if (recoveries.length === 1 && recoveries[0].state === "recovery-ready") {
      const transaction = recoveries[0];
      return {
        classification: "recovery-ready",
        operation: "resume-finalization",
        run_id: transaction.run_id,
        recovery: transaction.recovery,
      };
    }
    const transaction = recoveries[0];
    return noAction(
      "recovery-ambiguous",
      recoveries.length > 1
        ? "Multiple recovery records claim this card; resolve ownership without redispatching it."
        : "Repair the same-run recovery ownership/hash mismatch; do not dispatch the card again.",
      { run_id: transaction.run_id, recovery: transaction.recovery }
    );
  }

  const ambiguous = candidates.find((entry) => entry.state === "ambiguous");
  if (ambiguous) {
    return noAction(
      "recovery-ambiguous",
      "Repair the ambiguous durable run evidence; do not dispatch or mutate the card meanwhile.",
      { run_id: ambiguous.run_id }
    );
  }

  const transaction = runId ? candidates.find((entry) => entry.run_id === runId) || null : null;

  const activeLease = cardLeases.find((lease) => lease.valid_json !== false && !lease.expired);
  if (activeLease) {
    return noAction("active-lease", "Wait for the active owner to finish or checkpoint recovery.", {
      run_id: activeLease.run_id || "",
    });
  }

  const event = transaction && transaction.event;
  if (event && event.terminal === true && BLOCKED_TERMINALS.has(event.status)) {
    return needsHuman(
      "durable-blocker",
      event.blocker?.reason || event.summary || `durable ${event.status} outcome`,
      event.blocker?.remediation || "Inspect the durable event and resolve the blocker.",
      transaction.run_id,
      { event }
    );
  }

  const artifact = pullRequestArtifact(card.data);
  if (artifact) {
    if (!options.expectedRepository || !options.expectedBase) {
      return noAction(
        "unverified",
        "Resolve the authoritative source repository and default branch before retrying reconciliation.",
        { run_id: String(card.data.loop_run_id || "") }
      );
    }
    const inspect = options.inspectPullRequest || inspectPullRequest;
    const verified = inspect(artifact, {
      expectedRepo: options.expectedRepository,
      expectedBase: options.expectedBase || artifact.base,
      dispatchedAt: card.data.pr_dispatch_at,
      mergedAfter: card.data.pr_dispatch_at,
      ...(options.prOptions || {}),
    });
    if (verified.ok && verified.state === "MERGED") {
      return {
        classification: "verified-merged-pr",
        operation: "update-card",
        next_status: "done",
        run_id: String(card.data.loop_run_id || ""),
        pr: verified.pr,
        merge: verified.merge,
      };
    }
    if (verified.ok && verified.state === "OPEN") {
      return {
        classification: "verified-open-pr",
        operation: "update-card",
        next_status: "shipping",
        run_id: String(card.data.loop_run_id || ""),
        pr: verified.pr,
      };
    }
    return noAction(
      "unverified",
      `Retry reconciliation after GitHub identity evidence is available: ${verified.reason || verified.state || "UNKNOWN"}.`,
      { run_id: String(card.data.loop_run_id || ""), verification: verified }
    );
  }

  const expiredLease = cardLeases.find((lease) => lease.valid_json !== false && lease.expired);
  if (expiredLease) {
    return needsHuman(
      "expired-lease",
      "The lease expired without a validated recovery checkpoint.",
      "Inspect the original run ledger and workspace before deciding whether to retry.",
      expiredLease.run_id,
      { lease: expiredLease }
    );
  }

  if (event && event.terminal === true && FAILED_TERMINALS.has(event.status)) {
    return needsHuman(
      "durable-terminal-outcome",
      event.summary || `The durable run ended as ${event.status}.`,
      "Inspect the durable event and deliberately return the card to a dispatchable status if safe.",
      transaction.run_id,
      { event }
    );
  }

  return noAction(
    "unverified",
    "Add complete repository-pinned PR identity or durable run/recovery evidence, then retry reconciliation.",
    { run_id: String(card.data.loop_run_id || "") }
  );
}

function readCards(pmDir, pmRelative) {
  const backlogDir = path.join(pmDir, "backlog");
  if (!fs.existsSync(backlogDir)) return [];
  return fs
    .readdirSync(backlogDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => {
      const filePath = path.join(backlogDir, entry.name);
      const content = fs.readFileSync(filePath, "utf8");
      const parsed = parseFrontmatter(content);
      return {
        id: String(parsed.data.id || path.basename(entry.name, ".md")),
        data: parsed.data,
        content,
        relativePath: safeRelativePath(path.posix.join(pmRelative, "backlog", entry.name)),
        revision: sha256(fs.readFileSync(filePath)),
      };
    })
    .filter((card) => STALE_STATUSES.has(normalizeStatus(card.data.status)));
}

function fieldChange(field, before, after) {
  return {
    field,
    before: before === undefined || before === null ? "" : String(before),
    after: String(after),
  };
}

function boundedMutationPath(value) {
  const normalized = safeRelativePath(value);
  if (normalized.length > MAX_MUTATION_PATH_LENGTH) {
    throw new Error("recovery mutation path exceeds its bound");
  }
  return normalized;
}

function recoveryMutationManifest(recovery, pmRelative, finalizedAt) {
  try {
    const finalizationPlan = planFinalization(recovery, pmRelative, finalizedAt);
    const { paths, terminalEvent, transition } = finalizationPlan;
    if (transition.artifact_writes.length > MAX_RECOVERY_ARTIFACTS) return null;
    const mutations = [
      {
        operation: "write",
        path: boundedMutationPath(transition.card_write.relative_path),
        expected_revision: String(transition.card_write.expected_revision || "").slice(0, 80),
        content_sha256: sha256(transition.card_write.content),
      },
    ];
    for (const artifact of transition.artifact_writes) {
      mutations.push({
        operation: "write",
        path: boundedMutationPath(artifact.relative_path),
        content_sha256: sha256(artifact.content),
      });
    }
    mutations.push(
      {
        operation: "write",
        path: boundedMutationPath(paths.event),
        content_sha256: sha256(`${JSON.stringify(terminalEvent, null, 2)}\n`),
      },
      {
        operation: "delete",
        path: boundedMutationPath(paths.lease),
      },
      {
        operation: "delete",
        path: boundedMutationPath(paths.recovery),
      }
    );
    return mutations;
  } catch {
    return null;
  }
}

function publicRecoveryEvidence(recovery, mutations) {
  const evidence = {};
  for (const field of [
    "run_id",
    "card_id",
    "stage",
    "expected_card_revision",
    "config_fingerprint",
    "result_hash",
    "transition_hash",
    "terminal_event_hash",
  ]) {
    if (recovery[field] !== undefined) evidence[field] = String(recovery[field]).slice(0, 200);
  }
  evidence.mutations = mutations;
  return evidence;
}

function proposalFor(card, classification) {
  if (classification.operation === "none") return null;
  if (classification.operation === "resume-finalization") {
    return {
      card_id: card.id,
      card_path: card.relativePath,
      classification: classification.classification,
      operation: classification.operation,
      run_id: classification.run_id,
      expected_revision: card.revision,
      finalized_at: classification.recovery.finalized_at,
      changes: classification.recovery.mutations,
    };
  }

  const changes = [];
  if (String(card.data.status || "") !== classification.next_status) {
    changes.push(fieldChange("status", card.data.status, classification.next_status));
  }
  if (classification.classification === "verified-merged-pr") {
    changes.push(
      fieldChange("pr_merge_sha", card.data.pr_merge_sha, classification.merge.merge_sha)
    );
    changes.push(
      fieldChange("pr_merged_at", card.data.pr_merged_at, classification.merge.merged_at)
    );
  }
  if (classification.blocker) {
    changes.push(fieldChange("blocker_code", card.data.blocker_code, classification.blocker.code));
    changes.push(
      fieldChange("blocker_reason", card.data.blocker_reason, classification.blocker.reason)
    );
    changes.push(
      fieldChange(
        "blocker_remediation",
        card.data.blocker_remediation,
        classification.blocker.remediation
      )
    );
    if (classification.run_id) {
      changes.push(fieldChange("loop_run_id", card.data.loop_run_id, classification.run_id));
    }
  }
  if (changes.length === 0) return null;
  const proposal = {
    card_id: card.id,
    card_path: card.relativePath,
    classification: classification.classification,
    operation: "update-card",
    run_id: classification.run_id || "",
    expected_revision: card.revision,
    changes,
  };
  if (classification.lease?.filePath) {
    proposal.lease_path = classification.lease.relativePath || "";
    proposal.lease_run_id = classification.lease.run_id || "";
  }
  return proposal;
}

function buildPlan(projectDir, options = {}) {
  const pmDir = options.pmDir || resolvePmPaths(projectDir).pmDir;
  const now = options.now instanceof Date ? options.now : new Date();
  const expectedRepository =
    options.expectedRepository || sourceRepository(findGitRoot(options.sourceDir || projectDir));
  const expectedBase =
    options.expectedBase || defaultBranchName(findGitRoot(options.sourceDir || projectDir));
  const snapshot = (options.withRemoteSnapshot || withRemoteSnapshot)(
    pmDir,
    (remote) => {
      if (!remote.workspace) throw new Error("authoritative PM snapshot workspace is missing");
      for (const relativePath of [
        remote.pmRelative,
        path.posix.join(remote.pmRelative, "backlog"),
        path.posix.join(remote.pmRelative, "loop", "leases"),
        path.posix.join(remote.pmRelative, "loop", "events"),
        path.posix.join(remote.pmRelative, "loop", "recovery"),
      ]) {
        assertNoSymlinkPath(remote.workspace, safeRelativePath(relativePath));
      }
      const cards = readCards(remote.pmDir, remote.pmRelative);
      const leases = listLeases(remote.pmDir, { now }).map((lease) => ({
        ...lease,
        relativePath: safeRelativePath(
          path.posix.join(remote.pmRelative, "loop", "leases", path.basename(lease.filePath))
        ),
      }));
      const scanTransactions = options.scanSnapshotTransactions || scanSnapshotTransactions;
      const transactions = scanTransactions(remote.pmDir, {
        now,
        includeFinalized: true,
        cardIds: cards.map((card) => card.id),
        runIds: cards.map((card) => String(card.data.loop_run_id || "")).filter(Boolean),
      });
      const evidenceIndex = indexEvidence(leases, transactions);
      const counts = new Map();
      for (const card of cards) counts.set(card.id, (counts.get(card.id) || 0) + 1);
      const classifications = [];
      const proposed = [];
      for (const card of cards) {
        let classified =
          counts.get(card.id) > 1
            ? noAction(
                "duplicate-card-id",
                "Give every backlog file a unique card ID before reconciling."
              )
            : classifyStaleCard(card, evidenceForCard(card, evidenceIndex), {
                ...options,
                expectedRepository,
                expectedBase,
              });
        if (classified.recovery) {
          const privateRecovery = classified.recovery;
          const mutations = recoveryMutationManifest(
            privateRecovery,
            remote.pmRelative,
            now.toISOString()
          );
          if (!mutations) {
            classified = noAction(
              "recovery-ambiguous",
              "Recovery mutation metadata is invalid; repair the same run without redispatching it.",
              { run_id: classified.run_id }
            );
          } else {
            const executionKey = `${card.relativePath}\0${classified.run_id || ""}`;
            if (options.executionMap instanceof Map) {
              options.executionMap.set(executionKey, privateRecovery);
            }
            classified = {
              ...classified,
              recovery: {
                ...publicRecoveryEvidence(privateRecovery, mutations),
                finalized_at: now.toISOString(),
              },
            };
          }
        }
        const classification = {
          card_id: card.id,
          card_path: card.relativePath,
          status: String(card.data.status || ""),
          expected_revision: card.revision,
          ...classified,
        };
        classifications.push(classification);
        const proposal = proposalFor(card, classification);
        if (proposal) proposed.push(proposal);
      }
      return {
        pm_head_oid: remote.upstreamOid || "",
        classifications,
        proposed_changes: proposed,
      };
    },
    options.transactionOptions || {}
  );
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    expected_repository: expectedRepository,
    expected_base: expectedBase,
    ...snapshot,
  };
}

function defaultGitReadiness(pmDir) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return { ok: false, reason: "PM directory is not in a Git checkout" };
  try {
    ensureGitSyncReady(gitRoot, pmDir);
    const relative = gitRelativePath(gitRoot, pmDir);
    const status = runGit(
      ["status", "--porcelain=v1", "--untracked-files=all", "--", relative],
      gitRoot
    );
    if (status) return { ok: false, reason: `PM checkout has unsynced changes:\n${status}` };
    return { ok: true, git_root: gitRoot };
  } catch (err) {
    return { ok: false, reason: String(err.message || err) };
  }
}

function applyCardChanges(pmDir, changes, options = {}) {
  if (!Array.isArray(changes) || changes.length === 0) {
    return { ok: true, commitHash: options.expectedHeadOid || "", applied: [] };
  }
  const transaction = options.runIsolatedTransaction || runIsolatedTransaction;
  const work = changes.map((change) => ({ change, reconcileRunId: createRunId() }));
  return transaction(
    pmDir,
    {
      commitMessage:
        changes.length === 1
          ? `pm loop reconcile ${changes[0].card_id} ${changes[0].classification}`
          : `pm loop reconcile ${changes.length} stale cards`,
      expectedUpstreamOid: options.expectedHeadOid || "",
      upstreamMismatchReason: "reconcile-plan-stale",
      mutate(context) {
        const applied = [];
        for (const item of work) {
          const { change, reconcileRunId } = item;
          assertNoSymlinkPath(context.workspace, change.card_path);
          const cardPath = path.join(context.workspace, ...change.card_path.split("/"));
          if (
            !fs.existsSync(cardPath) ||
            sha256(fs.readFileSync(cardPath)) !== change.expected_revision
          ) {
            const err = new Error("card revision changed after reconciliation plan");
            err.name = "ReconcileRevisionError";
            throw err;
          }
          const content = fs.readFileSync(cardPath, "utf8");
          const data = parseFrontmatter(content).data;
          const fields = {};
          for (const field of MANAGED_FIELDS) {
            if (data[field] !== undefined) fields[field] = data[field];
          }
          for (const entry of change.changes) fields[entry.field] = entry.after;
          fs.writeFileSync(cardPath, rewriteFrontmatter(content, fields));

          let leasePath = "";
          if (change.lease_path) {
            leasePath = change.lease_path;
            assertNoSymlinkPath(context.workspace, leasePath);
            const absoluteLease = path.join(context.workspace, ...leasePath.split("/"));
            if (fs.existsSync(absoluteLease)) {
              const lease = JSON.parse(fs.readFileSync(absoluteLease, "utf8"));
              if (change.lease_run_id && lease.run_id !== change.lease_run_id) {
                throw new Error("expired lease owner changed after reconciliation plan");
              }
              fs.rmSync(absoluteLease);
            }
          }
          const eventPath = safeRelativePath(
            path.posix.join(context.pmRelative, "loop", "events", `${reconcileRunId}.json`)
          );
          assertNoSymlinkPath(context.workspace, eventPath);
          writeJsonAtomic(path.join(context.workspace, ...eventPath.split("/")), {
            schema_version: 1,
            run_id: reconcileRunId,
            card_id: change.card_id,
            terminal: true,
            status: "reconciled",
            outcome: change.classification,
            reconciled_at:
              options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
            changes: change.changes,
          });
          applied.push({
            card_path: change.card_path,
            event_path: eventPath,
            lease_path: leasePath,
          });
        }
        return { applied };
      },
      allowedPaths(_context, result) {
        return result.applied.flatMap((entry) => [
          entry.card_path,
          entry.event_path,
          ...(entry.lease_path ? [entry.lease_path] : []),
        ]);
      },
    },
    options.transactionOptions || {}
  );
}

function resumeRecovery(pmDir, change, recovery, options = {}) {
  if (
    !recovery ||
    recovery.run_id !== change.run_id ||
    recovery.card_id !== change.card_id ||
    !recovery.terminal_event
  ) {
    return { ok: false, reason: "recovery terminal event is missing" };
  }
  const finalize = options.finalizeRun || finalizeRun;
  return finalize(
    pmDir,
    {
      runId: recovery.run_id,
      cardId: recovery.card_id,
      stage: recovery.stage,
      event: recovery.terminal_event,
      finalizedAt: change.finalized_at,
      allowedArtifactPaths: (recovery.transition?.artifact_writes || []).map(
        (artifact) => artifact.relative_path
      ),
    },
    {
      ...(options.transactionOptions || {}),
      expectedHeadOid: options.expectedHeadOid || "",
    }
  );
}

function appliedChange(change, result, paths) {
  return {
    ...change,
    commit_oid: String(result.commitHash || ""),
    paths: [...new Set((paths || []).filter(Boolean))].sort(),
  };
}

function applyFailureReason(result, fallback) {
  if (result?.error) {
    return `${result.reason ? `${result.reason}: ` : ""}${result.error}`;
  }
  return result?.reason || fallback;
}

function runReconcile(projectDir, options = {}) {
  const pmDir = options.pmDir || resolvePmPaths(projectDir).pmDir;
  const executionMap = options.executionMap instanceof Map ? options.executionMap : new Map();
  const plan = options.plan || buildPlan(projectDir, { ...options, pmDir, executionMap });
  const base = {
    ...plan,
    mode: options.apply === true ? "apply" : "dry-run",
    applied_changes: [],
  };
  if (options.apply !== true) return { ok: true, ...base };

  const readiness = (options.checkGitReady || defaultGitReadiness)(pmDir);
  if (!readiness || readiness.ok !== true) {
    return {
      ok: false,
      code: "git-not-ready",
      reason: readiness?.reason || "Git sync readiness could not be verified",
      ...base,
    };
  }

  let expectedHeadOid = plan.pm_head_oid;
  const recoveries = plan.proposed_changes.filter(
    (change) => change.operation === "resume-finalization"
  );
  for (const change of recoveries) {
    const recovery = executionMap.get(`${change.card_path}\0${change.run_id || ""}`);
    const result = resumeRecovery(pmDir, change, recovery, {
      ...options,
      expectedHeadOid,
    });
    if (typeof options.onTransaction === "function") options.onTransaction(change, result);
    if (!result || result.ok !== true) {
      return {
        ok: false,
        code: "apply-failed",
        reason: applyFailureReason(result, "isolated PM reconciliation failed"),
        ...base,
      };
    }
    if (!/^[a-f0-9]{40,64}$/i.test(String(result.commitHash || ""))) {
      return {
        ok: false,
        code: "apply-failed",
        reason: "isolated PM recovery did not return a commit OID",
        ...base,
      };
    }
    expectedHeadOid = result.commitHash;
    const eventMutation = change.changes.find(
      (entry) => entry.operation === "write" && entry.path === result.event_path
    );
    if (
      !eventMutation ||
      eventMutation.content_sha256 !== sha256(`${JSON.stringify(result.event, null, 2)}\n`)
    ) {
      return {
        ok: false,
        code: "apply-failed",
        reason: "finalized recovery event does not match the proposed content hash",
        ...base,
      };
    }
    base.applied_changes.push(
      appliedChange(change, result, [
        result.card_path,
        result.event_path,
        result.recovery_path,
        result.lease_path,
        ...(result.artifact_paths || []),
      ])
    );
  }

  const ordinary = plan.proposed_changes.filter((change) => change.operation === "update-card");
  if (ordinary.length > 0) {
    const result = applyCardChanges(pmDir, ordinary, { ...options, expectedHeadOid });
    if (typeof options.onTransaction === "function") {
      options.onTransaction({ operation: "batch-update", changes: ordinary }, result);
    }
    if (!result || result.ok !== true) {
      return {
        ok: false,
        code: "apply-failed",
        reason: applyFailureReason(result, "isolated PM reconciliation failed"),
        ...base,
      };
    }
    if (!/^[a-f0-9]{40,64}$/i.test(String(result.commitHash || ""))) {
      return {
        ok: false,
        code: "apply-failed",
        reason: "isolated PM reconciliation did not return a commit OID",
        ...base,
      };
    }
    for (let index = 0; index < ordinary.length; index += 1) {
      const detail = result.applied?.[index] || {};
      base.applied_changes.push(
        appliedChange(ordinary[index], result, [
          detail.card_path,
          detail.event_path,
          detail.lease_path,
        ])
      );
    }
  }
  return { ok: true, ...base };
}

function reconcilePlanIdentity(plan) {
  return {
    expected_repository: plan.expected_repository,
    expected_base: plan.expected_base,
    pm_head_oid: plan.pm_head_oid,
    proposed_changes: plan.proposed_changes,
  };
}

function reconcilePlanHash(plan) {
  return sha256(stableStringify(reconcilePlanIdentity(plan)));
}

function reconcileReceipt(plan, result) {
  const applied = (result.applied_changes || []).map((change) => ({
    card_id: change.card_id,
    operation: change.operation,
    classification: change.classification,
    commit_oid: change.commit_oid,
    paths: change.paths,
  }));
  return {
    plan_sha256: reconcilePlanHash(plan),
    initial_head: plan.pm_head_oid,
    final_head: applied.at(-1)?.commit_oid || plan.pm_head_oid,
    applied_changes_sha256: sha256(stableStringify(applied)),
    applied_changes: applied,
  };
}

function runReconcileEffect(projectDir, options = {}) {
  const resolvedProjectDir = path.resolve(projectDir);
  const paths = resolvePmPaths(resolvedProjectDir);
  const pmDir = path.resolve(options.pmDir || paths.pmDir);
  const pmStateDir = path.resolve(options.pmStateDir || paths.pmStateDir);
  const planBuilder = options.planBuilder || buildPlan;
  const execute = options.execute || runReconcile;
  let executionMap;
  let plan;
  let originalPlanHash;
  const serialization = sharedGitRepositorySerialization(pmDir);

  const observe = ({ journal, mutation }) => {
    if (mutation?.result?.ok === true) {
      return { state: "verified", receipt: reconcileReceipt(plan, mutation.result) };
    }
    const prior = journal.verified_receipt?.receipt;
    let current;
    try {
      current = planBuilder(resolvedProjectDir, { ...options, pmDir });
    } catch (error) {
      return { state: "ambiguous", reason: `reconciliation state is unreadable: ${error.message}` };
    }
    const currentHash = reconcilePlanHash(current);
    const partialReceipt = journal.recovery_evidence?.partial_receipt;
    if (partialReceipt) {
      return {
        state: "ambiguous",
        reason:
          current.pm_head_oid === partialReceipt.final_head
            ? "reconciliation partially applied; exact recovery is required before retry"
            : "repository head diverged after a partially applied reconciliation",
      };
    }
    const attemptedPlanHash = journal.precondition?.plan_sha256;
    if (
      !mutation &&
      (journal.state === "attempting" || journal.state === "ambiguous") &&
      attemptedPlanHash &&
      attemptedPlanHash !== originalPlanHash
    ) {
      return {
        state: "ambiguous",
        reason: "the interrupted reconciliation plan cannot be reconstructed exactly",
      };
    }
    if (
      prior &&
      current.proposed_changes.length === 0 &&
      current.pm_head_oid === prior.final_head
    ) {
      return { state: "verified", receipt: prior };
    }
    if (plan.proposed_changes.length === 0 && currentHash === originalPlanHash) {
      return { state: "verified", receipt: reconcileReceipt(plan, { applied_changes: [] }) };
    }
    if (currentHash === originalPlanHash) {
      return { state: "absent", safe_to_retry: true, reason: "reconciliation plan is unchanged" };
    }
    return {
      state: "ambiguous",
      reason: "reconciliation plan changed without a verified effect receipt",
    };
  };

  const effect = runOperationalEffect({
    pmStateDir,
    workflow: "loop",
    effect: "apply-loop-reconciliation",
    authorityAction: "reconcile_loop_state",
    authorityActions: options.authorityActions,
    serializationRoot: serialization.root,
    serializationScope: serialization.scope,
    target: { repository: "pm-knowledge-base", operation: "loop-reconciliation" },
    intent: { mode: "apply" },
    precondition() {
      executionMap = new Map();
      plan = planBuilder(resolvedProjectDir, { ...options, pmDir, executionMap });
      originalPlanHash = reconcilePlanHash(plan);
      return {
        pm_head_oid: plan.pm_head_oid,
        plan_sha256: originalPlanHash,
        proposed_changes_sha256: sha256(stableStringify(plan.proposed_changes)),
      };
    },
    recovery: { code: "inspect-loop-reconcile-effect", command: "/pm:loop reconcile --dry-run" },
    observe,
    mutate() {
      const result = execute(resolvedProjectDir, {
        ...options,
        pmDir,
        apply: true,
        plan,
        executionMap,
      });
      if (!result.ok) {
        if (Array.isArray(result.applied_changes) && result.applied_changes.length > 0) {
          return {
            ambiguous: true,
            reason: result.reason || result.code || "loop reconciliation partially applied",
            recoveryEvidence: {
              code: result.code || "loop-reconcile-partial-apply",
              reason: result.reason || "loop reconciliation partially applied",
              partial_receipt: reconcileReceipt(plan, result),
            },
          };
        }
        return {
          blocked: true,
          reason: result.reason || result.code || "loop reconciliation failed",
          recovery: {
            code: result.code || "loop-reconcile-failed",
            command: "/pm:loop reconcile --dry-run",
          },
        };
      }
      if (reconcilePlanHash(result) !== originalPlanHash) {
        return {
          blocked: true,
          reason: "reconciliation executor returned a different plan than the journal precondition",
          recovery: {
            code: "loop-reconcile-plan-changed",
            command: "/pm:loop reconcile --dry-run",
          },
        };
      }
      return { receipt: reconcileReceipt(plan, result), result };
    },
  });
  const receipt = effect.verified_receipt?.receipt;
  const partialReceipt = effect.recovery_evidence?.partial_receipt;
  return {
    ...effect,
    ok: effect.state === "verified",
    mode: "apply",
    applied_changes: receipt?.applied_changes || partialReceipt?.applied_changes || [],
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    sourceDir: "",
    apply: false,
    dryRun: false,
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--source-dir": { key: "sourceDir", type: "string" },
      "--apply": { key: "apply", type: "boolean" },
      "--dry-run": { key: "dryRun", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (args.apply && args.dryRun) throw new Error("--apply and --dry-run are mutually exclusive");
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  if (args.sourceDir) args.sourceDir = path.resolve(args.sourceDir);
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.apply
      ? runReconcileEffect(args.projectDir, {
          ...args,
          authorityActions: ["reconcile_loop_state"],
        })
      : runReconcile(args.projectDir, args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 2);
  } catch (err) {
    process.stderr.write(`loop-reconcile: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildPlan,
  classifyStaleCard,
  parseArgs,
  recoveryMutationManifest,
  resumeRecovery,
  runReconcile,
  runReconcileEffect,
};

if (require.main === module) main();
