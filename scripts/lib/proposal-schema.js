"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 1;
const MAX_PROPOSAL_BYTES = 2 * 1024 * 1024;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STABLE_ID = /^[a-z][a-z0-9-]*:[a-z0-9][a-z0-9._-]*$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LIFECYCLES = ["draft", "reviewed", "approved", "planned", "in-progress", "done"];
const POST_APPROVAL_LIFECYCLES = new Set(["planned", "in-progress", "done"]);

const TOP_FIELDS = [
  "schema_version",
  "id",
  "slug",
  "lifecycle",
  "revision",
  "created_at",
  "updated_at",
  "title",
  "outcome",
  "priority",
  "size",
  "labels",
  "source",
  "decision_brief",
  "audience",
  "jobs_to_be_done",
  "evidence",
  "assumptions",
  "confidence",
  "scope",
  "requirements",
  "acceptance_criteria",
  "edge_cases",
  "design_requirements",
  "success_metrics",
  "alternatives",
  "risks",
  "open_decisions",
  "resolved_decisions",
  "question_reviews",
  "advisory_debt",
  "review",
  "presentation",
  "handoff",
];
const APPROVAL_FIELDS = [
  "schema_version",
  "kind",
  "proposal_id",
  "slug",
  "revision",
  "proposal_sha256",
  "content_sha256",
  "approved_by",
  "approved_at",
  "decision_id",
  "decision_sha256",
];

function issue(pathname, message) {
  return { path: pathname, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return (
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
  );
}

function closed(value, allowed, at, issues) {
  if (!isObject(value)) {
    issues.push(issue(at, "must be an object"));
    return false;
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(issue(`${at}.${key}`, `unknown field ${key}`));
  }
  return true;
}

function requiredString(value, at, issues) {
  if (!isString(value))
    issues.push(issue(at, "must be a non-empty string without control characters"));
}

function enumValue(value, values, at, issues, label = path.basename(at)) {
  if (!values.includes(value))
    issues.push(issue(at, `${label} must be one of ${values.join(", ")}`));
}

function stringArray(value, at, issues, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    issues.push(issue(at, `${fieldName(at)} must be ${nonEmpty ? "a non-empty" : "an"} array`));
    return;
  }
  const seen = new Set();
  value.forEach((entry, index) => {
    if (!isString(entry)) issues.push(issue(`${at}[${index}]`, "must be a non-empty string"));
    else if (seen.has(entry)) issues.push(issue(`${at}[${index}]`, `duplicate value ${entry}`));
    seen.add(entry);
  });
}

function rows(value, at, issues, fields, required, validate, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    issues.push(issue(at, `${fieldName(at)} must be ${nonEmpty ? "a non-empty" : "an"} array`));
    return new Set();
  }
  const ids = new Set();
  value.forEach((entry, index) => {
    const rowPath = `${at}[${index}]`;
    if (!closed(entry, fields, rowPath, issues)) return;
    for (const field of required) {
      if (!(field in entry)) issues.push(issue(`${rowPath}.${field}`, "is required"));
    }
    if ("id" in entry) {
      if (!STABLE_ID.test(entry.id || ""))
        issues.push(issue(`${rowPath}.id`, "must be a stable namespaced id"));
      else if (ids.has(entry.id)) issues.push(issue(`${rowPath}.id`, `duplicate id ${entry.id}`));
      ids.add(entry.id);
    }
    validate(entry, rowPath, issues);
  });
  return ids;
}

function validatePath(value, at, issues) {
  if (
    !isString(value) ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.includes("\\") ||
    value.split("/").includes("..") ||
    value.split("/").includes(".") ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//")
  ) {
    issues.push(issue(at, "must be a normalized project-relative path"));
  }
}

function validateProposal(proposal, options = {}) {
  const issues = [];
  const at = options.path || "$";
  if (!closed(proposal, TOP_FIELDS, at, issues)) return { ok: false, issues };
  for (const field of TOP_FIELDS)
    if (!(field in proposal)) issues.push(issue(`${at}.${field}`, "is required"));

  if (proposal.schema_version !== SCHEMA_VERSION)
    issues.push(issue(`${at}.schema_version`, `must equal ${SCHEMA_VERSION}`));
  if (!SLUG.test(proposal.slug || "")) issues.push(issue(`${at}.slug`, "must be a canonical slug"));
  if (proposal.id !== `proposal:${proposal.slug}`)
    issues.push(issue(`${at}.id`, `id must equal proposal:${proposal.slug}`));
  if (options.expectedSlug !== undefined && proposal.slug !== options.expectedSlug)
    issues.push(issue(`${at}.slug`, `slug must equal ${options.expectedSlug}`));
  enumValue(proposal.lifecycle, LIFECYCLES, `${at}.lifecycle`, issues, "lifecycle");
  if (!Number.isInteger(proposal.revision) || proposal.revision < 1)
    issues.push(issue(`${at}.revision`, "revision must be a positive integer"));
  for (const field of ["created_at", "updated_at"]) {
    if (!ISO_8601.test(proposal[field] || "") || Number.isNaN(Date.parse(proposal[field])))
      issues.push(issue(`${at}.${field}`, "must be an ISO-8601 UTC timestamp"));
  }
  if (
    ISO_8601.test(proposal.created_at || "") &&
    ISO_8601.test(proposal.updated_at || "") &&
    Date.parse(proposal.updated_at) < Date.parse(proposal.created_at)
  )
    issues.push(issue(`${at}.updated_at`, "must not predate created_at"));
  requiredString(proposal.title, `${at}.title`, issues);
  requiredString(proposal.outcome, `${at}.outcome`, issues);
  enumValue(
    proposal.priority,
    ["low", "medium", "high", "critical"],
    `${at}.priority`,
    issues,
    "priority"
  );
  enumValue(proposal.size, ["XS", "S", "M", "L", "XL"], `${at}.size`, issues, "size");
  stringArray(proposal.labels, `${at}.labels`, issues);
  enumValue(
    proposal.confidence,
    ["low", "medium", "high"],
    `${at}.confidence`,
    issues,
    "confidence"
  );

  if (closed(proposal.source, ["kind", "session_id", "lineage"], `${at}.source`, issues)) {
    enumValue(
      proposal.source.kind,
      ["groom-session", "migration", "manual"],
      `${at}.source.kind`,
      issues,
      "kind"
    );
    requiredString(proposal.source.session_id, `${at}.source.session_id`, issues);
    rows(
      proposal.source.lineage,
      `${at}.source.lineage`,
      issues,
      ["id", "path", "sha256"],
      ["id", "path", "sha256"],
      (entry, rowPath) => {
        validatePath(entry.path, `${rowPath}.path`, issues);
        if (!SHA256.test(entry.sha256 || ""))
          issues.push(issue(`${rowPath}.sha256`, "must be a sha256 hash"));
      },
      { nonEmpty: true }
    );
  }
  if (
    closed(
      proposal.decision_brief,
      ["problem", "recommendation", "why_now"],
      `${at}.decision_brief`,
      issues
    )
  ) {
    for (const field of ["problem", "recommendation", "why_now"])
      requiredString(proposal.decision_brief[field], `${at}.decision_brief.${field}`, issues);
  }

  const audienceIds = rows(
    proposal.audience,
    `${at}.audience`,
    issues,
    ["id", "name", "description"],
    ["id", "name", "description"],
    (entry, rowPath) => {
      requiredString(entry.name, `${rowPath}.name`, issues);
      requiredString(entry.description, `${rowPath}.description`, issues);
    },
    { nonEmpty: true }
  );
  const jtbdRefs = [];
  rows(
    proposal.jobs_to_be_done,
    `${at}.jobs_to_be_done`,
    issues,
    ["id", "audience_ids", "situation", "motivation", "outcome"],
    ["id", "audience_ids", "situation", "motivation", "outcome"],
    (entry, rowPath) => {
      stringArray(entry.audience_ids, `${rowPath}.audience_ids`, issues, { nonEmpty: true });
      jtbdRefs.push(
        ...(Array.isArray(entry.audience_ids)
          ? entry.audience_ids.map((id) => [id, `${rowPath}.audience_ids`])
          : [])
      );
      for (const field of ["situation", "motivation", "outcome"])
        requiredString(entry[field], `${rowPath}.${field}`, issues);
    },
    { nonEmpty: true }
  );
  for (const [id, refPath] of jtbdRefs)
    if (!audienceIds.has(id)) issues.push(issue(refPath, `unknown audience id ${id}`));

  const evidenceIds = rows(
    proposal.evidence,
    `${at}.evidence`,
    issues,
    ["id", "kind", "path", "summary", "observed_at"],
    ["id", "kind", "path", "summary", "observed_at"],
    (entry, rowPath) => {
      enumValue(
        entry.kind,
        ["research", "customer", "analytics", "strategy", "competitive", "other"],
        `${rowPath}.kind`,
        issues,
        "kind"
      );
      validatePath(entry.path, `${rowPath}.path`, issues);
      requiredString(entry.summary, `${rowPath}.summary`, issues);
      if (!ISO_8601.test(entry.observed_at || "") || Number.isNaN(Date.parse(entry.observed_at)))
        issues.push(issue(`${rowPath}.observed_at`, "must be an ISO-8601 UTC timestamp"));
    },
    { nonEmpty: true }
  );
  rows(
    proposal.assumptions,
    `${at}.assumptions`,
    issues,
    ["id", "statement", "confidence", "validation"],
    ["id", "statement", "confidence", "validation"],
    (entry, rowPath) => {
      requiredString(entry.statement, `${rowPath}.statement`, issues);
      enumValue(
        entry.confidence,
        ["low", "medium", "high"],
        `${rowPath}.confidence`,
        issues,
        "confidence"
      );
      requiredString(entry.validation, `${rowPath}.validation`, issues);
    }
  );

  if (closed(proposal.scope, ["in_scope", "non_goals"], `${at}.scope`, issues)) {
    for (const key of ["in_scope", "non_goals"])
      rows(
        proposal.scope[key],
        `${at}.scope.${key}`,
        issues,
        ["id", "statement"],
        ["id", "statement"],
        (entry, rowPath) => requiredString(entry.statement, `${rowPath}.statement`, issues),
        { nonEmpty: true }
      );
  }
  const requirementIds = rows(
    proposal.requirements,
    `${at}.requirements`,
    issues,
    ["id", "statement", "priority"],
    ["id", "statement", "priority"],
    (entry, rowPath) => {
      requiredString(entry.statement, `${rowPath}.statement`, issues);
      enumValue(
        entry.priority,
        ["must", "should", "could"],
        `${rowPath}.priority`,
        issues,
        "priority"
      );
    },
    { nonEmpty: true }
  );
  const requirementRefs = [];
  rows(
    proposal.acceptance_criteria,
    `${at}.acceptance_criteria`,
    issues,
    ["id", "requirement_ids", "given", "when", "then"],
    ["id", "requirement_ids", "given", "when", "then"],
    (entry, rowPath) => {
      stringArray(entry.requirement_ids, `${rowPath}.requirement_ids`, issues, { nonEmpty: true });
      requirementRefs.push(
        ...(Array.isArray(entry.requirement_ids)
          ? entry.requirement_ids.map((id) => [id, `${rowPath}.requirement_ids`])
          : [])
      );
      for (const field of ["given", "when", "then"])
        requiredString(entry[field], `${rowPath}.${field}`, issues);
    },
    { nonEmpty: true }
  );
  for (const [id, refPath] of requirementRefs)
    if (!requirementIds.has(id)) issues.push(issue(refPath, `unknown requirement id ${id}`));

  rows(
    proposal.edge_cases,
    `${at}.edge_cases`,
    issues,
    ["id", "scenario", "expected_behavior"],
    ["id", "scenario", "expected_behavior"],
    (entry, rowPath) => {
      requiredString(entry.scenario, `${rowPath}.scenario`, issues);
      requiredString(entry.expected_behavior, `${rowPath}.expected_behavior`, issues);
    },
    { nonEmpty: true }
  );
  rows(
    proposal.design_requirements,
    `${at}.design_requirements`,
    issues,
    ["id", "requirement"],
    ["id", "requirement"],
    (entry, rowPath) => requiredString(entry.requirement, `${rowPath}.requirement`, issues)
  );
  rows(
    proposal.success_metrics,
    `${at}.success_metrics`,
    issues,
    ["id", "metric", "baseline", "target", "window"],
    ["id", "metric", "baseline", "target", "window"],
    (entry, rowPath) => {
      for (const field of ["metric", "baseline", "target", "window"])
        requiredString(entry[field], `${rowPath}.${field}`, issues);
    },
    { nonEmpty: true }
  );
  rows(
    proposal.alternatives,
    `${at}.alternatives`,
    issues,
    ["id", "name", "reason_rejected"],
    ["id", "name", "reason_rejected"],
    (entry, rowPath) => {
      requiredString(entry.name, `${rowPath}.name`, issues);
      requiredString(entry.reason_rejected, `${rowPath}.reason_rejected`, issues);
    }
  );
  rows(
    proposal.risks,
    `${at}.risks`,
    issues,
    ["id", "risk", "likelihood", "impact", "mitigation"],
    ["id", "risk", "likelihood", "impact", "mitigation"],
    (entry, rowPath) => {
      requiredString(entry.risk, `${rowPath}.risk`, issues);
      enumValue(
        entry.likelihood,
        ["low", "medium", "high"],
        `${rowPath}.likelihood`,
        issues,
        "likelihood"
      );
      enumValue(entry.impact, ["low", "medium", "high"], `${rowPath}.impact`, issues, "impact");
      requiredString(entry.mitigation, `${rowPath}.mitigation`, issues);
    }
  );
  rows(
    proposal.open_decisions,
    `${at}.open_decisions`,
    issues,
    ["id", "question", "owner", "due_at"],
    ["id", "question", "owner"],
    (entry, rowPath) => {
      requiredString(entry.question, `${rowPath}.question`, issues);
      requiredString(entry.owner, `${rowPath}.owner`, issues);
      if (
        entry.due_at !== undefined &&
        (!ISO_8601.test(entry.due_at || "") || Number.isNaN(Date.parse(entry.due_at)))
      )
        issues.push(issue(`${rowPath}.due_at`, "must be an ISO-8601 UTC timestamp"));
    }
  );
  rows(
    proposal.resolved_decisions,
    `${at}.resolved_decisions`,
    issues,
    ["id", "question", "decision", "rationale"],
    ["id", "question", "decision", "rationale"],
    (entry, rowPath) => {
      for (const field of ["question", "decision", "rationale"])
        requiredString(entry[field], `${rowPath}.${field}`, issues);
    }
  );

  const debtIds = rows(
    proposal.advisory_debt,
    `${at}.advisory_debt`,
    issues,
    ["id", "summary", "severity", "status"],
    ["id", "summary", "severity", "status"],
    (entry, rowPath) => {
      requiredString(entry.summary, `${rowPath}.summary`, issues);
      enumValue(
        entry.severity,
        ["low", "medium", "high"],
        `${rowPath}.severity`,
        issues,
        "severity"
      );
      enumValue(
        entry.status,
        ["open", "accepted", "resolved"],
        `${rowPath}.status`,
        issues,
        "status"
      );
    }
  );
  const reviewRefs = [];
  rows(
    proposal.question_reviews,
    `${at}.question_reviews`,
    issues,
    ["id", "question", "outcome", "evidence_refs", "advisory_debt_ids"],
    ["id", "question", "outcome", "evidence_refs", "advisory_debt_ids"],
    (entry, rowPath) => {
      requiredString(entry.question, `${rowPath}.question`, issues);
      enumValue(
        entry.outcome,
        ["pass", "advisory", "fail"],
        `${rowPath}.outcome`,
        issues,
        "outcome"
      );
      stringArray(entry.evidence_refs, `${rowPath}.evidence_refs`, issues, { nonEmpty: true });
      stringArray(entry.advisory_debt_ids, `${rowPath}.advisory_debt_ids`, issues);
      for (const id of Array.isArray(entry.evidence_refs) ? entry.evidence_refs : [])
        reviewRefs.push(["evidence", id, `${rowPath}.evidence_refs`]);
      for (const id of Array.isArray(entry.advisory_debt_ids) ? entry.advisory_debt_ids : [])
        reviewRefs.push(["debt", id, `${rowPath}.advisory_debt_ids`]);
    }
  );
  for (const [kind, id, refPath] of reviewRefs) {
    const known = kind === "evidence" ? evidenceIds : debtIds;
    if (!known.has(id))
      issues.push(
        issue(refPath, `unknown ${kind === "evidence" ? "evidence" : "advisory debt"} id ${id}`)
      );
  }

  validateReview(proposal, at, issues);
  if (
    closed(proposal.presentation, ["summary", "audience", "sections"], `${at}.presentation`, issues)
  ) {
    requiredString(proposal.presentation.summary, `${at}.presentation.summary`, issues);
    requiredString(proposal.presentation.audience, `${at}.presentation.audience`, issues);
    stringArray(proposal.presentation.sections, `${at}.presentation.sections`, issues, {
      nonEmpty: true,
    });
  }
  if (
    closed(
      proposal.handoff,
      ["rfc_required", "implementation_ready", "dependencies", "constraints"],
      `${at}.handoff`,
      issues
    )
  ) {
    if (typeof proposal.handoff.rfc_required !== "boolean")
      issues.push(issue(`${at}.handoff.rfc_required`, "must be boolean"));
    if (typeof proposal.handoff.implementation_ready !== "boolean")
      issues.push(issue(`${at}.handoff.implementation_ready`, "must be boolean"));
    stringArray(proposal.handoff.dependencies, `${at}.handoff.dependencies`, issues);
    stringArray(proposal.handoff.constraints, `${at}.handoff.constraints`, issues, {
      nonEmpty: true,
    });
  }

  validateGlobalIds(proposal, at, issues);
  validateIdNamespaces(proposal, at, issues);

  return {
    ok: issues.length === 0,
    issues,
    content_sha256: issues.length === 0 ? proposalContentHash(proposal) : null,
  };
}

function validateGlobalIds(proposal, at, issues) {
  const collections = [
    proposal.source?.lineage,
    proposal.audience,
    proposal.jobs_to_be_done,
    proposal.evidence,
    proposal.assumptions,
    proposal.scope?.in_scope,
    proposal.scope?.non_goals,
    proposal.requirements,
    proposal.acceptance_criteria,
    proposal.edge_cases,
    proposal.design_requirements,
    proposal.success_metrics,
    proposal.alternatives,
    proposal.risks,
    proposal.open_decisions,
    proposal.resolved_decisions,
    proposal.question_reviews,
    proposal.advisory_debt,
  ];
  const seen = new Set();
  const reported = new Set();
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      if (!isObject(entry) || !isString(entry.id)) continue;
      if (seen.has(entry.id) && !reported.has(entry.id)) {
        issues.push(issue(at, `stable ids must be globally unique: ${entry.id}`));
        reported.add(entry.id);
      }
      seen.add(entry.id);
    }
  }
}

function validateIdNamespaces(proposal, at, issues) {
  const collections = [
    ["source.lineage", proposal.source?.lineage, "source:"],
    ["audience", proposal.audience, "audience:"],
    ["jobs_to_be_done", proposal.jobs_to_be_done, "jtbd:"],
    ["evidence", proposal.evidence, "evidence:"],
    ["assumptions", proposal.assumptions, "assumption:"],
    ["scope.in_scope", proposal.scope?.in_scope, "scope:"],
    ["scope.non_goals", proposal.scope?.non_goals, "non-goal:"],
    ["requirements", proposal.requirements, "req:"],
    ["acceptance_criteria", proposal.acceptance_criteria, "ac:"],
    ["edge_cases", proposal.edge_cases, "edge:"],
    ["design_requirements", proposal.design_requirements, "design:"],
    ["success_metrics", proposal.success_metrics, "metric:"],
    ["alternatives", proposal.alternatives, "alternative:"],
    ["risks", proposal.risks, "risk:"],
    ["open_decisions", proposal.open_decisions, "decision:"],
    ["resolved_decisions", proposal.resolved_decisions, "decision:"],
    ["question_reviews", proposal.question_reviews, "review:"],
    ["advisory_debt", proposal.advisory_debt, "debt:"],
  ];
  for (const [name, collection, prefix] of collections) {
    if (!Array.isArray(collection)) continue;
    for (const [index, entry] of collection.entries()) {
      if (isString(entry?.id) && !entry.id.startsWith(prefix))
        issues.push(issue(`${at}.${name}[${index}].id`, `${name} ids must start with ${prefix}`));
    }
  }
}

function validateReview(proposal, at, issues) {
  const reviewPath = `${at}.review`;
  if (
    !closed(
      proposal.review,
      ["status", "revision", "content_sha256", "completed_at"],
      reviewPath,
      issues
    )
  )
    return;
  enumValue(
    proposal.review.status,
    ["pending", "passed"],
    `${reviewPath}.status`,
    issues,
    "status"
  );
  if (proposal.review.status === "pending") {
    for (const field of ["revision", "content_sha256", "completed_at"])
      if (proposal.review[field] !== null)
        issues.push(issue(`${reviewPath}.${field}`, "must be null while review is pending"));
  } else {
    if (!Number.isInteger(proposal.review.revision) || proposal.review.revision < 1)
      issues.push(issue(`${reviewPath}.revision`, "must be a positive integer"));
    if (!SHA256.test(proposal.review.content_sha256 || ""))
      issues.push(issue(`${reviewPath}.content_sha256`, "must be a sha256 hash"));
    if (
      !ISO_8601.test(proposal.review.completed_at || "") ||
      Number.isNaN(Date.parse(proposal.review.completed_at))
    )
      issues.push(issue(`${reviewPath}.completed_at`, "must be an ISO-8601 UTC timestamp"));
  }
  if (proposal.review.status === "passed") {
    if (proposal.review.revision !== proposal.revision)
      issues.push(
        issue(`${reviewPath}.revision`, "review revision does not match current proposal revision")
      );
    if (proposal.review.content_sha256 !== proposalContentHash(proposal))
      issues.push(
        issue(
          `${reviewPath}.content_sha256`,
          "review content hash does not match current proposal content"
        )
      );
    if (
      !Array.isArray(proposal.question_reviews) ||
      proposal.question_reviews.length === 0 ||
      proposal.question_reviews.some((entry) => entry?.outcome === "fail")
    )
      issues.push(
        issue(
          `${at}.question_reviews`,
          "passed review requires covered questions with no failing outcome"
        )
      );
  }
  if (proposal.lifecycle !== "draft" && proposal.review.status !== "passed")
    issues.push(issue(reviewPath, "review must be passed after draft lifecycle"));
}

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function proposalBytesHash(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array) && typeof bytes !== "string")
    throw new TypeError("proposal bytes must be a Buffer, Uint8Array, or string");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function proposalContentHash(proposal) {
  const content = structuredClone(proposal);
  delete content.lifecycle;
  delete content.review;
  delete content.updated_at;
  return proposalBytesHash(Buffer.from(canonicalStringify(content)));
}

// Human approval is granted while the proposal is `reviewed`; the audit is
// written after the sole allowed lifecycle flip to `approved`. Bind every
// other canonical field so review metadata or timestamps cannot be swapped in
// between those two operations.
function proposalApprovalSnapshotHash(proposal) {
  const snapshot = structuredClone(proposal);
  delete snapshot.lifecycle;
  return proposalBytesHash(Buffer.from(canonicalStringify(snapshot)));
}

function validateRevisionTransition(previous, next) {
  const issues = [];
  const previousResult = validateProposal(previous, { path: "$previous" });
  const nextResult = validateProposal(next, { path: "$next" });
  issues.push(...previousResult.issues, ...nextResult.issues);
  if (!isObject(previous) || !isObject(next)) return { ok: false, issues };
  if (
    previous?.schema_version !== next?.schema_version ||
    previous?.id !== next?.id ||
    previous?.slug !== next?.slug
  ) {
    issues.push(issue("$next", "proposal schema and identity are immutable across revisions"));
  }
  if (previous.created_at !== next.created_at)
    issues.push(issue("$next.created_at", "created_at is immutable across revisions"));
  if (
    ISO_8601.test(previous.updated_at || "") &&
    ISO_8601.test(next.updated_at || "") &&
    Date.parse(next.updated_at) < Date.parse(previous.updated_at)
  )
    issues.push(issue("$next.updated_at", "updated_at cannot move backwards"));
  if (!Number.isInteger(previous?.revision) || !Number.isInteger(next?.revision))
    return { ok: false, issues };
  const changed = proposalContentHash(previous) !== proposalContentHash(next);
  if (changed) {
    const expected = previous.revision + 1;
    if (next.revision !== expected)
      issues.push(issue("$next.revision", `substantive changes require revision ${expected}`));
    if (next.lifecycle !== "draft" || next.review?.status !== "pending")
      issues.push(issue("$next", "substantive changes must return to draft with pending review"));
    if (next.updated_at === previous.updated_at)
      issues.push(issue("$next.updated_at", "substantive changes must advance updated_at"));
  } else if (next.revision !== previous.revision) {
    issues.push(issue("$next.revision", "lifecycle-only changes must retain the current revision"));
  }
  const transition = `${previous.lifecycle}->${next.lifecycle}`;
  const allowed = new Set([
    "draft->draft",
    "draft->reviewed",
    "reviewed->reviewed",
    "reviewed->approved",
    "reviewed->draft",
    "approved->approved",
    "approved->planned",
    "approved->draft",
    "planned->planned",
    "planned->in-progress",
    "planned->draft",
    "in-progress->in-progress",
    "in-progress->done",
    "in-progress->draft",
    "done->done",
    "done->draft",
  ]);
  if (!allowed.has(transition))
    issues.push(issue("$next.lifecycle", `lifecycle transition ${transition} is not allowed`));
  if (
    ["approved", ...POST_APPROVAL_LIFECYCLES].includes(previous.lifecycle) &&
    !changed &&
    next.lifecycle === "draft"
  )
    issues.push(
      issue(
        "$next.lifecycle",
        "post-approval lifecycle can only reopen through a substantive revision"
      )
    );
  return {
    ok: issues.length === 0,
    issues,
    substantive_change: changed,
    prior_content_sha256: proposalContentHash(previous),
    next_content_sha256: proposalContentHash(next),
  };
}

function validateApproval(proposal, approval, options = {}) {
  const issues = [];
  const at = options.path || "$approval";
  if (!closed(approval, APPROVAL_FIELDS, at, issues)) return { ok: false, issues };
  if (!isObject(proposal)) {
    issues.push(issue("$proposal", "approval verification requires a valid proposal object"));
    return { ok: false, issues };
  }
  const proposalResult = validateProposal(proposal, { path: "$proposal" });
  issues.push(...proposalResult.issues);
  for (const field of APPROVAL_FIELDS)
    if (!(field in approval)) issues.push(issue(`${at}.${field}`, "is required"));
  if (approval.schema_version !== 1) issues.push(issue(`${at}.schema_version`, "must equal 1"));
  if (approval.kind !== "proposal-approval")
    issues.push(issue(`${at}.kind`, "must equal proposal-approval"));
  if (approval.proposal_id !== proposal?.id)
    issues.push(issue(`${at}.proposal_id`, "does not match proposal identity"));
  if (approval.slug !== proposal?.slug)
    issues.push(issue(`${at}.slug`, "does not match proposal slug"));
  if (approval.revision !== proposal?.revision)
    issues.push(issue(`${at}.revision`, "does not match proposal revision"));
  const exactLifecycle = proposal?.lifecycle === "approved";
  const advancedLifecycle = POST_APPROVAL_LIFECYCLES.has(proposal?.lifecycle);
  if (!exactLifecycle && !(options.allowLifecycleAdvance && advancedLifecycle))
    issues.push(
      issue(
        "$.lifecycle",
        "approval requires approved lifecycle or an allowed downstream lifecycle"
      )
    );
  if (!SHA256.test(approval.proposal_sha256 || ""))
    issues.push(issue(`${at}.proposal_sha256`, "must be a sha256 hash"));
  if (!SHA256.test(approval.content_sha256 || ""))
    issues.push(issue(`${at}.content_sha256`, "must be a sha256 hash"));
  else if (approval.content_sha256 !== proposalContentHash(proposal))
    issues.push(issue(`${at}.content_sha256`, "content hash does not match proposal"));
  if (!isString(approval.approved_by))
    issues.push(issue(`${at}.approved_by`, "must identify the explicit approver"));
  if (!ISO_8601.test(approval.approved_at || "") || Number.isNaN(Date.parse(approval.approved_at)))
    issues.push(issue(`${at}.approved_at`, "must be an ISO-8601 UTC timestamp"));
  else if (
    ISO_8601.test(proposal.review?.completed_at || "") &&
    Date.parse(approval.approved_at) < Date.parse(proposal.review.completed_at)
  )
    issues.push(issue(`${at}.approved_at`, "approval cannot predate review completion"));
  if (approval.decision_id === null || approval.decision_sha256 === null) {
    if (approval.decision_id !== null || approval.decision_sha256 !== null)
      issues.push(issue(at, "decision_id and decision_sha256 must both be null or both be bound"));
  } else {
    if (!isString(approval.decision_id))
      issues.push(issue(`${at}.decision_id`, "must be a non-empty decision identity"));
    if (!SHA256.test(approval.decision_sha256 || ""))
      issues.push(issue(`${at}.decision_sha256`, "must be a sha256 hash"));
  }
  if (
    options.requireDecision &&
    (approval.decision_id === null || approval.decision_sha256 === null)
  )
    issues.push(issue(at, "trusted approval requires a bound Groom decision identity"));
  if (options.expectedDecision) {
    if (approval.decision_id !== options.expectedDecision.id)
      issues.push(issue(`${at}.decision_id`, "does not match the session approval decision"));
    if (approval.decision_sha256 !== options.expectedDecision.sha256)
      issues.push(issue(`${at}.decision_sha256`, "does not match the session approval decision"));
  }
  if (options.bytes === undefined)
    issues.push(
      issue(`${at}.proposal_sha256`, "exact proposal bytes are required to verify approval")
    );
  const exactBytesCurrent =
    options.bytes !== undefined && approval.proposal_sha256 === proposalBytesHash(options.bytes);
  if (options.bytes !== undefined && !exactBytesCurrent && !advancedLifecycle)
    issues.push(issue(`${at}.proposal_sha256`, "does not match exact proposal bytes"));
  return {
    ok: issues.length === 0,
    issues,
    exact_bytes_current: exactBytesCurrent,
    approval_basis: exactBytesCurrent ? "exact-approved-bytes" : "approved-semantic-revision",
  };
}

function buildApproval(
  proposal,
  bytes,
  { approvedBy, approvedAt, decisionId = null, decisionSha256 = null } = {}
) {
  const proposalResult = validateProposal(proposal);
  if (!proposalResult.ok)
    throw new Error(`cannot approve invalid proposal: ${proposalResult.issues[0].message}`);
  if (proposal.lifecycle !== "approved")
    throw new Error("proposal lifecycle must be approved before approval is recorded");
  if (!isString(approvedBy)) throw new Error("approvedBy must identify the explicit approver");
  if (!ISO_8601.test(approvedAt || "") || Number.isNaN(Date.parse(approvedAt)))
    throw new Error("approvedAt must be an ISO-8601 UTC timestamp");
  if (
    ISO_8601.test(proposal.review?.completed_at || "") &&
    Date.parse(approvedAt) < Date.parse(proposal.review.completed_at)
  )
    throw new Error("approvedAt cannot predate review completion");
  if ((decisionId === null) !== (decisionSha256 === null))
    throw new Error("decisionId and decisionSha256 must both be supplied or both omitted");
  if (decisionId !== null && !isString(decisionId))
    throw new Error("decisionId must be a non-empty decision identity");
  if (decisionSha256 !== null && !SHA256.test(decisionSha256))
    throw new Error("decisionSha256 must be a sha256 hash");
  return {
    schema_version: 1,
    kind: "proposal-approval",
    proposal_id: proposal.id,
    slug: proposal.slug,
    revision: proposal.revision,
    proposal_sha256: proposalBytesHash(bytes),
    content_sha256: proposalContentHash(proposal),
    approved_by: approvedBy,
    approved_at: approvedAt,
    decision_id: decisionId,
    decision_sha256: decisionSha256,
  };
}

function executionContract(proposal) {
  const result = validateProposal(proposal);
  if (!result.ok)
    throw new Error(`invalid proposal: ${result.issues[0].path} ${result.issues[0].message}`);
  return deepFreeze(
    structuredClone({
      schema_version: 1,
      proposal_id: proposal.id,
      slug: proposal.slug,
      revision: proposal.revision,
      lifecycle: proposal.lifecycle,
      title: proposal.title,
      outcome: proposal.outcome,
      size: proposal.size,
      scope: proposal.scope,
      requirements: proposal.requirements,
      acceptance_criteria: proposal.acceptance_criteria,
      edge_cases: proposal.edge_cases,
      design_requirements: proposal.design_requirements,
      success_metrics: proposal.success_metrics,
      open_decisions: proposal.open_decisions,
      risks: proposal.risks,
      handoff: proposal.handoff,
      content_sha256: result.content_sha256,
      approval_required: true,
    })
  );
}

function readApprovedProposal(filePath, options = {}) {
  const source = readProposal(filePath, {
    projectRoot: options.projectRoot,
    expectedSlug: options.expectedSlug,
  });
  if (
    source.proposal.lifecycle !== "approved" &&
    !POST_APPROVAL_LIFECYCLES.has(source.proposal.lifecycle)
  )
    throw new Error("canonical proposal is not approved or in a downstream lifecycle");
  const expectedApprovalPath = source.path.replace(/\.json$/, ".approval.json");
  const approvalSource = readApproval(options.approvalPath || expectedApprovalPath, {
    projectRoot: options.projectRoot,
  });
  if (approvalSource.path !== expectedApprovalPath)
    throw new Error("approval audit must be the sibling of the canonical proposal");
  const approvalResult = validateApproval(source.proposal, approvalSource.approval, {
    bytes: source.bytes,
    path: approvalSource.path,
    expectedDecision: options.expectedDecision,
    allowLifecycleAdvance: true,
    requireDecision: true,
  });
  if (!approvalResult.ok)
    throw new Error(
      `invalid proposal approval: ${approvalResult.issues
        .map((entry) => `${entry.path} ${entry.message}`)
        .join("; ")}`
    );
  return Object.freeze({
    kind: "approved-canonical-json",
    trustedApproval: true,
    source,
    approval: approvalSource.approval,
    approvalSource,
    contract: executionContract(source.proposal),
    exactBytesCurrent: approvalResult.exact_bytes_current,
    approvalBasis: approvalResult.approval_basis,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function resolveProposalPaths(projectRoot, slug, pmDir = "pm") {
  if (!SLUG.test(slug || "")) throw new Error("proposal slug must be a canonical slug");
  validateRelativeArgument(pmDir, "pmDir");
  const project = path.resolve(projectRoot);
  const proposalRoot = path.resolve(project, pmDir, "backlog", "proposals");
  assertWithin(project, proposalRoot);
  return Object.freeze({
    json: path.join(proposalRoot, `${slug}.json`),
    html: path.join(proposalRoot, `${slug}.html`),
    approval: path.join(proposalRoot, `${slug}.approval.json`),
    markdown: path.resolve(project, pmDir, "backlog", `${slug}.md`),
  });
}

function readProposal(filePath, options = {}) {
  if (!options.projectRoot) throw new Error("projectRoot is required for bounded proposal reads");
  const absolute = boundedExistingFile(filePath, options.projectRoot);
  const bytes = readBoundedNoFollow(absolute);
  if (absolute.endsWith(".json")) {
    let proposal;
    try {
      proposal = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`invalid proposal JSON: ${error.message}`);
    }
    const result = validateProposal(proposal, {
      path: absolute,
      expectedSlug: options.expectedSlug,
    });
    if (!result.ok)
      throw new Error(
        `invalid canonical proposal: ${result.issues.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`
      );
    return Object.freeze({
      kind: "canonical-json",
      trustedApproval: false,
      proposal,
      contentSha256: result.content_sha256,
      bytesSha256: proposalBytesHash(bytes),
      bytes,
      path: absolute,
    });
  }
  if (!absolute.endsWith(".md")) throw new Error("proposal source must end in .json or .md");
  if (!options.allowLegacy) throw new Error("legacy compatibility must be enabled explicitly");
  const parsed = parseLegacyMarkdown(bytes.toString("utf8"));
  return Object.freeze({
    kind: "legacy-markdown",
    trustedApproval: false,
    approvalReason: "legacy prose lifecycle is not trusted approval",
    path: absolute,
    bytesSha256: proposalBytesHash(bytes),
    bytes,
    ...parsed,
  });
}

function readApproval(filePath, options = {}) {
  if (!options.projectRoot) throw new Error("projectRoot is required for bounded approval reads");
  const absolute = boundedExistingFile(filePath, options.projectRoot);
  if (!absolute.endsWith(".approval.json"))
    throw new Error("approval source must end in .approval.json");
  const bytes = readBoundedNoFollow(absolute);
  let approval;
  try {
    approval = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`invalid approval JSON: ${error.message}`);
  }
  return Object.freeze({ approval, bytes, path: absolute });
}

function boundedExistingFile(filePath, projectRoot) {
  const providedRoot = path.resolve(projectRoot);
  const lexicalCandidate = path.resolve(filePath);
  const root = fs.realpathSync(providedRoot);
  const traversalRoot = isWithin(providedRoot, lexicalCandidate)
    ? providedRoot
    : isWithin(root, lexicalCandidate)
      ? root
      : null;
  if (!traversalRoot) throw new Error("proposal path is not bounded by the project root");
  const lexicalRelative = path.relative(traversalRoot, lexicalCandidate);
  let lexicalCurrent = traversalRoot;
  for (const part of lexicalRelative.split(path.sep).filter(Boolean)) {
    lexicalCurrent = path.join(lexicalCurrent, part);
    const stat = fs.lstatSync(lexicalCurrent);
    if (stat.isSymbolicLink())
      throw new Error("proposal path contains a symlink and is not bounded");
  }
  const candidate = fs.realpathSync(lexicalCandidate);
  assertWithin(root, candidate);
  const relative = path.relative(root, candidate);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw new Error("proposal path contains a symlink and is not bounded");
  }
  const stat = fs.statSync(candidate);
  if (!stat.isFile()) throw new Error("proposal path must be a regular file");
  if (stat.size > MAX_PROPOSAL_BYTES) throw new Error("proposal exceeds the 2 MiB read limit");
  return candidate;
}

function readBoundedNoFollow(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(filePath, flags);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("proposal path must be a regular file");
    if (stat.size > MAX_PROPOSAL_BYTES) throw new Error("proposal exceeds the 2 MiB read limit");
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("proposal changed during bounded read");
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error("proposal changed during bounded read");
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

function parseLegacyMarkdown(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("legacy proposal requires bounded YAML frontmatter");
  const metadata = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const field = line.match(/^([a-z][a-z0-9_-]*):\s*(.*?)\s*$/i);
    if (!field) throw new Error("legacy proposal frontmatter must contain flat scalar fields");
    let value = field[2];
    if (/^\[.*\]$/.test(value))
      value = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    else value = value.replace(/^(["'])(.*)\1$/, "$2");
    metadata[field[1]] = value;
  }
  if (!isString(metadata.title)) throw new Error("legacy proposal requires a title");
  return {
    title: metadata.title,
    lifecycle: metadata.status || "unknown",
    metadata: Object.freeze(metadata),
    body: match[2],
  };
}

function validateRelativeArgument(value, name) {
  if (
    !isString(value) ||
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    value.split("/").some((part) => part === ".." || part === "." || part === "")
  )
    throw new Error(`${name} must be a normalized project-relative path`);
}

function assertWithin(root, candidate) {
  if (!isWithin(root, candidate))
    throw new Error("proposal path is not bounded by the project root");
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function fieldName(at) {
  return String(at)
    .replace(/\[[0-9]+\]$/g, "")
    .split(".")
    .pop();
}

module.exports = {
  SCHEMA_VERSION,
  MAX_PROPOSAL_BYTES,
  canonicalStringify,
  proposalContentHash,
  proposalApprovalSnapshotHash,
  proposalBytesHash,
  validateProposal,
  validateApproval,
  buildApproval,
  validateRevisionTransition,
  executionContract,
  resolveProposalPaths,
  readProposal,
  readApproval,
  readApprovedProposal,
};
