"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PHASES,
  ROUTES,
  applyContext,
  approveSession,
  buildApprovalAudit,
  createSession,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  reviseSession,
  validateSession,
} = require("../scripts/lib/groom-session-schema");

test("Groom tiers route proportionate depth through one approval contract", () => {
  const repo = makeRepo();
  try {
    assert.deepEqual(PHASES, [
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
    ]);
    assert.deepEqual(ROUTES.agent, ROUTES.full);
    assert.ok(!ROUTES.quick.includes("review"));
    assert.ok(ROUTES.standard.includes("review"));

    let session = createSession({ slug: "fast-groom", sourceDir: repo, tier: "quick" });
    session = applyContext(session, {
      title: "Fast groom",
      outcome: "A testable product decision",
      source_kind: "idea",
      evidence_refs: ["pm/research/users.md#signal-1"],
    });
    assert.deepEqual(session.routing.required_phases, ROUTES.quick);
    assert.equal(nextDecision(session, "/tmp/session.json").phase, "intake");
    session = recordResult(session, passed(session));
    assert.equal(session.phase, "research");
    assert.deepEqual(validateSession(session), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("approval binds exact proposal bytes and revision, and revise invalidates it", () => {
  const repo = makeRepo();
  try {
    let session = applyContext(
      createSession({ slug: "approval", sourceDir: repo, tier: "quick" }),
      { title: "Approval", outcome: "Safe approval", source_kind: "idea", evidence_refs: [] }
    );
    session = advanceTo(session, "draft");
    const proposalPath = path.join(repo, "pm/backlog/proposals/approval.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft","title":"Approval"}\n');
    const proposal = proposalIdentity(proposalPath, 1);
    session = recordResult(
      session,
      passed(session, { proposal, evidence: [evidence("proposal"), evidence("artifact")] })
    );
    assert.equal(session.phase, "approval");
    assert.equal(session.status, "awaiting_approval");

    session = approveSession(session, { approvedBy: "product-owner" });
    assert.equal(session.approval.proposal_hash, proposal.content_hash);
    assert.equal(session.approval.proposal_revision, 1);
    assert.equal(session.phase, "handoff");

    fs.writeFileSync(proposalPath, '{"revision":2,"lifecycle":"draft","title":"Changed"}\n');
    assert.throws(
      () => approveSession(session, { approvedBy: "product-owner" }),
      /changed after approval/
    );

    session = reviseSession(session, {
      reason: "Scope changed",
      phase: "scope",
      proposal: proposalIdentity(proposalPath, 2),
    });
    assert.equal(session.phase, "scope");
    assert.equal(session.approval.status, "pending");
    assert.equal(session.proposal.revision, 2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("review outcomes cover independent questions without fixed worker identities", () => {
  const repo = makeRepo();
  try {
    let session = applyContext(
      createSession({ slug: "questions", sourceDir: repo, tier: "standard" }),
      { title: "Questions", outcome: "Bound review", source_kind: "idea", evidence_refs: [] }
    );
    session = advanceTo(session, "draft");
    const proposalPath = path.join(repo, "pm/backlog/proposals/questions.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft"}\n');
    const proposal = proposalIdentity(proposalPath, 1);
    session = recordResult(
      session,
      passed(session, { proposal, evidence: [evidence("proposal"), evidence("artifact")] })
    );
    assert.equal(session.phase, "review");
    const outcomes = session.routing.review_questions.map((question) => ({
      question_id: question.id,
      proposal_hash: proposal.content_hash,
      verdict: "pass",
      blocking: [],
      advisory: [],
    }));
    session = recordResult(
      session,
      passed(session, {
        proposal,
        question_outcomes: outcomes,
        evidence: [evidence("review")],
      })
    );
    assert.equal(session.review.status, "passed");
    assert.equal(session.review.outcomes.length, session.routing.review_questions.length);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("approval audit binds approved bytes after a lifecycle-only transition", () => {
  const repo = makeRepo();
  try {
    const proposalPath = path.join(repo, "pm/backlog/proposals/structured-groom.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    const proposal = JSON.parse(
      fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"), "utf8")
    );
    const { proposalContentHash, readApprovedProposal } = require("../scripts/lib/proposal-schema");
    proposal.lifecycle = "reviewed";
    proposal.review = {
      status: "passed",
      revision: 1,
      content_sha256: proposalContentHash(proposal),
      completed_at: "2026-07-14T00:00:00Z",
    };
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    let session = applyContext(
      createSession({ slug: proposal.slug, sourceDir: repo, tier: "quick" }),
      { title: proposal.title, outcome: proposal.outcome, source_kind: "idea", evidence_refs: [] }
    );
    session = advanceTo(session, "draft");
    session = recordResult(
      session,
      passed(session, { proposal: proposalIdentity(proposalPath, 1) })
    );
    session = approveSession(
      session,
      { approvedBy: "product-owner" },
      { now: "2026-07-14T01:00:00Z" }
    );

    proposal.lifecycle = "approved";
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    assert.deepEqual(approveSession(session, { approvedBy: "product-owner" }), session);
    const audit = buildApprovalAudit(session);
    assert.equal(audit.kind, "proposal-approval");
    assert.equal(audit.content_sha256, session.approval.proposal_hash);
    assert.notEqual(audit.proposal_sha256, session.proposal.proposal_sha256);
    assert.equal(audit.decision_id, session.approval.decision_id);
    assert.equal(audit.decision_sha256, session.approval.decision_sha256);
    fs.writeFileSync(
      proposalPath.replace(/\.json$/, ".approval.json"),
      `${JSON.stringify(audit, null, 2)}\n`
    );
    const approved = readApprovedProposal(proposalPath, {
      projectRoot: repo,
      expectedDecision: {
        id: session.approval.decision_id,
        sha256: session.approval.decision_sha256,
      },
    });
    assert.equal(approved.trustedApproval, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy Groom markdown migration is bounded and never trusts approval", () => {
  const repo = makeRepo();
  try {
    const legacy = path.join(repo, ".pm/groom-sessions/legacy.md");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      "# Groom Session\n\n| Field | Value |\n|---|---|\n| Slug | legacy |\n| Stage | present |\n| Tier | agent |\n"
    );
    const session = migrateLegacyMarkdown(legacy);
    assert.equal(session.slug, "legacy");
    assert.equal(session.context.tier, "agent");
    assert.equal(session.phase, "intake");
    assert.equal(session.migration.approval_trusted, false);
    assert.deepEqual(validateSession(session), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

function advanceTo(session, target) {
  while (session.phase !== target) session = recordResult(session, passed(session));
  return session;
}

function passed(session, overrides = {}) {
  const evidenceKinds = {
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
  };
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `${session.phase} complete`,
    proposal: null,
    evidence: (evidenceKinds[session.phase] || []).map(evidence),
    question_outcomes: [],
    capability_downgrades: [],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    ...overrides,
  };
}

function evidence(kind) {
  return { kind, command: "test", exit_code: 0, artifact: null };
}

function proposalIdentity(jsonPath, revision) {
  const { proposalBytesHash, proposalContentHash } = require("../scripts/lib/proposal-schema");
  const bytes = fs.readFileSync(jsonPath);
  const proposal = JSON.parse(bytes);
  return {
    json_path: jsonPath,
    proposal_sha256: proposalBytesHash(bytes),
    content_hash: proposalContentHash(proposal),
    revision,
    lifecycle: proposal.lifecycle || "draft",
  };
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-groom-session-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "test\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}
