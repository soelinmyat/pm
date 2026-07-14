#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readProjectInput } = require("./lib/safe-project-output");
const { readBoundedJsonFile } = require("./lib/safe-json-file");
const { writeProjectJsonAtomic } = require("./lib/project-atomic-write");
const { readApprovedProposal } = require("./lib/proposal-schema");
const { verifyArtifactBindings } = require("./lib/product-reasoning-bindings");
const {
  decisionId,
  featureId,
  featureSourceSnapshot,
  promoteDecisionBrief,
  rankIdeaBriefs,
  reconcileFeatureInventory,
  validateDecisionBrief,
  validateFeatureSourceRefs,
  validateFeatureInventory,
} = require("./lib/product-reasoning-schema");

function main(argv = process.argv.slice(2)) {
  try {
    const [command, ...rest] = argv;
    const args = parse(rest);
    let result;
    if (command === "decision-id")
      result = { decision_id: decisionId(required(args, "kind"), required(args, "slug")) };
    else if (command === "feature-id")
      result = { feature_id: featureId(required(args, "project"), required(args, "key")) };
    else if (command === "validate") {
      const root = path.resolve(required(args, "root"));
      const inputPath = path.resolve(required(args, "input"));
      const inputRelative = path.relative(root, inputPath).split(path.sep).join("/");
      const value = JSON.parse(
        readProjectInput(root, inputRelative, 4 * 1024 * 1024).bytes.toString("utf8")
      );
      let issues;
      if (value.document_type === "decision-brief") {
        issues = validateDecisionBrief(value);
        if (issues.length === 0)
          issues.push(...verifyArtifactBindings(root, value.source_artifacts));
      } else if (value.document_type === "feature-inventory") {
        issues = validateFeatureInventory(value);
        if (issues.length === 0) {
          issues.push(...verifyArtifactBindings(root, [value.markdown_binding]));
          issues.push(
            ...validateFeatureSourceRefs(value, path.resolve(required(args, "source_root")))
          );
        }
      } else throw new Error("input document_type must be decision-brief or feature-inventory");
      result = { ok: issues.length === 0, issues };
      if (issues.length) process.exitCode = 2;
    } else if (command === "rank-ideas") {
      const request = readBoundedJsonFile(required(args, "request"));
      result = { rankings: rankIdeaBriefs(request.ideas || [], request.strategy || null) };
    } else if (command === "reconcile-features") {
      const request = readBoundedJsonFile(required(args, "request"));
      result = reconcileFeatureInventory(request.previous || null, request.proposed);
      if (result.ambiguous.length) process.exitCode = 3;
    } else if (command === "feature-snapshot") {
      const request = readBoundedJsonFile(required(args, "request"));
      if (
        !request ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        Object.keys(request).some((field) => field !== "source_refs")
      )
        throw new Error("feature snapshot request must contain only source_refs");
      result = featureSourceSnapshot(
        path.resolve(required(args, "source_root")),
        request.source_refs
      );
    } else if (command === "promote") {
      const root = path.resolve(required(args, "root"));
      const request = readBoundedJsonFile(required(args, "request"));
      result = promote(root, request);
    } else
      throw new Error(
        "command must be decision-id, feature-id, validate, rank-ideas, reconcile-features, feature-snapshot, or promote"
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

function promote(root, request, options = {}) {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("promotion request must be an object");
  const fields = new Set([
    "decision_path",
    "target_ref",
    "confirmed_at",
    "binding_paths",
    "approval_decision",
  ]);
  for (const field of Object.keys(request))
    if (!fields.has(field)) throw new Error(`promotion request field ${field} is unknown`);
  for (const field of ["decision_path", "target_ref", "confirmed_at"])
    if (typeof request[field] !== "string" || !request[field])
      throw new Error(`promotion request ${field} is required`);
  if (!Array.isArray(request.binding_paths) || request.binding_paths.length === 0)
    throw new Error("promotion request binding_paths must be non-empty");
  if (request.binding_paths.length > 16)
    throw new Error("promotion request binding_paths cannot exceed 16 entries");
  if (new Set(request.binding_paths).size !== request.binding_paths.length)
    throw new Error("promotion request binding_paths must be unique");
  if (!request.binding_paths.includes(request.target_ref))
    throw new Error("promotion target_ref must also be a binding path");
  const approvalRef = request.target_ref.replace(/\.json$/, ".approval.json");
  if (approvalRef === request.target_ref || !request.binding_paths.includes(approvalRef))
    throw new Error("promotion binding_paths must include the sibling approval audit");
  if (
    !request.approval_decision ||
    typeof request.approval_decision !== "object" ||
    Array.isArray(request.approval_decision) ||
    Object.keys(request.approval_decision).some((field) => !["id", "sha256"].includes(field)) ||
    typeof request.approval_decision.id !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(request.approval_decision.sha256 || "")
  )
    throw new Error("promotion request approval_decision must bind id and sha256");

  const decisionInput = readProjectInput(root, request.decision_path, 4 * 1024 * 1024);
  const brief = JSON.parse(decisionInput.bytes.toString("utf8"));
  const canonical = canonicalOriginPaths(brief);
  if (request.decision_path !== canonical.decision)
    throw new Error(`promotion decision_path must equal ${canonical.decision}`);
  if (!request.binding_paths.includes(canonical.markdown))
    throw new Error(`promotion binding_paths must include canonical origin ${canonical.markdown}`);
  const canonicalTarget = `backlog/proposals/${brief.slug}.json`;
  if (request.target_ref !== canonicalTarget)
    throw new Error(`promotion target_ref must equal ${canonicalTarget}`);
  const approved = readApprovedProposal(path.resolve(root, request.target_ref), {
    projectRoot: root,
    expectedSlug: brief.slug,
    expectedDecision: request.approval_decision,
  });
  if (!approved.exactBytesCurrent || approved.source.proposal.lifecycle !== "approved")
    throw new Error("promotion requires the exact current approved proposal bytes");
  const originSha256 = sha256(decisionInput.bytes);
  if (
    !approved.source.proposal.source.lineage.some(
      (entry) => entry.path === decisionInput.relative && entry.sha256 === originSha256
    )
  )
    throw new Error("approved proposal source lineage must bind the exact origin decision bytes");
  const captured = new Map([
    [request.target_ref, approved.source.bytes],
    [approvalRef, approved.approvalSource.bytes],
  ]);
  let aggregateBytes = 0;
  const sourceArtifacts = request.binding_paths.map((bindingPath) => {
    const bytes = captured.get(bindingPath);
    const remaining = 64 * 1024 * 1024 - aggregateBytes;
    if (remaining <= 0) throw new Error("promotion bindings exceed the 64 MiB aggregate budget");
    let input;
    try {
      input = bytes
        ? { relative: bindingPath, bytes }
        : readProjectInput(root, bindingPath, Math.min(16 * 1024 * 1024, remaining));
    } catch (error) {
      if (remaining < 16 * 1024 * 1024 && /input exceeds/.test(error.message))
        throw new Error("promotion bindings exceed the 64 MiB aggregate budget");
      throw error;
    }
    captured.set(bindingPath, input.bytes);
    aggregateBytes += input.bytes.length;
    if (aggregateBytes > 64 * 1024 * 1024)
      throw new Error("promotion bindings exceed the 64 MiB aggregate budget");
    return {
      path: input.relative,
      sha256: `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`,
    };
  });
  const confirmedAt = Date.parse(request.confirmed_at);
  const chronologyFloor = Math.max(
    Date.parse(brief.updated_at),
    Date.parse(approved.approval.approved_at)
  );
  if (!Number.isFinite(confirmedAt) || confirmedAt < chronologyFloor)
    throw new Error("promotion confirmed_at cannot precede origin update or Groom approval");
  const promoted = promoteDecisionBrief(
    brief,
    request.target_ref,
    sourceArtifacts,
    request.confirmed_at
  );
  writeProjectJsonAtomic(root, request.decision_path, promoted, {
    maxBytes: 4 * 1024 * 1024,
    beforeSpawn() {
      if (typeof options.beforeReattest === "function") options.beforeReattest();
    },
    attestations: [
      ...sourceArtifacts.map((artifact) => ({
        path: artifact.path,
        sha256: artifact.sha256,
        maxBytes: 16 * 1024 * 1024,
      })),
    ],
    finalAttestation: {
      path: decisionInput.relative,
      sha256: originSha256,
      maxBytes: 4 * 1024 * 1024,
    },
  });
  return {
    promoted: true,
    decision_path: decisionInput.relative,
    target_ref: request.target_ref,
    bindings: sourceArtifacts,
  };
}

function canonicalOriginPaths(brief) {
  if (brief.kind === "think")
    return {
      decision: `thinking/${brief.slug}.decision.json`,
      markdown: `thinking/${brief.slug}.md`,
    };
  if (brief.kind === "idea")
    return {
      decision: `backlog/${brief.slug}.decision.json`,
      markdown: `backlog/${brief.slug}.md`,
    };
  throw new Error("only Think and Ideate decision briefs can be promoted to Groom");
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--") || argv[i + 1] === undefined)
      throw new Error(`invalid argument ${flag || ""}`);
    out[flag.slice(2).replaceAll("-", "_")] = argv[i + 1];
  }
  return out;
}
function required(args, key) {
  if (!args[key]) throw new Error(`--${key.replaceAll("_", "-")} is required`);
  return args[key];
}
if (require.main === module) main();
module.exports = { main, promote };
