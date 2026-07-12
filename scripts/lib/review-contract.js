"use strict";

const crypto = require("node:crypto");
const { isUiImpactPath } = require("./ui-impact");

const LENSES = Object.freeze(["bug", "design", "edge", "reuse", "quality", "efficiency"]);
const SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);
const OWNERS = Object.freeze(["review", "design-critique", "qa"]);
const DISPOSITIONS = Object.freeze(["open", "resolved", "dismissed", "deferred"]);
const DECISION_ACTIONS = Object.freeze([
  "keep-review",
  "handoff-design",
  "handoff-qa",
  "dismiss",
  "defer",
]);

function deriveLensApplicability(mode, changedFiles) {
  if (!new Set(["full", "code-scan"]).has(mode)) throw new Error("unknown Review mode");
  const logical = mode === "full" ? [...LENSES] : LENSES.filter((lens) => lens !== "design");
  const designApplicable = Array.isArray(changedFiles)
    ? changedFiles.some((item) => isUiImpactPath(item?.path))
    : false;
  return logical.map((name) => {
    if (name !== "design")
      return { name, applicable: true, reason: "required source-quality lens" };
    return designApplicable
      ? {
          name,
          applicable: true,
          reason: "UI source changed; inspect source-level design-system compliance only",
        }
      : { name, applicable: false, reason: "no UI source files changed" };
  });
}

function devReviewContext(session) {
  const acceptance = Array.isArray(session?.task?.acceptance_criteria)
    ? session.task.acceptance_criteria
    : [];
  return {
    run_id: session?.run_id,
    slug: session?.slug,
    review_mode: session?.routing?.review_mode,
    decision_version: session?.routing?.decision_version,
    acceptance_sha256: crypto.createHash("sha256").update(JSON.stringify(acceptance)).digest("hex"),
  };
}

function allocateLenses(lenses, maxWorkers, profile) {
  const unique = [...new Set(lenses || [])];
  if (
    unique.length === 0 ||
    unique.some((lens) => !LENSES.includes(lens)) ||
    !Number.isInteger(maxWorkers) ||
    maxWorkers < 1
  )
    throw new Error("allocation requires known lenses and a positive worker count");
  const count = Math.min(maxWorkers, unique.length);
  let groups;
  if (count === 1) groups = [[...unique]];
  else if (count === 2) {
    const preferred = [
      ["bug", "reuse", "efficiency"],
      ["edge", "design", "quality"],
    ];
    groups = preferred.map((group) => group.filter((lens) => unique.includes(lens)));
    for (const lens of unique)
      if (!groups.some((group) => group.includes(lens)))
        groups
          .reduce((shortest, group) => (group.length < shortest.length ? group : shortest))
          .push(lens);
    groups = groups.filter((group) => group.length > 0);
  } else {
    groups = [];
    for (const isolated of ["bug", "edge"]) if (unique.includes(isolated)) groups.push([isolated]);
    while (groups.length < count) groups.push([]);
    const flexibleStart = groups.filter((group) => group.length > 0).length;
    let cursor = flexibleStart;
    for (const lens of unique.filter((item) => !["bug", "edge"].includes(item))) {
      groups[cursor].push(lens);
      cursor = flexibleStart + ((cursor - flexibleStart + 1) % (groups.length - flexibleStart));
    }
    groups = groups.filter((group) => group.length > 0);
  }
  return groups.map((group, index) => ({
    worker_id: `reviewer-${index + 1}`,
    profile,
    lenses: group,
    independent: true,
  }));
}

function findingId(finding) {
  const evidence = [...(finding?.evidence || [])]
    .map((item) => {
      const artifact = new Set(["trace", "benchmark", "upstream-gate"]).has(item.kind);
      return `${normalize(item.kind)}:${normalize(item.ref)}:${normalize(
        artifact ? item.sha256 : "unbound"
      )}`;
    })
    .sort();
  const identity = [
    normalizePath(finding?.file),
    integer(finding?.line_start),
    integer(finding?.line_end),
    normalize(finding?.rule),
    evidence,
  ];
  return `rv-${crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20)}`;
}

function mergeSignals(signals, decisions) {
  const byId = new Map();
  for (const signal of signals || []) {
    const rows = byId.get(signal.id) || [];
    rows.push(structuredClone(signal));
    byId.set(signal.id, rows);
  }
  const decisionByFinding = new Map((decisions || []).map((item) => [item.finding_id, item]));
  const findings = [];
  const unresolved = [];
  for (const [id, rows] of [...byId].sort(([left], [right]) => left.localeCompare(right))) {
    rows.sort((left, right) => String(left.reviewer_id).localeCompare(String(right.reviewer_id)));
    const decision = decisionByFinding.get(id) || null;
    const lead = [...rows].sort(
      (left, right) =>
        right.confidence - left.confidence ||
        severityRank(right.severity) - severityRank(left.severity) ||
        String(left.reviewer_id).localeCompare(String(right.reviewer_id))
    )[0];
    const severity = rows
      .map((row) => row.severity)
      .sort((left, right) => severityRank(right) - severityRank(left))[0];
    const disputed = materialDisagreement(rows);
    const canonical = {
      id,
      category: lead.category,
      severity,
      confidence: Math.max(...rows.map((row) => row.confidence)),
      file: lead.file,
      line_start: lead.line_start,
      line_end: lead.line_end,
      rule: lead.rule,
      issue: lead.issue,
      impact: lead.impact,
      fix: lead.fix,
      fix_kind: lead.fix_kind,
      verify: lead.verify,
      evidence: lead.evidence,
      change_anchors: lead.change_anchors,
      owner: "review",
      disposition: lead.disposition,
      decision_required: rows.some((row) => row.decision_required === true),
      disputed,
      decision,
      signals: rows,
    };
    const decisionAuthoritative = applyDecision(canonical, decision);
    if (
      (decision && !decisionAuthoritative) ||
      ((disputed || canonical.decision_required) && !decisionAuthoritative)
    )
      unresolved.push(id);
    findings.push(canonical);
  }
  markCrossFindingConflicts(findings, unresolved);
  return { findings, unresolved_disagreements: [...new Set(unresolved)].sort() };
}

function markCrossFindingConflicts(findings, unresolved) {
  const byFile = new Map();
  for (const finding of findings) {
    const file = normalizePath(finding.file);
    const rows = byFile.get(file) || [];
    rows.push(finding);
    byFile.set(file, rows);
  }
  for (const rows of byFile.values()) {
    rows.sort(
      (left, right) =>
        left.line_start - right.line_start ||
        left.line_end - right.line_end ||
        left.id.localeCompare(right.id)
    );
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      const left = rows[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const right = rows[rightIndex];
        if (right.line_start > left.line_end) break;
        const overlaps = left.line_start <= right.line_end && right.line_start <= left.line_end;
        const incompatibleFix =
          left.fix_kind !== right.fix_kind || normalize(left.fix) !== normalize(right.fix);
        if (!overlaps || !incompatibleFix) continue;
        left.disputed = true;
        right.disputed = true;
        unresolved.push(left.id, right.id);
      }
    }
  }
}

function materialDisagreement(rows) {
  if (rows.length < 2) return false;
  const severities = rows.map((row) => severityRank(row.severity));
  const owners = new Set(rows.map((row) => row.owner));
  const dispositions = new Set(rows.map((row) => row.disposition));
  const fixKinds = new Set(rows.map((row) => row.fix_kind));
  const fixes = new Set(rows.map((row) => normalize(row.fix)));
  const decisionRequirements = new Set(rows.map((row) => row.decision_required));
  return (
    Math.max(...severities) - Math.min(...severities) > 1 ||
    owners.size > 1 ||
    dispositions.size > 1 ||
    fixKinds.size > 1 ||
    fixes.size > 1 ||
    decisionRequirements.size > 1
  );
}

function applyDecision(finding, decision) {
  if (!decision) return false;
  if (!DECISION_ACTIONS.includes(decision.action)) return false;
  if (decision.action === "keep-review") {
    finding.owner = "review";
    finding.disposition = "open";
    // Keeping ownership and disposition is monotonic, but a repository-local
    // row still cannot authenticate resolution of a dispute or decision gate.
    // Preserve it for audit while leaving authority-bearing state unresolved.
    return false;
  }
  // A repository file cannot prove that a human, rather than the reviewing
  // model, authorized a blocker-reducing action. Preserve the requested action
  // for audit, but never let it dismiss, defer, or hand off gate authority.
  return false;
}

function severityRank(value) {
  return SEVERITIES.indexOf(value);
}

function normalize(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizePath(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/");
}

function integer(value) {
  return Number.isInteger(value) ? value : null;
}

function changeAnchorText(anchor) {
  const cause =
    anchor?.side === "path"
      ? `${anchor.path} [path]`
      : `${anchor?.path || "unknown"} [${anchor?.side || "unknown"} ${anchor?.line_start}-${anchor?.line_end}]`;
  return `${cause} → ${anchor?.affected_ref || "unbound"} — ${anchor?.relation || "missing relation"}`;
}

module.exports = {
  DECISION_ACTIONS,
  DISPOSITIONS,
  LENSES,
  OWNERS,
  SEVERITIES,
  allocateLenses,
  changeAnchorText,
  deriveLensApplicability,
  devReviewContext,
  findingId,
  mergeSignals,
  severityRank,
};
