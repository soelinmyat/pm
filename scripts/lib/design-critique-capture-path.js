"use strict";

const { MAX_RECOVERY_ROUNDS } = require("./scoped-recovery");
const { MAX_PDF_PAGES } = require("./pdf-evidence-limits");

const MANAGED_CAPTURE_MEMBERS = new Set([
  "capture.png",
  "focus-baseline.png",
  "accessibility-tree-raw.json",
  "dom-audit-raw.json",
  "network-ledger.json",
  "capture.json",
  "capture.pdf",
  "pdf-observation.json",
]);
const MANAGED_CAPTURE_RAW_MEMBERS = new Set(["accessibility-tree-raw.json", "dom-audit-raw.json"]);
const MANAGED_CAPTURE_ROUNDS = new Set(["round-1", "round-2"]);

function managedCaptureMember(relativePath) {
  const parts = String(relativePath).replaceAll("\\", "/").split("/");
  const immutableRound = /^round-([1-9][0-9]*)$/.exec(parts[6] || "");
  let immutable = false;
  if (
    parts.length === 10 &&
    parts[4] === "runs" &&
    /^[a-z0-9][a-z0-9._-]*$/.test(parts[5]) &&
    immutableRound &&
    Number(immutableRound[1]) <= MAX_RECOVERY_ROUNDS &&
    parts[6] === parts[7]
  ) {
    // Atomic bundle reads still validate the managed symlink target. Only the
    // bounded run/round prefix differs from the original capture layout.
    parts.splice(4, 3);
    immutable = true;
  }
  if (
    parts.length !== 7 ||
    parts[0] !== ".pm" ||
    parts[1] !== "dev-sessions" ||
    !/^[a-z0-9._-]+$/.test(parts[2]) ||
    parts[2] === "." ||
    parts[2] === ".." ||
    parts[3] !== "design-critique" ||
    (!immutable && !MANAGED_CAPTURE_ROUNDS.has(parts[4])) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[5]) ||
    !isCaptureMember(parts[6]) ||
    (immutable && !parts[5].endsWith(`-r${Number(immutableRound[1])}`))
  ) {
    return null;
  }
  return parts[6];
}

function isCaptureMember(member) {
  const page = /^page-([0-9]{3})\.png$/.exec(member || "");
  return (
    MANAGED_CAPTURE_MEMBERS.has(member) ||
    Boolean(page && Number(page[1]) >= 1 && Number(page[1]) <= MAX_PDF_PAGES)
  );
}

function isManagedCaptureMemberPath(relativePath) {
  return managedCaptureMember(relativePath) !== null;
}

function isManagedCaptureRawPath(relativePath) {
  return MANAGED_CAPTURE_RAW_MEMBERS.has(managedCaptureMember(relativePath));
}

module.exports = { isManagedCaptureMemberPath, isManagedCaptureRawPath };
