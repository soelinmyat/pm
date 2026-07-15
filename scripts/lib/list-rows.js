"use strict";

const path = require("node:path");

const { classifyListAge } = require("../list-thresholds.js");
const { phaseLabel } = require("../phase-labels.js");
const { deriveShortId, disambiguateShortIds } = require("./derive-short-id.js");
const { buildOperationalSnapshot } = require("./operational-read-model.js");

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

function resumeHintForBacklog(kind, id) {
  if (kind === "shipped") return `view ${id}`;
  if (kind === "rfc") return `/pm:dev ${id}`;
  return `/pm:rfc ${id}`;
}

function resumeHintForSession(kind, id) {
  if (["groom", "rfc", "dev", "think"].includes(kind)) return `/pm:${kind} resume ${id}`;
  return `resume ${id}`;
}

function sourcePathFromSnapshot(portable, { pmDir, pmStateDir, sourceDir }) {
  const prefixes = [
    ["source/", sourceDir],
    ["state/", pmStateDir],
    ["pm/", pmDir],
  ];
  for (const [prefix, root] of prefixes) {
    if (portable.startsWith(prefix)) return path.join(root, portable.slice(prefix.length));
  }
  if (portable === "source") return sourceDir;
  if (portable === "state") return pmStateDir;
  if (portable === "pm") return pmDir;
  return portable;
}

function withOperationalIdentity(row, item) {
  return {
    ...row,
    id: item.id,
    lifecycle: item.lifecycle,
    artifactKind: item.artifact_kind,
  };
}

function linkageForBacklog(fm) {
  const linkage = {};
  if (fm.rfc) linkage.rfc = fm.rfc;
  if (fm.branch) linkage.branch = fm.branch;
  return Object.keys(linkage).length ? linkage : null;
}

function byUpdatedDesc(a, b) {
  return b.updatedEpoch - a.updatedEpoch;
}

function emitListRows(projectDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowSecs = Math.floor(now.getTime() / 1000);
  const snapshot = options.snapshot || buildOperationalSnapshot(projectDir, { now });
  const { pm_dir: pmDir, pm_state_dir: pmStateDir, source_dir: sourceDir } = snapshot.meta;

  const active = snapshot.sessions
    .map((session) => {
      const kind = session.kind;
      const sourcePath = sourcePathFromSnapshot(session.source_path, {
        pmDir,
        pmStateDir,
        sourceDir,
      });
      const shortId = deriveShortId(
        kind,
        { linear_id: session.linear_id, slug: session.slug },
        sourcePath
      );
      const phase = session.phase || "active";
      return {
        shortId,
        topic: session.topic,
        kind,
        phase,
        phaseLabel: phaseLabel(kind, phase),
        updatedEpoch: session.updated_epoch,
        ageRelative: formatAgeRelative(nowSecs - session.updated_epoch),
        staleness: classifyListAge(session.updated_epoch, nowSecs),
        resumeHint: resumeHintForSession(kind, shortId),
        linkage: null,
        sourcePath,
      };
    })
    .sort(byUpdatedDesc);
  const projectItem = (item) => {
    const kind =
      item.list_section === "shipped"
        ? "shipped"
        : item.list_section === "rfcs"
          ? "rfc"
          : "proposal";
    const phase = item.status || (kind === "shipped" ? "shipped" : "active");
    const sourcePath = sourcePathFromSnapshot(item.source_path, {
      pmDir,
      pmStateDir,
      sourceDir,
    });
    const shortId = deriveShortId(
      kind,
      { linear_id: item.id === item.slug ? "" : item.id, slug: "" },
      sourcePath
    );
    const row = {
      shortId,
      topic: item.title,
      kind,
      backlogKind: item.kind,
      phase,
      phaseLabel: phaseLabel(kind, phase),
      updatedEpoch: item.updatedEpoch,
      ageRelative: formatAgeRelative(nowSecs - item.updatedEpoch),
      staleness: classifyListAge(item.updatedEpoch, nowSecs),
      resumeHint: resumeHintForBacklog(kind, shortId),
      linkage: linkageForBacklog(item),
      sourcePath,
    };
    return withOperationalIdentity(row, item);
  };
  const proposals = snapshot.work_items
    .filter((item) => item.list_section === "proposals")
    .map(projectItem);
  const rfcs = snapshot.work_items.filter((item) => item.list_section === "rfcs").map(projectItem);
  const shipped = snapshot.work_items
    .filter((item) => item.list_section === "shipped")
    .map(projectItem);
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
      observationId: snapshot.meta.observation_id,
    },
    operational: {
      observationId: snapshot.meta.observation_id,
      leases: snapshot.leases,
      loop: snapshot.loop,
      recoveryActions: snapshot.recovery_actions,
    },
  };
}

module.exports = { emitListRows, formatAgeRelative, SHIPPED_CAP };
