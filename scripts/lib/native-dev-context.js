"use strict";
// An in-memory, live-checked scope. Persisted migration receipts never open it.
const scopes = new Map();
const identity = (session) => JSON.stringify(session.task.native);
function assertLive(session) {
  if (!session.task?.native) return;
  if (scopes.get(session.run_id) !== identity(session))
    throw new Error(
      "Native Dev requires a live authorized host; persisted history is not authority"
    );
}
async function inLiveScope(session, transport, operation) {
  if (scopes.has(session.run_id)) throw new Error("Native run is already executing locally");
  scopes.set(session.run_id, null); // Reserve before the first await.
  try {
    const current = await verifyCurrent(session, transport);
    scopes.set(session.run_id, identity(session));
    return await operation(current);
  } finally {
    scopes.delete(session.run_id);
  }
}
function validateNative(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Native provenance required");
  const fields = [
    "kind",
    "service_url",
    "project",
    "record_id",
    "workflow_id",
    "workflow_revision",
    "bundle_id",
    "bundle_digest",
    "review_id",
    "reviewer",
    "owner_id",
    "remote_session_id",
    "remote_session_revision",
    "snapshot_root",
    "entries",
    "execution_path",
    "remote_session_state",
    "certification",
  ];
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !(key in value))
  )
    throw new Error("Closed native provenance schema required");
  if (value.kind !== "productmemory-native-dev-v1")
    throw new Error("Unsupported native authority kind");
  const url = new URL(value.service_url);
  if (url.protocol !== "https:" || url.origin !== value.service_url || url.username || url.password)
    throw new Error("Native service origin required");
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.project) ||
    !/^bkl_[A-Za-z0-9]+$/.test(value.record_id) ||
    !/^[a-f0-9]{64}$/.test(value.bundle_digest)
  )
    throw new Error("Invalid native project/bundle identity");
  for (const key of [
    "workflow_id",
    "workflow_revision",
    "bundle_id",
    "review_id",
    "owner_id",
    "remote_session_id",
    "remote_session_revision",
  ])
    if (!Number.isSafeInteger(value[key]) || value[key] < 1)
      throw new Error(`Invalid native ${key}`);
  if (
    typeof value.reviewer !== "string" ||
    !value.reviewer.trim() ||
    !require("node:path").isAbsolute(value.snapshot_root)
  )
    throw new Error("Named reviewer and private snapshot required");
  if (!["running", "verified"].includes(value.remote_session_state))
    throw new Error("Invalid native session state");
  if (value.remote_session_state === "running" && value.certification !== null)
    throw new Error("Running native session cannot claim certification");
  if (
    value.remote_session_state === "verified" &&
    (!value.certification ||
      Object.keys(value.certification).length !== 3 ||
      Object.keys(value.certification).some(
        (key) => !["commit", "gate_manifest_sha256", "verification"].includes(key)
      ) ||
      !/^[a-f0-9]{40}$/.test(value.certification.commit) ||
      !/^[a-f0-9]{64}$/.test(value.certification.gate_manifest_sha256) ||
      typeof value.certification.verification !== "string")
  )
    throw new Error("Bound native certification receipt required");
  if (!Array.isArray(value.entries) || value.entries.length < 3 || value.entries.length > 100)
    throw new Error("Complete native bundle required");
}
async function verifyCurrent(session, transport) {
  const { createWorkflowClient } = require("../productmemory-workflow");
  const { validateEntries, validateTaskContract } = require("./native-dev-contract");
  const { gitExec } = require("./git-env");
  const fs = require("node:fs");
  const path = require("node:path");
  const native = session.task.native;
  validateNative(native);
  validateEntries(native.entries);
  const client = createWorkflowClient(transport);
  if (
    client.identity.service_url !== native.service_url ||
    client.identity.project !== native.project
  )
    throw new Error("Native transport identity changed");
  const root = fs.realpathSync(session.source.worktree);
  const snapshot = fs.realpathSync(native.snapshot_root);
  if (
    snapshot !== native.snapshot_root ||
    !snapshot.startsWith(path.join(root, ".pm", "productmemory") + path.sep) ||
    gitExec(root, ["rev-parse", "--show-toplevel"]).trim() !== root ||
    gitExec(root, ["branch", "--show-current"]).trim() !== session.source.branch
  )
    throw new Error("Native local worktree/snapshot identity changed");
  gitExec(root, ["merge-base", "--is-ancestor", session.source.base_commit, "HEAD"]);
  const observed = await client.get(native.record_id);
  if (
    observed.id !== native.workflow_id ||
    observed.revision !== native.workflow_revision ||
    observed.status !== "in-progress" ||
    observed.owner_id !== native.owner_id ||
    observed.bundle?.current !== true ||
    observed.bundle.id !== native.bundle_id ||
    observed.bundle.digest !== native.bundle_digest ||
    observed.bundle.review?.id !== native.review_id ||
    observed.bundle.review.decision !== "approved" ||
    observed.bundle.review.user !== native.reviewer ||
    JSON.stringify(observed.bundle.entries) !== JSON.stringify(native.entries)
  )
    throw new Error("Native current approval, scope, owner or bundle changed");
  const remote = observed.sessions?.find((item) => item.id === native.remote_session_id);
  if (
    !remote ||
    remote.state !== native.remote_session_state ||
    remote.revision !== native.remote_session_revision ||
    remote.feature_bundle_id !== native.bundle_id ||
    remote.feature_bundle_review_id !== native.review_id ||
    remote.owner_id !== native.owner_id ||
    remote.repository !== session.source.repo_root ||
    remote.branch !== session.source.branch ||
    remote.base_commit !== session.source.base_commit
  )
    throw new Error("Native execution session changed");
  if (native.remote_session_state === "verified") {
    if (
      remote.result_commit !== native.certification.commit ||
      remote.verification !== native.certification.verification ||
      gitExec(root, ["rev-parse", "HEAD"]).trim() !== native.certification.commit
    )
      throw new Error("Native certification commit/evidence changed");
    const { verifyDelivery } = require("../productmemory-dev-authority");
    const proof = verifyDelivery(
      path.join(root, ".pm", "dev-sessions", session.slug, "session.json"),
      session
    );
    if (proof.gate_manifest_sha256 !== native.certification.gate_manifest_sha256)
      throw new Error("Native certification gate evidence changed");
  }
  const visited = new Set([native.record_id]);
  const validated = new Set();
  let requests = 0;
  async function dependency(id) {
    if (validated.has(id)) return;
    if (visited.has(id) || ++requests > 100)
      throw new Error("Invalid or excessive native dependency graph");
    visited.add(id);
    const item = await client.get(id);
    const latest = item.sessions?.[0];
    if (
      item.status !== "done" ||
      !item.owner_id ||
      item.bundle?.current !== true ||
      item.bundle.review?.decision !== "approved" ||
      latest?.state !== "verified" ||
      latest.feature_bundle_id !== item.bundle.id ||
      latest.feature_bundle_review_id !== item.bundle.review.id ||
      latest.owner_id !== item.owner_id
    )
      throw new Error("Native dependency no longer accepted");
    for (const child of item.dependencies) await dependency(child);
    visited.delete(id);
    validated.add(id);
  }
  for (const id of observed.dependencies) await dependency(id);
  const checked = validateTaskContract(session);
  return { client, observed, remote, checked };
}
module.exports = { assertLive, inLiveScope, validateNative, verifyCurrent };
