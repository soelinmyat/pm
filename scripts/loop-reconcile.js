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
  createRunId,
  finalizeRun,
  runIsolatedTransaction,
  safeRelativePath,
  scanSnapshotTransactions,
  withRemoteSnapshot,
} = require("./loop-pm-transaction.js");
const { inspectPullRequest } = require("./pr-state.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

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
  if (
    !artifact.repo ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !artifact.url ||
    !artifact.base ||
    !artifact.head ||
    !/^[a-f0-9]{40,64}$/i.test(artifact.head_oid) ||
    !Number.isFinite(Date.parse(artifact.created_at))
  ) {
    return null;
  }
  return artifact;
}

function transactionForCard(card, transactions) {
  const runId = String(card.data.loop_run_id || "");
  const candidates = (transactions || []).filter((entry) => {
    const cardId = entry.recovery?.card_id || entry.lease?.card_id || entry.event?.card_id;
    return cardId ? cardId === card.id : entry.run_id === runId;
  });
  return candidates.find((entry) => entry.run_id === runId) || candidates[0] || null;
}

function leasesForCard(card, leases) {
  const runId = String(card.data.loop_run_id || "");
  return (leases || []).filter(
    (lease) =>
      (!lease.card_id || lease.card_id === card.id) &&
      (!runId || !lease.run_id || lease.run_id === runId)
  );
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
  const transaction = transactionForCard(card, evidence.transactions);
  const cardLeases = leasesForCard(card, evidence.leases);

  if (transaction && transaction.recovery) {
    if (transaction.state === "recovery-ready") {
      return {
        classification: "recovery-ready",
        operation: "resume-finalization",
        run_id: transaction.run_id,
        recovery: transaction.recovery,
      };
    }
    return noAction(
      "recovery-ambiguous",
      "Repair the same-run recovery ownership/hash mismatch; do not dispatch the card again.",
      { run_id: transaction.run_id, recovery: transaction.recovery }
    );
  }

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

function readTerminalEvents(pmDir) {
  const eventsDir = path.join(pmDir, "loop", "events");
  if (!fs.existsSync(eventsDir)) return [];
  const events = [];
  for (const entry of fs.readdirSync(eventsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const runId = entry.name.slice(0, -5);
    try {
      const event = JSON.parse(fs.readFileSync(path.join(eventsDir, entry.name), "utf8"));
      if (event.run_id !== runId || event.terminal !== true || typeof event.card_id !== "string") {
        continue;
      }
      events.push({
        run_id: runId,
        state: "finalized",
        event,
        recovery: null,
        lease: null,
        lease_expired: false,
        redispatch: false,
      });
    } catch {
      // Invalid durable evidence cannot authorize a repair.
    }
  }
  return events;
}

function fieldChange(field, before, after) {
  return {
    field,
    before: before === undefined || before === null ? "" : String(before),
    after: String(after),
  };
}

function proposalFor(card, classification) {
  if (classification.operation === "none") return null;
  if (classification.operation === "resume-finalization") {
    const proposal = {
      card_id: card.id,
      card_path: card.relativePath,
      classification: classification.classification,
      operation: classification.operation,
      run_id: classification.run_id,
      expected_revision: card.revision,
      changes: [{ field: "recovery", before: "ready-to-finalize", after: "finalized" }],
    };
    Object.defineProperty(proposal, "_recovery", { value: classification.recovery });
    return proposal;
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

function sourceRepository(projectDir) {
  const root = findGitRoot(projectDir);
  if (!root) return "";
  let remote = "";
  try {
    remote = runGit(["remote", "get-url", "origin"], root);
  } catch {
    return "";
  }
  const match = String(remote).match(
    /(?:github\.com[/:]|^[^/]+\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/
  );
  return match ? match[1].replace(/\.git$/, "") : "";
}

function sourceDefaultBranch(projectDir) {
  const root = findGitRoot(projectDir);
  if (!root) return "main";
  try {
    return runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root).replace(
      /^origin\//,
      ""
    );
  } catch {
    return "main";
  }
}

function buildPlan(projectDir, options = {}) {
  const pmDir = options.pmDir || resolvePmPaths(projectDir).pmDir;
  const now = options.now instanceof Date ? options.now : new Date();
  const expectedRepository =
    options.expectedRepository || sourceRepository(options.sourceDir || projectDir);
  const expectedBase = options.expectedBase || sourceDefaultBranch(options.sourceDir || projectDir);
  const snapshot = (options.withRemoteSnapshot || withRemoteSnapshot)(
    pmDir,
    (remote) => {
      const cards = readCards(remote.pmDir, remote.pmRelative);
      const leases = listLeases(remote.pmDir, { now }).map((lease) => ({
        ...lease,
        relativePath: safeRelativePath(
          path.posix.join(remote.pmRelative, "loop", "leases", path.basename(lease.filePath))
        ),
      }));
      const incompleteTransactions = scanSnapshotTransactions(remote.pmDir, { now });
      const byRunId = new Map(
        readTerminalEvents(remote.pmDir).map((transaction) => [transaction.run_id, transaction])
      );
      for (const transaction of incompleteTransactions) {
        byRunId.set(transaction.run_id, transaction);
      }
      const transactions = [...byRunId.values()];
      const classifications = cards.map((card) => {
        const classified = classifyStaleCard(
          card,
          { leases, transactions },
          {
            ...options,
            expectedRepository,
            expectedBase,
          }
        );
        return {
          card_id: card.id,
          card_path: card.relativePath,
          status: String(card.data.status || ""),
          expected_revision: card.revision,
          ...classified,
        };
      });
      const proposed = [];
      for (const card of cards) {
        const classification = classifications.find((entry) => entry.card_id === card.id);
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

function applyCardChange(pmDir, change, options = {}) {
  const transaction = options.runIsolatedTransaction || runIsolatedTransaction;
  const reconcileRunId = createRunId();
  return transaction(
    pmDir,
    {
      commitMessage: `pm loop reconcile ${change.card_id} ${change.classification}`,
      mutate(context) {
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
        return { card_path: change.card_path, event_path: eventPath, lease_path: leasePath };
      },
      allowedPaths(_context, result) {
        return [
          result.card_path,
          result.event_path,
          ...(result.lease_path ? [result.lease_path] : []),
        ];
      },
    },
    options.transactionOptions || {}
  );
}

function resumeRecovery(pmDir, change, options = {}) {
  const recovery = change._recovery;
  if (!recovery || !recovery.terminal_event) {
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
      allowedArtifactPaths: (recovery.transition?.artifact_writes || []).map(
        (artifact) => artifact.relative_path
      ),
    },
    options.transactionOptions || {}
  );
}

function runReconcile(projectDir, options = {}) {
  const pmDir = options.pmDir || resolvePmPaths(projectDir).pmDir;
  const plan = buildPlan(projectDir, { ...options, pmDir });
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

  for (const change of plan.proposed_changes) {
    const result =
      change.operation === "resume-finalization"
        ? resumeRecovery(pmDir, change, options)
        : applyCardChange(pmDir, change, options);
    if (typeof options.onTransaction === "function") options.onTransaction(change, result);
    if (!result || result.ok !== true) {
      return {
        ok: false,
        code: "apply-failed",
        reason: result?.reason || result?.error || "isolated PM reconciliation failed",
        ...base,
      };
    }
    base.applied_changes.push(change);
  }
  return { ok: true, ...base };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    sourceDir: "",
    apply: false,
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--source-dir": { key: "sourceDir", type: "string" },
      "--apply": { key: "apply", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  if (args.sourceDir) args.sourceDir = path.resolve(args.sourceDir);
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = runReconcile(args.projectDir, args);
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
  resumeRecovery,
  runReconcile,
};

if (require.main === module) main();
