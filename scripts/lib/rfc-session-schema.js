"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { extractSidecarHash, validateRfcSidecar } = require("../rfc-sidecar-check.js");

const PHASES = ["intake", "generation", "review", "approval", "handoff"];
const STATUSES = new Set(["active", "awaiting_approval", "approved", "blocked", "complete"]);
const RESULT_STATUSES = new Set(["passed", "failed", "blocked", "noop"]);
const REQUIRED_REVIEW_LENSES = ["architecture-risk", "test-strategy", "maintainability"];
const AUTHORITY_ACTIONS = [
  "linear_create",
  "loop_approval",
  "open_browser",
  "start_implementation",
];
const PHASE_METADATA = {
  intake: {
    instruction_path: "skills/rfc/steps/01-intake.md",
    required_evidence: [],
    allowed_modes: ["inline"],
  },
  generation: {
    instruction_path: "skills/rfc/steps/02-rfc-generation.md",
    required_evidence: ["artifact"],
    allowed_modes: ["inline", "delegated", "headless"],
  },
  review: {
    instruction_path: "skills/rfc/steps/03-rfc-review.md",
    required_evidence: ["review"],
    allowed_modes: ["inline", "delegated", "headless"],
  },
  approval: {
    instruction_path: "skills/rfc/steps/04-approval-handoff.md",
    required_evidence: [],
    allowed_modes: ["inline"],
  },
  handoff: {
    instruction_path: "skills/rfc/steps/04-approval-handoff.md",
    required_evidence: ["handoff"],
    allowed_modes: ["inline", "headless"],
  },
};

function createSession(options) {
  if (!options?.slug || !options?.sourceDir) {
    throw new Error("createSession requires slug and sourceDir");
  }
  const sourceDir = path.resolve(options.sourceDir);
  let repoRoot;
  try {
    repoRoot = fs.realpathSync(runGit(sourceDir, ["rev-parse", "--show-toplevel"]));
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
      runtime_session_id: null,
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
  if (session.phase !== "intake" || session.status !== "active") {
    throw new Error("RFC context may only be configured during active intake");
  }
  if (!isObject(facts)) throw new Error("RFC context facts must be an object");
  if (!new Set(["proposal", "linear-issue"]).has(facts.source_kind)) {
    throw new Error("source_kind must be proposal or linear-issue");
  }
  if (!["M", "L", "XL"].includes(facts.size)) {
    throw new Error("RFC size must be M, L, or XL; route XS/S directly to pm:dev");
  }
  if (!Array.isArray(facts.acceptance_criteria) || facts.acceptance_criteria.length === 0) {
    throw new Error("RFC context requires acceptance_criteria");
  }
  if (facts.source_kind === "proposal" && !nonEmpty(facts.proposal_path)) {
    throw new Error("proposal source requires proposal_path");
  }
  const next = structuredClone(session);
  next.context = {
    configured: true,
    source_kind: facts.source_kind,
    proposal_path: facts.proposal_path ? path.resolve(facts.proposal_path) : null,
    linear_id: facts.linear_id || null,
    size: facts.size,
    acceptance_criteria: [...facts.acceptance_criteria],
  };
  next.updated_at = options.now || new Date().toISOString();
  assertValidSession(next);
  return next;
}

function nextDecision(session, sessionPath) {
  assertValidSession(session);
  const metadata = PHASE_METADATA[session.phase];
  return {
    schema_version: 1,
    run_id: session.run_id,
    session_path: path.resolve(sessionPath),
    status: session.status,
    phase: session.phase,
    attempt: session.phase_attempt,
    instruction_path: metadata.instruction_path,
    required_evidence: metadata.required_evidence,
    allowed_modes: metadata.allowed_modes,
    artifact_hash: session.artifact ? artifactFingerprint(session.artifact) : null,
    approval_required: session.phase === "approval",
  };
}

function recordResult(session, result, options = {}) {
  assertValidSession(session);
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
  if (result.status === "passed" || result.status === "noop") {
    const currentIndex = PHASES.indexOf(session.phase);
    if (session.phase === "handoff") {
      next.status = "complete";
      reason = "approved RFC handoff completed";
    } else {
      next.phase = PHASES[currentIndex + 1];
      next.phase_attempt = 1;
      reason = `validated ${result.status} result`;
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
  next.history.push({
    prior_phase: session.phase,
    next_phase: next.phase,
    reason,
    timestamp: now,
  });
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
    verifyArtifact(result.artifact, { ...options, expectedSlug: session.slug, requireHead: true });
    session.artifact = structuredClone(result.artifact);
    return;
  }
  if (session.phase === "review") {
    requireEvidence(result, "review");
    verifyArtifact(result.artifact, { ...options, expectedSlug: session.slug, requireHead: true });
    validateReviewerVerdicts(result.reviewer_verdicts);
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
    if (session.approval.status !== "approved") {
      throw new Error("handoff requires explicit human approval");
    }
    verifyArtifact(result.artifact, { ...options, expectedSlug: session.slug, requireHead: true });
    if (result.artifact.sidecar_hash !== session.artifact.sidecar_hash) {
      throw new Error("handoff sidecar hash differs from the approved design");
    }
    if (
      result.artifact.html_hash !== session.artifact.html_hash &&
      !result.evidence.some((item) => item?.kind === "lifecycle" && item.exit_code === 0)
    ) {
      throw new Error("handoff HTML changed without passing lifecycle-only evidence");
    }
    session.artifact = structuredClone(result.artifact);
  }
}

function approveSession(session, input, options = {}) {
  assertValidSession(session);
  if (session.phase !== "approval" || session.status !== "awaiting_approval") {
    throw new Error("RFC is not awaiting approval");
  }
  if (session.review.status !== "passed" || !session.review.artifact_hash || !session.artifact) {
    throw new Error("RFC must pass technical review before approval");
  }
  if (!nonEmpty(input?.approvedBy)) throw new Error("approval requires approvedBy");
  verifyArtifact(session.artifact, { ...options, expectedSlug: session.slug, requireHead: false });
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
  next.history.push({
    prior_phase: "approval",
    next_phase: "handoff",
    reason: "explicit human approval recorded",
    timestamp: now,
  });
  assertValidSession(next);
  return next;
}

function grantAuthority(session, input, options = {}) {
  assertValidSession(session);
  if (!AUTHORITY_ACTIONS.includes(input?.action)) {
    throw new Error(`unknown RFC authority action: ${String(input?.action)}`);
  }
  if (!nonEmpty(input.reason)) throw new Error("authority grant requires a reason");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  next.authority[input.action] = true;
  next.authority_log.push({
    action: input.action,
    granted: true,
    reason: input.reason,
    recorded_at: now,
  });
  next.updated_at = now;
  assertValidSession(next);
  return next;
}

function migrateLegacyMarkdown(legacyPath, options = {}) {
  const absoluteLegacy = path.resolve(legacyPath);
  const text = fs.readFileSync(absoluteLegacy, "utf8");
  const table = (field) => {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      text.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*(.*?)\\s*\\|$`, "m"))?.[1]?.trim() || null
    );
  };
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
  session.history.push({
    prior_phase: "legacy",
    next_phase: "intake",
    reason: "legacy RFC state requires context, artifact, review, and approval recertification",
    timestamp: session.migration.migrated_at,
  });
  assertValidSession(session);
  return session;
}

function findGitRoot(startDir) {
  try {
    return runGit(startDir, ["rev-parse", "--show-toplevel"]);
  } catch {
    throw new Error(`legacy RFC session is not inside a Git worktree: ${startDir}`);
  }
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
  if (result.schema_version !== 1) throw new Error("phase result schema_version must equal 1");
  if (result.run_id !== session.run_id) throw new Error("phase result run_id mismatch");
  if (result.phase !== session.phase) throw new Error("phase result phase mismatch");
  if (result.attempt !== session.phase_attempt) throw new Error("phase result attempt mismatch");
  if (session.status !== "active" && session.status !== "approved") {
    throw new Error(`session is ${session.status}, not recordable`);
  }
  if (!RESULT_STATUSES.has(result.status)) throw new Error("phase result status is invalid");
  if (!nonEmpty(result.summary)) throw new Error("phase result summary is required");
  if (!Array.isArray(result.evidence)) throw new Error("phase result evidence must be an array");
  if (!Array.isArray(result.reviewer_verdicts)) {
    throw new Error("phase result reviewer_verdicts must be an array");
  }
  if (!isObject(result.runtime) || !nonEmpty(result.runtime.provider)) {
    throw new Error("phase result runtime is required");
  }
  if (
    result.status === "blocked" &&
    (!isObject(result.blocker) || !nonEmpty(result.blocker.reason))
  ) {
    throw new Error("blocked phase result requires blocker.reason");
  }
  if (result.status === "noop" && session.phase !== "handoff") {
    throw new Error(`${session.phase} cannot be recorded as noop`);
  }
}

function validateReviewerVerdicts(verdicts) {
  if (!Array.isArray(verdicts)) throw new Error("reviewer verdicts must be an array");
  const byLens = new Map();
  for (const item of verdicts) {
    if (!isObject(item) || !REQUIRED_REVIEW_LENSES.includes(item.lens)) {
      throw new Error(`unknown review lens: ${String(item?.lens)}`);
    }
    if (byLens.has(item.lens)) throw new Error(`duplicate review lens: ${item.lens}`);
    if (!new Set(["pass", "block"]).has(item.verdict)) {
      throw new Error(`invalid verdict for ${item.lens}`);
    }
    if (!Array.isArray(item.blocking) || !Array.isArray(item.advisory)) {
      throw new Error(`review lens ${item.lens} requires blocking and advisory arrays`);
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
  const jsonBytes = fs.readFileSync(artifact.json_path);
  const observed = sha256(jsonBytes);
  const html = fs.readFileSync(artifact.html_path, "utf8");
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
  if (options.requireHead !== false) {
    const head = (options.artifactHead || defaultArtifactHead)(artifact);
    if (head !== artifact.commit)
      throw new Error(`RFC artifact commit is stale; current HEAD is ${head}`);
  }
  return artifact;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function artifactFingerprint(artifact) {
  return sha256(Buffer.from(`${artifact.html_hash}\n${artifact.sidecar_hash}\n`));
}

function defaultArtifactHead(artifact) {
  return runGit(artifact.repo_root, ["rev-parse", "HEAD"]);
}

function validateSession(session) {
  const errors = [];
  if (!isObject(session)) return [{ path: "$", message: "session must be an object" }];
  if (session.schema_version !== 2) errors.push(issue("$.schema_version", "must equal 2"));
  if (!nonEmpty(session.run_id)) errors.push(issue("$.run_id", "required"));
  if (!nonEmpty(session.slug)) errors.push(issue("$.slug", "required"));
  if (!STATUSES.has(session.status)) errors.push(issue("$.status", "invalid"));
  if (!PHASES.includes(session.phase)) errors.push(issue("$.phase", "invalid"));
  if (!Number.isInteger(session.phase_attempt) || session.phase_attempt < 1) {
    errors.push(issue("$.phase_attempt", "must be positive integer"));
  }
  if (!isObject(session.source) || !nonEmpty(session.source.repo_root)) {
    errors.push(issue("$.source", "repo_root required"));
  }
  if (!isObject(session.context) || !Array.isArray(session.context.acceptance_criteria)) {
    errors.push(issue("$.context", "invalid"));
  }
  if (!isObject(session.review) || !new Set(["not_started", "passed"]).has(session.review.status)) {
    errors.push(issue("$.review.status", "invalid"));
  }
  if (
    !isObject(session.approval) ||
    !new Set(["pending", "approved"]).has(session.approval.status)
  ) {
    errors.push(issue("$.approval.status", "invalid"));
  }
  if (!isObject(session.authority)) errors.push(issue("$.authority", "invalid"));
  else {
    for (const action of AUTHORITY_ACTIONS) {
      if (typeof session.authority[action] !== "boolean") {
        errors.push(issue(`$.authority.${action}`, "must be boolean"));
      }
    }
  }
  for (const field of ["attempts", "blockers", "history", "authority_log"]) {
    if (!Array.isArray(session[field])) errors.push(issue(`$.${field}`, "must be an array"));
  }
  if (session.status === "awaiting_approval" && session.phase !== "approval") {
    errors.push(issue("$.status", "awaiting_approval requires approval phase"));
  }
  if (session.approval.status === "approved" && session.phase === "approval") {
    errors.push(issue("$.approval", "approved session must advance to handoff"));
  }
  return errors;
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

function runGit(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitValue(cwd, args, fallback) {
  try {
    return runGit(cwd, args) || fallback;
  } catch {
    return fallback;
  }
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashResult(result) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(result)).digest("hex")}`;
}

module.exports = {
  AUTHORITY_ACTIONS,
  PHASES,
  PHASE_METADATA,
  REQUIRED_REVIEW_LENSES,
  applyContext,
  approveSession,
  assertValidSession,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  validateSession,
  verifyArtifact,
  artifactFingerprint,
};
