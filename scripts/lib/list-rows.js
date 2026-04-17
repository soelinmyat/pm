"use strict";

const path = require("path");

const { resolvePmPaths } = require("../resolve-pm-dir.js");
const { parseFrontmatter } = require("../kb-frontmatter.js");
const {
  listGroomSessions,
  listRfcSessions,
  listDevSessions,
  listThinkSessions,
  listMarkdownFiles,
  safeRead,
  safeStat,
  dateToEpoch,
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

function resumeHintForSession(kind, id) {
  if (kind === "groom") return `/pm:groom resume ${id}`;
  if (kind === "rfc") return `/pm:rfc resume ${id}`;
  if (kind === "dev") return `/pm:dev resume ${id}`;
  if (kind === "think") return `/pm:think resume ${id}`;
  return `resume ${id}`;
}

function resumeHintForBacklog(kind, id) {
  if (kind === "shipped") return `view ${id}`;
  if (kind === "rfc") return `/pm:dev ${id}`;
  return `/pm:rfc ${id}`;
}

function readBacklogFrontmatter(filePath) {
  const { data } = parseFrontmatter(safeRead(filePath));
  return {
    status: data.status || "",
    title: data.title || "",
    updated: data.updated || "",
    rfc: data.rfc || "",
    branch: data.branch || "",
    linear_id: data.linear_id || data.id || "",
  };
}

function linkageForBacklog(fm) {
  const linkage = {};
  if (fm.rfc) linkage.rfc = fm.rfc;
  if (fm.branch) linkage.branch = fm.branch;
  return Object.keys(linkage).length ? linkage : null;
}

function buildSessionRow(descriptor, nowSecs) {
  const { kind, filePath, updatedEpoch } = descriptor;
  const shortId = deriveShortId(
    kind,
    { linear_id: descriptor.linearId || "", slug: descriptor.slug || "" },
    filePath
  );
  const phase = descriptor.stage || "active";
  return {
    shortId,
    topic: descriptor.topic,
    kind,
    phase,
    phaseLabel: phaseLabel(kind, phase),
    updatedEpoch,
    ageRelative: formatAgeRelative(nowSecs - updatedEpoch),
    staleness: classifyListAge(updatedEpoch, nowSecs),
    resumeHint: resumeHintForSession(kind, shortId),
    linkage: null,
    sourcePath: filePath,
  };
}

function buildBacklogRow(kind, filePath, fm, nowSecs) {
  // Fall back to mtime only when frontmatter lacks `updated` — saves a stat
  // call per row on backlogs where every file has proper frontmatter.
  let updatedEpoch = dateToEpoch(fm.updated);
  if (!updatedEpoch) {
    const stat = safeStat(filePath);
    updatedEpoch = stat ? Math.floor(stat.mtimeMs / 1000) : 0;
  }
  const shortId = deriveShortId(kind, { linear_id: fm.linear_id, slug: "" }, filePath);
  const phase = fm.status || "active";
  return {
    shortId,
    topic: fm.title || path.basename(filePath, ".md"),
    kind,
    phase,
    phaseLabel: phaseLabel(kind, phase),
    updatedEpoch,
    ageRelative: formatAgeRelative(nowSecs - updatedEpoch),
    staleness: classifyListAge(updatedEpoch, nowSecs),
    resumeHint: resumeHintForBacklog(kind, shortId),
    linkage: linkageForBacklog(fm),
    sourcePath: filePath,
  };
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
