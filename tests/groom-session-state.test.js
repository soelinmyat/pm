"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
const { reviewOutcome, reviewRow } = require("./helpers/groom-review-fixture.js");

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
    assert.ok(ROUTES.quick.includes("design"));
    assert.ok(ROUTES.quick.includes("review"));
    assert.ok(ROUTES.standard.includes("review"));

    let session = createSession({ slug: "fast-groom", sourceDir: repo, tier: "quick" });
    assert.equal(session.schema_version, 2);
    const artifact = makeOwnedArtifact(repo, "fast-groom");
    session = applyContext(session, {
      title: "Fast groom",
      outcome: "A testable product decision",
      source_kind: "idea",
      evidence_refs: ["pm/research/users.md#signal-1"],
      artifact_repo_root: artifact,
    });
    assert.deepEqual(session.routing.required_phases, ROUTES.quick);
    assert.deepEqual(
      session.routing.review_questions.map((question) => question.id),
      ["assumption-risk", "experience"]
    );
    assert.equal(nextDecision(session, "/tmp/session.json").phase, "intake");
    session = recordResult(session, passed(session));
    assert.equal(session.phase, "research");
    assert.deepEqual(validateSession(session), []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("legacy schema-v1 Quick sessions resume on their frozen pre-design route", () => {
  const repo = makeRepo();
  try {
    const artifact = makeOwnedArtifact(repo, "legacy-quick-route");
    let session = applyContext(
      createSession({ slug: "legacy-quick-route", sourceDir: repo, tier: "quick" }),
      {
        title: "Legacy quick route",
        outcome: "Resume without rewriting immutable workflow history",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    session.schema_version = 1;
    session.routing.required_phases = [
      "intake",
      "research",
      "scope",
      "draft",
      "approval",
      "handoff",
      "retro",
    ];
    session.routing.review_questions = [];
    assert.deepEqual(validateSession(session), []);
    session = recordResult(session, passed(session));
    session = recordResult(session, passed(session));
    session = recordResult(session, passed(session));
    assert.equal(session.phase, "draft");

    const proposalPath = path.join(artifact, "pm/backlog/proposals/legacy-quick-route.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft"}\n');
    session = recordResult(
      session,
      passed(session, {
        proposal: proposalIdentity(proposalPath, 1),
        evidence: [evidence("proposal"), evidence("artifact")],
      })
    );
    assert.equal(session.phase, "approval");
    assert.equal(session.status, "awaiting_approval");
    assert.equal(session.review.status, "not_started");

    session = approveSession(session, { approvedBy: "product-owner" });
    assert.equal(session.phase, "handoff");
    assert.equal(session.approval.status, "approved");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("Groom keeps product source identity separate from proposal artifact storage", () => {
  const sourceRepo = makeRepo();
  const artifactRepo = makeRepo();
  try {
    const artifact = makeOwnedArtifact(artifactRepo, "separate-artifacts");
    let session = applyContext(
      createSession({ slug: "separate-artifacts", sourceDir: sourceRepo, tier: "quick" }),
      {
        title: "Separate artifacts",
        outcome: "Preserve product context while isolating KB writes",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    assert.equal(session.source.repo_root, fs.realpathSync(sourceRepo));
    assert.equal(session.context.artifact_repo_root, fs.realpathSync(artifact));
    assert.equal(nextDecision(session, "/tmp/session.json").phase, "intake");

    session = advanceTo(session, "draft");
    const proposalPath = path.join(artifact, "pm/backlog/proposals/separate-artifacts.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft"}\n');
    bindSessionReviewContract(session, proposalPath);
    session = recordResult(
      session,
      passed(session, {
        proposal: proposalIdentity(proposalPath, 1),
        evidence: [evidence("proposal"), evidence("artifact")],
      })
    );

    assert.equal(session.proposal.json_path, proposalPath);
    assert.deepEqual(validateSession(session), []);
  } finally {
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(artifactRepo, { recursive: true, force: true });
  }
});

test("fresh Groom context rejects missing and unowned artifact repositories", () => {
  const sourceRepo = makeRepo();
  const unownedRepo = makeRepo();
  try {
    const session = createSession({ slug: "ownership", sourceDir: sourceRepo, tier: "quick" });
    const facts = {
      title: "Ownership",
      outcome: "Reject shared checkout writes",
      source_kind: "idea",
      evidence_refs: [],
    };
    assert.throws(() => applyContext(session, facts), /requires artifact_repo_root/);
    assert.throws(
      () => applyContext(session, { ...facts, artifact_repo_root: unownedRepo }),
      /helper-owned branch/
    );
  } finally {
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(unownedRepo, { recursive: true, force: true });
  }
});

test("Groom resume rejects drifted helper-owned artifact identity", () => {
  const sourceRepo = makeRepo();
  const artifactRepo = makeRepo();
  try {
    const artifact = makeOwnedArtifact(artifactRepo, "resume-identity");
    const session = applyContext(
      createSession({ slug: "resume-identity", sourceDir: sourceRepo, tier: "quick" }),
      {
        title: "Resume identity",
        outcome: "Reject a retargeted artifact worktree",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    execFileSync("git", ["remote", "set-url", "--push", "origin", sourceRepo], {
      cwd: artifact,
    });

    assert.throws(
      () => nextDecision(session, "/tmp/session.json"),
      /delivery URL identity changed/
    );
  } finally {
    fs.rmSync(sourceRepo, { recursive: true, force: true });
    fs.rmSync(artifactRepo, { recursive: true, force: true });
  }
});

test("approval binds exact proposal bytes and revision, and revise invalidates it", () => {
  const repo = makeRepo();
  try {
    const artifact = makeOwnedArtifact(repo, "approval");
    let session = applyContext(
      createSession({ slug: "approval", sourceDir: repo, tier: "quick" }),
      {
        title: "Approval",
        outcome: "Safe approval",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    session = advanceTo(session, "draft");
    const proposalPath = path.join(artifact, "pm/backlog/proposals/approval.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft","title":"Approval"}\n');
    bindSessionReviewContract(session, proposalPath, { complete: true });
    const proposal = proposalIdentity(proposalPath, 1);
    session = recordResult(
      session,
      passed(session, { proposal, evidence: [evidence("proposal"), evidence("artifact")] })
    );
    session = passCurrentReview(session, proposal);
    assert.equal(session.phase, "approval");
    assert.equal(session.status, "awaiting_approval");

    session = approveSession(session, { approvedBy: "product-owner" });
    assert.equal(session.approval.proposal_hash, proposal.content_hash);
    assert.equal(session.approval.proposal_revision, 1);
    assert.equal(session.phase, "handoff");

    const changed = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
    changed.revision = 2;
    changed.lifecycle = "draft";
    changed.title = "Changed";
    fs.writeFileSync(proposalPath, `${JSON.stringify(changed)}\n`);
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
    const artifact = makeOwnedArtifact(repo, "questions");
    let session = applyContext(
      createSession({ slug: "questions", sourceDir: repo, tier: "standard" }),
      {
        title: "Questions",
        outcome: "Bound review",
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    session = advanceTo(session, "draft");
    const proposalPath = path.join(artifact, "pm/backlog/proposals/questions.json");
    fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
    fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft"}\n');
    bindSessionReviewContract(session, proposalPath, { complete: true });
    const proposal = proposalIdentity(proposalPath, 1);
    session = recordResult(
      session,
      passed(session, { proposal, evidence: [evidence("proposal"), evidence("artifact")] })
    );
    assert.equal(session.phase, "review");
    const outcomes = session.routing.review_questions.map((question, index) =>
      reviewOutcome(question, proposal.content_hash, index)
    );
    const divergent = structuredClone(outcomes);
    divergent[0].conclusion =
      "A different conclusion claims the review passed for unrelated operational reasons.";
    assert.throws(
      () =>
        recordResult(
          session,
          passed(session, {
            proposal,
            question_outcomes: divergent,
            evidence: [evidence("review")],
          })
        ),
      /conclusion does not match canonical review/
    );
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
    const artifact = makeOwnedArtifact(repo, "structured-groom");
    const proposalPath = path.join(artifact, "pm/backlog/proposals/structured-groom.json");
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
    let session = applyContext(
      createSession({ slug: proposal.slug, sourceDir: repo, tier: "quick" }),
      {
        title: proposal.title,
        outcome: proposal.outcome,
        source_kind: "idea",
        evidence_refs: [],
        artifact_repo_root: artifact,
      }
    );
    bindSessionReviewContractObject(session, proposal, { complete: true });
    proposal.review.content_sha256 = proposalContentHash(proposal);
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    session = advanceTo(session, "draft");
    session = recordResult(
      session,
      passed(session, { proposal: proposalIdentity(proposalPath, 1) })
    );
    session = passCurrentReview(session, proposalIdentity(proposalPath, 1));
    session = approveSession(
      session,
      { approvedBy: "product-owner" },
      { now: "2026-07-14T01:00:00Z" }
    );

    const reviewedUpdatedAt = proposal.updated_at;
    proposal.updated_at = "2026-07-14T01:30:00Z";
    proposal.lifecycle = "approved";
    fs.writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
    assert.throws(() => buildApprovalAudit(session), /proposal changed after approval/);

    proposal.updated_at = reviewedUpdatedAt;
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

test("session validation rejects phases outside the route and incoherent approval status", () => {
  const repo = makeRepo();
  try {
    const standard = createSession({ slug: "coherence", sourceDir: repo, tier: "standard" });
    standard.phase = "presentation";
    assert.match(JSON.stringify(validateSession(standard)), /selected tier route/);

    const approval = createSession({ slug: "approval-coherence", sourceDir: repo });
    approval.phase = "approval";
    assert.match(JSON.stringify(validateSession(approval)), /must be awaiting_approval/);

    const narrowed = createSession({ slug: "narrowed-review", sourceDir: repo, tier: "full" });
    narrowed.routing.review_questions = narrowed.routing.review_questions.slice(0, 1);
    assert.match(JSON.stringify(validateSession(narrowed)), /tier review contract/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("full and agent sessions reject one-row proposal review coverage before pass or approval", () => {
  for (const tier of ["full", "agent"]) {
    const repo = makeRepo();
    try {
      const artifact = makeOwnedArtifact(repo, `${tier}-coverage`);
      let session = applyContext(
        createSession({ slug: `${tier}-coverage`, sourceDir: repo, tier }),
        {
          title: `${tier} coverage`,
          outcome: "Reject partial canonical review coverage",
          source_kind: "idea",
          evidence_refs: [],
          artifact_repo_root: artifact,
        }
      );
      session = advanceTo(session, "draft");
      const proposalPath = path.join(artifact, `pm/backlog/proposals/${tier}-coverage.json`);
      fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
      fs.writeFileSync(proposalPath, '{"revision":1,"lifecycle":"draft"}\n');
      bindSessionReviewContract(session, proposalPath, { complete: false });
      const oneRow = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
      oneRow.question_reviews = [reviewRow(session.routing.review_questions[0])];
      fs.writeFileSync(proposalPath, `${JSON.stringify(oneRow)}\n`);
      const proposal = proposalIdentity(proposalPath, 1);
      session = recordResult(
        session,
        passed(session, { proposal, evidence: [evidence("proposal"), evidence("artifact")] })
      );
      const outcomes = session.routing.review_questions.map((question, index) =>
        reviewOutcome(question, proposal.content_hash, index)
      );
      assert.throws(
        () =>
          recordResult(
            session,
            passed(session, {
              proposal,
              question_outcomes: outcomes,
              evidence: [evidence("review")],
            })
          ),
        /missing tier-required question reviews/
      );

      session.phase = "approval";
      session.status = "awaiting_approval";
      session.review = {
        status: "passed",
        proposal_hash: proposal.content_hash,
        rounds: 1,
        outcomes,
        reviewed_at: new Date().toISOString(),
      };
      assert.throws(
        () => approveSession(session, { approvedBy: "product-owner" }),
        /missing tier-required question reviews/
      );
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

function advanceTo(session, target) {
  while (session.phase !== target) session = recordResult(session, passed(session));
  return session;
}

function passCurrentReview(session, proposal) {
  assert.equal(session.phase, "review");
  return recordResult(
    session,
    passed(session, {
      proposal,
      question_outcomes: session.routing.review_questions.map((question, index) =>
        reviewOutcome(question, proposal.content_hash, index)
      ),
      evidence: [evidence("review")],
    })
  );
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

function bindSessionReviewContract(session, proposalPath, options = {}) {
  const proposal = JSON.parse(fs.readFileSync(proposalPath, "utf8"));
  bindSessionReviewContractObject(session, proposal, options);
  fs.writeFileSync(proposalPath, `${JSON.stringify(proposal)}\n`);
}

function bindSessionReviewContractObject(session, proposal, { complete = false } = {}) {
  if (!Array.isArray(proposal.evidence)) {
    proposal.evidence = [
      {
        id: "evidence:baseline",
        kind: "research",
        path: "pm/research/baseline.md",
        summary: "Baseline observations for the proposal review contract.",
        observed_at: "2026-07-14T00:00:00.000Z",
      },
    ];
  }
  proposal.source = {
    ...(proposal.source || {}),
    kind: "groom-session",
    session_id: session.run_id,
  };
  proposal.review_contract = {
    session_id: session.run_id,
    tier: session.context.tier,
    required_question_ids: session.routing.review_questions.map((question) => question.id),
  };
  proposal.question_reviews = complete
    ? session.routing.review_questions.map((question, index) => reviewRow(question, index))
    : [];
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

function makeOwnedArtifact(repo, slug) {
  const branch = `codex/${slug}-groom`;
  const worktree = path.join(repo, ".owned", slug);
  execFileSync("git", ["remote", "add", "origin", repo], { cwd: repo });
  execFileSync("git", ["worktree", "add", "-q", "-b", branch, worktree], { cwd: repo });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const urlHash = crypto.createHash("sha256").update(repo).digest("hex");
  for (const [key, value] of [
    [`branch.${branch}.pmArtifactBase`, base],
    [`branch.${branch}.pmArtifactKind`, "groom"],
    [`branch.${branch}.pmArtifactRemote`, "origin"],
    [`branch.${branch}.pmArtifactDefaultBranch`, "main"],
    [`branch.${branch}.pmArtifactRemoteUrlSha256`, urlHash],
  ])
    execFileSync("git", ["config", key, value], { cwd: repo });
  return worktree;
}
