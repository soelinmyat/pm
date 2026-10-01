"use strict";

// Additive live authority for PM's existing canonical Dev runtime. It deliberately
// retains the existing local provenance/quality validators and never synthesizes
// approval audits from remote or imported history.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitExec } = require("./lib/git-env");
const { createWorkflowClient } = require("./productmemory-workflow");
const {
  validateSession,
  verifyRfcSidecarIdentity,
  verifyRfcReadinessProvenance,
} = require("./lib/dev-session-schema");
const { readApprovedProposal } = require("./lib/proposal-schema");
const { findGitRoot } = require("./loop-git");
const { createProjectRootAnchor, readProjectInput } = require("./lib/project-file");
const gates = require("./dev-gate-check");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function readCanonical(sessionPath) {
  const bytes = fs.readFileSync(sessionPath);
  if (bytes.length > 4 * 1024 * 1024) throw new Error("Dev session exceeds input budget");
  const session = JSON.parse(bytes);
  // Do not invoke readSession's legacy-upgrade writer on ongoing sessions.
  if (session.schema_version !== 3)
    throw new Error("Upgrade legacy Dev state separately before native binding");
  const issues = validateSession(session);
  if (issues.length) throw new Error(`Invalid canonical Dev state: ${issues[0].message}`);
  if (!session.task.proposal || !session.task.rfc_sidecar) {
    throw new Error(
      "Native binding requires existing canonical proposal/RFC provenance; remote history is not a substitute"
    );
  }
  const proposal = readApprovedProposal(session.task.proposal.path, {
    expectedSlug: session.slug,
    projectRoot: findGitRoot(path.dirname(session.task.proposal.path)),
    requireCurrentPrototypeIdentity: true,
    requireExperienceClassification: true,
  });
  if (
    !proposal.trustedApproval ||
    `sha256:${sha(proposal.source.bytes)}` !== session.task.proposal.approved_proposal_sha256
  )
    throw new Error("Local proposal approval lineage changed");
  verifyRfcSidecarIdentity(
    session.task.rfc_sidecar,
    session.task.design_context,
    session.task.work_units
  );
  verifyRfcReadinessProvenance(session);
  return session;
}

function verifyDelivery(sessionPath, session) {
  const root = session.source.worktree;
  const commit = gates.currentGitCommit(root);
  const manifestPath = path.join(path.dirname(sessionPath), "gates.json");
  const bytes = fs.readFileSync(manifestPath);
  if (bytes.length > 1024 * 1024) throw new Error("Gate manifest exceeds input budget");
  const manifest = JSON.parse(bytes);
  const context = gates.resolveEnforcementContext({
    cwd: root,
    session,
    enforce: true,
    currentCommit: commit,
  });
  const checked = gates.checkGateManifest(manifest, {
    ...context,
    currentCommit: commit,
    manifestPath,
    artifactRoot: root,
    canonicalSession: session,
    runId: session.run_id,
    requireSessionBinding: true,
    reviewEvidenceMode: "enforce",
    requiredAuthorities: [],
    requireDeliveryEvidence: true,
  });
  if (!checked.ok) throw new Error(`Current PM gates failed: ${checked.issues[0].message}`);
  return {
    commit,
    gate_manifest_sha256: sha(bytes),
    gates: manifest.gates.map(({ name, status }) => ({ name, status })),
  };
}

function createNativeDevAuthority({
  transport,
  readCanonicalState = readCanonical,
  verifyCurrentDelivery = verifyDelivery,
  currentCommit = (session) => gates.currentGitCommit(session.source.worktree),
  verifyWorkspace = (session) => {
    const root = session.source.worktree;
    if (findGitRoot(root) !== fs.realpathSync(root)) throw new Error("Canonical worktree changed");
    const branch = gitExec(root, ["branch", "--show-current"]).trim();
    if (branch !== session.source.branch) throw new Error("Canonical branch changed");
    gitExec(root, ["merge-base", "--is-ancestor", session.source.base_commit, "HEAD"]);
  },
}) {
  const client = createWorkflowClient(transport);
  const checkDocuments = (session, workflow) => {
    const entries = workflow.bundle?.entries;
    if (!Array.isArray(entries)) throw new Error("Current feature bundle required");
    const proposalEntry = entries.find((entry) => entry.role === "proposal");
    const rfcEntry = entries.find((entry) => entry.role === "rfc");
    if (!proposalEntry || !rfcEntry) throw new Error("Proposal/RFC bindings required");
    const root = findGitRoot(path.dirname(session.task.proposal.path));
    if (!root) throw new Error("Canonical document Git root required");
    const anchor = createProjectRootAnchor(root);
    let total = 0;
    for (const entry of entries) {
      if (typeof entry.path !== "string" || !entry.path.startsWith("pm/"))
        throw new Error("Shared source path required");
      const { bytes } = readProjectInput(root, entry.path, 128 * 1024 * 1024, {
        projectRootAnchor: anchor,
        requireStablePath: true,
      });
      total += bytes.length;
      if (total > 256 * 1024 * 1024 || sha(bytes) !== entry.content_hash)
        throw new Error("Native bundle document bytes changed");
    }
    if (
      fs.realpathSync(path.resolve(root, proposalEntry.path)) !==
        fs.realpathSync(session.task.proposal.path) ||
      fs.realpathSync(path.resolve(root, rfcEntry.path)) !==
        fs.realpathSync(session.task.rfc_sidecar.path)
    ) {
      throw new Error("Native bundle differs from local canonical proposal/RFC identity");
    }
  };
  const checkReceipt = (receipt, workflow, session) => {
    if (
      receipt?.schema_version !== 1 ||
      receipt.kind !== "pm-native-dev-binding" ||
      receipt.service_url !== client.identity.service_url ||
      receipt.project !== client.identity.project ||
      receipt.local_run_id !== session.run_id ||
      receipt.record_id !== workflow.record_id ||
      receipt.repository !== session.source.repo_root ||
      receipt.branch !== session.source.branch ||
      receipt.base_commit !== session.source.base_commit ||
      workflow.revision !== receipt.workflow_revision ||
      workflow.status !== "in-progress" ||
      workflow.bundle?.current !== true ||
      workflow.bundle.id !== receipt.bundle_id ||
      workflow.bundle.digest !== receipt.bundle_digest ||
      workflow.bundle.review?.id !== receipt.review_id ||
      workflow.bundle.review.decision !== "approved" ||
      workflow.owner_id !== receipt.owner_id
    )
      throw new Error("Native execution authority changed; stop and reconcile explicitly");
    const remoteSession = workflow.sessions?.find((item) => item.id === receipt.remote_session_id);
    if (
      !remoteSession ||
      remoteSession.state !== "running" ||
      remoteSession.revision !== receipt.remote_session_revision ||
      remoteSession.feature_bundle_id !== receipt.bundle_id ||
      remoteSession.feature_bundle_review_id !== receipt.review_id ||
      remoteSession.owner_id !== receipt.owner_id ||
      remoteSession.repository !== receipt.repository ||
      remoteSession.branch !== receipt.branch ||
      remoteSession.base_commit !== receipt.base_commit
    ) {
      throw new Error("Native session state or approval lineage changed");
    }
    return remoteSession;
  };

  const assertCurrent = async (sessionPath, receipt, phase) => {
    const local = readCanonicalState(sessionPath);
    verifyWorkspace(local);
    if (phase && local.phase !== phase)
      throw new Error("Run only the canonical Dev runtime's current phase");
    const workflow = await client.get(receipt.record_id);
    const remoteSession = checkReceipt(receipt, workflow, local);
    checkDocuments(local, workflow);
    return { local, workflow, remoteSession };
  };

  return Object.freeze({
    async bind(sessionPath, recordId) {
      const local = readCanonicalState(sessionPath);
      verifyWorkspace(local);
      const workflow = await client.get(recordId);
      checkDocuments(local, workflow);
      const result = await client.start(workflow, {
        repository: local.source.repo_root,
        branch: local.source.branch,
        base_commit: local.source.base_commit,
      });
      return Object.freeze({
        schema_version: 1,
        kind: "pm-native-dev-binding",
        ...client.identity,
        local_run_id: local.run_id,
        record_id: recordId,
        workflow_revision: result.workflow.revision,
        bundle_id: result.authority.bundle_id,
        bundle_digest: result.authority.bundle_digest,
        review_id: result.authority.review_id,
        owner_id: result.authority.owner_id,
        remote_session_id: result.session.id,
        remote_session_revision: result.session.revision,
        repository: local.source.repo_root,
        branch: local.source.branch,
        base_commit: local.source.base_commit,
      });
    },
    assertCurrent,
    async certify(sessionPath, receipt) {
      const observed = await assertCurrent(sessionPath, receipt);
      const proof = verifyCurrentDelivery(sessionPath, observed.local);
      if (!/^[a-f0-9]{40}$/.test(proof.commit)) throw new Error("Current verified commit required");
      // Recheck live state and canonical sources after potentially long gate checks.
      const final = await assertCurrent(sessionPath, receipt);
      if (JSON.stringify(final.local) !== JSON.stringify(observed.local))
        throw new Error("Local Dev state changed during certification");
      if (currentCommit(final.local) !== proof.commit)
        throw new Error("Worktree HEAD changed during certification");
      return client.report(final.workflow, final.remoteSession, {
        state: "verified",
        result_commit: proof.commit,
        verification: JSON.stringify({
          kind: "pm-canonical-gate-verification",
          local_run_id: receipt.local_run_id,
          bundle_digest: receipt.bundle_digest,
          ...proof,
        }),
      });
    },
  });
}

module.exports = { createNativeDevAuthority, verifyDelivery };
