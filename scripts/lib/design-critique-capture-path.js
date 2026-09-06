"use strict";

const MANAGED_CAPTURE_MEMBERS = new Set([
  "capture.png",
  "accessibility-tree-raw.json",
  "dom-audit-raw.json",
  "network-ledger.json",
  "capture.json",
]);
const MANAGED_CAPTURE_RAW_MEMBERS = new Set(["accessibility-tree-raw.json", "dom-audit-raw.json"]);
const MANAGED_CAPTURE_ROUNDS = new Set(["round-1", "round-2"]);

function managedCaptureMember(relativePath) {
  const parts = String(relativePath).replaceAll("\\", "/").split("/");
  if (
    parts.length !== 7 ||
    parts[0] !== ".pm" ||
    parts[1] !== "dev-sessions" ||
    !/^[a-z0-9._-]+$/.test(parts[2]) ||
    parts[2] === "." ||
    parts[2] === ".." ||
    parts[3] !== "design-critique" ||
    !MANAGED_CAPTURE_ROUNDS.has(parts[4]) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[5]) ||
    !MANAGED_CAPTURE_MEMBERS.has(parts[6])
  ) {
    return null;
  }
  return parts[6];
}

function isManagedCaptureMemberPath(relativePath) {
  return managedCaptureMember(relativePath) !== null;
}

function isManagedCaptureRawPath(relativePath) {
  return MANAGED_CAPTURE_RAW_MEMBERS.has(managedCaptureMember(relativePath));
}

module.exports = { isManagedCaptureMemberPath, isManagedCaptureRawPath };
