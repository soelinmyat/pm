"use strict";

const fs = require("fs");
const path = require("path");

const REFERENCE_PATH = path.join(__dirname, "..", "references", "phase-labels.md");

let cache = null;

function loadReference() {
  if (cache) return cache;

  const text = fs.readFileSync(REFERENCE_PATH, "utf8");
  const entries = [];
  const rowPattern = /^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|\s*$/;

  for (const line of text.split("\n")) {
    const match = rowPattern.exec(line);
    if (!match) continue;
    const [, kind, phase, label] = match;
    if (kind === "Kind" || label === "Label") continue;
    entries.push({ kind, phase, label });
  }

  const map = new Map();
  for (const entry of entries) {
    map.set(`${entry.kind}::${entry.phase}`, entry.label);
  }

  cache = { entries, map };
  return cache;
}

function titleCase(raw) {
  const cleaned = String(raw).replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function phaseLabel(kind, phase) {
  if (phase === null || phase === undefined || phase === "") {
    return "(no phase)";
  }
  const { map } = loadReference();
  const key = `${kind}::${phase}`;
  if (map.has(key)) {
    return map.get(key);
  }
  return titleCase(phase);
}

function allPhases() {
  return loadReference().entries.slice();
}

function _resetCacheForTests() {
  cache = null;
}

module.exports = { phaseLabel, allPhases, _resetCacheForTests };
