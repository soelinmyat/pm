"use strict";

const { classifyListAge } = require("../list-thresholds.js");
const { phaseLabel } = require("../phase-labels.js");
const { disambiguateShortIds } = require("./derive-short-id.js");
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
      const shortId = session.linear_id || session.id;
      const phase = session.phase || "active";
      return {
        id: session.id,
        shortId,
        topic: session.topic,
        kind,
        phase,
        phaseLabel: phaseLabel(kind, phase),
        lifecycle: "active_session",
        artifactKind: kind,
        updatedEpoch: session.updated_epoch,
        ageRelative: formatAgeRelative(nowSecs - session.updated_epoch),
        staleness: classifyListAge(session.updated_epoch, nowSecs),
        resumeHint: session.action,
        linkage: null,
        sourcePath: session.source_path,
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
    const phase = item.status || item.lifecycle;
    return {
      id: item.id,
      shortId: item.id,
      topic: item.title,
      kind,
      backlogKind: item.kind,
      artifactKind: item.artifact_kind,
      lifecycle: item.lifecycle,
      phase,
      phaseLabel: phaseLabel(kind, phase),
      updatedEpoch: item.updatedEpoch,
      ageRelative: formatAgeRelative(nowSecs - item.updatedEpoch),
      staleness: classifyListAge(item.updatedEpoch, nowSecs),
      resumeHint: resumeHintForBacklog(kind, item.id),
      linkage: linkageForBacklog(item),
      recoveryAction:
        snapshot.recovery_actions.find((action) => action.target_id === item.id) || null,
      sourcePath: item.source_path,
    };
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
