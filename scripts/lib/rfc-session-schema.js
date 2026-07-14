"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { inspectHtmlArtifact } = require("../artifact-check.js");
const { extractSidecarHash, validateRfcSidecar } = require("../rfc-sidecar-check.js");
const { loadPhaseStep } = require("../step-loader.js");
const { findGitRoot, gitRelativePath, readGitFile, runGit } = require("../loop-git.js");
const { isRfc3339DateTime: isIsoDate } = require("./iso-time.js");
const { markdownTableValue } = require("./session-scan.js");
const { grantActions } = require("./workflow-runtime/authority.js");
const {
  createTransition,
  hashResult,
  isObject: isRecordObject,
  stableStringify,
} = require("./workflow-runtime/records.js");
const {
  evidenceRecordIssues,
  runtimeRecordIssues,
} = require("./workflow-runtime/result-envelope.js");

const PHASES = ["intake", "generation", "review", "approval", "handoff"];
const STATUSES = new Set(["active", "awaiting_approval", "approved", "blocked", "complete"]);
const RESULT_STATUSES = new Set(["passed", "failed", "blocked"]);
const REQUIRED_REVIEW_LENSES = ["architecture-risk", "test-strategy", "maintainability"];
const AUTHORITY_ACTIONS = [
  "linear_create",
  "loop_approval",
  "open_browser",
  "start_implementation",
];
function createSession(options) {
  if (!options?.slug || !options?.sourceDir) {
    throw new Error("createSession requires slug and sourceDir");
  }
  const sourceDir = path.resolve(options.sourceDir);
  let repoRoot;
  try {
    repoRoot = fs.realpathSync(findGitRoot(sourceDir));
  } catch {
    throw new Error(`source directory is not a Git worktree: ${sourceDir}`);
  }
  const now = options.now || new Date().toISOString();
  const session = {
    schema_version: 2,
    run_id: options.runId || `rfc_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    slug: normalizeSlug(options.slug),
    status: "active",
    phase: "intake",
    phase_attempt: 1,
    created_at: now,
    updated_at: now,
    source: {
      repo_root: repoRoot,
      worktree: repoRoot,
      branch: gitValue(repoRoot, ["branch", "--show-current"], "detached"),
      base_commit: gitValue(repoRoot, ["rev-parse", "HEAD"], "unknown"),
    },
    context: {
      configured: false,
      source_kind: null,
      proposal_path: null,
      linear_id: null,
      size: null,
      acceptance_criteria: [],
      artifact_repo_root: null,
    },
    artifact: null,
    review: {
      status: "not_started",
      artifact_hash: null,
      rounds: 0,
      verdicts: [],
      reviewed_at: null,
    },
    approval: {
      status: "pending",
      approved_by: null,
      approved_at: null,
      artifact_hash: null,
    },
    authority: Object.fromEntries(AUTHORITY_ACTIONS.map((action) => [action, false])),
    authority_log: [],
    execution: {
      profile: options.profile || "inherit",
      runtime: options.runtime || "inline",
      model: options.model || "inherit",
      reasoning: options.reasoning || "inherit",
      mode: options.mode || "inherit",
      runtime_session_id: null,
      headless: options.headless ?? process.env.PM_LOOP_WORKER === "1",
    },
    attempts: [],
    blockers: [],
    history: [],
    migration: null,
  };
  assertValidSession(session);
  return session;
}

function applyContext(session, facts, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.phase !== "intake" || session.status !== "active") {
    throw new Error("RFC context may only be configured during active intake");
  }
  if (!isObject(facts)) throw new Error("RFC context facts must be an object");
  const contextFields = new Set([
    "source_kind",
    "proposal_path",
    "linear_id",
    "size",
    "acceptance_criteria",
    "artifact_repo_root",
  ]);
  for (const field of Object.keys(facts)) {
    if (!contextFields.has(field)) throw new Error(`unknown RFC context field: ${field}`);
  }
  if (!new Set(["proposal", "linear-issue"]).has(facts.source_kind)) {
    throw new Error("source_kind must be proposal or linear-issue");
  }
  if (!["M", "L", "XL"].includes(facts.size)) {
    throw new Error("RFC size must be M, L, or XL; route XS/S directly to pm:dev");
  }
  if (!Array.isArray(facts.acceptance_criteria) || facts.acceptance_criteria.length === 0) {
    throw new Error("RFC context requires acceptance_criteria");
  }
  if (facts.acceptance_criteria.some((criterion) => !nonEmpty(criterion))) {
    throw new Error("every acceptance criterion must be a non-empty string");
  }
  if (facts.source_kind === "proposal" && !nonEmpty(facts.proposal_path)) {
    throw new Error("proposal source requires proposal_path");
  }
  if (facts.source_kind === "proposal" && !fs.existsSync(path.resolve(facts.proposal_path))) {
    throw new Error(`proposal_path does not exist: ${path.resolve(facts.proposal_path)}`);
  }
  if (facts.source_kind === "linear-issue" && !nonEmpty(facts.linear_id)) {
    throw new Error("linear-issue source requires linear_id");
  }
  const artifactCandidate = facts.artifact_repo_root
    ? path.resolve(facts.artifact_repo_root)
    : facts.proposal_path
      ? path.dirname(path.resolve(facts.proposal_path))
      : session.source.repo_root;
  let artifactRepoRoot;
  try {
    artifactRepoRoot = fs.realpathSync(findGitRoot(artifactCandidate));
  } catch {
    throw new Error(`artifact_repo_root is not a Git worktree: ${artifactCandidate}`);
  }
  const next = structuredClone(session);
  next.context = {
    configured: true,
    source_kind: facts.source_kind,
    proposal_path: facts.proposal_path ? path.resolve(facts.proposal_path) : null,
    linear_id: facts.linear_id || null,
    size: facts.size,
    acceptance_criteria: [...facts.acceptance_criteria],
    artifact_repo_root: artifactRepoRoot,
  };
  next.updated_at = options.now || new Date().toISOString();
  assertValidSession(next);
  return next;
}

function nextDecision(session, sessionPath) {
  assertValidSession(session);
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const step = loadPhaseStep("rfc", session.phase, session.source.repo_root, pluginRoot);
  const instructionPath =
    step.source === "default" ? path.relative(pluginRoot, step.filePath) : step.filePath;
  return {
    schema_version: 1,
    run_id: session.run_id,
    session_path: path.resolve(sessionPath),
    status: session.status,
    phase: session.phase,
    attempt: session.phase_attempt,
    instruction_path: instructionPath,
    required_references: step.requires,
    required_evidence: step.requiredEvidence,
    allowed_modes: step.allowedModes,
    result_schema: step.resultSchema,
    artifact_hash: session.artifact ? artifactFingerprint(session.artifact) : null,
    approval_required: session.phase === "approval",
  };
}

function recordResult(session, result, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.phase === "approval") {
    throw new Error("approval phase requires the explicit approval command");
  }
  validateResultIdentity(session, result);
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();

  if (result.status === "passed") {
    validatePassedResult(next, result, options);
  }

  next.attempts.push({
    phase: session.phase,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    artifact_hash: result.artifact ? artifactFingerprint(result.artifact) : null,
    recorded_at: now,
    runtime: structuredClone(result.runtime),
    result_hash: hashResult(result),
  });
  if (result.runtime.session_id) {
    next.execution.runtime = result.runtime.provider;
    next.execution.model = result.runtime.model;
    next.execution.reasoning = result.runtime.reasoning;
    next.execution.runtime_session_id = result.runtime.session_id;
  }

  let reason = `phase ${result.status}`;
  if (result.status === "passed") {
    const currentIndex = PHASES.indexOf(session.phase);
    if (session.phase === "handoff") {
      next.status = "complete";
      reason = "approved RFC handoff completed";
    } else {
      next.phase = PHASES[currentIndex + 1];
      next.phase_attempt = 1;
      reason = "validated passed result";
      if (next.phase === "approval") next.status = "awaiting_approval";
    }
  } else if (result.status === "blocked") {
    next.status = "blocked";
    next.blockers.push({
      ...structuredClone(result.blocker),
      phase: session.phase,
      recorded_at: now,
    });
  } else if (result.status === "failed") {
    if (session.phase_attempt >= 3) {
      next.status = "blocked";
      next.blockers.push({
        code: "retry-budget-exhausted",
        reason: result.summary,
        remediation: "Resolve the repeated cause before resuming",
        phase: session.phase,
        recorded_at: now,
      });
      reason = "retry budget exhausted";
    } else {
      next.phase_attempt += 1;
      reason = "validated retry of the same phase";
    }
  }
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: session.phase,
      nextPhase: next.phase,
      reason,
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function validatePassedResult(session, result, options) {
  if (session.phase === "intake") {
    if (!session.context.configured) throw new Error("intake requires configured RFC context");
    return;
  }
  if (session.phase === "generation") {
    requireEvidence(result, "artifact");
    verifyArtifact(result.artifact, {
      ...options,
      expectedSlug: session.slug,
      expectedRepoRoot: session.context.artifact_repo_root,
      forbidApproved: true,
      requireHead: true,
    });
    session.artifact = structuredClone(result.artifact);
    return;
  }
  if (session.phase === "review") {
    requireEvidence(result, "review");
    verifyArtifact(result.artifact, {
      ...options,
      expectedSlug: session.slug,
      expectedRepoRoot: session.context.artifact_repo_root,
      forbidApproved: true,
      requireHead: true,
    });
    validateReviewerVerdicts(result.reviewer_verdicts, artifactFingerprint(result.artifact));
    session.artifact = structuredClone(result.artifact);
    session.review = {
      status: "passed",
      artifact_hash: artifactFingerprint(result.artifact),
      rounds: session.review.rounds + 1,
      verdicts: structuredClone(result.reviewer_verdicts),
      reviewed_at: options.now || new Date().toISOString(),
    };
    return;
  }
  if (session.phase === "handoff") {
    requireEvidence(result, "handoff");
    requireEvidence(result, "lifecycle");
    if (session.approval.status !== "approved") {
      throw new Error("handoff requires explicit human approval");
    }
    verifyArtifact(result.artifact, {
      ...options,
      expectedSlug: session.slug,
      expectedRepoRoot: session.context.artifact_repo_root,
      requireApproved: true,
      requireHead: true,
    });
    if (result.artifact.sidecar_hash !== session.artifact.sidecar_hash) {
      throw new Error("handoff sidecar hash differs from the approved design");
    }
    if (
      result.artifact.html_hash !== session.artifact.html_hash &&
      !result.evidence.some((item) => item?.kind === "lifecycle" && item.exit_code === 0)
    ) {
      throw new Error("handoff HTML changed without passing lifecycle-only evidence");
    }
    if (result.artifact.html_hash !== session.artifact.html_hash) {
      verifyLifecycleOnlyTransition(session.artifact, result.artifact);
    }
    requireEvidence(result, "approval-audit");
    validateApprovalAudit(session, result.artifact, result.evidence);
    session.artifact = structuredClone(result.artifact);
  }
}

function approveSession(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.execution.headless || options.loopWorker || process.env.PM_LOOP_WORKER === "1") {
    throw new Error("headless RFC sessions cannot record human approval");
  }
  if (
    session.phase === "handoff" &&
    session.status === "approved" &&
    session.approval.status === "approved" &&
    session.approval.approved_by === input?.approvedBy
  ) {
    verifyArtifact(session.artifact, {
      ...options,
      expectedSlug: session.slug,
      expectedRepoRoot: session.context.artifact_repo_root,
      forbidApproved: true,
      requireHead: false,
    });
    if (artifactFingerprint(session.artifact) !== session.approval.artifact_hash) {
      throw new Error("artifact changed after approval; return to review");
    }
    return structuredClone(session);
  }
  if (session.phase !== "approval" || session.status !== "awaiting_approval") {
    throw new Error("RFC is not awaiting approval");
  }
  if (session.review.status !== "passed" || !session.review.artifact_hash || !session.artifact) {
    throw new Error("RFC must pass technical review before approval");
  }
  if (!nonEmpty(input?.approvedBy)) throw new Error("approval requires approvedBy");
  verifyArtifact(session.artifact, {
    ...options,
    expectedSlug: session.slug,
    expectedRepoRoot: session.context.artifact_repo_root,
    forbidApproved: true,
    requireHead: false,
  });
  if (artifactFingerprint(session.artifact) !== session.review.artifact_hash) {
    throw new Error("artifact changed after review; return to review before approval");
  }
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  next.approval = {
    status: "approved",
    approved_by: input.approvedBy,
    approved_at: now,
    artifact_hash: session.review.artifact_hash,
  };
  next.status = "approved";
  next.phase = "handoff";
  next.phase_attempt = 1;
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: "approval",
      nextPhase: "handoff",
      reason: "explicit human approval recorded",
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function reviseSession(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (!new Set(["approval", "handoff"]).has(session.phase) || session.status === "complete") {
    throw new Error(
      "RFC revision is allowed only while awaiting approval or before handoff completes"
    );
  }
  if (!nonEmpty(input?.reason)) throw new Error("RFC revision requires a reason");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  next.phase = "review";
  next.phase_attempt = 1;
  next.status = "active";
  next.review = {
    status: "not_started",
    artifact_hash: null,
    rounds: next.review.rounds,
    verdicts: [],
    reviewed_at: null,
  };
  next.approval = {
    status: "pending",
    approved_by: null,
    approved_at: null,
    artifact_hash: null,
  };
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: session.phase,
      nextPhase: "review",
      reason: `review invalidated: ${input.reason}`,
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function resumeBlocked(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.status !== "blocked") throw new Error("RFC session is not blocked");
  if (!nonEmpty(input?.resolution)) throw new Error("blocked resume requires a resolution");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  const blocker = [...next.blockers].reverse().find((item) => !item.resolved_at);
  if (!blocker) throw new Error("blocked RFC session has no unresolved blocker");
  blocker.resolved_at = now;
  blocker.resolution = input.resolution;
  next.status = "active";
  next.phase_attempt = 1;
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: session.phase,
      nextPhase: session.phase,
      reason: `blocker resolved: ${input.resolution}`,
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function grantAuthority(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (!AUTHORITY_ACTIONS.includes(input?.action)) {
    throw new Error(`unknown RFC authority action: ${String(input?.action)}`);
  }
  if (!nonEmpty(input.reason)) throw new Error("authority grant requires a reason");
  const now = options.now || new Date().toISOString();
  const granted = grantActions({
    authority: session.authority,
    log: session.authority_log,
    actions: [input.action],
    allowedActions: new Set(AUTHORITY_ACTIONS),
    reason: input.reason,
    timestamp: now,
    entryBuilder: (entry) => ({
      action: entry.actions[0],
      granted: true,
      reason: entry.reason,
      recorded_at: entry.granted_at,
    }),
  });
  const next = structuredClone(session);
  next.authority = granted.authority;
  next.authority_log = granted.log;
  next.updated_at = now;
  assertValidSession(next);
  return next;
}

function migrateLegacyMarkdown(legacyPath, options = {}) {
  const absoluteLegacy = path.resolve(legacyPath);
  const text = fs.readFileSync(absoluteLegacy, "utf8");
  const table = (field) => markdownTableValue(text, field) || null;
  const sourceDir = options.sourceDir || findGitRoot(path.dirname(absoluteLegacy));
  const fallbackSlug = path.basename(absoluteLegacy, ".md");
  const session = createSession({
    slug: table("Slug") || fallbackSlug,
    sourceDir,
    now: options.now,
  });
  session.migration = {
    legacy_path: absoluteLegacy,
    legacy_stage: table("Stage") || "unknown",
    migrated_at: options.now || new Date().toISOString(),
    approval_trusted: false,
    reason: "legacy workflow could write approved before explicit human approval",
  };
  session.history.push(
    createTransition({
      priorPhase: "legacy",
      nextPhase: "intake",
      reason: "legacy RFC state requires context, artifact, review, and approval recertification",
      timestamp: session.migration.migrated_at,
    })
  );
  assertValidSession(session);
  return session;
}

function validateResultIdentity(session, result) {
  if (!isObject(result)) throw new Error("phase result must be an object");
  const allowed = new Set([
    "schema_version",
    "run_id",
    "phase",
    "attempt",
    "status",
    "summary",
    "artifact",
    "evidence",
    "reviewer_verdicts",
    "blocker",
    "runtime",
  ]);
  for (const field of Object.keys(result)) {
    if (!allowed.has(field)) throw new Error(`unknown phase result field: ${field}`);
  }
  for (const field of allowed) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`phase result requires ${field}`);
    }
  }
  if (result.schema_version !== 1) throw new Error("phase result schema_version must equal 1");
  if (result.run_id !== session.run_id) throw new Error("phase result run_id mismatch");
  if (result.phase !== session.phase) throw new Error("phase result phase mismatch");
  if (result.attempt !== session.phase_attempt) throw new Error("phase result attempt mismatch");
  if (session.status !== "active" && session.status !== "approved") {
    throw new Error(`session is ${session.status}, not recordable`);
  }
  if (result.status === "noop") throw new Error(`${session.phase} cannot be recorded as noop`);
  if (!RESULT_STATUSES.has(result.status)) throw new Error("phase result status is invalid");
  if (!nonEmpty(result.summary)) throw new Error("phase result summary is required");
  if (!Array.isArray(result.evidence)) throw new Error("phase result evidence must be an array");
  for (const [index, evidence] of result.evidence.entries()) {
    const evidenceIssues = evidenceRecordIssues(evidence, index);
    if (evidenceIssues.some((item) => item.message === "must be an object")) {
      throw new Error("phase result evidence entries must be objects");
    }
    if (evidenceIssues.some((item) => item.message === "unknown field")) {
      throw new Error("phase result evidence has unknown fields");
    }
    if (evidenceIssues.some((item) => item.message === "required field is missing")) {
      throw new Error("phase result evidence requires kind, command, exit_code, and artifact");
    }
    if (
      evidenceIssues.some((item) => item.path.endsWith(".kind") || item.path.endsWith(".exit_code"))
    ) {
      throw new Error("phase result evidence requires kind and integer exit_code");
    }
    const nullableIssue = evidenceIssues.find(
      (item) =>
        item.message === "must be null or a string" &&
        (item.path.endsWith(".command") || item.path.endsWith(".artifact"))
    );
    if (nullableIssue) {
      throw new Error(
        `phase result evidence.${nullableIssue.path.split(".").at(-1)} must be null or string`
      );
    }
  }
  if (!Array.isArray(result.reviewer_verdicts)) {
    throw new Error("phase result reviewer_verdicts must be an array");
  }
  const runtimeIssues = runtimeRecordIssues(result.runtime, "$.runtime", {
    requireSessionId: true,
  });
  if (runtimeIssues.some((item) => item.path === "$.runtime" || item.path.endsWith(".provider"))) {
    throw new Error("phase result runtime is required");
  }
  if (runtimeIssues.some((item) => item.message === "unknown field")) {
    throw new Error("phase result runtime has unknown fields");
  }
  for (const field of ["provider", "model", "reasoning"]) {
    if (runtimeIssues.some((item) => item.path.endsWith(`.${field}`)))
      throw new Error(`phase result runtime.${field} is required`);
  }
  if (
    runtimeIssues.some(
      (item) => item.path.endsWith(".session_id") && item.message === "required field is missing"
    )
  ) {
    throw new Error("phase result runtime requires provider, model, reasoning, and session_id");
  }
  if (runtimeIssues.some((item) => item.path.endsWith(".session_id"))) {
    throw new Error("phase result runtime.session_id must be null or string");
  }
  if (
    result.status === "blocked" &&
    (!isObject(result.blocker) ||
      !nonEmpty(result.blocker.code) ||
      !nonEmpty(result.blocker.reason) ||
      !nonEmpty(result.blocker.remediation))
  ) {
    throw new Error("blocked phase result requires blocker code, reason, and remediation");
  }
  if (result.status === "blocked") {
    const blockerFields = new Set([
      "code",
      "reason",
      "remediation",
      "phase",
      "recorded_at",
      "resolved_at",
      "resolution",
    ]);
    for (const field of Object.keys(result.blocker)) {
      if (!blockerFields.has(field)) throw new Error(`unknown blocker field: ${field}`);
    }
  }
}

function validateReviewerVerdicts(verdicts, expectedArtifactHash) {
  if (!Array.isArray(verdicts)) throw new Error("reviewer verdicts must be an array");
  const byLens = new Map();
  for (const item of verdicts) {
    if (!isObject(item) || !REQUIRED_REVIEW_LENSES.includes(item.lens)) {
      throw new Error(`unknown review lens: ${String(item?.lens)}`);
    }
    if (byLens.has(item.lens)) throw new Error(`duplicate review lens: ${item.lens}`);
    const fields = ["lens", "artifact_hash", "verdict", "blocking", "advisory"];
    if (Object.keys(item).some((field) => !fields.includes(field))) {
      throw new Error(`review lens ${item.lens} has unknown fields`);
    }
    if (!new Set(["pass", "block"]).has(item.verdict)) {
      throw new Error(`invalid verdict for ${item.lens}`);
    }
    if (!Array.isArray(item.blocking) || !Array.isArray(item.advisory)) {
      throw new Error(`review lens ${item.lens} requires blocking and advisory arrays`);
    }
    if (item.artifact_hash !== expectedArtifactHash) {
      throw new Error(`review lens ${item.lens} is stale or bound to a different artifact`);
    }
    byLens.set(item.lens, item);
  }
  for (const lens of REQUIRED_REVIEW_LENSES) {
    if (!byLens.has(lens)) throw new Error(`missing review lens: ${lens}`);
  }
  if ([...byLens.values()].some((item) => item.verdict !== "pass" || item.blocking.length > 0)) {
    throw new Error("review has blocking reviewer findings");
  }
}

function requireEvidence(result, kind) {
  if (!result.evidence.some((item) => item?.kind === kind && item.exit_code === 0)) {
    throw new Error(`${result.phase} requires passing ${kind} evidence`);
  }
}

function verifyArtifact(artifact, options = {}) {
  if (!isObject(artifact)) throw new Error("RFC artifact identity is required");
  for (const field of [
    "html_path",
    "json_path",
    "html_hash",
    "sidecar_hash",
    "repo_root",
    "commit",
  ]) {
    if (!nonEmpty(artifact[field])) throw new Error(`RFC artifact requires ${field}`);
  }
  const repoRoot = fs.realpathSync(artifact.repo_root);
  if (
    options.expectedRepoRoot &&
    repoRoot !== fs.realpathSync(path.resolve(options.expectedRepoRoot))
  ) {
    throw new Error("RFC artifact repository differs from the intake-bound artifact repository");
  }
  const actualRoot = findGitRoot(repoRoot);
  if (!actualRoot || fs.realpathSync(actualRoot) !== repoRoot) {
    throw new Error("RFC artifact repo_root is not a canonical Git worktree");
  }
  const htmlPath = fs.realpathSync(artifact.html_path);
  const jsonPath = fs.realpathSync(artifact.json_path);
  if (!path.isAbsolute(artifact.html_path) || !path.isAbsolute(artifact.json_path)) {
    throw new Error("RFC artifact paths must be absolute");
  }
  const htmlRelative = gitRelativePath(repoRoot, htmlPath);
  const jsonRelative = gitRelativePath(repoRoot, jsonPath);
  if (!htmlRelative.endsWith(".html") || !jsonRelative.endsWith(".json")) {
    throw new Error("RFC artifact paths must be HTML and JSON files inside artifact repo_root");
  }
  const jsonBytes = fs.readFileSync(jsonPath);
  const observed = sha256(jsonBytes);
  const htmlBytes = fs.readFileSync(htmlPath);
  const html = htmlBytes.toString("utf8");
  const observedHtml = sha256(Buffer.from(html));
  if (
    observed !== artifact.sidecar_hash ||
    observedHtml !== artifact.html_hash ||
    extractSidecarHash(html) !== observed
  ) {
    throw new Error("RFC artifact changed or HTML/sidecar binding is stale");
  }
  let sidecar;
  try {
    sidecar = JSON.parse(jsonBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`RFC sidecar is malformed: ${error.message}`);
  }
  const validation = validateRfcSidecar(sidecar, artifact.json_path, {
    expectedSlug: options.expectedSlug,
    htmlPath: artifact.html_path,
    storedHash: extractSidecarHash(html),
    sidecarHash: observed,
  });
  if (!validation.ok) {
    throw new Error(
      `RFC sidecar validation failed: ${validation.issues.map((item) => item.message).join("; ")}`
    );
  }
  validateHtmlStructure(html, sidecar);
  const artifactContract = inspectHtmlArtifact(htmlBytes, { expectedKind: "rfc" });
  if (!artifactContract.ok) {
    throw new Error(
      `RFC HTML artifact contract failed: ${artifactContract.issues
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ")}`
    );
  }
  const lifecycleStatus = extractLifecycleStatus(html);
  if (options.forbidApproved && lifecycleStatus === "approved") {
    throw new Error("RFC artifact claims approval before explicit human approval");
  }
  if (options.requireApproved && lifecycleStatus !== "approved") {
    throw new Error("RFC handoff artifact must expose approved lifecycle status");
  }
  if (options.requireHead !== false) {
    const head = (options.artifactHead || defaultArtifactHead)(artifact);
    if (head !== artifact.commit)
      throw new Error(`RFC artifact commit is stale; current HEAD is ${head}`);
  }
  let committedHtml;
  let committedJson;
  try {
    committedHtml = readGitFile(artifact.commit, htmlRelative, repoRoot, { timeout: 10_000 });
    committedJson = readGitFile(artifact.commit, jsonRelative, repoRoot, { timeout: 10_000 });
  } catch (error) {
    throw new Error(`RFC artifact is not tracked at commit ${artifact.commit}: ${error.message}`);
  }
  if (!committedHtml.equals(htmlBytes) || !committedJson.equals(jsonBytes)) {
    throw new Error("RFC artifact working bytes do not match the declared commit");
  }
  return artifact;
}

function validateHtmlStructure(html, sidecar) {
  for (const anchor of ["brief", "execution-contract", "appendix", "test-strategy"]) {
    if (!new RegExp(`id=["']${anchor}["']`).test(html)) {
      throw new Error(`RFC HTML is missing required anchor: ${anchor}`);
    }
  }
  for (const className of [
    "issue-detail",
    "issue-detail-num",
    "issue-detail-title",
    "issue-detail-size",
    "test-strategy",
    "test-strategy-block",
    "hooks-badge",
  ]) {
    if (!htmlHasClass(html, className)) {
      throw new Error(`RFC HTML is missing required class: ${className}`);
    }
  }
  const issueCount = [...html.matchAll(/class=["']([^"']*)["']/g)].filter((match) =>
    match[1].split(/\s+/).includes("issue-detail")
  ).length;
  if (issueCount !== sidecar.issues.length) {
    throw new Error(
      `RFC HTML/sidecar issue-count mismatch: HTML ${issueCount}, sidecar ${sidecar.issues.length}`
    );
  }
}

function htmlHasClass(html, className) {
  return [...html.matchAll(/class=["']([^"']*)["']/g)].some((match) =>
    match[1].split(/\s+/).includes(className)
  );
}

function verifyLifecycleOnlyTransition(previousArtifact, currentArtifact) {
  if (fs.realpathSync(previousArtifact.repo_root) !== fs.realpathSync(currentArtifact.repo_root)) {
    throw new Error("RFC lifecycle transition changed artifact repository");
  }
  const repoRoot = fs.realpathSync(previousArtifact.repo_root);
  const relative = gitRelativePath(repoRoot, previousArtifact.html_path);
  const before = readGitFile(previousArtifact.commit, relative, repoRoot, {
    timeout: 10_000,
  }).toString("utf8");
  const after = fs.readFileSync(currentArtifact.html_path, "utf8");
  if (canonicalizeLifecycle(before) !== canonicalizeLifecycle(after)) {
    throw new Error("RFC handoff changed substantive HTML, not lifecycle metadata only");
  }
  const workflowLifecycle = lifecycleMarker(after);
  const artifactLifecycle = artifactLifecycleMarker(after);
  if (workflowLifecycle.status !== "approved") {
    throw new Error("RFC handoff lifecycle must be approved");
  }
  if (artifactLifecycle && artifactLifecycle.lifecycle !== "approved") {
    throw new Error("RFC handoff artifact metadata lifecycle must be approved");
  }
}

function canonicalizeLifecycle(html) {
  const marker = lifecycleMarker(html);
  let canonical = `${html.slice(0, marker.valueStart)}<LIFECYCLE>${html.slice(marker.valueEnd)}`;
  const artifactMarker = artifactLifecycleMarker(canonical);
  if (artifactMarker) {
    canonical = `${canonical.slice(0, artifactMarker.valueStart)}<LIFECYCLE>${canonical.slice(artifactMarker.valueEnd)}`;
  }
  const visibleMarker = visibleLifecycleMarker(canonical);
  canonical = `${canonical.slice(0, visibleMarker.valueStart)}<LIFECYCLE>${canonical.slice(visibleMarker.valueEnd)}`;
  return canonical;
}

function visibleLifecycleMarker(html) {
  const pattern =
    /<([a-z][a-z0-9-]*)\b(?=[^>]*\bdata-pm-lifecycle(?:=["'][^"']*["'])?)[^>]*>\s*(draft|reviewed|approved|superseded)\s*<\/\1>/gi;
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error("RFC HTML must contain exactly one visible data-pm-lifecycle marker");
  }
  const match = matches[0];
  const valueOffset = match[0].toLowerCase().indexOf(match[2].toLowerCase());
  return {
    lifecycle: match[2].toLowerCase(),
    valueStart: match.index + valueOffset,
    valueEnd: match.index + valueOffset + match[2].length,
  };
}

function artifactLifecycleMarker(html) {
  const pattern = /<script\b(?=[^>]*\bid=["']pm-artifact["'])[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(pattern)];
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new Error("RFC HTML must contain at most one #pm-artifact metadata marker");
  }
  const match = matches[0];
  const body = match[1];
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("RFC #pm-artifact marker must contain valid JSON");
  }
  if (!isObject(parsed) || !Object.hasOwn(parsed, "lifecycle")) {
    throw new Error("RFC #pm-artifact marker must contain lifecycle");
  }
  const valueMatch = body.match(
    /(["']lifecycle["']\s*:\s*["'])(draft|reviewed|approved|superseded)(["'])/i
  );
  if (!valueMatch || body.match(/["']lifecycle["']\s*:/gi)?.length !== 1) {
    throw new Error("RFC #pm-artifact marker must use one explicit lifecycle field");
  }
  const bodyStart = match.index + match[0].indexOf(body);
  const valueOffset = valueMatch.index + valueMatch[1].length;
  return {
    lifecycle: String(parsed.lifecycle).toLowerCase(),
    valueStart: bodyStart + valueOffset,
    valueEnd: bodyStart + valueOffset + valueMatch[2].length,
  };
}

function lifecycleMarker(html) {
  const pattern = /<script\b(?=[^>]*\bid=["']rfc-lifecycle["'])[^>]*>([\s\S]*?)<\/script>/gi;
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error("RFC HTML must contain exactly one #rfc-lifecycle metadata marker");
  }
  const match = matches[0];
  const body = match[1];
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("RFC #rfc-lifecycle marker must contain valid JSON");
  }
  if (!isObject(parsed) || Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, "status")) {
    throw new Error("RFC #rfc-lifecycle marker must contain only status");
  }
  const status = String(parsed.status).toLowerCase();
  if (!["draft", "awaiting-approval", "approved"].includes(status)) {
    throw new Error("RFC #rfc-lifecycle status is invalid");
  }
  const valueMatch = body.match(
    /(["']status["']\s*:\s*["'])(draft|awaiting-approval|approved)(["'])/i
  );
  if (!valueMatch || body.match(/["']status["']\s*:/gi)?.length !== 1) {
    throw new Error("RFC #rfc-lifecycle marker must use one explicit status field");
  }
  const bodyStart = match.index + match[0].indexOf(body);
  const valueOffset = valueMatch.index + valueMatch[1].length;
  return {
    status,
    valueStart: bodyStart + valueOffset,
    valueEnd: bodyStart + valueOffset + valueMatch[2].length,
  };
}

function approvalTransitionDigest(session, artifact = session.artifact) {
  return sha256(
    Buffer.from(
      stableStringify({
        run_id: session.run_id,
        slug: session.slug,
        review: session.review,
        approval: session.approval,
        artifact: artifact && {
          html_path: artifact.html_path,
          json_path: artifact.json_path,
          html_hash: artifact.html_hash,
          sidecar_hash: artifact.sidecar_hash,
          repo_root: artifact.repo_root,
        },
      })
    )
  );
}

function buildApprovalAudit(session, artifact, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.phase !== "handoff" || session.approval.status !== "approved") {
    throw new Error("approval audit requires an explicitly approved handoff session");
  }
  verifyArtifact(artifact, {
    ...options,
    expectedSlug: session.slug,
    expectedRepoRoot: session.context.artifact_repo_root,
    requireApproved: true,
    requireHead: true,
  });
  if (artifact.sidecar_hash !== session.artifact.sidecar_hash) {
    throw new Error("approval audit sidecar differs from the approved design");
  }
  verifyLifecycleOnlyTransition(session.artifact, artifact);
  return {
    schema_version: 1,
    run_id: session.run_id,
    slug: session.slug,
    status: "approved",
    approved_by: session.approval.approved_by,
    approved_at: session.approval.approved_at,
    html_sha256: artifact.html_hash,
    sidecar_sha256: artifact.sidecar_hash,
    approval_transition_sha256: approvalTransitionDigest(session, artifact),
  };
}

function validateApprovalAudit(session, artifact, evidence) {
  const record = evidence.find((item) => item?.kind === "approval-audit" && item.exit_code === 0);
  const expectedPath = artifact.json_path.replace(/\.json$/i, ".approval.json");
  if (!record || path.resolve(record.artifact || "") !== path.resolve(expectedPath)) {
    throw new Error("handoff approval-audit evidence must point to the sibling approval audit");
  }
  const bytes = fs.readFileSync(expectedPath);
  const observed = JSON.parse(bytes.toString("utf8"));
  const expected = buildApprovalAudit(session, artifact, { requireHead: true });
  if (stableStringify(observed) !== stableStringify(expected)) {
    throw new Error("handoff approval audit does not match the exact approved artifact");
  }
  const relative = gitRelativePath(artifact.repo_root, expectedPath);
  const committed = readGitFile(artifact.commit, relative, artifact.repo_root, { timeout: 10_000 });
  if (!committed.equals(bytes)) {
    throw new Error("handoff approval audit is not tracked at the declared artifact commit");
  }
}

function extractLifecycleStatus(html) {
  return lifecycleMarker(html).status;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactFingerprint(artifact) {
  return sha256(Buffer.from(`${artifact.html_hash}\n${artifact.sidecar_hash}\n`));
}

function defaultArtifactHead(artifact) {
  return runGit(["rev-parse", "HEAD"], artifact.repo_root, { timeout: 10_000 });
}

function validateSession(session) {
  const errors = [];
  if (!isObject(session)) return [{ path: "$", message: "session must be an object" }];
  validateExactFields(
    session,
    [
      "schema_version",
      "run_id",
      "slug",
      "status",
      "phase",
      "phase_attempt",
      "created_at",
      "updated_at",
      "source",
      "context",
      "artifact",
      "review",
      "approval",
      "authority",
      "authority_log",
      "execution",
      "attempts",
      "blockers",
      "history",
      "migration",
    ],
    "$",
    errors
  );
  if (session.schema_version !== 2) errors.push(issue("$.schema_version", "must equal 2"));
  if (!/^rfc_[A-Za-z0-9_-]+$/.test(session.run_id || "")) {
    errors.push(issue("$.run_id", "must be an rfc_ run identifier"));
  }
  if (!nonEmpty(session.slug)) errors.push(issue("$.slug", "required"));
  if (!STATUSES.has(session.status)) errors.push(issue("$.status", "invalid"));
  if (!PHASES.includes(session.phase)) errors.push(issue("$.phase", "invalid"));
  if (!Number.isInteger(session.phase_attempt) || session.phase_attempt < 1) {
    errors.push(issue("$.phase_attempt", "must be positive integer"));
  }
  for (const field of ["created_at", "updated_at"]) {
    if (!isIsoDate(session[field])) {
      errors.push(issue(`$.${field}`, "must be an ISO timestamp"));
    }
  }
  validateClosedObject(
    session.source,
    ["repo_root", "worktree", "branch", "base_commit"],
    "$.source",
    errors,
    (value, objectPath) => {
      for (const field of ["repo_root", "worktree", "branch", "base_commit"]) {
        if (!nonEmpty(value[field])) errors.push(issue(`${objectPath}.${field}`, "required"));
      }
    }
  );
  validateClosedObject(
    session.context,
    [
      "configured",
      "source_kind",
      "proposal_path",
      "linear_id",
      "size",
      "acceptance_criteria",
      "artifact_repo_root",
    ],
    "$.context",
    errors,
    (value, objectPath) => {
      if (typeof value.configured !== "boolean")
        errors.push(issue(`${objectPath}.configured`, "must be boolean"));
      if (![null, "proposal", "linear-issue"].includes(value.source_kind))
        errors.push(issue(`${objectPath}.source_kind`, "invalid"));
      if (![null, "M", "L", "XL"].includes(value.size))
        errors.push(issue(`${objectPath}.size`, "invalid"));
      if (value.artifact_repo_root !== null && !nonEmpty(value.artifact_repo_root)) {
        errors.push(issue(`${objectPath}.artifact_repo_root`, "must be null or a path"));
      }
      if (
        !Array.isArray(value.acceptance_criteria) ||
        value.acceptance_criteria.some((item) => !nonEmpty(item))
      ) {
        errors.push(issue(`${objectPath}.acceptance_criteria`, "must contain non-empty strings"));
      }
    }
  );
  if (session.artifact !== null) validateArtifactShape(session.artifact, "$.artifact", errors);
  validateReviewShape(session.review, errors);
  validateApprovalShape(session.approval, errors);
  if (!isObject(session.authority)) errors.push(issue("$.authority", "invalid"));
  else {
    validateExactFields(session.authority, AUTHORITY_ACTIONS, "$.authority", errors);
    for (const action of AUTHORITY_ACTIONS) {
      if (typeof session.authority[action] !== "boolean") {
        errors.push(issue(`$.authority.${action}`, "must be boolean"));
      }
    }
  }
  for (const field of ["attempts", "blockers", "history", "authority_log"]) {
    if (!Array.isArray(session[field])) errors.push(issue(`$.${field}`, "must be an array"));
  }
  if (Array.isArray(session.attempts)) {
    session.attempts.forEach((value, index) => validateAttempt(value, index, errors));
  }
  if (Array.isArray(session.history)) {
    session.history.forEach((value, index) => validateHistory(value, index, errors));
  }
  if (Array.isArray(session.authority_log)) {
    session.authority_log.forEach((value, index) => validateAuthorityRecord(value, index, errors));
  }
  if (Array.isArray(session.blockers)) {
    session.blockers.forEach((value, index) => validateBlocker(value, index, errors));
  }
  if (session.migration !== null) {
    validateMigration(session.migration, errors);
  }
  validateExecutionShape(session.execution, errors);
  if (session.status === "awaiting_approval" && session.phase !== "approval") {
    errors.push(issue("$.status", "awaiting_approval requires approval phase"));
  }
  if (session.approval.status === "approved" && session.phase === "approval") {
    errors.push(issue("$.approval", "approved session must advance to handoff"));
  }
  if (session.phase === "approval" && session.review?.status !== "passed") {
    errors.push(issue("$.review", "approval phase requires passed review"));
  }
  if (
    ["approved", "complete"].includes(session.status) &&
    session.approval?.status !== "approved"
  ) {
    errors.push(issue("$.approval", `${session.status} session requires explicit approval`));
  }
  if (session.status === "complete" && session.phase !== "handoff") {
    errors.push(issue("$.status", "complete session must remain at handoff"));
  }
  return errors;
}

function validateExactFields(value, fields, objectPath, errors) {
  const allowed = new Set(fields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(issue(`${objectPath}.${field}`, "unknown field"));
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      errors.push(issue(`${objectPath}.${field}`, "required"));
    }
  }
}

function validateClosedObject(value, fields, objectPath, errors, validate) {
  if (!isObject(value)) {
    errors.push(issue(objectPath, "must be an object"));
    return;
  }
  validateExactFields(value, fields, objectPath, errors);
  validate(value, objectPath);
}

function validateRecordObject(value, fields, objectPath, errors) {
  if (!isObject(value)) {
    errors.push(issue(objectPath, "must be an object"));
    return;
  }
  validateExactFields(value, fields, objectPath, errors);
}

function validateAttempt(value, index, errors) {
  const objectPath = `$.attempts[${index}]`;
  const fields = [
    "phase",
    "attempt",
    "status",
    "summary",
    "artifact_hash",
    "recorded_at",
    "runtime",
    "result_hash",
  ];
  validateRecordObject(value, fields, objectPath, errors);
  if (!isObject(value)) return;
  if (!PHASES.filter((phase) => phase !== "approval").includes(value.phase))
    errors.push(issue(`${objectPath}.phase`, "invalid"));
  if (!Number.isInteger(value.attempt) || value.attempt < 1)
    errors.push(issue(`${objectPath}.attempt`, "invalid"));
  if (!RESULT_STATUSES.has(value.status)) errors.push(issue(`${objectPath}.status`, "invalid"));
  if (!nonEmpty(value.summary)) errors.push(issue(`${objectPath}.summary`, "required"));
  if (value.artifact_hash !== null && !/^sha256:[0-9a-f]{64}$/.test(value.artifact_hash || "")) {
    errors.push(issue(`${objectPath}.artifact_hash`, "invalid"));
  }
  if (!isIsoDate(value.recorded_at)) errors.push(issue(`${objectPath}.recorded_at`, "invalid"));
  validateRuntimeRecord(value.runtime, `${objectPath}.runtime`, errors);
  if (!/^sha256:[0-9a-f]{64}$/.test(value.result_hash || ""))
    errors.push(issue(`${objectPath}.result_hash`, "invalid"));
}

function validateRuntimeRecord(value, objectPath, errors) {
  const fields = ["provider", "model", "reasoning", "session_id"];
  validateRecordObject(value, fields, objectPath, errors);
  if (!isObject(value)) return;
  for (const field of ["provider", "model", "reasoning"]) {
    if (!nonEmpty(value[field])) errors.push(issue(`${objectPath}.${field}`, "required"));
  }
  if (value.session_id !== null && !nonEmpty(value.session_id)) {
    errors.push(issue(`${objectPath}.session_id`, "must be null or string"));
  }
}

function validateHistory(value, index, errors) {
  const objectPath = `$.history[${index}]`;
  validateRecordObject(
    value,
    ["prior_phase", "next_phase", "reason", "timestamp"],
    objectPath,
    errors
  );
  if (!isObject(value)) return;
  for (const field of ["prior_phase", "next_phase", "reason"]) {
    if (!nonEmpty(value[field])) errors.push(issue(`${objectPath}.${field}`, "required"));
  }
  if (!isIsoDate(value.timestamp)) errors.push(issue(`${objectPath}.timestamp`, "invalid"));
}

function validateAuthorityRecord(value, index, errors) {
  const objectPath = `$.authority_log[${index}]`;
  validateRecordObject(value, ["action", "granted", "reason", "recorded_at"], objectPath, errors);
  if (!isObject(value)) return;
  if (!AUTHORITY_ACTIONS.includes(value.action))
    errors.push(issue(`${objectPath}.action`, "invalid"));
  if (typeof value.granted !== "boolean") errors.push(issue(`${objectPath}.granted`, "invalid"));
  if (!nonEmpty(value.reason)) errors.push(issue(`${objectPath}.reason`, "required"));
  if (!isIsoDate(value.recorded_at)) errors.push(issue(`${objectPath}.recorded_at`, "invalid"));
}

function validateBlocker(value, index, errors) {
  const objectPath = `$.blockers[${index}]`;
  const fields = [
    "code",
    "reason",
    "remediation",
    "phase",
    "recorded_at",
    "resolved_at",
    "resolution",
  ];
  if (!isObject(value)) {
    errors.push(issue(objectPath, "must be an object"));
    return;
  }
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) errors.push(issue(`${objectPath}.${field}`, "unknown field"));
  }
  for (const field of ["code", "reason", "remediation"]) {
    if (!nonEmpty(value[field])) errors.push(issue(`${objectPath}.${field}`, "required"));
  }
  if (value.phase !== undefined && !PHASES.includes(value.phase))
    errors.push(issue(`${objectPath}.phase`, "invalid"));
  for (const field of ["recorded_at", "resolved_at"]) {
    if (value[field] !== undefined && !isIsoDate(value[field]))
      errors.push(issue(`${objectPath}.${field}`, "invalid"));
  }
  if (value.resolution !== undefined && !nonEmpty(value.resolution))
    errors.push(issue(`${objectPath}.resolution`, "invalid"));
}

function validateMigration(value, errors) {
  const objectPath = "$.migration";
  validateRecordObject(
    value,
    ["legacy_path", "legacy_stage", "migrated_at", "approval_trusted", "reason"],
    objectPath,
    errors
  );
  if (!isObject(value)) return;
  for (const field of ["legacy_path", "legacy_stage", "reason"]) {
    if (!nonEmpty(value[field])) errors.push(issue(`${objectPath}.${field}`, "required"));
  }
  if (!isIsoDate(value.migrated_at)) errors.push(issue(`${objectPath}.migrated_at`, "invalid"));
  if (value.approval_trusted !== false)
    errors.push(issue(`${objectPath}.approval_trusted`, "must be false"));
}

function validateArtifactShape(value, objectPath, errors) {
  validateClosedObject(
    value,
    ["html_path", "json_path", "html_hash", "sidecar_hash", "repo_root", "commit"],
    objectPath,
    errors,
    (artifact, artifactPath) => {
      for (const field of ["html_path", "json_path", "repo_root", "commit"]) {
        if (!nonEmpty(artifact[field])) errors.push(issue(`${artifactPath}.${field}`, "required"));
      }
      for (const field of ["html_hash", "sidecar_hash"]) {
        if (!/^sha256:[0-9a-f]{64}$/.test(artifact[field] || "")) {
          errors.push(issue(`${artifactPath}.${field}`, "must be sha256"));
        }
      }
    }
  );
}

function validateReviewShape(value, errors) {
  validateClosedObject(
    value,
    ["status", "artifact_hash", "rounds", "verdicts", "reviewed_at"],
    "$.review",
    errors,
    (review) => {
      if (!["not_started", "passed"].includes(review.status))
        errors.push(issue("$.review.status", "invalid"));
      if (!Number.isInteger(review.rounds) || review.rounds < 0)
        errors.push(issue("$.review.rounds", "invalid"));
      if (!Array.isArray(review.verdicts)) errors.push(issue("$.review.verdicts", "must be array"));
      if (review.status === "passed" && !/^sha256:[0-9a-f]{64}$/.test(review.artifact_hash || "")) {
        errors.push(issue("$.review.artifact_hash", "passed review requires artifact hash"));
      }
      if (review.reviewed_at !== null && !isIsoDate(review.reviewed_at)) {
        errors.push(issue("$.review.reviewed_at", "invalid"));
      }
      if (review.status === "passed" && !isIsoDate(review.reviewed_at)) {
        errors.push(issue("$.review.reviewed_at", "passed review requires timestamp"));
      }
      if (review.status === "passed" && Array.isArray(review.verdicts)) {
        try {
          validateReviewerVerdicts(review.verdicts, review.artifact_hash);
        } catch (error) {
          errors.push(issue("$.review.verdicts", error.message));
        }
      }
    }
  );
}

function validateApprovalShape(value, errors) {
  validateClosedObject(
    value,
    ["status", "approved_by", "approved_at", "artifact_hash"],
    "$.approval",
    errors,
    (approval) => {
      if (!["pending", "approved"].includes(approval.status))
        errors.push(issue("$.approval.status", "invalid"));
      if (approval.status === "approved") {
        if (!nonEmpty(approval.approved_by))
          errors.push(issue("$.approval.approved_by", "required"));
        if (!isIsoDate(approval.approved_at))
          errors.push(issue("$.approval.approved_at", "invalid"));
        if (!/^sha256:[0-9a-f]{64}$/.test(approval.artifact_hash || ""))
          errors.push(issue("$.approval.artifact_hash", "invalid"));
      }
    }
  );
}

function validateExecutionShape(value, errors) {
  validateClosedObject(
    value,
    ["profile", "runtime", "model", "reasoning", "mode", "runtime_session_id", "headless"],
    "$.execution",
    errors,
    (execution) => {
      for (const field of ["profile", "runtime", "model", "reasoning", "mode"]) {
        if (!nonEmpty(execution[field])) errors.push(issue(`$.execution.${field}`, "required"));
      }
      if (execution.runtime_session_id !== null && !nonEmpty(execution.runtime_session_id))
        errors.push(issue("$.execution.runtime_session_id", "must be null or string"));
      if (typeof execution.headless !== "boolean") {
        errors.push(issue("$.execution.headless", "must be boolean"));
      }
    }
  );
}

function assertValidSession(session) {
  const errors = validateSession(session);
  if (errors.length) {
    throw new Error(
      `invalid RFC session: ${errors.map((item) => `${item.path} ${item.message}`).join("; ")}`
    );
  }
  return session;
}

function normalizeSlug(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("RFC slug is empty after normalization");
  return slug;
}

function gitValue(cwd, args, fallback) {
  try {
    return runGit(args, cwd, { timeout: 10_000 }) || fallback;
  } catch {
    return fallback;
  }
}

function verifySourceIdentity(session) {
  const root = findGitRoot(session.source.worktree);
  if (!root || fs.realpathSync(root) !== fs.realpathSync(session.source.repo_root)) {
    throw new Error("source worktree no longer belongs to the recorded repository");
  }
  const branch = gitValue(session.source.worktree, ["branch", "--show-current"], "detached");
  if (branch !== session.source.branch) {
    throw new Error(
      `source branch changed: expected ${session.source.branch}, observed ${branch}; reinitialize or recertify workspace`
    );
  }
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function isObject(value) {
  return isRecordObject(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  AUTHORITY_ACTIONS,
  PHASES,
  REQUIRED_REVIEW_LENSES,
  applyContext,
  approveSession,
  approvalTransitionDigest,
  assertValidSession,
  buildApprovalAudit,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  resumeBlocked,
  reviseSession,
  validateSession,
  verifyArtifact,
  artifactFingerprint,
};
