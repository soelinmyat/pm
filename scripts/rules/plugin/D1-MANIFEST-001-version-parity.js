"use strict";

// D1-MANIFEST-001 — all four manifest files must report the same version
// string. Marketplace carries the version inside its first plugins[] entry.

const { MANIFEST_FILES } = require("../../plugin-contract/constants.js");

function extractVersion(relPath, json) {
  if (!json) return null;
  if (relPath === ".claude-plugin/marketplace.json") {
    if (Array.isArray(json.plugins) && json.plugins[0] && json.plugins[0].version) {
      return json.plugins[0].version;
    }
    return null;
  }
  return json.version || null;
}

module.exports = {
  id: "D1-MANIFEST-001",
  severity: "error",
  description: "All four manifest files must declare the same version string",
  check(ctx) {
    const issues = [];
    const versions = new Map();
    for (const rel of MANIFEST_FILES) {
      const m = ctx.manifests[rel];
      if (!m || !m.exists || !m.json) continue;
      const v = extractVersion(rel, m.json);
      if (v) versions.set(rel, v);
    }
    const unique = new Set(versions.values());
    if (unique.size > 1) {
      const parts = [];
      for (const [rel, v] of versions) parts.push(`${rel}=${v}`);
      issues.push({
        file: "(manifests)",
        message: `manifest version mismatch: ${parts.join(", ")}`,
      });
    }
    return issues;
  },
};
