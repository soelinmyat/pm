"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readProjectInput } = require("./safe-project-output");

const DECISION_KINDS = new Set(["think", "idea", "strategy"]);
const DECISION_STATUSES = new Set(["exploring", "confirmed", "parked"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const TRIGGER_LANES = new Set(["research", "groom", "ideate", "features", "strategy", "none"]);
const PROMOTION_STATUSES = new Set(["not-offered", "offered", "promoted"]);
const EVIDENCE_STRENGTH = Object.freeze({ hypothesis: 0, moderate: 1, strong: 2 });
const STRATEGIC_ALIGNMENT = Object.freeze({ weak: 0, partial: 1, strong: 2 });
const COMPETITOR_GAP = Object.freeze({ parity: 0, partial: 1, unique: 2 });
const SCOPE_EFFICIENCY = Object.freeze({ large: 0, medium: 1, small: 2 });
const MAX_BINDINGS = 16;
const MAX_SOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_SNAPSHOT_BYTES = 64 * 1024 * 1024;

function stableId(prefix, ...parts) {
  const canonical = parts.map((part) => normalizeToken(part)).join("\0");
  return `${prefix}-${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 20)}`;
}

function decisionId(kind, slug) {
  return stableId("dec", kind, slug);
}

function featureId(sourceProject, key) {
  return stableId("feat", sourceProject, key);
}

function validateDecisionBrief(value) {
  const issues = [];
  if (!record(value)) return ["decision brief must be an object"];
  closed(
    value,
    [
      "schema_version",
      "document_type",
      "decision_id",
      "kind",
      "slug",
      "title",
      "problem",
      "evidence_refs",
      "alternatives",
      "decision",
      "confidence",
      "non_goals",
      "next_trigger",
      "promotion",
      "source_artifacts",
      "strategy_context",
      "alignment",
      "created_at",
      "updated_at",
    ],
    "decision",
    issues
  );
  equal(value.schema_version, 1, "decision.schema_version", issues);
  equal(value.document_type, "decision-brief", "decision.document_type", issues);
  if (!DECISION_KINDS.has(value.kind)) issues.push("decision.kind is invalid");
  slug(value.slug, "decision.slug", issues);
  if (value.kind && value.slug && value.decision_id !== decisionId(value.kind, value.slug)) {
    issues.push("decision.decision_id does not match stable identity");
  }
  text(value.title, "decision.title", issues);
  text(value.problem, "decision.problem", issues);
  array(value.evidence_refs, "decision.evidence_refs", issues, (entry, at) => {
    if (!record(entry)) return issues.push(`${at} must be an object`);
    closed(entry, ["ref", "evidence_id", "note"], at, issues);
    evidenceRef(entry.ref, `${at}.ref`, issues);
    if (
      entry.evidence_id !== null &&
      entry.evidence_id !== undefined &&
      !/^ev-[a-f0-9]{20}$/.test(entry.evidence_id)
    )
      issues.push(`${at}.evidence_id is invalid`);
    text(entry.note, `${at}.note`, issues);
  });
  const alternativeIds = new Set();
  const alternativeContent = new Set();
  array(value.alternatives, "decision.alternatives", issues, (entry, at) => {
    if (!record(entry)) return issues.push(`${at} must be an object`);
    closed(entry, ["id", "title", "tradeoff"], at, issues);
    slug(entry.id, `${at}.id`, issues);
    if (alternativeIds.has(entry.id)) issues.push(`${at}.id is duplicated`);
    alternativeIds.add(entry.id);
    text(entry.title, `${at}.title`, issues);
    text(entry.tradeoff, `${at}.tradeoff`, issues);
    const signature = `${normalizeProse(entry.title)}\0${normalizeProse(entry.tradeoff)}`;
    if (alternativeContent.has(signature)) issues.push(`${at} duplicates another alternative`);
    alternativeContent.add(signature);
  });
  validateDecision(value.decision, value.alternatives, issues);
  validateConfidence(value.confidence, issues);
  stringArray(value.non_goals, "decision.non_goals", issues, { unique: true });
  validateTrigger(value.next_trigger, issues);
  validatePromotion(value.promotion, value.source_artifacts, issues);
  const artifactPaths = new Set();
  array(
    value.source_artifacts,
    "decision.source_artifacts",
    issues,
    (entry, at) => {
      if (!record(entry)) return issues.push(`${at} must be an object`);
      closed(entry, ["path", "sha256"], at, issues);
      kbPath(entry.path, `${at}.path`, issues);
      if (artifactPaths.has(entry.path)) issues.push(`${at}.path is duplicated`);
      artifactPaths.add(entry.path);
      if (!/^sha256:[a-f0-9]{64}$/.test(entry.sha256 || "")) issues.push(`${at}.sha256 is invalid`);
    },
    { nonEmpty: true }
  );
  if (value.source_artifacts?.length > MAX_BINDINGS)
    issues.push(`decision.source_artifacts cannot exceed ${MAX_BINDINGS} entries`);
  const canonicalReader = canonicalDecisionReader(value.kind, value.slug);
  if (canonicalReader && !artifactPaths.has(canonicalReader))
    issues.push(`decision.source_artifacts must bind canonical reader ${canonicalReader}`);
  if (value.kind === "strategy") validateStrategyContext(value.strategy_context, issues);
  else if (value.strategy_context !== undefined)
    issues.push("decision.strategy_context is strategy-only");
  if (value.kind === "idea") validateAlignment(value.alignment, value.evidence_refs, issues);
  else if (value.alignment !== undefined) issues.push("decision.alignment is idea-only");
  timestamp(value.created_at, "decision.created_at", issues);
  timestamp(value.updated_at, "decision.updated_at", issues);
  if (
    value.created_at &&
    value.updated_at &&
    Date.parse(value.updated_at) < Date.parse(value.created_at)
  ) {
    issues.push("decision.updated_at precedes created_at");
  }
  if (value.decision?.status === "confirmed" && (value.alternatives || []).length < 2) {
    issues.push("confirmed decision requires at least two alternatives");
  }
  if (value.evidence_refs?.length === 0 && value.confidence?.level !== "low") {
    issues.push("decision without evidence must have low confidence");
  }
  if (value.kind === "idea" && value.evidence_refs?.length === 0)
    issues.push("idea decision requires at least one evidence source signal");
  if (value.promotion?.status === "promoted") {
    if (!new Set(["think", "idea"]).has(value.kind))
      issues.push("only Think and Ideate decisions can be promoted to Groom");
    const canonicalTarget = value.slug ? `backlog/proposals/${value.slug}.json` : null;
    if (canonicalTarget && value.promotion.target_ref !== canonicalTarget)
      issues.push(`promoted decision target_ref must equal ${canonicalTarget}`);
    const canonicalApproval = value.slug ? `backlog/proposals/${value.slug}.approval.json` : null;
    if (canonicalApproval && !artifactPaths.has(canonicalApproval))
      issues.push(`promoted decision must bind canonical approval audit ${canonicalApproval}`);
    if (
      timestampValue(value.promotion.confirmed_at) !== null &&
      timestampValue(value.updated_at) !== null &&
      timestampValue(value.promotion.confirmed_at) !== timestampValue(value.updated_at)
    )
      issues.push("promoted decision confirmation must equal updated_at");
  }
  return issues;
}

function canonicalDecisionReader(kind, slugValue) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugValue || "")) return null;
  if (kind === "think") return `thinking/${slugValue}.md`;
  if (kind === "idea") return `backlog/${slugValue}.md`;
  if (kind === "strategy") return "strategy.md";
  return null;
}

function timestampValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateDecision(decision, alternatives, issues) {
  if (!record(decision)) return issues.push("decision.decision must be an object");
  closed(decision, ["status", "choice", "rationale"], "decision.decision", issues);
  if (!DECISION_STATUSES.has(decision.status)) issues.push("decision.decision.status is invalid");
  if (decision.choice !== null && decision.choice !== undefined)
    slug(decision.choice, "decision.decision.choice", issues);
  text(decision.rationale, "decision.decision.rationale", issues);
  if (decision.status === "confirmed") {
    if (!decision.choice) issues.push("confirmed decision requires a choice");
    else if (
      !(Array.isArray(alternatives) ? alternatives : []).some(
        (entry) => entry?.id === decision.choice
      )
    ) {
      issues.push("decision choice must reference an alternative");
    }
  }
}

function validateConfidence(confidence, issues) {
  if (!record(confidence)) return issues.push("decision.confidence must be an object");
  closed(confidence, ["level", "basis"], "decision.confidence", issues);
  if (!CONFIDENCE_LEVELS.has(confidence.level)) issues.push("decision.confidence.level is invalid");
  stringArray(confidence.basis, "decision.confidence.basis", issues, {
    nonEmpty: true,
    unique: true,
  });
}

function validateTrigger(trigger, issues) {
  if (!record(trigger)) return issues.push("decision.next_trigger must be an object");
  closed(trigger, ["lane", "condition", "target"], "decision.next_trigger", issues);
  if (!TRIGGER_LANES.has(trigger.lane)) issues.push("decision.next_trigger.lane is invalid");
  text(trigger.condition, "decision.next_trigger.condition", issues);
  if (trigger.target !== null && trigger.target !== undefined)
    kbPath(trigger.target, "decision.next_trigger.target", issues);
}

function validatePromotion(promotion, sourceArtifacts, issues) {
  if (!record(promotion)) return issues.push("decision.promotion must be an object");
  closed(
    promotion,
    [
      "status",
      "target_kind",
      "target_ref",
      "confirmed_at",
      "approval_decision",
      "origin_decision_sha256",
    ],
    "decision.promotion",
    issues
  );
  if (!PROMOTION_STATUSES.has(promotion.status))
    issues.push("decision.promotion.status is invalid");
  const promoted = promotion.status === "promoted";
  if (promoted) {
    if (promotion.target_kind !== "groom")
      issues.push("promoted decision target_kind must be groom");
    kbPath(promotion.target_ref, "decision.promotion.target_ref", issues);
    timestamp(promotion.confirmed_at, "decision.promotion.confirmed_at", issues);
    if (!record(promotion.approval_decision)) {
      issues.push("promoted decision approval_decision must be an object");
    } else {
      closed(
        promotion.approval_decision,
        ["id", "sha256"],
        "decision.promotion.approval_decision",
        issues
      );
      text(promotion.approval_decision.id, "decision.promotion.approval_decision.id", issues);
      if (!/^sha256:[a-f0-9]{64}$/.test(promotion.approval_decision.sha256 || ""))
        issues.push("decision.promotion.approval_decision.sha256 is invalid");
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(promotion.origin_decision_sha256 || ""))
      issues.push("promoted decision origin_decision_sha256 is invalid");
    if (
      !(Array.isArray(sourceArtifacts) ? sourceArtifacts : []).some(
        (artifact) => artifact?.path === promotion.target_ref
      )
    )
      issues.push("promoted decision target_ref must be a source artifact binding");
  } else {
    if (promotion.target_kind !== null) issues.push("unpromoted decision target_kind must be null");
    if (promotion.target_ref !== null || promotion.confirmed_at !== null)
      issues.push("unpromoted decision cannot bind a target or confirmation time");
    if (promotion.approval_decision !== undefined && promotion.approval_decision !== null)
      issues.push("unpromoted decision cannot bind an approval decision");
    if (promotion.origin_decision_sha256 !== undefined && promotion.origin_decision_sha256 !== null)
      issues.push("unpromoted decision cannot bind an origin decision hash");
  }
}

function validateStrategyContext(context, issues) {
  if (!record(context)) return issues.push("strategy decision requires strategy_context");
  closed(context, ["priorities", "non_goals"], "decision.strategy_context", issues);
  const ids = new Set();
  for (const field of ["priorities", "non_goals"]) {
    array(
      context[field],
      `decision.strategy_context.${field}`,
      issues,
      (entry, at) => {
        if (!record(entry)) return issues.push(`${at} must be an object`);
        closed(entry, ["id", "title"], at, issues);
        slug(entry.id, `${at}.id`, issues);
        if (ids.has(entry.id)) issues.push(`${at}.id is duplicated across strategy tokens`);
        ids.add(entry.id);
        text(entry.title, `${at}.title`, issues);
      },
      { nonEmpty: field === "priorities" }
    );
  }
}

function validateAlignment(alignment, evidenceRefs, issues) {
  if (!record(alignment)) return issues.push("idea decision requires alignment");
  closed(
    alignment,
    [
      "strength",
      "priority_ids",
      "non_goal_conflicts",
      "evidence_strength",
      "competitor_gap",
      "dependencies",
      "scope_signal",
    ],
    "decision.alignment",
    issues
  );
  if (!Object.hasOwn(STRATEGIC_ALIGNMENT, alignment.strength))
    issues.push("decision.alignment.strength is invalid");
  stringArray(alignment.priority_ids, "decision.alignment.priority_ids", issues, {
    slug: true,
    unique: true,
  });
  stringArray(alignment.non_goal_conflicts, "decision.alignment.non_goal_conflicts", issues, {
    slug: true,
    unique: true,
  });
  if (!Object.hasOwn(EVIDENCE_STRENGTH, alignment.evidence_strength))
    issues.push("decision.alignment.evidence_strength is invalid");
  const evidenceCount = new Set(
    (Array.isArray(evidenceRefs) ? evidenceRefs : [])
      .map((entry) => entry?.evidence_id || entry?.ref)
      .filter(Boolean)
  ).size;
  if (alignment.evidence_strength === "strong" && evidenceCount < 3)
    issues.push("strong idea evidence requires at least three distinct signals");
  if (alignment.evidence_strength === "moderate" && (evidenceCount < 1 || evidenceCount > 2))
    issues.push("moderate idea evidence requires one or two distinct signals");
  if (!Object.hasOwn(COMPETITOR_GAP, alignment.competitor_gap))
    issues.push("decision.alignment.competitor_gap is invalid");
  stringArray(alignment.dependencies, "decision.alignment.dependencies", issues, { unique: true });
  if (!Object.hasOwn(SCOPE_EFFICIENCY, alignment.scope_signal))
    issues.push("decision.alignment.scope_signal is invalid");
}

function rankIdeaBriefs(briefs, strategyBrief = null) {
  const strategyIssues = strategyBrief ? validateDecisionBrief(strategyBrief) : [];
  if (strategyIssues.length)
    throw new Error(`invalid strategy brief: ${strategyIssues.join("; ")}`);
  if (strategyBrief && strategyBrief.kind !== "strategy")
    throw new Error("strategy input must be a strategy decision brief");
  const priorities = new Set(
    strategyBrief?.strategy_context?.priorities?.map((item) => item.id) || []
  );
  const nonGoals = new Set(
    strategyBrief?.strategy_context?.non_goals?.map((item) => item.id) || []
  );
  return briefs
    .map((brief) => {
      const issues = validateDecisionBrief(brief);
      if (issues.length) throw new Error(`invalid idea brief: ${issues.join("; ")}`);
      if (brief.kind !== "idea") throw new Error("ranking accepts only idea briefs");
      const a = brief.alignment;
      const hasStrategy = Boolean(strategyBrief);
      const unknownPriorities = hasStrategy
        ? a.priority_ids.filter((id) => !priorities.has(id))
        : [...a.priority_ids];
      const conflicts = hasStrategy ? a.non_goal_conflicts.filter((id) => nonGoals.has(id)) : [];
      const unknownNonGoals = hasStrategy
        ? a.non_goal_conflicts.filter((id) => !nonGoals.has(id))
        : [...a.non_goal_conflicts];
      const components = {
        strategic_alignment: STRATEGIC_ALIGNMENT[a.strength],
        evidence_strength: EVIDENCE_STRENGTH[a.evidence_strength],
        competitor_gap: COMPETITOR_GAP[a.competitor_gap],
        dependency_efficiency: Math.max(0, 2 - a.dependencies.length),
        scope_efficiency: SCOPE_EFFICIENCY[a.scope_signal],
      };
      return {
        brief,
        components,
        unknown_priorities: unknownPriorities,
        non_goal_conflicts: conflicts,
        unknown_non_goals: unknownNonGoals,
      };
    })
    .sort(compareRanked)
    .map((entry, index) => ({
      rank: index + 1,
      decision_id: entry.brief.decision_id,
      components: entry.components,
      unknown_priorities: entry.unknown_priorities,
      non_goal_conflicts: entry.non_goal_conflicts,
      unknown_non_goals: entry.unknown_non_goals,
    }));
}

function promoteDecisionBrief(
  brief,
  targetRef,
  sourceArtifacts,
  confirmedAt,
  approvalDecision,
  originDecisionSha256
) {
  const existingIssues = validateDecisionBrief(brief);
  if (existingIssues.length)
    throw new Error(`invalid decision brief: ${existingIssues.join("; ")}`);
  const promoted = {
    ...brief,
    promotion: {
      status: "promoted",
      target_kind: "groom",
      target_ref: targetRef,
      confirmed_at: confirmedAt,
      approval_decision: approvalDecision,
      origin_decision_sha256: originDecisionSha256,
    },
    source_artifacts: sourceArtifacts,
    updated_at: confirmedAt,
  };
  const issues = validateDecisionBrief(promoted);
  if (issues.length) throw new Error(`invalid promotion: ${issues.join("; ")}`);
  return promoted;
}

function compareRanked(left, right) {
  for (const key of [
    "strategic_alignment",
    "evidence_strength",
    "competitor_gap",
    "dependency_efficiency",
    "scope_efficiency",
  ]) {
    if (left.components[key] !== right.components[key])
      return right.components[key] - left.components[key];
  }
  return left.brief.decision_id.localeCompare(right.brief.decision_id);
}

function validateFeatureInventory(value) {
  const issues = [];
  if (!record(value)) return ["feature inventory must be an object"];
  closed(
    value,
    [
      "schema_version",
      "document_type",
      "generated_at",
      "source_project",
      "scan",
      "areas",
      "markdown_binding",
    ],
    "inventory",
    issues
  );
  equal(value.schema_version, 2, "inventory.schema_version", issues);
  equal(value.document_type, "feature-inventory", "inventory.document_type", issues);
  timestamp(value.generated_at, "inventory.generated_at", issues);
  slug(value.source_project, "inventory.source_project", issues);
  if (!record(value.scan)) issues.push("inventory.scan must be an object");
  else {
    closed(
      value.scan,
      ["mode", "files_scanned", "files_total", "commit", "snapshot_sha256"],
      "inventory.scan",
      issues
    );
    if (!new Set(["git", "filesystem"]).has(value.scan.mode))
      issues.push("inventory.scan.mode must be git or filesystem");
    integer(value.scan.files_scanned, "inventory.scan.files_scanned", issues, 1);
    integer(
      value.scan.files_total,
      "inventory.scan.files_total",
      issues,
      value.scan.files_scanned || 1
    );
    if (value.scan.mode === "git") {
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.scan.commit || ""))
        issues.push("git inventory.scan.commit must be a full object ID");
      if (value.scan.snapshot_sha256 !== null)
        issues.push("git inventory.scan.snapshot_sha256 must be null");
    } else if (value.scan.mode === "filesystem") {
      if (value.scan.commit !== null) issues.push("filesystem inventory.scan.commit must be null");
      if (!/^sha256:[a-f0-9]{64}$/.test(value.scan.snapshot_sha256 || ""))
        issues.push("filesystem inventory.scan.snapshot_sha256 is invalid");
    }
  }
  const ids = new Set();
  const keys = new Set();
  const areaNames = new Set();
  let count = 0;
  array(
    value.areas,
    "inventory.areas",
    issues,
    (area, at) => {
      if (!record(area)) return issues.push(`${at} must be an object`);
      closed(area, ["name", "features"], at, issues);
      text(area.name, `${at}.name`, issues);
      const normalizedArea = normalizeToken(area.name);
      if (areaNames.has(normalizedArea)) issues.push(`${at}.name is duplicated`);
      areaNames.add(normalizedArea);
      array(
        area.features,
        `${at}.features`,
        issues,
        (feature, featureAt) => {
          count += 1;
          if (!record(feature)) return issues.push(`${featureAt} must be an object`);
          closed(
            feature,
            ["feature_id", "key", "name", "outcome", "highlights", "confidence", "source_refs"],
            featureAt,
            issues
          );
          slug(feature.key, `${featureAt}.key`, issues);
          if (!/^feat-[a-f0-9]{20}$/.test(feature.feature_id || "")) {
            issues.push(`${featureAt}.feature_id is invalid`);
          }
          if (ids.has(feature.feature_id)) issues.push(`${featureAt}.feature_id is duplicated`);
          if (keys.has(feature.key)) issues.push(`${featureAt}.key is duplicated`);
          ids.add(feature.feature_id);
          keys.add(feature.key);
          text(feature.name, `${featureAt}.name`, issues);
          text(feature.outcome, `${featureAt}.outcome`, issues);
          stringArray(feature.highlights, `${featureAt}.highlights`, issues, {
            nonEmpty: true,
            unique: true,
          });
          if (feature.highlights?.length < 2 || feature.highlights?.length > 4)
            issues.push(`${featureAt}.highlights must contain 2 through 4 items`);
          if (!CONFIDENCE_LEVELS.has(feature.confidence))
            issues.push(`${featureAt}.confidence is invalid`);
          stringArray(feature.source_refs, `${featureAt}.source_refs`, issues, {
            nonEmpty: true,
            sourcePath: true,
            unique: true,
          });
          if (feature.source_refs?.length > 16)
            issues.push(`${featureAt}.source_refs cannot exceed 16 entries`);
        },
        { nonEmpty: true }
      );
    },
    { nonEmpty: true }
  );
  if (value.areas?.length < 3 || value.areas?.length > 6)
    issues.push("inventory must contain 3 through 6 areas");
  if (count < 8 || count > 20) issues.push("inventory must contain 8 through 20 features");
  if (!record(value.markdown_binding)) issues.push("inventory.markdown_binding must be an object");
  else {
    closed(value.markdown_binding, ["path", "sha256"], "inventory.markdown_binding", issues);
    kbPath(value.markdown_binding.path, "inventory.markdown_binding.path", issues);
    if (value.markdown_binding.path !== "product/features.md")
      issues.push("inventory.markdown_binding.path must equal product/features.md");
    if (!/^sha256:[a-f0-9]{64}$/.test(value.markdown_binding.sha256 || ""))
      issues.push("inventory.markdown_binding.sha256 is invalid");
  }
  return issues;
}

function validateFeatureSourceRefs(inventory, sourceRoot) {
  const issues = validateFeatureInventory(inventory);
  if (issues.length) return issues;
  let root;
  try {
    root = fs.realpathSync(path.resolve(sourceRoot));
  } catch (error) {
    return [`source root is unavailable: ${error.message}`];
  }
  const refs = [
    ...new Set(
      inventory.areas.flatMap((area) => area.features.flatMap((feature) => feature.source_refs))
    ),
  ];
  if (inventory.scan.mode === "filesystem") {
    try {
      const snapshot = featureSourceSnapshot(root, refs);
      if (snapshot.snapshot_sha256 !== inventory.scan.snapshot_sha256)
        issues.push("filesystem feature source snapshot does not match current source bytes");
    } catch (error) {
      issues.push(error.message);
    }
    return issues;
  }
  const commitType = spawnSync("git", ["-C", root, "cat-file", "-t", inventory.scan.commit], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  if (commitType.error || commitType.status !== 0 || commitType.stdout.trim() !== "commit")
    return ["inventory.scan.commit must resolve to an exact commit object"];
  const result = spawnSync("git", ["-C", root, "cat-file", "--batch-check=%(objecttype)"], {
    input: `${refs.map((ref) => `${inventory.scan.commit}:${ref}`).join("\n")}\n`,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const observed = result.status === 0 ? result.stdout.trim().split("\n") : [];
  refs.forEach((ref, index) => {
    if (result.error || result.status !== 0 || observed[index] !== "blob")
      issues.push(`feature source ref is absent at scan.commit: ${ref}`);
  });
  return issues;
}

function featureSourceSnapshot(sourceRoot, sourceRefs) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0)
    throw new Error("feature snapshot source_refs must be non-empty");
  if (sourceRefs.length > 320) throw new Error("feature snapshot source_refs cannot exceed 320");
  const validationIssues = [];
  stringArray(sourceRefs, "feature snapshot source_refs", validationIssues, {
    sourcePath: true,
    unique: true,
  });
  if (validationIssues.length) throw new Error(validationIssues.join("; "));
  const root = fs.realpathSync(path.resolve(sourceRoot));
  let totalBytes = 0;
  const files = [...sourceRefs].sort().map((ref) => {
    const remaining = MAX_SOURCE_SNAPSHOT_BYTES - totalBytes;
    if (remaining <= 0)
      throw new Error("feature source snapshot exceeds the 64 MiB aggregate budget");
    let input;
    try {
      input = readProjectInput(root, ref, Math.min(MAX_SOURCE_FILE_BYTES, remaining));
    } catch (error) {
      if (remaining < MAX_SOURCE_FILE_BYTES && /input exceeds/.test(error.message))
        throw new Error("feature source snapshot exceeds the 64 MiB aggregate budget");
      throw error;
    }
    totalBytes += input.bytes.length;
    return {
      path: input.relative,
      bytes: input.bytes.length,
      sha256: `sha256:${crypto.createHash("sha256").update(input.bytes).digest("hex")}`,
    };
  });
  const digest = crypto.createHash("sha256");
  for (const file of files) digest.update(`${file.path}\0${file.sha256}\0${file.bytes}\n`);
  return {
    snapshot_sha256: `sha256:${digest.digest("hex")}`,
    file_count: files.length,
    total_bytes: totalBytes,
    files,
  };
}

function reconcileFeatureInventory(previous, proposed, resolutions = {}) {
  const proposedIssues = validateFeatureInventory(proposed);
  if (proposedIssues.length)
    throw new Error(`invalid proposed feature inventory: ${proposedIssues.join("; ")}`);
  if (previous) {
    const previousIssues = validateFeatureInventory(previous);
    if (previousIssues.length)
      throw new Error(`invalid previous feature inventory: ${previousIssues.join("; ")}`);
  }
  const priorFeatures = flattenFeatures(previous);
  const proposedFeatures = flattenFeatures(proposed);
  if (!record(resolutions)) throw new Error("feature resolutions must be an object");
  const proposedKeys = new Set(proposedFeatures.map((feature) => feature.key));
  for (const [key, choice] of Object.entries(resolutions)) {
    if (!proposedKeys.has(key)) throw new Error(`feature resolution key ${key} is unknown`);
    if (choice !== "new" && !/^feat-[a-f0-9]{20}$/.test(choice || ""))
      throw new Error(`feature resolution ${key} must be a candidate feature ID or new`);
  }
  const analyses = proposedFeatures.map((feature) => {
    const exact = priorFeatures.find((old) => old.key === feature.key);
    const candidates = exact
      ? [{ feature: exact, overlap: 1, exact: true }]
      : priorFeatures
          .map((old) => ({
            feature: old,
            overlap: jaccard(old.source_refs, feature.source_refs),
            exact: false,
          }))
          .filter((item) => item.overlap >= 0.6)
          .sort(
            (left, right) =>
              right.overlap - left.overlap ||
              left.feature.feature_id.localeCompare(right.feature.feature_id)
          );
    const best = candidates[0]?.overlap;
    return {
      feature,
      top: candidates.filter((item) => item.overlap === best),
    };
  });
  const claims = new Map();
  for (const analysis of analyses) {
    for (const candidate of analysis.top) {
      const rows = claims.get(candidate.feature.feature_id) || [];
      rows.push(analysis.feature.key);
      claims.set(candidate.feature.feature_id, rows);
    }
  }
  const used = new Set();
  const ambiguousCandidates = new Set();
  const ambiguous = [];
  const resolved = new Map();
  for (const analysis of analyses) {
    const collision = analysis.top.some(
      (candidate) => (claims.get(candidate.feature.feature_id) || []).length > 1
    );
    const choice = resolutions[analysis.feature.key];
    if (analysis.top.length > 1 || collision) {
      const candidateIds = analysis.top.map((item) => item.feature.feature_id).sort();
      if (choice !== undefined) {
        if (choice !== "new" && !candidateIds.includes(choice))
          throw new Error(
            `feature resolution ${analysis.feature.key} must select a reported candidate or new`
          );
        const selected =
          choice === "new" ? featureId(proposed.source_project, analysis.feature.key) : choice;
        if (used.has(selected))
          throw new Error(
            `feature resolution ${analysis.feature.key} reuses claimed identity ${selected}`
          );
        used.add(selected);
        resolved.set(analysis.feature.key, selected);
        continue;
      }
      for (const candidate of analysis.top) ambiguousCandidates.add(candidate.feature.feature_id);
      ambiguous.push({
        key: analysis.feature.key,
        candidates: candidateIds,
      });
      continue;
    }
    const match = analysis.top[0]?.feature || null;
    if (choice !== undefined) {
      const allowed = match ? [match.feature_id] : [];
      if (choice !== "new" && !allowed.includes(choice))
        throw new Error(
          `feature resolution ${analysis.feature.key} must select a reported candidate or new`
        );
    }
    const selected =
      choice === "new"
        ? featureId(proposed.source_project, analysis.feature.key)
        : choice || match?.feature_id || featureId(proposed.source_project, analysis.feature.key);
    if (used.has(selected))
      throw new Error(
        `feature resolution ${analysis.feature.key} reuses claimed identity ${selected}`
      );
    if (match || choice !== undefined) used.add(selected);
    resolved.set(analysis.feature.key, selected);
  }
  ambiguous.sort((left, right) => left.key.localeCompare(right.key));
  const areas = proposed.areas.map((area) => ({
    ...area,
    features: area.features.map((feature) => ({
      ...feature,
      feature_id: resolved.get(feature.key) || featureId(proposed.source_project, feature.key),
    })),
  }));
  return {
    inventory: { ...proposed, areas },
    ambiguous,
    retired: priorFeatures
      .filter((item) => !used.has(item.feature_id) && !ambiguousCandidates.has(item.feature_id))
      .map((item) => item.feature_id),
  };
}

function flattenFeatures(inventory) {
  return (inventory?.areas || []).flatMap((area) => area.features || []);
}

function jaccard(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (!union.size) return 0;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function normalizeProse(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function evidenceRef(value, label, issues) {
  if (typeof value === "string" && /^https:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.username || url.password) issues.push(`${label} URL cannot contain credentials`);
      return;
    } catch {
      // Fall through to the common invalid-reference issue.
    }
  }
  kbPath(value, label, issues, "evidence reference");
}
function kbPath(value, label, issues, noun = "knowledge-base path") {
  portablePath(value, label, issues, noun);
  if (typeof value === "string" && (value === "pm" || value.startsWith("pm/")))
    issues.push(`${label} must be relative to pm_dir without a pm/ prefix`);
}
function portablePath(value, label, issues, noun = "project path") {
  if (
    typeof value !== "string" ||
    !value ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("~") ||
    /[\0\r\n]/.test(value) ||
    value.includes("\\") ||
    value.split(/[\\/]/).includes("..") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
  )
    issues.push(`${label} must be a portable ${noun}`);
}
function closed(value, fields, label, issues) {
  for (const key of Object.keys(value || {}))
    if (!fields.includes(key)) issues.push(`${label}.${key} is unknown`);
}
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
function equal(actual, expected, label, issues) {
  if (actual !== expected) issues.push(`${label} must equal ${expected}`);
}
function text(value, label, issues) {
  if (typeof value !== "string" || !value.trim() || /[\0\r]/.test(value))
    issues.push(`${label} must be non-empty text`);
}
function slug(value, label, issues) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || "")) issues.push(`${label} must be kebab-case`);
}
function timestamp(value, label, issues) {
  if (typeof value !== "string") return issues.push(`${label} must be RFC 3339`);
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/
  );
  if (!match) return issues.push(`${label} must be RFC 3339`);
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > daysInMonth ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) ||
    !Number.isFinite(Date.parse(value))
  )
    issues.push(`${label} must be RFC 3339`);
}
function integer(value, label, issues, minimum) {
  if (!Number.isInteger(value) || value < minimum)
    issues.push(`${label} must be an integer >= ${minimum}`);
}
function array(value, label, issues, check, options = {}) {
  if (!Array.isArray(value)) return issues.push(`${label} must be an array`);
  if (options.nonEmpty && value.length === 0) issues.push(`${label} must be non-empty`);
  value.forEach((entry, index) => check(entry, `${label}[${index}]`));
}
function stringArray(value, label, issues, options = {}) {
  const seen = new Set();
  array(
    value,
    label,
    issues,
    (entry, at) => {
      if (typeof entry !== "string" || !entry.trim()) issues.push(`${at} must be non-empty text`);
      else if (options.slug) slug(entry, at, issues);
      else if (options.sourcePath) portablePath(entry, at, issues, "source-project path");
      if (options.unique && typeof entry === "string") {
        if (seen.has(entry)) issues.push(`${at} is duplicated`);
        seen.add(entry);
      }
    },
    options
  );
}

module.exports = {
  decisionId,
  featureId,
  featureSourceSnapshot,
  promoteDecisionBrief,
  rankIdeaBriefs,
  reconcileFeatureInventory,
  validateDecisionBrief,
  validateFeatureSourceRefs,
  validateFeatureInventory,
};
