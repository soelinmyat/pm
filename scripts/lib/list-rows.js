"use strict";

const path = require("path");

const { resolvePmPaths } = require("../resolve-pm-dir.js");
const {
  listGroomSessions,
  listRfcSessions,
  listDevSessions,
  listThinkSessions,
  listMarkdownFiles,
  safeRead,
  safeStat,
  dateToEpoch,
  frontmatterValue,
} = require("./session-scan.js");
const { classifyListAge } = require("../list-thresholds.js");
const { phaseLabel } = require("../phase-labels.js");
const { deriveShortId, disambiguateShortIds } = require("./derive-short-id.js");

const SHIPPED_CAP = 3;

function formatAgeRelative(ageSecs) {
  if (ageSecs < 0) return "just now";
  if (ageSecs < 60) return `${ageSecs}s ago`;
  const mins = Math.floor(ageSecs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function resumeHintForSession(descriptor) {
  const { kind } = descriptor;
  const id = descriptor.shortId;
  if (kind === "groom") return `/pm:groom resume ${id}`;
  if (kind === "rfc") return `/pm:rfc resume ${id}`;
  if (kind === "dev") return `/pm:dev resume ${id}`;
  if (kind === "think") return `/pm:think resume ${id}`;
  return `resume ${id}`;
}

function resumeHintForBacklog(kind, id, frontmatter) {
  if (kind === "shipped") return `view ${id}`;
  if (kind === "rfc") return `/pm:dev ${id}`;
  return `/pm:rfc ${id}`;
}

function readBacklogFrontmatter(filePath) {
  const text = safeRead(filePath);
  return {
    text,
    status: frontmatterValue(text, "status"),
    title: frontmatterValue(text, "title"),
    updated: frontmatterValue(text, "updated"),
    rfc: frontmatterValue(text, "rfc"),
    branch: frontmatterValue(text, "branch"),
    linear_id: frontmatterValue(text, "linear_id") || frontmatterValue(text, "id"),
  };
}

function linkageForBacklog(fm) {
  const linkage = {};
  if (fm.rfc) linkage.rfc = fm.rfc;
  if (fm.branch) linkage.branch = fm.branch;
  return Object.keys(linkage).length ? linkage : null;
}

function buildSessionRow(descriptor, nowSecs) {
  const frontmatter = {
    linear_id: descriptor.linearId || "",
    slug: descriptor.slug || "",
  };
  const shortId = deriveShortId(descriptor.kind, frontmatter, descriptor.filePath);
  const phase = descriptor.stage || "active";
  const ageSecs = nowSecs - descriptor.updatedEpoch;
  const row = {
    shortId,
    topic: descriptor.topic,
    kind: descriptor.kind,
    phase,
    phaseLabel: phaseLabel(descriptor.kind, phase),
    updatedEpoch: descriptor.updatedEpoch,
    ageRelative: formatAgeRelative(ageSecs),
    staleness: classifyListAge(descriptor.updatedEpoch, nowSecs),
    resumeHint: "", // set after shortId is final
    linkage: null,
    sourcePath: descriptor.filePath,
  };
  row.resumeHint = resumeHintForSession({ ...row });
  return row;
}

function buildBacklogRow(kind, filePath, fm, nowSecs) {
  const stat = safeStat(filePath);
  const updatedEpoch = dateToEpoch(fm.updated) || (stat ? Math.floor(stat.mtimeMs / 1000) : 0);
  const frontmatter = { linear_id: fm.linear_id, slug: "" };
  const shortId = deriveShortId(kind, frontmatter, filePath);
  const topic = fm.title || path.basename(filePath, ".md");
  const phase = fm.status || "active";
  const ageSecs = nowSecs - updatedEpoch;
  const row = {
    shortId,
    topic,
    kind,
    phase,
    phaseLabel: phaseLabel(kind, phase),
    updatedEpoch,
    ageRelative: formatAgeRelative(ageSecs),
    staleness: classifyListAge(updatedEpoch, nowSecs),
    resumeHint: "",
    linkage: linkageForBacklog(fm),
    sourcePath: filePath,
  };
  row.resumeHint = resumeHintForBacklog(kind, shortId, fm);
  return row;
}

function collectActive(sourceDir, nowSecs) {
  const descriptors = [
    ...listGroomSessions({ sourceDir }),
    ...listRfcSessions({ sourceDir }),
    ...listDevSessions({ sourceDir }),
    ...listThinkSessions({ sourceDir }),
  ];
  return descriptors.map((d) => buildSessionRow(d, nowSecs));
}

function collectBacklog(pmDir, nowSecs) {
  const backlogDir = path.join(pmDir, "backlog");
  const files = listMarkdownFiles(backlogDir);
  const proposals = [];
  const rfcs = [];
  const shipped = [];
  for (const filePath of files) {
    const fm = readBacklogFrontmatter(filePath);
    if (fm.status === "shipped") {
      shipped.push(buildBacklogRow("shipped", filePath, fm, nowSecs));
    } else if (fm.rfc) {
      rfcs.push(buildBacklogRow("rfc", filePath, fm, nowSecs));
    } else {
      proposals.push(buildBacklogRow("proposal", filePath, fm, nowSecs));
    }
  }
  return { proposals, rfcs, shipped };
}

function byUpdatedDesc(a, b) {
  return b.updatedEpoch - a.updatedEpoch;
}

function emitListRows(projectDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowSecs = Math.floor(now.getTime() / 1000);

  const { pmDir, pmStateDir } = resolvePmPaths(projectDir);
  const sourceDir = projectDir;

  const active = collectActive(sourceDir, nowSecs).sort(byUpdatedDesc);
  const { proposals, rfcs, shipped } = collectBacklog(pmDir, nowSecs);
  proposals.sort(byUpdatedDesc);
  rfcs.sort(byUpdatedDesc);
  shipped.sort(byUpdatedDesc);
  const shippedCapped = shipped.slice(0, SHIPPED_CAP);

  // Disambiguate collisions within each kind (across the whole payload).
  disambiguateShortIds([...active, ...proposals, ...rfcs, ...shippedCapped]);

  return {
    active,
    proposals,
    rfcs,
    shipped: shippedCapped,
    meta: {
      pmDir,
      pmStateDir,
      sourceDir,
      generatedAt: new Date(nowSecs * 1000).toISOString(),
    },
  };
}

module.exports = { emitListRows, formatAgeRelative, SHIPPED_CAP };
