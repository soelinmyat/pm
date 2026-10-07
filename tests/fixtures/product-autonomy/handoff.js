"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const groom = require("../../../scripts/lib/groom-session-schema");
const proposalSchema = require("../../../scripts/lib/proposal-schema");
const rfc = require("../../../scripts/lib/rfc-session-schema");
const {
  materializeProposalSources,
  reviewOutcome,
  reviewRow,
} = require("../../helpers/groom-review-fixture");
const { writeArtifact, relabelArtifact } = require("../../helpers/rfc-run-fixture");
const GROOM_CLI = path.resolve(__dirname, "../../../scripts/groom-session.js");

function approvedProduct(repo, delegated, options = {}) {
  repo.root = fs.realpathSync(repo.root);
  repo.own("structured-groom");
  let session = groom.createSession({
    slug: "structured-groom",
    sourceDir: repo.root,
    tier: "quick",
    previewSourceRoot: options.previewSourceRoot,
    productContractVersion: options.current ? 1 : undefined,
  });
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../fixtures/proposals/strong-v1.json"))
  );
  proposal.source.session_id = session.run_id;
  proposal.review_contract = {
    session_id: session.run_id,
    tier: "quick",
    required_question_ids: session.routing.review_questions.map((question) => question.id),
  };
  proposal.question_reviews = session.routing.review_questions.map((question, index) =>
    reviewRow(question, index)
  );
  proposal.lifecycle = "reviewed";
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((item) => item.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["draft", "approved", "archived", "error"],
    experience_invariants: ["Every state exposes its next action."],
    visual_invariants: [],
  };
  if (options.valueDecision) proposal.decision_brief.value_decision = options.valueDecision;
  if (options.preview) {
    proposal.design_context.ui_impact = true;
    proposal.design_context.visual_invariants = [
      "Preserve the incumbent detail, gallery and drawer composition.",
    ];
    proposal.design_context.app_preview = options.preview;
    proposal.design_context.critical_states = options.preview.journeys.flatMap(
      (row) => row.required_states
    );
  }
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalSchema.proposalContentHash(proposal),
    completed_at: "2026-07-14T00:00:00.000Z",
  };
  materializeProposalSources(repo.root, proposal);
  proposal.review.content_sha256 = proposalSchema.proposalContentHash(proposal);
  const proposalPath = path.join(repo.root, "pm/backlog/proposals/structured-groom.json");
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  const { approval_snapshot_sha256: _snapshot, ...identity } = groom.proposalIdentityFromPath(
    proposalPath,
    repo.root,
    { previewSourceRoot: options.previewSourceRoot }
  );
  session.phase = "approval";
  session.status = "awaiting_approval";
  session.proposal = identity;
  session.context.artifact_repo_root = repo.root;
  session.review = {
    status: "passed",
    proposal_hash: identity.content_hash,
    rounds: 1,
    outcomes: session.routing.review_questions.map((question, index) =>
      reviewOutcome(question, identity.content_hash, index)
    ),
    reviewed_at: "2026-07-14T00:30:00.000Z",
  };
  const sessionPath = path.join(repo.root, ".pm/groom-sessions", session.slug, "session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  if (delegated) {
    const wrong = spawnSync(
      process.execPath,
      [
        GROOM_CLI,
        "approve",
        "--session",
        sessionPath,
        "--approved-by",
        "product-owner",
        "--delegate-content-sha256",
        `sha256:${"f".repeat(64)}`,
        "--json",
      ],
      { encoding: "utf8" }
    );
    assert.notEqual(wrong.status, 0, "a mismatched exact-product confirmation must fail");
  }
  const approved = spawnSync(
    process.execPath,
    [
      GROOM_CLI,
      "approve",
      "--session",
      sessionPath,
      "--approved-by",
      "product-owner",
      ...(delegated ? ["--delegate-content-sha256", identity.content_hash] : []),
      "--json",
    ],
    { encoding: "utf8" }
  );
  assert.equal(approved.status, 0, approved.stderr);
  session = JSON.parse(approved.stdout).session;
  if (delegated)
    assert.ok(
      session.approval.delivery_delegation,
      "explicit approval must produce a bounded grant"
    );
  proposal.lifecycle = "approved";
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  const audit = groom.buildApprovalAudit(session);
  const approvalPath = proposalPath.replace(/\.json$/, ".approval.json");
  fs.writeFileSync(approvalPath, JSON.stringify(audit));
  return {
    path: proposalPath,
    proposal,
    audit,
    approvalPath,
    sessionPath,
    sessionBytes: fs.readFileSync(sessionPath),
  };
}

function configuredRfc(repo, product, previewSourceRoot) {
  return rfc.applyContext(
    rfc.createSession({ slug: product.proposal.slug, sourceDir: repo.root }),
    {
      source_kind: "proposal",
      proposal_path: product.path,
      artifact_repo_root: repo.root,
      ...(previewSourceRoot ? { preview_source_root: previewSourceRoot } : {}),
    }
  );
}
function writeProductArtifact(repo, session, product) {
  let artifact = writeArtifact(repo, session.slug, "draft");
  const sidecar = JSON.parse(fs.readFileSync(artifact.json_path));
  sidecar.size = product.proposal.size;
  sidecar.design_context = product.proposal.design_context;
  fs.writeFileSync(artifact.json_path, JSON.stringify(sidecar));
  artifact = relabelArtifact(repo, session.slug, artifact, "draft");
  return artifact;
}
function basicVerdicts(artifact) {
  return rfc.REQUIRED_REVIEW_LENSES.map((lens) => ({
    lens,
    artifact_hash: rfc.artifactFingerprint(artifact),
    verdict: "pass",
    blocking: [],
    advisory: [],
  }));
}
function preservationVerdicts(session, artifact) {
  return basicVerdicts(artifact).map((item) => ({
    ...item,
    delegation_scope: {
      grant_sha256: session.context.delivery_delegation.grant_sha256,
      product_decision_sha256: session.context.proposal_identity.decision_sha256,
      reviewer_id: `independent:${item.lens}`,
      boundaries: {
        product: "preserved",
        commercial: "preserved",
        security: "preserved",
        privacy: "preserved",
        operational: "preserved",
      },
      rationale: `The ${item.lens} assessment preserves the manual approval/archive behavior and the existing buyer/data/operations constraints.`,
      evidence: ["proposal requirement and exact RFC execution-contract"],
    },
  }));
}

module.exports = { approvedProduct, configuredRfc, writeProductArtifact, preservationVerdicts };
