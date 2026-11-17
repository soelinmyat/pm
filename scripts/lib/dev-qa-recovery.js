"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { acquireOwnedLock } = require("./owned-lock");
const { readProjectInput, writeProjectJsonAtomic } = require("./project-file");
const { runGit } = require("../loop-git");
const { transactionIssues } = require("./release-transaction-schema");
const { appendTransition } = require("./workflow-runtime/records");
const MAX_BYTES = 8 * 1024 * 1024;
const digest = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

function readOptional(root, relative) {
  try {
    return readProjectInput(root, relative, MAX_BYTES).bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A superseded publication is audit history, not current certification. Validate
// its complete effect/receipt identity using the same rules as a live generation;
// the transaction schema intentionally validates historical entries less deeply.
function historicalPublication(session, transaction, commit) {
  if (transaction.generation !== transaction.history.length + 1)
    throw new Error("first QA recovery requires contiguous delivery history");
  let prNumber = null;
  for (const generation of transaction.history) {
    const projected = {
      ...transaction,
      generation: generation.generation,
      history: transaction.history.slice(0, generation.generation - 1),
      release: { ...transaction.release, prepared_commit: generation.prepared_commit },
      evidence: generation.evidence,
      effects: generation.effects,
      pr_body_attestation: generation.pr_body_attestation ?? null,
    };
    if (transactionIssues(projected).length)
      throw new Error("first QA recovery refuses invalid historical delivery effects or evidence");
    if (generation.pr_body_attestation || generation.evidence.candidate)
      throw new Error(
        "first QA recovery refuses historical merge attestations or optimized candidates"
      );
    const qa = generation.evidence.qa;
    if (
      qa &&
      (qa.artifact !== `.pm/dev-sessions/${session.slug}/gates.json` ||
        qa.commit !== generation.prepared_commit)
    )
      throw new Error("first QA recovery refuses historical canonical QA bindings");
    const effects = Object.entries(generation.effects);
    if (!effects.length) continue;
    if (
      effects.some(
        ([name, effect]) =>
          !["push", "create-pr", "ready-pr"].includes(name) ||
          effect.status !== "verified" ||
          effect.attempts.some((attempt) => attempt.status === "attempting") ||
          effect.depends_on.some(
            (dependency) => generation.effects[dependency]?.status !== "verified"
          )
      ) ||
      !generation.effects["create-pr"]
    )
      throw new Error(
        "first QA recovery refuses unresolved or non-publication historical delivery effects"
      );
    const receipt = generation.effects["create-pr"].verified_receipt.receipt;
    const number = receipt.pr_number ?? receipt.number;
    if (prNumber !== null && number !== prNumber)
      throw new Error("first QA recovery requires one historical PR identity");
    prNumber = number;
    runGit(
      ["merge-base", "--is-ancestor", generation.prepared_commit, commit],
      session.source.worktree
    );
  }
  return prNumber;
}

function assertEligible(session, transaction, commit) {
  const { validateSession } = require("./dev-session-schema");
  const issues = validateSession(session);
  if (issues.length) throw new Error(`invalid recovery session: ${issues[0].message}`);
  if (session.phase !== "ship" || !["active", "blocked"].includes(session.status))
    throw new Error("first QA recovery requires an active or blocked Ship session");
  if (
    !session.authority.local_writes ||
    session.candidate.route !== "comprehensive" ||
    session.candidate.external_effect_started_at
  )
    throw new Error(
      "first QA recovery requires local-write authority and an untouched comprehensive candidate"
    );
  if (
    session.routing.qa_recovery ||
    session.routing.required_phases.includes("qa") ||
    session.routing.required_gates.includes("qa") ||
    session.evidence.qa ||
    session.attempts.some((entry) => entry.phase === "qa")
  )
    throw new Error("first QA recovery cannot replace existing QA routing or history");
  const blockers = session.blockers.filter((entry) => !entry.resolved_at);
  if (
    blockers.some(
      (entry) =>
        entry.phase !== "ship" ||
        !["missing-qa", "pm-unrouted-mobile-qa-contract", "pm-missing-qa-recovery"].includes(
          entry.code
        )
    ) ||
    (session.status === "blocked" && !blockers.length)
  )
    throw new Error("resolve unrelated blockers before requiring QA");
  if (
    !session.evidence.implementation?.commit ||
    !session.evidence.review?.commit ||
    session.attempts.filter((entry) => entry.phase === "review").at(-1)?.status !== "passed"
  )
    throw new Error("first QA recovery requires completed implementation and Review");
  if (
    transactionIssues(transaction).length ||
    transaction.run_id !== session.run_id ||
    transaction.slug !== session.slug ||
    transaction.source.head_branch !== session.source.branch ||
    transaction.source.delivery_remote !== session.source.delivery_remote ||
    transaction.source.base_branch !== session.source.default_branch ||
    transaction.release.prepared_commit !== commit
  )
    throw new Error("release transaction must match the session and current prepared HEAD");
  if (
    Object.keys(transaction.effects).length ||
    transaction.pr_body_attestation ||
    transaction.evidence.qa ||
    transaction.evidence.candidate
  )
    throw new Error("first QA recovery refuses current delivery effects or QA bindings");
  historicalPublication(session, transaction, commit);
  if (transaction.release.tag_created)
    throw new Error("first QA recovery refuses an existing release tag");
}

function recoveredSession(archive, archiveBinding) {
  const { validateSession, RUNNER_VERSION } = require("./dev-session-schema");
  const next = JSON.parse(archive.session);
  const priorPhase = next.phase;
  next.routing.required_phases.splice(next.routing.required_phases.indexOf("review"), 0, "qa");
  next.routing.required_gates.splice(next.routing.required_gates.indexOf("review"), 0, "qa");
  next.routing.reasons.push(`First QA required: ${archive.reason}`);
  next.routing.qa_recovery = {
    archive: archiveBinding,
    commit: archive.commit,
    recorded_at: archive.recorded_at,
  };
  // Exact predecessor certification stays in the immutable archive. Keep the
  // Review lineage anchors live, but require a new passing Review record.
  for (const phase of ["review", "ship", "retro"]) {
    if (next.evidence[phase])
      next.evidence[phase] = {
        commit: null,
        records: [],
        recorded_at: archive.recorded_at,
        ...(next.evidence[phase].recovery_history
          ? { recovery_history: next.evidence[phase].recovery_history }
          : {}),
      };
  }
  for (const blocker of next.blockers.filter((entry) => !entry.resolved_at)) {
    blocker.resolved_at = archive.recorded_at;
    blocker.resolution = `Required first QA; delivery remains uncertified: ${archive.reason}`;
  }
  next.phase = "qa";
  next.phase_attempt = 1;
  next.status = "active";
  next.updated_at = archive.recorded_at;
  appendTransition(next.history, {
    priorPhase,
    nextPhase: "qa",
    reason: `Required first QA: ${archive.reason}`,
    result: next.routing.qa_recovery,
    timestamp: archive.recorded_at,
    runnerVersion: RUNNER_VERSION,
  });
  const issues = validateSession(next);
  if (issues.length) throw new Error(`invalid recovered session: ${issues[0].message}`);
  return next;
}

// Caller holds the canonical Dev session lock. Hold the transaction lock too:
// begin cannot race the eligibility check or observe half-published recovery.
function requireQa(options) {
  const {
    validateSession,
    writeSession,
    verifyRfcSidecarIdentity,
  } = require("./dev-session-schema");
  const { value: located } = require("./dev-session-location").loadDevSession(process.cwd(), {
    sessionPath: options.sessionPath,
  });
  if (fs.realpathSync(located.source.repo_root) !== fs.realpathSync(located.source.worktree))
    throw new Error(
      "first QA recovery currently requires a co-located session and worktree; split-root sessions need a separately supported migration"
    );
  const root = located.source.repo_root;
  const sessionPath = fs.realpathSync(options.sessionPath);
  const relative = path.relative(root, sessionPath).split(path.sep).join("/");
  const directory = path.posix.dirname(relative);
  if (relative !== `.pm/dev-sessions/${located.slug}/session.json`)
    throw new Error("first QA recovery requires the canonical active session path");
  const transactionRelative = `${directory}/ship/release-transaction.json`;
  // Validate the path before the lock implementation can create anything.
  readProjectInput(root, transactionRelative, MAX_BYTES);
  const release = acquireOwnedLock(path.join(root, transactionRelative) + ".lock", {
    attempts: 200,
    waitMs: 25,
  });
  try {
    const sessionBytes = readProjectInput(root, relative, MAX_BYTES).bytes;
    const session = JSON.parse(sessionBytes);
    if (session.schema_version !== 3 || validateSession(session).length)
      throw new Error("QA recovery requires a valid schema-v3 session; migrate separately first");
    verifyRfcSidecarIdentity(
      session.task.rfc_sidecar,
      session.task.design_context,
      session.task.work_units
    );
    if (!/^sha256:[a-f0-9]{64}$/.test(options.expectedSessionSha256 || ""))
      throw new Error("expected session SHA-256 is required");
    if (
      typeof options.reason !== "string" ||
      !options.reason.trim() ||
      options.reason.length > 2000
    )
      throw new Error("QA recovery requires a bounded non-empty reason");
    const head = runGit(["rev-parse", "HEAD"], session.source.worktree);
    const branch = runGit(["branch", "--show-current"], session.source.worktree);
    if (head !== options.commit || branch !== session.source.branch)
      throw new Error("QA recovery commit and branch must equal current HEAD");
    const archivePath = `${directory}/recovery/require-qa/${options.expectedSessionSha256.slice(7)}.json`;
    let archiveBytes = readOptional(root, archivePath);
    const transactionBytes = readProjectInput(root, transactionRelative, MAX_BYTES).bytes.toString(
      "utf8"
    );
    const gatesBytes = readOptional(root, `${directory}/gates.json`);
    if (archiveBytes !== null) {
      const archive = JSON.parse(archiveBytes);
      if (
        archive.commit !== options.commit ||
        archive.reason !== options.reason.trim() ||
        digest(archive.session) !== options.expectedSessionSha256
      )
        throw new Error("recovery archive does not match the original request");
      const binding = { path: archivePath, sha256: digest(archiveBytes) };
      const next = recoveredSession(archive, binding);
      if (session.routing.qa_recovery) {
        if (
          session.routing.qa_recovery.archive.sha256 !== binding.sha256 ||
          !sessionBytes.equals(jsonBytes(next))
        )
          throw new Error("recovery already advanced or its immutable archive changed");
        return { session, idempotent: true, archive: binding };
      }
      if (
        digest(sessionBytes) !== options.expectedSessionSha256 ||
        archive.transaction !== transactionBytes ||
        archive.gates !== gatesBytes
      )
        throw new Error("recovery inputs changed after archive publication");
      assertEligible(session, JSON.parse(transactionBytes), options.commit);
      writeSession(sessionPath, next);
      return { session: next, idempotent: false, archive: binding };
    }
    if (digest(sessionBytes) !== options.expectedSessionSha256)
      throw new Error("session SHA-256 changed; re-observe before recovery");
    assertEligible(session, JSON.parse(transactionBytes), options.commit);
    const archive = {
      schema_version: 1,
      commit: options.commit,
      reason: options.reason.trim(),
      recorded_at: new Date().toISOString(),
      session: sessionBytes.toString("utf8"),
      transaction: transactionBytes,
      gates: gatesBytes,
    };
    archiveBytes = jsonBytes(archive);
    if (archiveBytes.length > MAX_BYTES)
      throw new Error("QA recovery archive exceeds its byte budget");
    const binding = { path: archivePath, sha256: digest(archiveBytes) };
    const next = recoveredSession(archive, binding);
    writeProjectJsonAtomic(root, archivePath, archive, {
      replace: false,
      fileMode: 0o600,
      directoryMode: 0o700,
    });
    writeSession(sessionPath, next);
    return { session: next, idempotent: false, archive: binding };
  } finally {
    release();
  }
}

function assertRecoveryDeliveryReady(session, transaction, effect) {
  const recovery = session.routing?.qa_recovery;
  if (!recovery) return;
  if (session.status !== "active" || session.phase !== "ship")
    throw new Error("QA recovery requires completed QA and fresh Review before delivery");
  if (
    runGit(["rev-parse", "HEAD"], session.source.worktree) !==
      transaction.release.prepared_commit ||
    runGit(["branch", "--show-current"], session.source.worktree) !== session.source.branch
  )
    throw new Error("QA recovery delivery requires current prepared HEAD and branch");
  const root = session.source.repo_root;
  const archive = readProjectInput(root, recovery.archive.path, MAX_BYTES);
  if (digest(archive.bytes) !== recovery.archive.sha256)
    throw new Error("QA recovery archive hash changed");
  const predecessor = JSON.parse(JSON.parse(archive.bytes).transaction);
  const prNumber = historicalPublication(session, predecessor, recovery.commit);
  if (JSON.stringify(predecessor.source) !== JSON.stringify(transaction.source))
    throw new Error("QA recovery delivery destination changed from the archived transaction");
  const currentPr = transaction.effects["create-pr"]?.verified_receipt?.receipt;
  if (prNumber !== null && currentPr && (currentPr.pr_number ?? currentPr.number) !== prNumber)
    throw new Error("QA recovery must reconcile the same historical PR before delivery");
  if (
    prNumber !== null &&
    effect === "create-pr" &&
    transaction.effects["create-pr"]?.target.existing_pr_number !== prNumber
  )
    throw new Error("QA recovery create-pr target must bind the historical existing_pr_number");
  for (const kind of ["qa", "review", "verification"]) {
    if (!transaction.evidence[kind] || transaction.evidence[kind].checked_at < recovery.recorded_at)
      throw new Error(`QA recovery requires fresh ${kind} release binding`);
    const bound = transaction.evidence[kind];
    const relative = path.isAbsolute(bound.artifact)
      ? path.relative(root, bound.artifact).split(path.sep).join("/")
      : bound.artifact;
    if (
      bound.commit !== transaction.release.prepared_commit ||
      digest(readProjectInput(root, relative, MAX_BYTES).bytes) !== bound.sha256
    )
      throw new Error(`QA recovery ${kind} release binding is stale or changed`);
  }
  const { checkGateManifest } = require("../dev-gate-check");
  const manifestPath = `.pm/dev-sessions/${session.slug}/gates.json`;
  const manifest = JSON.parse(readProjectInput(root, manifestPath, MAX_BYTES).bytes);
  const base = require("../review-target").resolveTrustedBase(
    session.source.worktree,
    session.source.delivery_remote
  );

  let evidenceBase = base.commit;
  if (["place-main-tag", "tracker-update"].includes(effect)) {
    // A merged feature has intentionally changed main's merge base. Authenticate
    // the observed merge, then check every gate against its frozen Review base.
    const merge = transaction.effects.merge;
    const receipt = merge?.verified_receipt?.receipt;
    if (
      transactionIssues(transaction).length ||
      merge?.status !== "verified" ||
      receipt?.head_oid !== transaction.release.prepared_commit ||
      base.ref !== `${transaction.source.delivery_remote}/${transaction.source.base_branch}` ||
      `sha256:${base.remote_push_url_sha256}` !== transaction.source.push_url_sha256
    )
      throw new Error(
        "QA recovery post-merge execution requires a matching verified merge and live destination"
      );
    const review = JSON.parse(
      readProjectInput(root, `.pm/dev-sessions/${session.slug}/review/report.json`, MAX_BYTES).bytes
    );
    const targetFile = readProjectInput(root, review.target.path, MAX_BYTES);
    const target = JSON.parse(targetFile.bytes);
    if (
      digest(targetFile.bytes) !== `sha256:${review.target.sha256}` ||
      review.source.commit !== transaction.release.prepared_commit ||
      target.source.commit !== transaction.release.prepared_commit
    )
      throw new Error("QA recovery post-merge Review must bind the exact prepared commit");
    evidenceBase = target.source.base_commit;
    runGit(
      ["merge-base", "--is-ancestor", evidenceBase, receipt.merge_sha],
      session.source.worktree
    );
    runGit(
      ["merge-base", "--is-ancestor", receipt.merge_sha, base.commit],
      session.source.worktree
    );
  }
  const checked = checkGateManifest(manifest, {
    manifestPath,
    artifactRoot: root,
    canonicalSession: session,
    runId: session.run_id,
    currentCommit: transaction.release.prepared_commit,
    currentBranch: session.source.branch,
    authoritativeBaseRef: base.ref,
    authoritativeBaseCommit: evidenceBase,
    authoritativePushUrlSha256: base.remote_push_url_sha256,
    requireSessionBinding: true,
    requireDeliveryEvidence: true,
    reviewEvidenceMode: "enforce",
    allowSkippedGates: ["design-critique", "tdd"],
  });
  if (!checked.ok)
    throw new Error(
      `QA recovery delivery gates failed: ${checked.issues.map((issue) => issue.message).join("; ")}`
    );
  return prNumber;
}
function relocateQaRecovery(session, activeDir, archiveDir) {
  const binding = session.routing.qa_recovery?.archive;
  if (!binding) return;
  const root = session.source.repo_root;
  const oldPath = path.resolve(root, binding.path);
  const inside = (base, value) => {
    const relative = path.relative(base, value);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : null;
  };
  // Completion writes the relocated binding before renaming the directory.
  // A retry must verify the same bytes still at their active location.
  const relative = inside(activeDir, oldPath) || inside(archiveDir, oldPath);
  if (!relative) throw new Error("QA recovery archive is outside the active session");
  const sourcePath = path.relative(root, path.join(activeDir, relative)).split(path.sep).join("/");
  const bytes = readProjectInput(root, sourcePath, MAX_BYTES).bytes;
  if (digest(bytes) !== binding.sha256) throw new Error("QA recovery archive hash changed");
  binding.path = path.relative(root, path.join(archiveDir, relative)).split(path.sep).join("/");
}
module.exports = { requireQa, assertRecoveryDeliveryReady, relocateQaRecovery };
