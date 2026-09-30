"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isRfc3339DateTime } = require("./iso-time.js");
const { stableStringify } = require("./workflow-runtime/records.js");
const { MAX_LINEAGE_HOPS, assertOwnsOnlyAmendment } = require("./rfc-amendment.js");
const {
  approvalAuditRecord,
  readCommittedApprovalAudit,
  readCommittedSidecar,
  validateSession: validateRfcSession,
} = require("./rfc-session-schema.js");

const V1_FIELDS = [
  "schema_version",
  "run_id",
  "slug",
  "status",
  "approved_by",
  "approved_at",
  "html_sha256",
  "sidecar_sha256",
  "approval_transition_sha256",
];
const V2_FIELDS = [...V1_FIELDS, "amends", "amended_issue_nums", "reason"];

// Proves that the sidecar beside its approval audit is exactly what a human
// approved in a completed RFC run archived under archiveRepoRoot. For an
// amendment (v2), also walks the owns-only lineage; with lineageTo it must
// reach that earlier sidecar hash.
function verifyRfcApproval({ sidecarPath, slug, archiveRepoRoot, lineageTo = null }) {
  const resolvedSidecar = path.resolve(sidecarPath);
  const htmlPath = resolvedSidecar.replace(/\.json$/i, ".html");
  const approvalPath = resolvedSidecar.replace(/\.json$/i, ".approval.json");
  if (htmlPath === resolvedSidecar) {
    throw new Error("RFC approval audit must sit beside an RFC JSON sidecar");
  }
  const sidecarBytes = fs.readFileSync(resolvedSidecar);
  const htmlBytes = fs.readFileSync(htmlPath);
  const approvalBytes = fs.readFileSync(approvalPath);
  let approval;
  try {
    approval = JSON.parse(approvalBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`RFC approval audit is malformed: ${error.message}`);
  }
  if (
    !hasApprovalShape(approval, slug) ||
    approval.html_sha256 !== sha256(htmlBytes) ||
    approval.sidecar_sha256 !== sha256(sidecarBytes)
  ) {
    throw new Error("RFC approval audit is not a valid human approval of the exact artifacts");
  }
  const artifactRepoRoot = findContainingGitRoot(resolvedSidecar);
  if (!artifactRepoRoot) throw new Error("RFC artifact is not inside a Git repository");
  const archived = readCompletedRun(archiveRepoRoot, slug, approval.run_id);
  if (
    !backsApproval(archived, slug, approval) ||
    fs.realpathSync(archived.artifact?.repo_root || "") !== artifactRepoRoot ||
    fs.realpathSync(archived.context?.artifact_repo_root || "") !== artifactRepoRoot
  ) {
    throw new Error("RFC approval audit is not backed by its completed RFC run");
  }
  let committed;
  try {
    committed = readCommittedApprovalAudit(archived);
  } catch (error) {
    throw new Error(`RFC approval audit is not tracked with its completed run: ${error.message}`);
  }
  if (committed.sha256 !== sha256(approvalBytes)) {
    throw new Error("RFC approval audit on disk differs from the committed approval audit");
  }
  const lineage = walkLineage({ archived, approval, archiveRepoRoot, slug, lineageTo });
  return {
    approval,
    approval_sha256: committed.sha256,
    archived,
    artifact_repo_root: artifactRepoRoot,
    sidecar_sha256: approval.sidecar_sha256,
    lineage,
  };
}

function walkLineage({ archived, approval, archiveRepoRoot, slug, lineageTo }) {
  const lineage = [{ run_id: archived.run_id, sidecar_sha256: approval.sidecar_sha256 }];
  if (lineageTo && approval.sidecar_sha256 === lineageTo) return lineage;
  const visited = new Set([archived.run_id]);
  let current = archived;
  let audit = approval;
  while (audit.schema_version === 2) {
    if (lineage.length > MAX_LINEAGE_HOPS) {
      throw new Error(`RFC approval lineage exceeds ${MAX_LINEAGE_HOPS} amendments`);
    }
    const priorRunId = audit.amends.run_id;
    if (visited.has(priorRunId)) {
      throw new Error(`RFC approval lineage repeats run ${priorRunId}`);
    }
    visited.add(priorRunId);
    const prior = readCompletedRun(archiveRepoRoot, slug, priorRunId);
    if (prior.status !== "complete" || validateRfcSession(prior).length > 0) {
      throw new Error(`RFC approval lineage run ${priorRunId} is not a valid completed run`);
    }
    let priorAudit;
    try {
      priorAudit = readCommittedApprovalAudit(prior);
    } catch (error) {
      throw new Error(
        `RFC approval lineage run ${priorRunId} has no valid audit: ${error.message}`
      );
    }
    if (
      priorAudit.sha256 !== audit.amends.approval_sha256 ||
      prior.artifact.sidecar_hash !== audit.amends.sidecar_sha256 ||
      prior.artifact.html_hash !== audit.amends.html_sha256
    ) {
      throw new Error(
        `RFC approval lineage is broken: ${current.run_id} does not amend the approval of ${priorRunId}`
      );
    }
    try {
      assertOwnsOnlyAmendment(
        readCommittedSidecar(prior.artifact),
        readCommittedSidecar(current.artifact),
        audit.amended_issue_nums
      );
    } catch (error) {
      throw new Error(
        `RFC approval lineage step ${priorRunId} -> ${current.run_id} is not owns-only: ${error.message}`
      );
    }
    lineage.push({ run_id: prior.run_id, sidecar_sha256: prior.artifact.sidecar_hash });
    if (lineageTo && prior.artifact.sidecar_hash === lineageTo) return lineage;
    current = prior;
    audit = priorAudit.audit;
  }
  if (lineageTo) {
    throw new Error(
      `RFC approval lineage does not descend from the bound sidecar ${lineageTo}; amend the RFC run Dev is bound to`
    );
  }
  return lineage;
}

function hasApprovalShape(approval, slug) {
  if (!isObject(approval)) return false;
  const fields = approval.schema_version === 2 ? V2_FIELDS : V1_FIELDS;
  if (![1, 2].includes(approval.schema_version)) return false;
  if (Object.keys(approval).some((field) => !fields.includes(field))) return false;
  if (fields.some((field) => !Object.hasOwn(approval, field))) return false;
  return (
    typeof approval.run_id === "string" &&
    /^rfc_[A-Za-z0-9_-]+$/.test(approval.run_id) &&
    approval.slug === slug &&
    approval.status === "approved" &&
    typeof approval.approved_by === "string" &&
    approval.approved_by.trim() !== "" &&
    isRfc3339DateTime(approval.approved_at)
  );
}

function backsApproval(archived, slug, approval) {
  return (
    archived.status === "complete" &&
    archived.slug === slug &&
    archived.run_id === approval.run_id &&
    validateRfcSession(archived).length === 0 &&
    isObject(archived.artifact) &&
    stableStringify(approval) === stableStringify(approvalAuditRecord(archived, archived.artifact))
  );
}

function readCompletedRun(archiveRepoRoot, slug, runId) {
  const archivePath = path.join(
    archiveRepoRoot,
    ".pm",
    "rfc-sessions",
    "completed",
    slug,
    runId,
    "session.json"
  );
  if (!fs.existsSync(archivePath)) {
    throw new Error(`RFC approval audit ${runId} has no matching completed RFC run`);
  }
  return JSON.parse(fs.readFileSync(archivePath, "utf8"));
}

function findContainingGitRoot(filePath) {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return fs.realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = { MAX_LINEAGE_HOPS, findContainingGitRoot, verifyRfcApproval };
