"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");
const groom = require("../scripts/lib/groom-session-schema");
const proposalSchema = require("../scripts/lib/proposal-schema");
const rfc = require("../scripts/lib/rfc-session-schema");
const { verifyRfcApproval } = require("../scripts/lib/rfc-approval-audit");
const {
  materializeProposalSources,
  reviewOutcome,
  reviewRow,
} = require("./helpers/groom-review-fixture");
const {
  makeRfcRepo,
  writeArtifact,
  phaseResult,
  resultEvidence,
  recordFile,
  relabelArtifact,
} = require("./helpers/rfc-run-fixture");
const GROOM_CLI = path.resolve(__dirname, "../scripts/groom-session.js");

test("explicit exact-product Groom delegation reaches independently reviewed initial RFC and verified handoff without a second human decision", () => {
  const repo = makeRfcRepo();
  try {
    const product = approvedProduct(repo, true);
    assert.equal(product.audit.delivery_delegation.technical_derivation, true);
    assert.equal(product.audit.delivery_delegation.implementation, true);
    let session = configuredRfc(repo, product);
    const grant = session.context.delivery_delegation;
    assert.equal(grant.grant_sha256, product.audit.delivery_delegation.grant_sha256);
    session = rfc.recordResult(session, phaseResult(session));
    const artifact = writeProductArtifact(repo, session, product);
    session = rfc.recordResult(
      session,
      phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
    );
    session = rfc.recordResult(
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: preservationVerdicts(session, artifact),
      })
    );
    assert.equal(session.status, "delegated");
    assert.equal(session.phase, "handoff");
    assert.equal(session.approval.status, "delegated");
    assert.equal(session.approval.approved_at, product.audit.approved_at);
    assert.equal(session.approval.approved_by, product.audit.approved_by);
    assert.deepEqual(session.authority, {
      linear_create: false,
      loop_approval: false,
      open_browser: false,
      start_implementation: false,
    });
    assert.match(session.history.at(-1).reason, /delegated.*product decision/);
    const sessionPath = path.join(repo.root, ".pm/rfc-sessions", session.slug, "session.json");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(session));
    let handoffArtifact = relabelArtifact(repo, session.slug, artifact, "reviewed");
    const audit = rfc.buildApprovalAudit(session, handoffArtifact);
    assert.equal(audit.schema_version, 4);
    assert.equal(audit.status, "delegated");
    assert.equal(audit.product_decision.decision_sha256, product.audit.decision_sha256);
    assertPublishedDelegation(session, audit);
    const auditPath = handoffArtifact.json_path.replace(/\.json$/, ".approval.json");
    fs.writeFileSync(auditPath, JSON.stringify(audit));
    execFileSync("git", ["add", path.relative(repo.root, auditPath)], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "record delegated technical handoff"], {
      cwd: repo.root,
    });
    handoffArtifact = { ...handoffArtifact, commit: repo.head() };
    const completed = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact: handoffArtifact,
        evidence: [
          resultEvidence("handoff"),
          resultEvidence("lifecycle"),
          resultEvidence("approval-audit", auditPath),
        ],
      })
    );
    assert.equal(completed.status, 0, completed.stderr);
    const verified = verifyRfcApproval({
      sidecarPath: handoffArtifact.json_path,
      slug: session.slug,
      archiveRepoRoot: repo.root,
    });
    assert.equal(verified.delegation.grant_sha256, grant.grant_sha256);
    assert.equal(verified.archived.status, "complete");
    assert.equal(verified.approval.status, "delegated");
    const before = fs.readFileSync(auditPath);
    const counterfeit = JSON.parse(before);
    counterfeit.product_decision.decision_sha256 = `sha256:${"f".repeat(64)}`;
    fs.writeFileSync(auditPath, JSON.stringify(counterfeit));
    assert.throws(
      () =>
        verifyRfcApproval({
          sidecarPath: handoffArtifact.json_path,
          slug: session.slug,
          archiveRepoRoot: repo.root,
        }),
      /backed|committed|decision/
    );
    fs.writeFileSync(auditPath, before);
    const archivePath = JSON.parse(completed.stdout).session_path;
    const amended = repo.run([
      "amend",
      "--kind",
      "maintenance",
      "--completed",
      archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "1",
      "--reason",
      "Correct the technical command while preserving approved behavior",
      "--json",
    ]);
    assert.equal(amended.status, 0, amended.stderr);
    const maintenance = JSON.parse(amended.stdout).session;
    const nextSidecar = JSON.parse(fs.readFileSync(handoffArtifact.json_path));
    nextSidecar.issues[0].verification_commands = ["node --test tests/product-delegation.test.js"];
    fs.writeFileSync(handoffArtifact.json_path, JSON.stringify(nextSidecar));
    const rendered = rfc.renderMaintenanceArtifact(maintenance);
    fs.writeFileSync(rendered.html_path, rendered.html);
    let maintainedArtifact = relabelArtifact(repo, session.slug, handoffArtifact, "draft");
    const maintenanceVerdicts = basicVerdicts(maintainedArtifact).map((item) => ({
      ...item,
      maintenance_scope: {
        preserved: true,
        rationale:
          "Only the executable verification command changes; the approved manual archive behavior and product/risk contract remain identical.",
      },
    }));
    const reviewed = recordFile(
      repo,
      maintenance,
      phaseResult(maintenance, {
        artifact: maintainedArtifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: maintenanceVerdicts,
      })
    );
    assert.equal(reviewed.status, 0, reviewed.stderr);
    const maintained = JSON.parse(reviewed.stdout).session;
    assert.equal(maintained.approval.status, "maintained");
    maintainedArtifact = relabelArtifact(repo, session.slug, maintainedArtifact, "reviewed");
    const maintenanceAudit = rfc.buildApprovalAudit(maintained, maintainedArtifact);
    assert.equal(maintenanceAudit.schema_version, 5);
    assert.equal(
      maintenanceAudit.product_decision.decision_sha256,
      audit.product_decision.decision_sha256
    );
    fs.writeFileSync(auditPath, JSON.stringify(maintenanceAudit));
    execFileSync("git", ["add", path.relative(repo.root, auditPath)], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "record reviewed delegated maintenance"], {
      cwd: repo.root,
    });
    maintainedArtifact = { ...maintainedArtifact, commit: repo.head() };
    const maintenanceHandoff = recordFile(
      repo,
      maintained,
      phaseResult(maintained, {
        artifact: maintainedArtifact,
        evidence: [
          resultEvidence("handoff"),
          resultEvidence("lifecycle"),
          resultEvidence("approval-audit", auditPath),
        ],
      })
    );
    assert.equal(maintenanceHandoff.status, 0, maintenanceHandoff.stderr);
    const lineage = verifyRfcApproval({
      sidecarPath: maintainedArtifact.json_path,
      slug: session.slug,
      archiveRepoRoot: repo.root,
      lineageTo: handoffArtifact.sidecar_hash,
    });
    assert.deepEqual(
      lineage.lineage.map((hop) => hop.run_id),
      [maintenance.run_id, session.run_id]
    );
    assert.equal(lineage.delegation.grant_sha256, grant.grant_sha256);
    assertPublishedDelegation(maintained, maintenanceAudit);
    // Lifecycle progress changes no approved product meaning or grant.
    const advanced = JSON.parse(fs.readFileSync(product.path));
    advanced.lifecycle = "planned";
    advanced.updated_at = new Date().toISOString();
    fs.writeFileSync(product.path, JSON.stringify(advanced));
    assert.equal(
      verifyRfcApproval({
        sidecarPath: maintainedArtifact.json_path,
        slug: session.slug,
        archiveRepoRoot: repo.root,
      }).delegation.grant_sha256,
      grant.grant_sha256
    );
  } finally {
    repo.cleanup();
  }
});

test("ordinary product approval preserves initial RFC human approval and old-session compatibility", () => {
  const repo = makeRfcRepo();
  try {
    const product = approvedProduct(repo, false);
    assert.equal(product.audit.delivery_delegation, undefined);
    let session = configuredRfc(repo, product);
    assert.equal(session.context.delivery_delegation, null);
    const legacy = structuredClone(session);
    delete legacy.context.delivery_delegation;
    assert.deepEqual(rfc.validateSession(rfc.upgradeCompatibleSession(legacy)), []);
    session = rfc.recordResult(session, phaseResult(session));
    const artifact = writeProductArtifact(repo, session, product);
    session = rfc.recordResult(
      session,
      phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
    );
    session = rfc.recordResult(
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: basicVerdicts(artifact),
      })
    );
    assert.equal(session.status, "awaiting_approval");
    assert.equal(session.approval.status, "pending");
  } finally {
    repo.cleanup();
  }
});

test("delegation refuses wrong confirmation, replay, forged grant, material or uncertain boundaries and correlated reviewers", () => {
  const repo = makeRfcRepo();
  try {
    const product = approvedProduct(repo, true);
    const bytes = fs.readFileSync(product.path);
    const auditBytes = fs.readFileSync(product.approvalPath);
    const bad = JSON.parse(auditBytes);
    bad.delivery_delegation.content_sha256 = `sha256:${"a".repeat(64)}`;
    fs.writeFileSync(product.approvalPath, JSON.stringify(bad));
    assert.throws(() => configuredRfc(repo, product), /delegation|decision/);
    fs.writeFileSync(product.approvalPath, auditBytes);
    const groomSession = JSON.parse(fs.readFileSync(product.sessionPath));
    delete groomSession.approval.delivery_delegation;
    fs.writeFileSync(product.sessionPath, JSON.stringify(groomSession));
    assert.throws(
      () => configuredRfc(repo, product),
      /canonical Groom.*delegation|delegation.*Groom/i
    );
    fs.writeFileSync(product.sessionPath, product.sessionBytes);
    const proposal = JSON.parse(bytes);
    proposal.requirements[0].statement += " Automatically charge a new buyer fee.";
    fs.writeFileSync(product.path, JSON.stringify(proposal));
    assert.throws(() => configuredRfc(repo, product), /content hash|review|delegation/);
    fs.writeFileSync(product.path, bytes);
    let session = configuredRfc(repo, product);
    session = rfc.recordResult(session, phaseResult(session));
    const artifact = writeProductArtifact(repo, session, product);
    session = rfc.recordResult(
      session,
      phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
    );
    for (const boundary of ["product", "commercial", "security", "privacy", "operational"]) {
      for (const verdict of ["material-change", "uncertain"]) {
        const lenses = preservationVerdicts(session, artifact);
        lenses[0].delegation_scope.boundaries[boundary] = verdict;
        assert.throws(
          () =>
            rfc.recordResult(
              session,
              phaseResult(session, {
                artifact,
                evidence: [resultEvidence("review")],
                reviewer_verdicts: lenses,
              })
            ),
          /delegation.*preserv|material|uncertain/
        );
      }
    }
    const correlated = preservationVerdicts(session, artifact);
    correlated[1].delegation_scope.reviewer_id = correlated[0].delegation_scope.reviewer_id;
    assert.throws(
      () =>
        rfc.recordResult(
          session,
          phaseResult(session, {
            artifact,
            evidence: [resultEvidence("review")],
            reviewer_verdicts: correlated,
          })
        ),
      /independent/
    );
    assert.throws(
      () =>
        rfc.recordResult(
          session,
          phaseResult(session, {
            artifact,
            evidence: [resultEvidence("review")],
            reviewer_verdicts: basicVerdicts(artifact),
          })
        ),
      /delegation.*scope/
    );
    const stale = preservationVerdicts(session, artifact);
    stale[0].delegation_scope.grant_sha256 = `sha256:${"e".repeat(64)}`;
    assert.throws(
      () =>
        rfc.recordResult(
          session,
          phaseResult(session, {
            artifact,
            evidence: [resultEvidence("review")],
            reviewer_verdicts: stale,
          })
        ),
      /delegation.*grant/
    );
  } finally {
    repo.cleanup();
  }
});

test("RFC intake preserves an explicitly selected preview source worktree and rejects missing or changed source roots", () => {
  const repo = makeRfcRepo();
  const preview = makeRfcRepo();
  try {
    const product = approvedProduct(repo, true);
    const selected = fs.realpathSync(preview.root);
    const session = rfc.applyContext(
      rfc.createSession({ slug: product.proposal.slug, sourceDir: repo.root }),
      {
        source_kind: "proposal",
        proposal_path: product.path,
        artifact_repo_root: repo.root,
        preview_source_root: selected,
      }
    );
    assert.equal(session.context.preview_source_root, selected);
    assert.doesNotThrow(() => rfc.nextDecision(session, "/tmp/rfc-session.json"));
    assert.throws(
      () =>
        rfc.applyContext(rfc.createSession({ slug: product.proposal.slug, sourceDir: repo.root }), {
          source_kind: "proposal",
          proposal_path: product.path,
          artifact_repo_root: repo.root,
          preview_source_root: path.join(selected, "absent"),
        }),
      /preview_source_root/
    );
    fs.rmSync(path.join(selected, ".git"), { recursive: true, force: true });
    assert.throws(() => rfc.nextDecision(session, "/tmp/rfc-session.json"), /preview_source_root/);
  } finally {
    repo.cleanup();
    preview.cleanup();
  }
});

function approvedProduct(repo, delegated) {
  repo.root = fs.realpathSync(repo.root);
  repo.own("structured-groom");
  let session = groom.createSession({
    slug: "structured-groom",
    sourceDir: repo.root,
    tier: "quick",
  });
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
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
    repo.root
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

function configuredRfc(repo, product) {
  return rfc.applyContext(
    rfc.createSession({ slug: product.proposal.slug, sourceDir: repo.root }),
    { source_kind: "proposal", proposal_path: product.path, artifact_repo_root: repo.root }
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

function assertPublishedDelegation(session, audit) {
  const Ajv2020 = require("ajv/dist/2020");
  const addFormats = require("ajv-formats");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const sessionSchema = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../skills/rfc/references/rfc-session.schema.json"))
  );
  const auditSchema = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../skills/rfc/references/rfc-approval.schema.json"))
  );
  const validSession = ajv.compile(sessionSchema);
  const validAudit = ajv.compile(auditSchema);
  assert.equal(validSession(session), true, JSON.stringify(validSession.errors));
  assert.equal(validAudit(audit), true, JSON.stringify(validAudit.errors));
}
