"use strict";

// Follow-up items left by a Design Director run: system notes and the
// findings a report marks `filed`. The collector reads every director report
// in one session folder and returns the list; the ledger in session.json
// records which items were filed, merged, declined or are still pending.
// Nothing here files anything: the agent files through the existing capture
// paths and records the outcome.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readBoundedJsonFile } = require("./safe-json-file");
const { isRfc3339DateTime } = require("./iso-time");

const REPORT_SCHEMA = "design-director-report";
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const RUN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const REVIEW_RE = /^review-([1-5])$/;
const SOURCE_RE =
  /^design-critique\/director\/[a-z0-9][a-z0-9._-]{0,63}\/review-[1-5]\/report\.json$/;
const KEY_RE = /^fu_[a-f0-9]{16}$/;
const LINEAR_REF_RE = /^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,8}$/;
const BACKLOG_REF_RE = /^backlog\/[a-z0-9][a-z0-9-]{0,199}\.md$/;
const CLASSES = new Set(["system-note", "small", "elevation", "major"]);
const STATES = new Set(["pending", "filed", "merged", "declined"]);
const TRACKERS = new Set(["linear", "backlog"]);
const ACTIONS = new Set(["created", "occurrence-added"]);
const SCOPES = new Set(["system", "local"]);
const MAX_CHANGE_CHARS = 2000;
const ITEM_FIELDS = [
  "key",
  "class",
  "dimension",
  "scope",
  "change",
  "source",
  "state",
  "tracker",
  "ref",
  "action",
  "into",
  "updated_at",
];
const SYSTEM_BASIS =
  "system note: the fix needs a shared component, a token or a screen outside the declared surfaces";
const LOCAL_BASIS = "leftover of this change: its fix lies on the changed screens";
const STOP_WORDS = new Set(["the", "and", "for", "with", "page", "screen", "view"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value) {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function listDirectory(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Every report.json under design-critique/director/{run}/review-{N}/, in run
// then review order. Only real directories are followed.
function discoverReports(sessionDir) {
  const base = path.join(sessionDir, "design-critique", "director");
  const found = [];
  for (const run of listDirectory(base)) {
    if (!run.isDirectory() || !RUN_RE.test(run.name)) continue;
    for (const review of listDirectory(path.join(base, run.name))) {
      const match = REVIEW_RE.exec(review.name);
      if (!review.isDirectory() || !match) continue;
      const absolute = path.join(base, run.name, review.name, "report.json");
      if (!fs.existsSync(absolute) && !isSymlink(absolute)) continue;
      found.push({
        run: run.name,
        review: Number(match[1]),
        absolute,
        source: `design-critique/director/${run.name}/${review.name}/report.json`,
      });
    }
  }
  return found.sort((a, b) => (a.run === b.run ? a.review - b.review : a.run < b.run ? -1 : 1));
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

// A finding is a follow-up when its latest status is `filed`, or when it is a
// system note that was not fixed. Open small findings and elevations are not:
// they block until round 3, where the report files them.
function isFollowUp(finding) {
  if (!isObject(finding) || !CLASSES.has(finding.class)) return false;
  if (finding.status === "filed") return true;
  return finding.class === "system-note" && finding.status === "open";
}

function itemKey(finding) {
  const identity =
    finding.class === "system-note"
      ? ["system", normalize(finding.change)]
      : [
          "local",
          finding.class,
          finding.dimension,
          normalize(finding.location),
          normalize(finding.change),
        ];
  return `fu_${crypto.createHash("sha256").update(identity.join("|")).digest("hex").slice(0, 16)}`;
}

function surfaceCheck(location, designContext) {
  const surfaces = Array.isArray(designContext?.surfaces) ? designContext.surfaces : [];
  if (surfaces.length === 0) return null;
  const present = new Set(words(location));
  const named = surfaces.some((surface) => words(surface?.name).some((word) => present.has(word)));
  return named
    ? null
    : "location names no declared surface; confirm the fix stays inside the declared surfaces, or record it as a system item";
}

function collectFollowUps({ sessionDir, designContext = null } = {}) {
  const reports = [];
  const skipped = [];
  // Latest occurrence of each finding per run: earlier reviews carry the
  // same id forward with its current status.
  const latest = new Map();
  for (const entry of discoverReports(sessionDir)) {
    let report;
    try {
      report = readBoundedJsonFile(entry.absolute, MAX_REPORT_BYTES);
    } catch (error) {
      skipped.push({ report: entry.source, reason: `cannot be read: ${error.message}` });
      continue;
    }
    if (!isObject(report) || report.schema !== REPORT_SCHEMA || !Array.isArray(report.findings)) {
      skipped.push({ report: entry.source, reason: `is not a ${REPORT_SCHEMA}` });
      continue;
    }
    reports.push(entry.source);
    for (const finding of report.findings) {
      if (!isObject(finding) || !text(finding.id)) continue;
      latest.set(`${entry.run}\u0000${finding.id}`, { entry, finding });
    }
  }

  const items = new Map();
  for (const { entry, finding } of latest.values()) {
    if (!isFollowUp(finding)) continue;
    const key = itemKey(finding);
    const source = {
      report: entry.source,
      run: entry.run,
      review: entry.review,
      finding_id: finding.id,
    };
    const existing = items.get(key);
    if (existing) {
      existing.sources.push(source);
      continue;
    }
    const system = finding.class === "system-note";
    items.set(key, {
      key,
      class: finding.class,
      dimension: String(finding.dimension || ""),
      scope: system ? "system" : "local",
      scope_basis: system ? SYSTEM_BASIS : LOCAL_BASIS,
      scope_check: system ? null : surfaceCheck(finding.location, designContext),
      location: String(finding.location || ""),
      observation: String(finding.observation || ""),
      change: String(finding.change || ""),
      first_seen_round: Number.isInteger(finding.first_seen_round)
        ? finding.first_seen_round
        : null,
      report: null,
      sources: [source],
    });
  }
  const order = (a, b) =>
    a.run === b.run
      ? a.review - b.review || a.finding_id.localeCompare(b.finding_id)
      : a.run < b.run
        ? -1
        : 1;
  const list = [...items.values()].map((item) => {
    item.sources.sort(order);
    item.report = path.join(sessionDir, ...item.sources.at(-1).report.split("/"));
    return item;
  });
  list.sort((a, b) => order(a.sources[0], b.sources[0]));
  return { reports, skipped, items: list };
}

// Filing waits for an observed merge: a delivery receipt in the ship
// evidence with state MERGED and a merge commit. A parked run never files.
function deliveryState(session) {
  const blockers = Array.isArray(session?.blockers) ? session.blockers : [];
  if (blockers.some((blocker) => blocker?.code === "design-director-parked"))
    return { merged: false, merge_sha: null, reason: "parked" };
  const records = Array.isArray(session?.evidence?.ship?.records)
    ? session.evidence.ship.records
    : [];
  for (const record of records) {
    if (record?.kind !== "delivery" || record.exit_code !== 0 || !text(record.artifact)) continue;
    try {
      const receipt = readBoundedJsonFile(record.artifact, 1024 * 1024);
      if (receipt?.state === "MERGED" && text(receipt.merge_sha))
        return { merged: true, merge_sha: receipt.merge_sha, reason: "merged" };
    } catch {
      // An unreadable receipt proves nothing.
    }
  }
  return { merged: false, merge_sha: null, reason: "not merged" };
}

function validateRef(tracker, ref) {
  if (tracker === "linear") return LINEAR_REF_RE.test(ref);
  if (tracker === "backlog") return BACKLOG_REF_RE.test(ref);
  return false;
}

function validateFollowUps(value, errors, base = "$.follow_ups") {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push(issue(base, "must be an object"));
    return;
  }
  for (const field of Object.keys(value))
    if (!["schema_version", "merge_sha", "items"].includes(field))
      errors.push(issue(`${base}.${field}`, "unknown field"));
  if (value.schema_version !== 1) errors.push(issue(`${base}.schema_version`, "must equal 1"));
  if (!text(value.merge_sha) || value.merge_sha.length > 200)
    errors.push(issue(`${base}.merge_sha`, "must name the observed merge commit"));
  if (!Array.isArray(value.items)) {
    errors.push(issue(`${base}.items`, "must be an array"));
    return;
  }
  const keys = new Set(value.items.map((item) => item?.key));
  const seen = new Set();
  value.items.forEach((item, index) => {
    const at = `${base}.items[${index}]`;
    if (!isObject(item)) return errors.push(issue(at, "must be an object"));
    for (const field of Object.keys(item))
      if (!ITEM_FIELDS.includes(field)) errors.push(issue(`${at}.${field}`, "unknown field"));
    for (const field of ITEM_FIELDS)
      if (!Object.hasOwn(item, field)) errors.push(issue(`${at}.${field}`, "required"));
    if (typeof item.key !== "string" || !KEY_RE.test(item.key))
      errors.push(issue(`${at}.key`, "must be an fu_ key"));
    else if (seen.has(item.key)) errors.push(issue(`${at}.key`, "must be unique"));
    seen.add(item.key);
    if (!CLASSES.has(item.class)) errors.push(issue(`${at}.class`, "must be a follow-up class"));
    if (!text(item.dimension)) errors.push(issue(`${at}.dimension`, "required"));
    if (!SCOPES.has(item.scope)) errors.push(issue(`${at}.scope`, "must be system or local"));
    if (!text(item.change) || item.change.length > MAX_CHANGE_CHARS)
      errors.push(issue(`${at}.change`, `must be 1 to ${MAX_CHANGE_CHARS} characters`));
    if (typeof item.source !== "string" || !SOURCE_RE.test(item.source))
      errors.push(issue(`${at}.source`, "must be a director report path inside the session"));
    if (!isRfc3339DateTime(item.updated_at))
      errors.push(issue(`${at}.updated_at`, "must be a date-time"));
    if (!STATES.has(item.state)) {
      errors.push(issue(`${at}.state`, `must be one of ${[...STATES].join(", ")}`));
      return undefined;
    }
    const filed = item.state === "filed";
    const merged = item.state === "merged";
    if (filed) {
      if (!TRACKERS.has(item.tracker))
        errors.push(issue(`${at}.tracker`, "a filed item names linear or backlog"));
      else if (typeof item.ref !== "string" || !validateRef(item.tracker, item.ref))
        errors.push(issue(`${at}.ref`, `must be a ${item.tracker} reference`));
      if (!ACTIONS.has(item.action))
        errors.push(issue(`${at}.action`, "a filed item was created or had an occurrence added"));
    } else
      for (const field of ["tracker", "ref", "action"])
        if (item[field] !== null)
          errors.push(issue(`${at}.${field}`, `only a filed item has a ${field}`));
    if (merged) {
      if (typeof item.into !== "string" || item.into === item.key || !keys.has(item.into))
        errors.push(issue(`${at}.into`, "must name another item in this ledger"));
    } else if (item.into !== null) errors.push(issue(`${at}.into`, "only a merged item has into"));
    return undefined;
  });
}

// Adds newly collected items as pending. Existing entries keep their state.
function syncLedger(ledger, items, mergeSha, now) {
  const current = isObject(ledger) ? ledger : { schema_version: 1, merge_sha: mergeSha, items: [] };
  const known = new Set(current.items.map((item) => item.key));
  const added = items
    .filter((item) => !known.has(item.key))
    .map((item) => ({
      key: item.key,
      class: item.class,
      dimension: item.dimension || "unspecified",
      scope: item.scope,
      // A checked report always names the change; fall back so an older
      // report without one cannot make the session invalid.
      change: (
        item.change.trim() ||
        item.observation.trim() ||
        item.location.trim() ||
        "unnamed"
      ).slice(0, MAX_CHANGE_CHARS),
      source: item.sources.at(-1).report,
      state: "pending",
      tracker: null,
      ref: null,
      action: null,
      into: null,
      updated_at: now,
    }));
  return {
    changed: added.length > 0 || !isObject(ledger),
    ledger: { ...current, items: [...current.items, ...added] },
  };
}

function refusal(message, kind = "precondition") {
  const error = new Error(message);
  error.followUpRefusal = kind;
  return error;
}

// Applies one recorded outcome. A filed item is final: recording the same
// filing again is a no-op, and anything else is refused so a rerun never
// files twice.
function applyRecord(ledger, request, now) {
  const items = isObject(ledger) && Array.isArray(ledger.items) ? ledger.items : [];
  const index = items.findIndex((item) => item.key === request.key);
  if (index < 0) throw refusal(`no follow-up item ${request.key}; run follow-ups first`);
  if (!STATES.has(request.state))
    throw refusal(`--state must be one of ${[...STATES].join(", ")}`, "invalid");
  if (request.scope !== undefined && !SCOPES.has(request.scope))
    throw refusal("--scope must be system or local", "invalid");
  const filed = request.state === "filed";
  if (filed) {
    if (!TRACKERS.has(request.tracker))
      throw refusal("a filed item needs --tracker linear or backlog", "invalid");
    if (!validateRef(request.tracker, request.ref || ""))
      throw refusal(
        request.tracker === "linear"
          ? "--ref must be a Linear identifier such as CLE-123"
          : "--ref must be backlog/{slug}.md",
        "invalid"
      );
    if (!ACTIONS.has(request.action))
      throw refusal("a filed item needs --action created or occurrence-added", "invalid");
  } else if (["tracker", "ref", "action"].some((field) => request[field] !== undefined))
    throw refusal("--tracker, --ref and --action apply only to --state filed", "invalid");
  if (request.state === "merged") {
    const target = items.find((item) => item.key === request.into);
    if (!target || request.into === request.key)
      throw refusal("--into must name another item in this ledger", "invalid");
    if (target.state === "merged") throw refusal(`${request.into} is itself merged`, "invalid");
  } else if (request.into !== undefined)
    throw refusal("--into applies only to --state merged", "invalid");

  const current = items[index];
  const next = {
    ...current,
    scope: request.scope ?? current.scope,
    state: request.state,
    tracker: filed ? request.tracker : null,
    ref: filed ? request.ref : null,
    action: filed ? request.action : null,
    into: request.state === "merged" ? request.into : null,
  };
  const same = ["scope", "state", "tracker", "ref", "action", "into"].every(
    (field) => next[field] === current[field]
  );
  if (same) return { idempotent: true, item: current, ledger };
  if (current.state === "filed")
    throw refusal(`${current.key} is already filed as ${current.ref}; it is not filed twice`);
  next.updated_at = now;
  const updated = [...items];
  updated[index] = next;
  return { idempotent: false, item: next, ledger: { ...ledger, items: updated } };
}

// The collected list with the ledger's state on each item.
function withState(items, ledger, fileable) {
  const byKey = new Map((ledger?.items || []).map((entry) => [entry.key, entry]));
  return items.map((item) => {
    const entry = byKey.get(item.key);
    if (!fileable || !entry)
      return { ...item, state: "held", tracker: null, ref: null, action: null, into: null };
    return {
      ...item,
      scope: entry.scope,
      state: entry.state,
      tracker: entry.tracker,
      ref: entry.ref,
      action: entry.action,
      into: entry.into,
    };
  });
}

function countStates(items) {
  const counts = { pending: 0, filed: 0, merged: 0, declined: 0 };
  for (const item of items) if (Object.hasOwn(counts, item.state)) counts[item.state] += 1;
  return counts;
}

module.exports = {
  applyRecord,
  collectFollowUps,
  countStates,
  deliveryState,
  syncLedger,
  validateFollowUps,
  withState,
};
