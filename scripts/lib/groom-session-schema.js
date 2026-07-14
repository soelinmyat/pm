"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { findGitRoot, runGit } = require("../loop-git.js");
const { isRfc3339DateTime: isIsoDate } = require("./iso-time.js");
const { markdownTableValue } = require("./session-scan.js");
const { loadPhaseStep } = require("../step-loader.js");
const { grantActions } = require("./workflow-runtime/authority.js");
const { createTransition, hashResult, isObject } = require("./workflow-runtime/records.js");
const {
  evidenceRecordIssues,
  runtimeRecordIssues,
} = require("./workflow-runtime/result-envelope.js");
const {
  buildApproval,
  proposalApprovalSnapshotHash,
  proposalBytesHash,
  proposalContentHash,
} = require("./proposal-schema.js");

const PHASES = [
  "intake",
  "research",
  "scope",
  "synthesis",
  "design",
  "draft",
  "review",
  "presentation",
  "approval",
  "handoff",
  "retro",
];
const ROUTES = Object.freeze({
  quick: ["intake", "research", "scope", "draft", "approval", "handoff", "retro"],
  standard: PHASES.filter((phase) => phase !== "presentation"),
  full: [...PHASES],
  agent: [...PHASES],
});
const STATUSES = new Set(["active", "awaiting_approval", "approved", "blocked", "complete"]);
const RESULT_STATUSES = new Set(["passed", "failed", "blocked"]);
const AUTHORITY_ACTIONS = ["tracker_create", "open_browser", "start_rfc", "external_research"];
const REVIEW_QUESTIONS = Object.freeze({
  standard: [
    {
      id: "problem-evidence",
      text: "Is the problem and evidence chain sufficient for this decision?",
    },
    { id: "scope", text: "Is the scope coherent, minimal, and explicit about non-goals?" },
    { id: "acceptance", text: "Are acceptance criteria observable and implementation-neutral?" },
    { id: "experience", text: "Are user flows, failure states, and design requirements complete?" },
    {
      id: "feasibility",
      text: "Is feasibility credible without smuggling in an engineering design?",
    },
  ],
  full: [
    {
      id: "problem-evidence",
      text: "Is the problem and evidence chain sufficient for this decision?",
    },
    { id: "scope", text: "Is the scope coherent, minimal, and explicit about non-goals?" },
    { id: "acceptance", text: "Are acceptance criteria observable and implementation-neutral?" },
    { id: "experience", text: "Are user flows, failure states, and design requirements complete?" },
    {
      id: "feasibility",
      text: "Is feasibility credible without smuggling in an engineering design?",
    },
    {
      id: "reversal",
      text: "What assumption, counterexample, or competitive fact could reverse the recommendation?",
    },
  ],
});

function createSession(options) {
  if (!options?.slug || !options?.sourceDir)
    throw new Error("createSession requires slug and sourceDir");
  const tier = options.tier || "standard";
  if (!ROUTES[tier]) throw new Error(`unknown Groom tier: ${tier}`);
  const sourceDir = path.resolve(options.sourceDir);
  let repoRoot;
  try {
    repoRoot = fs.realpathSync(findGitRoot(sourceDir));
  } catch {
    throw new Error(`source directory is not a Git worktree: ${sourceDir}`);
  }
  const now = options.now || new Date().toISOString();
  const reviewTier = tier === "agent" ? "full" : tier;
  const session = {
    schema_version: 1,
    run_id: options.runId || `groom_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
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
      tier,
      title: null,
      outcome: null,
      source_kind: null,
      source_path: null,
      evidence_refs: [],
    },
    routing: {
      required_phases: [...ROUTES[tier]],
      review_questions: structuredClone(REVIEW_QUESTIONS[reviewTier] || []),
      kb_gate: tier === "agent" ? "strict" : "normal",
    },
    proposal: null,
    review: {
      status: "not_started",
      proposal_hash: null,
      rounds: 0,
      outcomes: [],
      reviewed_at: null,
    },
    approval: {
      status: "pending",
      approved_by: null,
      approved_at: null,
      proposal_hash: null,
      proposal_revision: null,
      proposal_snapshot_sha256: null,
      decision_id: null,
      decision_sha256: null,
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
  if (session.phase !== "intake" || session.status !== "active")
    throw new Error("Groom context may only be configured during active intake");
  if (!isObject(facts)) throw new Error("Groom context facts must be an object");
  const allowed = new Set([
    "tier",
    "title",
    "outcome",
    "source_kind",
    "source_path",
    "evidence_refs",
  ]);
  for (const field of Object.keys(facts))
    if (!allowed.has(field)) throw new Error(`unknown Groom context field: ${field}`);
  const tier = facts.tier || session.context.tier;
  if (!ROUTES[tier]) throw new Error(`unknown Groom tier: ${tier}`);
  if (!nonEmpty(facts.title) || !nonEmpty(facts.outcome))
    throw new Error("Groom context requires title and outcome");
  if (!["idea", "backlog", "legacy"].includes(facts.source_kind))
    throw new Error("source_kind must be idea, backlog, or legacy");
  if (!Array.isArray(facts.evidence_refs) || facts.evidence_refs.some((value) => !nonEmpty(value)))
    throw new Error("evidence_refs must contain strings");
  if (["backlog", "legacy"].includes(facts.source_kind) && !nonEmpty(facts.source_path))
    throw new Error(`${facts.source_kind} source requires source_path`);
  if (facts.source_path) {
    const sourcePath = path.resolve(facts.source_path);
    if (!fs.existsSync(sourcePath)) throw new Error(`source_path does not exist: ${sourcePath}`);
    assertWithin(session.source.repo_root, sourcePath, "source_path");
  }
  const next = structuredClone(session);
  next.context = {
    configured: true,
    tier,
    title: facts.title.trim(),
    outcome: facts.outcome.trim(),
    source_kind: facts.source_kind,
    source_path: facts.source_path ? path.resolve(facts.source_path) : null,
    evidence_refs: [...facts.evidence_refs],
  };
  const reviewTier = tier === "agent" ? "full" : tier;
  next.routing = {
    required_phases: [...ROUTES[tier]],
    review_questions: structuredClone(REVIEW_QUESTIONS[reviewTier] || []),
    kb_gate: tier === "agent" ? "strict" : "normal",
  };
  next.updated_at = options.now || new Date().toISOString();
  assertValidSession(next);
  return next;
}

function nextDecision(session, sessionPath) {
  assertValidSession(session);
  const pluginRoot = path.resolve(__dirname, "..", "..");
  const step = loadPhaseStep("groom", session.phase, session.source.repo_root, pluginRoot);
  return {
    schema_version: 1,
    run_id: session.run_id,
    session_path: path.resolve(sessionPath),
    status: session.status,
    phase: session.phase,
    attempt: session.phase_attempt,
    tier: session.context.tier,
    instruction_path:
      step.source === "default" ? path.relative(pluginRoot, step.filePath) : step.filePath,
    required_references: step.requires,
    required_evidence: step.requiredEvidence,
    allowed_modes: step.allowedModes,
    result_schema: step.resultSchema,
    proposal: session.proposal,
    questions: session.phase === "review" ? structuredClone(session.routing.review_questions) : [],
    approval_required: session.phase === "approval",
  };
}

function recordResult(session, result, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.phase === "approval")
    throw new Error("approval phase requires the explicit approval command");
  validateResultIdentity(session, result);
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  if (result.status === "passed") validatePassedResult(next, result, now);
  next.attempts.push({
    phase: session.phase,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    proposal_hash: result.proposal?.content_hash || null,
    recorded_at: now,
    runtime: structuredClone(result.runtime),
    capability_downgrades: structuredClone(result.capability_downgrades),
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
    const route = next.routing.required_phases;
    const index = route.indexOf(session.phase);
    if (session.phase === "retro") {
      next.status = "complete";
      reason = "Groom retro completed";
    } else {
      next.phase = route[index + 1];
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
  } else if (session.phase_attempt >= 3) {
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
  next.updated_at = now;
  next.history.push(
    createTransition({ priorPhase: session.phase, nextPhase: next.phase, reason, timestamp: now })
  );
  assertValidSession(next);
  return next;
}

function validatePassedResult(session, result, now) {
  if (session.phase === "intake" && !session.context.configured)
    throw new Error("intake requires configured Groom context");
  if (result.proposal) {
    verifyProposal(result.proposal, session.source.repo_root);
    if (session.proposal && result.proposal.revision < session.proposal.revision)
      throw new Error("proposal revision cannot decrease");
    if (
      session.proposal &&
      result.proposal.content_hash !== session.proposal.content_hash &&
      result.proposal.revision <= session.proposal.revision
    )
      throw new Error("substantive proposal changes require a higher revision");
    session.proposal = structuredClone(result.proposal);
  }
  if (["draft", "review", "presentation", "handoff"].includes(session.phase) && !session.proposal)
    throw new Error(`${session.phase} requires proposal identity`);
  for (const kind of requiredEvidence(session.phase)) requireEvidence(result, kind);
  if (session.phase === "review") {
    validateQuestionOutcomes(session, result.question_outcomes);
    session.review = {
      status: "passed",
      proposal_hash: session.proposal.content_hash,
      rounds: session.review.rounds + 1,
      outcomes: structuredClone(result.question_outcomes),
      reviewed_at: now,
    };
  }
  if (session.phase === "handoff") {
    if (session.approval.status !== "approved")
      throw new Error("handoff requires explicit human approval");
    verifyProposal(session.proposal, session.source.repo_root);
    if (
      session.proposal.content_hash !== session.approval.proposal_hash ||
      session.proposal.revision !== session.approval.proposal_revision
    )
      throw new Error("proposal changed after approval; revise and approve again");
  }
}

function approveSession(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.execution.headless || options.loopWorker || process.env.PM_LOOP_WORKER === "1")
    throw new Error("headless Groom sessions cannot record human approval");
  if (
    session.phase === "handoff" &&
    session.approval.status === "approved" &&
    session.approval.approved_by === input?.approvedBy
  ) {
    let current;
    try {
      current = proposalIdentityFromPath(session.proposal.json_path, session.source.repo_root);
    } catch {
      throw new Error("proposal changed after approval; revise and approve again");
    }
    if (
      current.content_hash !== session.approval.proposal_hash ||
      current.revision !== session.approval.proposal_revision ||
      current.approval_snapshot_sha256 !== session.approval.proposal_snapshot_sha256
    )
      throw new Error("proposal changed after approval; revise and approve again");
    return structuredClone(session);
  }
  if (session.phase !== "approval" || session.status !== "awaiting_approval")
    throw new Error("Groom proposal is not awaiting approval");
  if (!nonEmpty(input?.approvedBy)) throw new Error("approval requires approvedBy");
  if (!session.proposal) throw new Error("approval requires a proposal");
  verifyProposal(session.proposal, session.source.repo_root);
  if (
    session.routing.required_phases.includes("review") &&
    (session.review.status !== "passed" ||
      session.review.proposal_hash !== session.proposal.content_hash)
  )
    throw new Error("proposal must pass current question review before approval");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  const current = proposalIdentityFromPath(session.proposal.json_path, session.source.repo_root);
  const decisionId = `groom-approval:${session.run_id}`;
  const decisionSha256 = hashResult({
    schema_version: 1,
    decision_id: decisionId,
    proposal_hash: session.proposal.content_hash,
    proposal_revision: session.proposal.revision,
    proposal_snapshot_sha256: current.approval_snapshot_sha256,
    approved_by: input.approvedBy.trim(),
    approved_at: now,
  });
  next.approval = {
    status: "approved",
    approved_by: input.approvedBy.trim(),
    approved_at: now,
    proposal_hash: session.proposal.content_hash,
    proposal_revision: session.proposal.revision,
    proposal_snapshot_sha256: current.approval_snapshot_sha256,
    decision_id: decisionId,
    decision_sha256: decisionSha256,
  };
  next.status = "approved";
  next.phase = "handoff";
  next.phase_attempt = 1;
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: "approval",
      nextPhase: "handoff",
      reason: "explicit human product approval recorded",
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function reviseSession(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (!["approval", "handoff"].includes(session.phase) || session.status === "complete")
    throw new Error(
      "Groom revision is allowed only while awaiting approval or before handoff completes"
    );
  if (!nonEmpty(input?.reason)) throw new Error("Groom revision requires a reason");
  const proposal = input.proposal || session.proposal;
  if (!proposal) throw new Error("Groom revision requires current proposal identity");
  verifyProposal(proposal, session.source.repo_root);
  if (
    session.proposal &&
    proposal.content_hash !== session.proposal.content_hash &&
    proposal.revision <= session.proposal.revision
  )
    throw new Error("substantive Groom revision must increase proposal revision");
  const targetPhase = input.phase || "scope";
  const targetIndex = session.routing.required_phases.indexOf(targetPhase);
  const approvalIndex = session.routing.required_phases.indexOf("approval");
  if (targetIndex < 0 || targetIndex >= approvalIndex)
    throw new Error("revision phase must be a routed phase before approval");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  next.proposal = structuredClone(proposal);
  next.phase = targetPhase;
  next.phase_attempt = 1;
  next.status = "active";
  next.review = {
    status: "not_started",
    proposal_hash: null,
    rounds: next.review.rounds,
    outcomes: [],
    reviewed_at: null,
  };
  next.approval = {
    status: "pending",
    approved_by: null,
    approved_at: null,
    proposal_hash: null,
    proposal_revision: null,
    proposal_snapshot_sha256: null,
    decision_id: null,
    decision_sha256: null,
  };
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: session.phase,
      nextPhase: targetPhase,
      reason: `requested revision: ${input.reason.trim()}`,
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function resumeBlocked(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.status !== "blocked") throw new Error("Groom session is not blocked");
  if (!nonEmpty(input?.resolution)) throw new Error("unblock requires a resolution");
  const next = structuredClone(session);
  const now = options.now || new Date().toISOString();
  const blocker = next.blockers.at(-1);
  blocker.resolved_at = now;
  blocker.resolution = input.resolution.trim();
  next.status = "active";
  next.phase_attempt += 1;
  next.updated_at = now;
  next.history.push(
    createTransition({
      priorPhase: session.phase,
      nextPhase: session.phase,
      reason: "blocker resolved",
      timestamp: now,
    })
  );
  assertValidSession(next);
  return next;
}

function grantAuthority(session, input, options = {}) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (!AUTHORITY_ACTIONS.includes(input?.action))
    throw new Error(`unknown Groom authority action: ${input?.action}`);
  const now = options.now || new Date().toISOString();
  const granted = grantActions({
    actions: [input.action],
    reason: input.reason,
    allowedActions: new Set(AUTHORITY_ACTIONS),
    authority: session.authority,
    log: session.authority_log,
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

function buildApprovalAudit(session) {
  assertValidSession(session);
  verifySourceIdentity(session);
  if (session.approval.status !== "approved" || !session.proposal)
    throw new Error("approval audit requires an explicitly approved proposal");
  const proposal = proposalIdentityFromPath(session.proposal.json_path, session.source.repo_root);
  if (
    proposal.content_hash !== session.approval.proposal_hash ||
    proposal.revision !== session.approval.proposal_revision ||
    proposal.approval_snapshot_sha256 !== session.approval.proposal_snapshot_sha256
  )
    throw new Error("proposal changed after approval");
  if (proposal.lifecycle !== "approved")
    throw new Error("approval audit requires the canonical proposal lifecycle to be approved");
  const bytes = fs.readFileSync(proposal.json_path);
  return buildApproval(JSON.parse(bytes), bytes, {
    approvedBy: session.approval.approved_by,
    approvedAt: session.approval.approved_at,
    decisionId: session.approval.decision_id,
    decisionSha256: session.approval.decision_sha256,
  });
}

function proposalIdentityFromPath(jsonPath, repoRoot) {
  const bytes = fs.readFileSync(jsonPath);
  const parsed = JSON.parse(bytes);
  const identity = {
    json_path: path.resolve(jsonPath),
    proposal_sha256: proposalBytesHash(bytes),
    content_hash: proposalContentHash(parsed),
    revision: parsed.revision,
    lifecycle: parsed.lifecycle,
  };
  verifyProposal(identity, repoRoot);
  return { ...identity, approval_snapshot_sha256: proposalApprovalSnapshotHash(parsed) };
}

function migrateLegacyMarkdown(legacyPath, options = {}) {
  const absolute = path.resolve(legacyPath);
  const text = fs.readFileSync(absolute, "utf8");
  const value = (field) => markdownTableValue(text, field) || null;
  const tier = ROUTES[value("Tier")] ? value("Tier") : "standard";
  const session = createSession({
    slug: value("Slug") || path.basename(absolute, ".md"),
    sourceDir: options.sourceDir || findGitRoot(path.dirname(absolute)),
    tier,
    now: options.now,
  });
  session.migration = {
    legacy_path: absolute,
    legacy_stage: value("Stage") || "unknown",
    migrated_at: options.now || new Date().toISOString(),
    approval_trusted: false,
    reason: "legacy Groom state lacks hash-bound explicit approval and must be recertified",
  };
  session.history.push(
    createTransition({
      priorPhase: "legacy",
      nextPhase: "intake",
      reason: "legacy Groom state requires context and approval recertification",
      timestamp: session.migration.migrated_at,
    })
  );
  assertValidSession(session);
  return session;
}

function validateResultIdentity(session, result) {
  if (!isObject(result)) throw new Error("phase result must be an object");
  const fields = [
    "schema_version",
    "run_id",
    "phase",
    "attempt",
    "status",
    "summary",
    "proposal",
    "evidence",
    "question_outcomes",
    "capability_downgrades",
    "blocker",
    "runtime",
  ];
  exactFields(result, fields, "phase result");
  if (
    result.schema_version !== 1 ||
    result.run_id !== session.run_id ||
    result.phase !== session.phase ||
    result.attempt !== session.phase_attempt
  )
    throw new Error("phase result identity mismatch");
  if (!["active", "approved"].includes(session.status))
    throw new Error(`session is ${session.status}, not recordable`);
  if (!RESULT_STATUSES.has(result.status) || !nonEmpty(result.summary))
    throw new Error("phase result status and summary are required");
  if (
    !Array.isArray(result.evidence) ||
    !Array.isArray(result.question_outcomes) ||
    !Array.isArray(result.capability_downgrades)
  )
    throw new Error("phase result arrays are required");
  result.evidence.forEach((entry, index) => {
    if (evidenceRecordIssues(entry, index).length)
      throw new Error("phase result evidence is invalid");
  });
  const runtimeIssues = runtimeRecordIssues(result.runtime, "$.runtime", {
    requireSessionId: true,
  });
  if (runtimeIssues.length) throw new Error("phase result runtime is invalid");
  result.capability_downgrades.forEach((item) => {
    exactFields(item, ["capability", "reason", "fallback"], "capability downgrade");
    if (![item.capability, item.reason, item.fallback].every(nonEmpty))
      throw new Error("capability downgrade fields are required");
  });
  if (result.status === "blocked") {
    if (
      !isObject(result.blocker) ||
      ![result.blocker.code, result.blocker.reason, result.blocker.remediation].every(nonEmpty)
    )
      throw new Error("blocked phase result requires blocker code, reason, and remediation");
  }
}

function validateQuestionOutcomes(session, outcomes) {
  const byId = new Map();
  for (const item of outcomes) {
    exactFields(
      item,
      ["question_id", "proposal_hash", "verdict", "blocking", "advisory"],
      "question outcome"
    );
    if (!session.routing.review_questions.some((question) => question.id === item.question_id))
      throw new Error(`unknown review question: ${item.question_id}`);
    if (byId.has(item.question_id))
      throw new Error(`duplicate review question: ${item.question_id}`);
    if (item.proposal_hash !== session.proposal.content_hash)
      throw new Error(`review question ${item.question_id} is stale`);
    if (
      !["pass", "block"].includes(item.verdict) ||
      !Array.isArray(item.blocking) ||
      !Array.isArray(item.advisory)
    )
      throw new Error(`invalid outcome for ${item.question_id}`);
    byId.set(item.question_id, item);
  }
  for (const question of session.routing.review_questions)
    if (!byId.has(question.id)) throw new Error(`missing review question: ${question.id}`);
  if ([...byId.values()].some((item) => item.verdict !== "pass" || item.blocking.length))
    throw new Error("question review has blocking findings");
}

function verifyProposal(proposal, repoRoot) {
  if (!isObject(proposal)) throw new Error("proposal identity is required");
  exactFields(
    proposal,
    ["json_path", "proposal_sha256", "content_hash", "revision", "lifecycle"],
    "proposal identity"
  );
  if (!path.isAbsolute(proposal.json_path) || !proposal.json_path.endsWith(".json"))
    throw new Error("proposal json_path must be an absolute JSON path");
  const relative = path.relative(
    fs.realpathSync(repoRoot),
    fs.realpathSync(path.dirname(proposal.json_path))
  );
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("proposal path escapes the project repository");
  const bytes = fs.readFileSync(proposal.json_path);
  const parsed = JSON.parse(bytes);
  if (proposal.proposal_sha256 !== proposalBytesHash(bytes))
    throw new Error("proposal source hash does not match exact bytes");
  if (proposal.content_hash !== proposalContentHash(parsed))
    throw new Error("proposal content hash does not match canonical content");
  if (parsed.revision !== proposal.revision || parsed.lifecycle !== proposal.lifecycle)
    throw new Error("proposal identity does not match source revision and lifecycle");
  if (!Number.isInteger(proposal.revision) || proposal.revision < 1)
    throw new Error("proposal revision must be a positive integer");
  if (!["draft", "reviewed", "approved"].includes(proposal.lifecycle))
    throw new Error("proposal lifecycle is invalid");
  return proposal;
}

function requiredEvidence(phase) {
  return (
    {
      intake: ["intake"],
      research: ["research"],
      scope: ["scope"],
      synthesis: ["synthesis"],
      design: ["design"],
      draft: ["proposal", "artifact"],
      review: ["review"],
      presentation: ["presentation", "artifact"],
      handoff: ["handoff"],
      retro: ["retro"],
    }[phase] || []
  );
}
function requireEvidence(result, kind) {
  if (!result.evidence.some((item) => item.kind === kind && item.exit_code === 0))
    throw new Error(`${result.phase} requires passing ${kind} evidence`);
}

function validateSession(session) {
  const errors = [];
  if (!isObject(session)) return [{ path: "$", message: "session must be an object" }];
  const fields = [
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
    "routing",
    "proposal",
    "review",
    "approval",
    "authority",
    "authority_log",
    "execution",
    "attempts",
    "blockers",
    "history",
    "migration",
  ];
  collectExact(session, fields, "$", errors);
  if (session.schema_version !== 1) errors.push(issue("$.schema_version", "must equal 1"));
  if (!/^groom_[A-Za-z0-9_-]+$/.test(session.run_id || ""))
    errors.push(issue("$.run_id", "invalid"));
  if (!nonEmpty(session.slug)) errors.push(issue("$.slug", "required"));
  if (!STATUSES.has(session.status)) errors.push(issue("$.status", "invalid"));
  if (!PHASES.includes(session.phase)) errors.push(issue("$.phase", "invalid"));
  if (!Number.isInteger(session.phase_attempt) || session.phase_attempt < 1)
    errors.push(issue("$.phase_attempt", "invalid"));
  for (const field of ["created_at", "updated_at"])
    if (!isIsoDate(session[field])) errors.push(issue(`$.${field}`, "invalid"));
  if (!isObject(session.source)) errors.push(issue("$.source", "invalid"));
  else {
    collectExact(
      session.source,
      ["repo_root", "worktree", "branch", "base_commit"],
      "$.source",
      errors
    );
    for (const field of ["repo_root", "worktree", "branch", "base_commit"])
      if (!nonEmpty(session.source[field])) errors.push(issue(`$.source.${field}`, "required"));
  }
  if (!isObject(session.context)) errors.push(issue("$.context", "invalid"));
  else {
    collectExact(
      session.context,
      ["configured", "tier", "title", "outcome", "source_kind", "source_path", "evidence_refs"],
      "$.context",
      errors
    );
    if (typeof session.context.configured !== "boolean")
      errors.push(issue("$.context.configured", "invalid"));
    if (!ROUTES[session.context.tier]) errors.push(issue("$.context.tier", "invalid"));
    if (
      !Array.isArray(session.context.evidence_refs) ||
      session.context.evidence_refs.some((item) => !nonEmpty(item))
    )
      errors.push(issue("$.context.evidence_refs", "invalid"));
    if (
      session.context.configured &&
      (!nonEmpty(session.context.title) ||
        !nonEmpty(session.context.outcome) ||
        !["idea", "backlog", "legacy"].includes(session.context.source_kind))
    )
      errors.push(issue("$.context", "configured context is incomplete"));
  }
  if (!isObject(session.routing)) errors.push(issue("$.routing", "invalid"));
  else {
    collectExact(
      session.routing,
      ["required_phases", "review_questions", "kb_gate"],
      "$.routing",
      errors
    );
    if (
      JSON.stringify(session.routing.required_phases) !==
      JSON.stringify(ROUTES[session.context?.tier])
    )
      errors.push(issue("$.routing.required_phases", "does not match tier"));
    if (!Array.isArray(session.routing.review_questions))
      errors.push(issue("$.routing.review_questions", "invalid"));
    else
      session.routing.review_questions.forEach((question, index) => {
        validateClosedRecord(
          question,
          ["id", "text"],
          `$.routing.review_questions[${index}]`,
          errors
        );
        if (!nonEmpty(question?.id) || !nonEmpty(question?.text))
          errors.push(issue(`$.routing.review_questions[${index}]`, "id and text required"));
      });
    if (!["normal", "strict"].includes(session.routing.kb_gate))
      errors.push(issue("$.routing.kb_gate", "invalid"));
  }
  if (session.proposal !== null) {
    validateClosedRecord(
      session.proposal,
      ["json_path", "proposal_sha256", "content_hash", "revision", "lifecycle"],
      "$.proposal",
      errors
    );
    if (
      !/^sha256:[0-9a-f]{64}$/.test(session.proposal?.proposal_sha256 || "") ||
      !/^sha256:[0-9a-f]{64}$/.test(session.proposal?.content_hash || "")
    )
      errors.push(issue("$.proposal", "hashes are invalid"));
  }
  validateClosedRecord(
    session.review,
    ["status", "proposal_hash", "rounds", "outcomes", "reviewed_at"],
    "$.review",
    errors
  );
  if (isObject(session.review)) {
    if (!["not_started", "passed"].includes(session.review.status))
      errors.push(issue("$.review.status", "invalid"));
    if (!Number.isInteger(session.review.rounds) || session.review.rounds < 0)
      errors.push(issue("$.review.rounds", "invalid"));
    if (!Array.isArray(session.review.outcomes)) errors.push(issue("$.review.outcomes", "invalid"));
    else
      session.review.outcomes.forEach((outcome, index) =>
        validateClosedRecord(
          outcome,
          ["question_id", "proposal_hash", "verdict", "blocking", "advisory"],
          `$.review.outcomes[${index}]`,
          errors
        )
      );
    if (
      session.review.status === "passed" &&
      (!/^sha256:[0-9a-f]{64}$/.test(session.review.proposal_hash || "") ||
        !isIsoDate(session.review.reviewed_at))
    )
      errors.push(issue("$.review", "passed review requires current hash and timestamp"));
  }
  validateClosedRecord(
    session.approval,
    [
      "status",
      "approved_by",
      "approved_at",
      "proposal_hash",
      "proposal_revision",
      "proposal_snapshot_sha256",
      "decision_id",
      "decision_sha256",
    ],
    "$.approval",
    errors
  );
  if (isObject(session.approval)) {
    if (!["pending", "approved"].includes(session.approval.status))
      errors.push(issue("$.approval.status", "invalid"));
    if (
      session.approval.status === "approved" &&
      (!nonEmpty(session.approval.approved_by) ||
        !isIsoDate(session.approval.approved_at) ||
        !/^sha256:[0-9a-f]{64}$/.test(session.approval.proposal_hash || "") ||
        !Number.isInteger(session.approval.proposal_revision) ||
        session.approval.proposal_revision < 1 ||
        !/^sha256:[0-9a-f]{64}$/.test(session.approval.proposal_snapshot_sha256 || "") ||
        !nonEmpty(session.approval.decision_id) ||
        !/^sha256:[0-9a-f]{64}$/.test(session.approval.decision_sha256 || ""))
    )
      errors.push(issue("$.approval", "approved record is incomplete"));
    if (
      session.approval.status === "pending" &&
      [
        session.approval.approved_by,
        session.approval.approved_at,
        session.approval.proposal_hash,
        session.approval.proposal_revision,
        session.approval.proposal_snapshot_sha256,
        session.approval.decision_id,
        session.approval.decision_sha256,
      ].some((value) => value !== null)
    )
      errors.push(issue("$.approval", "pending approval must not carry decision identity"));
  }
  validateClosedRecord(
    session.execution,
    ["profile", "runtime", "model", "reasoning", "mode", "runtime_session_id", "headless"],
    "$.execution",
    errors
  );
  if (isObject(session.execution)) {
    for (const field of ["profile", "runtime", "model", "reasoning", "mode"])
      if (!nonEmpty(session.execution[field]))
        errors.push(issue(`$.execution.${field}`, "required"));
    if (typeof session.execution.headless !== "boolean")
      errors.push(issue("$.execution.headless", "invalid"));
  }
  if (!isObject(session.authority)) errors.push(issue("$.authority", "invalid"));
  else {
    collectExact(session.authority, AUTHORITY_ACTIONS, "$.authority", errors);
    for (const action of AUTHORITY_ACTIONS)
      if (typeof session.authority[action] !== "boolean")
        errors.push(issue(`$.authority.${action}`, "invalid"));
  }
  for (const field of ["authority_log", "attempts", "blockers", "history"])
    if (!Array.isArray(session[field])) errors.push(issue(`$.${field}`, "invalid"));
  if (Array.isArray(session.authority_log))
    session.authority_log.forEach((entry, index) =>
      validateClosedRecord(
        entry,
        ["action", "granted", "reason", "recorded_at"],
        `$.authority_log[${index}]`,
        errors
      )
    );
  if (Array.isArray(session.attempts))
    session.attempts.forEach((entry, index) => {
      const at = `$.attempts[${index}]`;
      validateClosedRecord(
        entry,
        [
          "phase",
          "attempt",
          "status",
          "summary",
          "proposal_hash",
          "recorded_at",
          "runtime",
          "capability_downgrades",
          "result_hash",
        ],
        at,
        errors
      );
      if (!PHASES.filter((phase) => phase !== "approval").includes(entry?.phase))
        errors.push(issue(`${at}.phase`, "invalid"));
      if (!Array.isArray(entry?.capability_downgrades))
        errors.push(issue(`${at}.capability_downgrades`, "invalid"));
      for (const runtimeIssue of runtimeRecordIssues(entry?.runtime, `${at}.runtime`, {
        requireSessionId: true,
      }))
        errors.push(runtimeIssue);
    });
  if (Array.isArray(session.history))
    session.history.forEach((entry, index) => {
      const at = `$.history[${index}]`;
      validateClosedRecord(entry, ["prior_phase", "next_phase", "reason", "timestamp"], at, errors);
      if (!isIsoDate(entry?.timestamp)) errors.push(issue(`${at}.timestamp`, "invalid"));
    });
  if (Array.isArray(session.blockers))
    session.blockers.forEach((entry, index) => {
      const at = `$.blockers[${index}]`;
      if (!isObject(entry)) errors.push(issue(at, "invalid"));
      else
        for (const key of Object.keys(entry))
          if (
            ![
              "code",
              "reason",
              "remediation",
              "phase",
              "recorded_at",
              "resolved_at",
              "resolution",
            ].includes(key)
          )
            errors.push(issue(`${at}.${key}`, "unknown field"));
    });
  if (session.migration !== null) {
    validateClosedRecord(
      session.migration,
      ["legacy_path", "legacy_stage", "migrated_at", "approval_trusted", "reason"],
      "$.migration",
      errors
    );
    if (session.migration?.approval_trusted !== false)
      errors.push(issue("$.migration.approval_trusted", "must be false"));
  }
  if (session.status === "awaiting_approval" && session.phase !== "approval")
    errors.push(issue("$.status", "awaiting_approval requires approval phase"));
  if (
    isObject(session.routing) &&
    Array.isArray(session.routing.required_phases) &&
    !session.routing.required_phases.includes(session.phase)
  )
    errors.push(issue("$.phase", "must belong to the selected tier route"));
  if (session.phase === "approval" && session.status !== "awaiting_approval")
    errors.push(issue("$.status", "approval phase must be awaiting_approval"));
  if (session.status === "approved" && !["handoff", "retro"].includes(session.phase))
    errors.push(issue("$.status", "approved status requires handoff or retro phase"));
  if (["handoff", "retro"].includes(session.phase) && session.status === "active")
    errors.push(issue("$.status", `${session.phase} phase cannot be active`));
  if (["approved", "complete"].includes(session.status) && session.approval?.status !== "approved")
    errors.push(issue("$.approval", "explicit approval required"));
  if (session.status === "complete" && session.phase !== "retro")
    errors.push(issue("$.phase", "complete session must remain at retro"));
  return errors;
}

function assertValidSession(session) {
  const errors = validateSession(session);
  if (errors.length)
    throw new Error(
      `invalid Groom session: ${errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`
    );
}
function validateClosedRecord(value, fields, objectPath, errors) {
  if (!isObject(value)) errors.push(issue(objectPath, "invalid"));
  else collectExact(value, fields, objectPath, errors);
}
function collectExact(value, fields, objectPath, errors) {
  const allowed = new Set(fields);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) errors.push(issue(`${objectPath}.${key}`, "unknown field"));
  for (const key of fields)
    if (!Object.hasOwn(value, key)) errors.push(issue(`${objectPath}.${key}`, "required"));
}
function exactFields(value, fields, label) {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  for (const key of fields)
    if (!Object.hasOwn(value, key)) throw new Error(`${label} requires ${key}`);
}
function normalizeSlug(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("Groom slug is invalid");
  return slug;
}
function gitValue(cwd, args, fallback) {
  try {
    return runGit(args, cwd, { timeout: 10_000 });
  } catch {
    return fallback;
  }
}
function verifySourceIdentity(session) {
  const observed = fs.realpathSync(findGitRoot(session.source.worktree));
  if (observed !== fs.realpathSync(session.source.repo_root))
    throw new Error("Groom source worktree identity changed");
  const branch =
    gitValue(session.source.worktree, ["branch", "--show-current"], "detached") || "detached";
  if (branch !== session.source.branch)
    throw new Error(`Groom source branch changed from ${session.source.branch} to ${branch}`);
}
function assertWithin(root, candidate, label) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`${label} escapes the project repository`);
}
function issue(pathValue, message) {
  return { path: pathValue, message };
}
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  AUTHORITY_ACTIONS,
  PHASES,
  REVIEW_QUESTIONS,
  ROUTES,
  applyContext,
  approveSession,
  assertValidSession,
  buildApprovalAudit,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  proposalIdentityFromPath,
  recordResult,
  resumeBlocked,
  reviseSession,
  validateSession,
  verifyProposal,
};
