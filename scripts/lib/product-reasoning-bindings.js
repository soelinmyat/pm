"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readProjectInput } = require("./safe-project-output");
const { readApprovedProposal } = require("./proposal-schema");

const MAX_BINDING_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BINDING_TOTAL_BYTES = 64 * 1024 * 1024;

function verifyArtifactBindings(root, bindings, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? MAX_BINDING_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_BINDING_TOTAL_BYTES;
  const budgetState = options.budgetState || { remaining: maxTotalBytes };
  const cache = options.cache || new Map();
  const issues = [];
  let remaining = budgetState.remaining;
  for (const binding of bindings || []) {
    let input = cache.get(binding.path);
    if (!input) {
      if (remaining <= 0) {
        issues.push(`${binding.path}: aggregate binding bytes exceed 64 MiB`);
        break;
      }
      const limit = Math.min(maxFileBytes, remaining);
      try {
        input = readProjectInput(root, binding.path, limit);
      } catch (error) {
        const aggregate = remaining < maxFileBytes && /input exceeds/.test(error.message);
        issues.push(
          `${binding.path}: ${aggregate ? "aggregate binding bytes exceed 64 MiB" : error.message}`
        );
        if (aggregate) break;
        continue;
      }
      remaining -= input.bytes.length;
      budgetState.remaining = remaining;
      cache.set(binding.path, input);
    }
    const observed = `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`;
    if (observed !== binding.sha256)
      issues.push(`${binding.path}: SHA-256 does not match current bytes`);
  }
  return issues;
}

function verifyDecisionBriefBindings(root, brief) {
  const cache = new Map();
  const budgetState = { remaining: MAX_BINDING_TOTAL_BYTES };
  const promoted = brief.promotion?.status === "promoted";
  const targetRef = promoted ? brief.promotion.target_ref : null;
  const exactBindings = promoted
    ? brief.source_artifacts.filter((artifact) => artifact.path !== targetRef)
    : brief.source_artifacts;
  const issues = verifyArtifactBindings(root, exactBindings, { cache, budgetState });
  if (issues.length || !promoted) return issues;
  try {
    if (budgetState.remaining <= 0)
      return [...issues, `${targetRef}: aggregate binding bytes exceed 64 MiB`];
    let verifiedProposal;
    try {
      verifiedProposal = readProjectInput(
        root,
        targetRef,
        Math.min(MAX_BINDING_FILE_BYTES, budgetState.remaining)
      ).bytes;
    } catch (error) {
      const aggregate =
        budgetState.remaining < MAX_BINDING_FILE_BYTES && /input exceeds/.test(error.message);
      issues.push(
        `${targetRef}: ${aggregate ? "aggregate binding bytes exceed 64 MiB" : error.message}`
      );
      return issues;
    }
    budgetState.remaining -= verifiedProposal.length;
    const approved = readApprovedProposal(path.resolve(root, targetRef), {
      projectRoot: root,
      expectedSlug: brief.slug,
      expectedDecision: brief.promotion.approval_decision,
    });
    const targetBinding = brief.source_artifacts.find((artifact) => artifact.path === targetRef);
    if (targetBinding?.sha256 !== approved.approval.proposal_sha256)
      issues.push(`${targetRef}: persisted promotion does not bind the approved proposal revision`);
    const approvalRef = targetRef.replace(/\.json$/, ".approval.json");
    const verifiedApproval = cache.get(approvalRef)?.bytes;
    if (!verifiedProposal.equals(approved.source.bytes))
      issues.push(`${targetRef}: proposal bytes changed during validation`);
    if (!verifiedApproval?.equals(approved.approvalSource.bytes))
      issues.push(`${approvalRef}: approval bytes changed during validation`);
    const decisionPath =
      brief.kind === "think"
        ? `thinking/${brief.slug}.decision.json`
        : `backlog/${brief.slug}.decision.json`;
    if (
      !approved.source.proposal.source.lineage.some(
        (entry) =>
          entry.path === decisionPath && entry.sha256 === brief.promotion.origin_decision_sha256
      )
    )
      issues.push(`${targetRef}: proposal lineage does not bind the promoted origin decision`);
    if (Date.parse(brief.promotion.confirmed_at) < Date.parse(approved.approval.approved_at))
      issues.push(`${targetRef}: promotion confirmation predates approval`);
  } catch (error) {
    issues.push(`${targetRef}: ${error.message}`);
  }
  return issues;
}

module.exports = {
  MAX_BINDING_FILE_BYTES,
  MAX_BINDING_TOTAL_BYTES,
  verifyArtifactBindings,
  verifyDecisionBriefBindings,
};
