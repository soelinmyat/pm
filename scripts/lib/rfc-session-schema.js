"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { extractSidecarHash, validateRfcSidecar } = require("../rfc-sidecar-check.js");
const { loadPhaseStep } = require("../step-loader.js");
const { findGitRoot, gitRelativePath, readGitFile, runGit } = require("../loop-git.js");
const { markdownTableValue } = require("./session-scan.js");

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
    verifyArtifact(result.artifact, {
      ...options,
      expectedSlug: session.slug,
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
    session.artifact = structuredClone(result.artifact);
  }
}

function approveSession(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (
    session.phase === "handoff" &&
    session.status === "approved" &&
    session.approval.status === "approved" &&
    session.approval.approved_by === input?.approvedBy
  ) {
    verifyArtifact(session.artifact, {
      ...options,
      expectedSlug: session.slug,
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
  next.history.push({
    prior_phase: "approval",
    next_phase: "handoff",
    reason: "explicit human approval recorded",
    timestamp: now,
  });
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
  next.history.push({
    prior_phase: session.phase,
    next_phase: "review",
    reason: `review invalidated: ${input.reason}`,
    timestamp: now,
  });
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
  next.history.push({
    prior_phase: session.phase,
    next_phase: session.phase,
    reason: `blocker resolved: ${input.resolution}`,
    timestamp: now,
  });
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
  session.history.push({
    prior_phase: "legacy",
    next_phase: "intake",
    reason: "legacy RFC state requires context, artifact, review, and approval recertification",
    timestamp: session.migration.migrated_at,
  });
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
  for (const evidence of result.evidence) {
    if (!isObject(evidence)) throw new Error("phase result evidence entries must be objects");
    const fields = ["kind", "command", "exit_code", "artifact"];
    if (Object.keys(evidence).some((field) => !fields.includes(field))) {
      throw new Error("phase result evidence has unknown fields");
    }
    if (!nonEmpty(evidence.kind) || !Number.isInteger(evidence.exit_code)) {
      throw new Error("phase result evidence requires kind and integer exit_code");
    }
  }
  if (!Array.isArray(result.reviewer_verdicts)) {
    throw new Error("phase result reviewer_verdicts must be an array");
  }
  if (!isObject(result.runtime) || !nonEmpty(result.runtime.provider)) {
    throw new Error("phase result runtime is required");
  }
  const runtimeFields = ["provider", "model", "reasoning", "session_id"];
  if (Object.keys(result.runtime).some((field) => !runtimeFields.includes(field))) {
    throw new Error("phase result runtime has unknown fields");
  }
  for (const field of ["provider", "model", "reasoning"]) {
    if (!nonEmpty(result.runtime[field]))
      throw new Error(`phase result runtime.${field} is required`);
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
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  if (beforeLines.length !== afterLines.length) {
    throw new Error("RFC handoff changed HTML structure, not lifecycle metadata only");
  }
  for (let index = 0; index < beforeLines.length; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (!isLifecycleStatusLine(beforeLines[index]) || !isLifecycleStatusLine(afterLines[index])) {
      throw new Error(`RFC handoff changed substantive HTML at line ${index + 1}`);
    }
  }
}

function isLifecycleStatusLine(line) {
  return (
    /["']status["']\s*:/.test(line) ||
    /^\s*status\s*:/.test(line) ||
    /data-status=/.test(line) ||
    /class=["'][^"']*pill[^"']*["'][^>]*>.*\b(?:draft|approved)\b/i.test(line)
  );
}

function extractLifecycleStatus(html) {
  const jsonStatus = html.match(/["']status["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (jsonStatus) return jsonStatus.trim().toLowerCase();
  const frontmatterStatus = html.match(/^\s*status\s*:\s*([^\s<]+)/im)?.[1];
  if (frontmatterStatus) return frontmatterStatus.trim().toLowerCase();
  if (/class=["'][^"']*pill[^"']*["'][^>]*>.*\bapproved\b/i.test(html)) return "approved";
  if (/class=["'][^"']*pill[^"']*["'][^>]*>.*\bdraft\b/i.test(html)) return "draft";
  return null;
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
  if (!nonEmpty(session.run_id)) errors.push(issue("$.run_id", "required"));
  if (!nonEmpty(session.slug)) errors.push(issue("$.slug", "required"));
  if (!STATUSES.has(session.status)) errors.push(issue("$.status", "invalid"));
  if (!PHASES.includes(session.phase)) errors.push(issue("$.phase", "invalid"));
  if (!Number.isInteger(session.phase_attempt) || session.phase_attempt < 1) {
    errors.push(issue("$.phase_attempt", "must be positive integer"));
  }
  for (const field of ["created_at", "updated_at"]) {
    if (!nonEmpty(session[field]) || Number.isNaN(Date.parse(session[field]))) {
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
    ["configured", "source_kind", "proposal_path", "linear_id", "size", "acceptance_criteria"],
    "$.context",
    errors,
    (value, objectPath) => {
      if (typeof value.configured !== "boolean")
        errors.push(issue(`${objectPath}.configured`, "must be boolean"));
      if (![null, "proposal", "linear-issue"].includes(value.source_kind))
        errors.push(issue(`${objectPath}.source_kind`, "invalid"));
      if (![null, "M", "L", "XL"].includes(value.size))
        errors.push(issue(`${objectPath}.size`, "invalid"));
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
    session.attempts.forEach((value, index) =>
      validateRecordObject(
        value,
        [
          "phase",
          "attempt",
          "status",
          "summary",
          "artifact_hash",
          "recorded_at",
          "runtime",
          "result_hash",
        ],
        `$.attempts[${index}]`,
        errors
      )
    );
  }
  if (Array.isArray(session.history)) {
    session.history.forEach((value, index) =>
      validateRecordObject(
        value,
        ["prior_phase", "next_phase", "reason", "timestamp"],
        `$.history[${index}]`,
        errors
      )
    );
  }
  if (Array.isArray(session.authority_log)) {
    session.authority_log.forEach((value, index) =>
      validateRecordObject(
        value,
        ["action", "granted", "reason", "recorded_at"],
        `$.authority_log[${index}]`,
        errors
      )
    );
  }
  if (Array.isArray(session.blockers)) {
    session.blockers.forEach((value, index) => {
      if (!isObject(value) || !nonEmpty(value.code) || !nonEmpty(value.reason)) {
        errors.push(issue(`$.blockers[${index}]`, "requires code and reason"));
      }
    });
  }
  if (session.migration !== null) {
    validateRecordObject(
      session.migration,
      ["legacy_path", "legacy_stage", "migrated_at", "approval_trusted", "reason"],
      "$.migration",
      errors
    );
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
        if (!nonEmpty(approval.approved_at) || Number.isNaN(Date.parse(approval.approved_at)))
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
    ["profile", "runtime", "model", "reasoning", "mode", "runtime_session_id"],
    "$.execution",
    errors,
    (execution) => {
      for (const field of ["profile", "runtime", "model", "reasoning", "mode"]) {
        if (!nonEmpty(execution[field])) errors.push(issue(`$.execution.${field}`, "required"));
      }
      if (execution.runtime_session_id !== null && !nonEmpty(execution.runtime_session_id))
        errors.push(issue("$.execution.runtime_session_id", "must be null or string"));
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
  resumeBlocked,
  reviseSession,
  validateSession,
  verifyArtifact,
  artifactFingerprint,
};
