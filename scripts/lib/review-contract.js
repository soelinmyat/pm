"use strict";

const crypto = require("node:crypto");

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
    .map((item) => `${normalize(item.kind)}:${normalize(item.ref)}`)
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
      owner: lead.owner,
      disposition: lead.disposition,
      decision_required: rows.some((row) => row.decision_required === true),
      disputed,
      decision,
      signals: rows,
    };
    applyDecision(canonical, decision);
    if ((disputed || canonical.decision_required) && !decision) unresolved.push(id);
    findings.push(canonical);
  }
  return { findings, unresolved_disagreements: unresolved };
}

function materialDisagreement(rows) {
  if (rows.length < 2) return false;
  const severities = rows.map((row) => severityRank(row.severity));
  const owners = new Set(rows.map((row) => row.owner));
  const dispositions = new Set(rows.map((row) => row.disposition));
  const fixKinds = new Set(rows.map((row) => row.fix_kind));
  const decisionRequirements = new Set(rows.map((row) => row.decision_required));
  return (
    Math.max(...severities) - Math.min(...severities) > 1 ||
    owners.size > 1 ||
    dispositions.size > 1 ||
    fixKinds.size > 1 ||
    decisionRequirements.size > 1
  );
}

function applyDecision(finding, decision) {
  if (!decision) return;
  if (!DECISION_ACTIONS.includes(decision.action)) return;
  if (decision.action === "keep-review") {
    finding.owner = "review";
    finding.disposition = "open";
  } else if (decision.action === "handoff-design") {
    finding.owner = "design-critique";
    finding.disposition = "open";
  } else if (decision.action === "handoff-qa") {
    finding.owner = "qa";
    finding.disposition = "open";
  } else if (decision.action === "dismiss") finding.disposition = "dismissed";
  else if (decision.action === "defer") finding.disposition = "deferred";
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

module.exports = {
  DECISION_ACTIONS,
  DISPOSITIONS,
  LENSES,
  OWNERS,
  SEVERITIES,
  allocateLenses,
  findingId,
  mergeSignals,
  severityRank,
};
