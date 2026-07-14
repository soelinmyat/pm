"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { parseFrontmatter } = require("../kb-frontmatter");
const { readProjectInput } = require("./safe-project-output");
const { readApprovedProposal } = require("./proposal-schema");

const MAX_BINDING_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BINDING_TOTAL_BYTES = 64 * 1024 * 1024;

function lineagePathMatches(observed, expected) {
  if (typeof observed !== "string" || typeof expected !== "string") return false;
  const normalizedObserved = observed.replaceAll("\\", "/");
  const normalizedExpected = expected.replaceAll("\\", "/");
  return (
    normalizedObserved === normalizedExpected ||
    normalizedObserved.endsWith(`/${normalizedExpected}`)
  );
}

function verifyArtifactBindings(root, bindings, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? MAX_BINDING_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? MAX_BINDING_TOTAL_BYTES;
  const budgetState = options.budgetState || { remaining: maxTotalBytes };
  const cache = options.cache || new Map();
  const issues = [];
  let remaining = budgetState.remaining;
  for (const binding of bindings || []) {
    let input = cache.get(binding.path);
    if (input && input.bytes.length > maxFileBytes) {
      issues.push(`${binding.path}: input exceeds ${maxFileBytes} bytes`);
      continue;
    }
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

function verifyDecisionBriefBindings(root, brief, options = {}) {
  const cache = options.cache || new Map();
  const budgetState = options.budgetState || { remaining: MAX_BINDING_TOTAL_BYTES };
  const promoted = brief.promotion?.status === "promoted";
  const targetRef = promoted ? brief.promotion.target_ref : null;
  const exactBindings = promoted
    ? brief.source_artifacts.filter((artifact) => artifact.path !== targetRef)
    : brief.source_artifacts;
  const issues = verifyArtifactBindings(root, exactBindings, { cache, budgetState });
  if (!issues.length) issues.push(...verifyCanonicalReaderMarker(brief, cache));
  if (issues.length || !promoted) return issues;
  try {
    let verifiedProposal = cache.get(targetRef)?.bytes;
    if (!verifiedProposal && budgetState.remaining <= 0)
      return [...issues, `${targetRef}: aggregate binding bytes exceed 64 MiB`];
    try {
      if (!verifiedProposal) {
        const input = readProjectInput(
          root,
          targetRef,
          Math.min(MAX_BINDING_FILE_BYTES, budgetState.remaining)
        );
        verifiedProposal = input.bytes;
        cache.set(targetRef, input);
        budgetState.remaining -= verifiedProposal.length;
      }
    } catch (error) {
      const aggregate =
        budgetState.remaining < MAX_BINDING_FILE_BYTES && /input exceeds/.test(error.message);
      issues.push(
        `${targetRef}: ${aggregate ? "aggregate binding bytes exceed 64 MiB" : error.message}`
      );
      return issues;
    }
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
          lineagePathMatches(entry.path, decisionPath) &&
          entry.sha256 === brief.promotion.origin_decision_sha256
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

function canonicalReaderPaths(brief) {
  if (brief.kind === "think")
    return {
      markdown: `thinking/${brief.slug}.md`,
      decision: `thinking/${brief.slug}.decision.json`,
    };
  if (brief.kind === "idea")
    return {
      markdown: `backlog/${brief.slug}.md`,
      decision: `backlog/${brief.slug}.decision.json`,
    };
  if (brief.kind === "strategy")
    return { markdown: "strategy.md", decision: "strategy.decision.json" };
  return null;
}

function verifyCanonicalReaderMarker(brief, cache) {
  const canonical = canonicalReaderPaths(brief);
  if (!canonical) return [];
  const source = cache.get(canonical.markdown);
  if (!source) return [`${canonical.markdown}: canonical reader bytes were not authenticated`];
  let parsed;
  try {
    parsed = parseFrontmatter(source.bytes.toString("utf8"));
  } catch (error) {
    return [`${canonical.markdown}: invalid canonical reader frontmatter: ${error.message}`];
  }
  if (!parsed.hasFrontmatter)
    return [`${canonical.markdown}: companion requires v2 canonical reader frontmatter`];
  const issues = [];
  if (String(parsed.data.reasoning_version) !== "2")
    issues.push(`${canonical.markdown}: reasoning_version must equal 2`);
  if (parsed.data.decision_brief !== canonical.decision)
    issues.push(`${canonical.markdown}: decision_brief must equal ${canonical.decision}`);
  if (brief.promotion?.status === "promoted") {
    if (brief.kind === "think") {
      if (parsed.data.status !== "promoted")
        issues.push(`${canonical.markdown}: promoted Think status must equal promoted`);
      if (parsed.data.promoted_to !== brief.slug)
        issues.push(`${canonical.markdown}: promoted_to must equal ${brief.slug}`);
    } else if (
      brief.kind === "idea" &&
      !new Set(["proposed", "planned", "in-progress", "done"]).has(parsed.data.status)
    ) {
      issues.push(`${canonical.markdown}: promoted Ideate status is not a downstream lifecycle`);
    }
  }
  return issues;
}

module.exports = {
  MAX_BINDING_FILE_BYTES,
  MAX_BINDING_TOTAL_BYTES,
  canonicalReaderPaths,
  lineagePathMatches,
  verifyArtifactBindings,
  verifyCanonicalReaderMarker,
  verifyDecisionBriefBindings,
};
