"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const DECISION_KINDS = new Set(["think", "idea", "strategy"]);
const DECISION_STATUSES = new Set(["exploring", "confirmed", "parked"]);
const CONFIDENCE_LEVELS = new Set(["low", "medium", "high"]);
const TRIGGER_LANES = new Set(["research", "groom", "ideate", "features", "strategy", "none"]);
const PROMOTION_STATUSES = new Set(["not-offered", "offered", "promoted"]);
const EVIDENCE_STRENGTH = Object.freeze({ hypothesis: 0, moderate: 1, strong: 2 });
const STRATEGIC_ALIGNMENT = Object.freeze({ weak: 0, partial: 1, strong: 2 });
const COMPETITOR_GAP = Object.freeze({ parity: 0, partial: 1, unique: 2 });
const SCOPE_EFFICIENCY = Object.freeze({ large: 0, medium: 1, small: 2 });

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
  array(value.alternatives, "decision.alternatives", issues, (entry, at) => {
    if (!record(entry)) return issues.push(`${at} must be an object`);
    closed(entry, ["id", "title", "tradeoff"], at, issues);
    slug(entry.id, `${at}.id`, issues);
    if (alternativeIds.has(entry.id)) issues.push(`${at}.id is duplicated`);
    alternativeIds.add(entry.id);
    text(entry.title, `${at}.title`, issues);
    text(entry.tradeoff, `${at}.tradeoff`, issues);
  });
  validateDecision(value.decision, value.alternatives, issues);
  validateConfidence(value.confidence, issues);
  stringArray(value.non_goals, "decision.non_goals", issues, { unique: true });
  validateTrigger(value.next_trigger, issues);
  validatePromotion(value.promotion, value.source_artifacts, issues);
  array(
    value.source_artifacts,
    "decision.source_artifacts",
    issues,
    (entry, at) => {
      if (!record(entry)) return issues.push(`${at} must be an object`);
      closed(entry, ["path", "sha256"], at, issues);
      portablePath(entry.path, `${at}.path`, issues);
      if (!/^sha256:[a-f0-9]{64}$/.test(entry.sha256 || "")) issues.push(`${at}.sha256 is invalid`);
    },
    { nonEmpty: true }
  );
  if (value.kind === "strategy") validateStrategyContext(value.strategy_context, issues);
  else if (value.strategy_context !== undefined)
    issues.push("decision.strategy_context is strategy-only");
  if (value.kind === "idea") validateAlignment(value.alignment, issues);
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
  return issues;
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
    else if (!(alternatives || []).some((entry) => entry?.id === decision.choice)) {
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
    portablePath(trigger.target, "decision.next_trigger.target", issues);
}

function validatePromotion(promotion, sourceArtifacts, issues) {
  if (!record(promotion)) return issues.push("decision.promotion must be an object");
  closed(
    promotion,
    ["status", "target_kind", "target_ref", "confirmed_at"],
    "decision.promotion",
    issues
  );
  if (!PROMOTION_STATUSES.has(promotion.status))
    issues.push("decision.promotion.status is invalid");
  const promoted = promotion.status === "promoted";
  if (promoted) {
    if (promotion.target_kind !== "groom")
      issues.push("promoted decision target_kind must be groom");
    portablePath(promotion.target_ref, "decision.promotion.target_ref", issues);
    timestamp(promotion.confirmed_at, "decision.promotion.confirmed_at", issues);
    if (!(sourceArtifacts || []).some((artifact) => artifact?.path === promotion.target_ref))
      issues.push("promoted decision target_ref must be a source artifact binding");
  } else {
    if (promotion.target_kind !== null) issues.push("unpromoted decision target_kind must be null");
    if (promotion.target_ref !== null || promotion.confirmed_at !== null)
      issues.push("unpromoted decision cannot bind a target or confirmation time");
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

function validateAlignment(alignment, issues) {
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
  if (!(alignment.strength in STRATEGIC_ALIGNMENT))
    issues.push("decision.alignment.strength is invalid");
  stringArray(alignment.priority_ids, "decision.alignment.priority_ids", issues, {
    slug: true,
    unique: true,
  });
  stringArray(alignment.non_goal_conflicts, "decision.alignment.non_goal_conflicts", issues, {
    slug: true,
    unique: true,
  });
  if (!(alignment.evidence_strength in EVIDENCE_STRENGTH))
    issues.push("decision.alignment.evidence_strength is invalid");
  if (!(alignment.competitor_gap in COMPETITOR_GAP))
    issues.push("decision.alignment.competitor_gap is invalid");
  stringArray(alignment.dependencies, "decision.alignment.dependencies", issues, { unique: true });
  if (!(alignment.scope_signal in SCOPE_EFFICIENCY))
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
      const unknownPriorities = priorities.size
        ? a.priority_ids.filter((id) => !priorities.has(id))
        : [];
      const conflicts = a.non_goal_conflicts.filter((id) => !nonGoals.size || nonGoals.has(id));
      const unknownNonGoals = nonGoals.size
        ? a.non_goal_conflicts.filter((id) => !nonGoals.has(id))
        : [];
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

function promoteDecisionBrief(brief, targetRef, sourceArtifacts, confirmedAt) {
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
    closed(value.scan, ["files_scanned", "files_total", "commit"], "inventory.scan", issues);
    integer(value.scan.files_scanned, "inventory.scan.files_scanned", issues, 1);
    integer(
      value.scan.files_total,
      "inventory.scan.files_total",
      issues,
      value.scan.files_scanned || 1
    );
    if (value.scan.commit !== null && !/^[a-f0-9]{40,64}$/.test(value.scan.commit || ""))
      issues.push("inventory.scan.commit is invalid");
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
            portablePath: true,
            unique: true,
          });
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
    portablePath(value.markdown_binding.path, "inventory.markdown_binding.path", issues);
    if (!/^sha256:[a-f0-9]{64}$/.test(value.markdown_binding.sha256 || ""))
      issues.push("inventory.markdown_binding.sha256 is invalid");
  }
  return issues;
}

function reconcileFeatureInventory(previous, proposed) {
  const proposedIssues = validateFeatureInventory(proposed);
  if (proposedIssues.length)
    throw new Error(`invalid proposed feature inventory: ${proposedIssues.join("; ")}`);
  if (previous) {
    const previousIssues = validateFeatureInventory(previous);
    if (previousIssues.length)
      throw new Error(`invalid previous feature inventory: ${previousIssues.join("; ")}`);
  }
  const priorFeatures = flattenFeatures(previous);
  const used = new Set();
  const ambiguous = [];
  const areas = proposed.areas.map((area) => ({
    ...area,
    features: area.features.map((feature) => {
      const exact = priorFeatures.find(
        (old) => !used.has(old.feature_id) && old.key === feature.key
      );
      const candidates = exact
        ? [exact]
        : priorFeatures
            .filter((old) => !used.has(old.feature_id))
            .map((old) => ({ ...old, overlap: jaccard(old.source_refs, feature.source_refs) }))
            .filter((old) => old.overlap >= 0.6)
            .sort((a, b) => b.overlap - a.overlap || a.feature_id.localeCompare(b.feature_id));
      if (!exact && candidates.length > 1 && candidates[0].overlap === candidates[1].overlap) {
        ambiguous.push({
          key: feature.key,
          candidates: candidates
            .filter((item) => item.overlap === candidates[0].overlap)
            .map((item) => item.feature_id),
        });
      }
      const match =
        exact ||
        (candidates.length === 1 || candidates[0]?.overlap > candidates[1]?.overlap
          ? candidates[0]
          : null);
      if (match) used.add(match.feature_id);
      return {
        ...feature,
        feature_id: match?.feature_id || featureId(proposed.source_project, feature.key),
      };
    }),
  }));
  return {
    inventory: { ...proposed, areas },
    ambiguous,
    retired: priorFeatures
      .filter((item) => !used.has(item.feature_id))
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
  portablePath(value, label, issues, "evidence reference");
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
      else if (options.portablePath) portablePath(entry, at, issues);
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
  promoteDecisionBrief,
  rankIdeaBriefs,
  reconcileFeatureInventory,
  validateDecisionBrief,
  validateFeatureInventory,
};
