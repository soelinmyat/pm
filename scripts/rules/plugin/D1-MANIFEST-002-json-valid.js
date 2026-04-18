"use strict";

// D1-MANIFEST-002 — each manifest file must be valid JSON.

const { MANIFEST_FILES } = require("../../plugin-contract/constants.js");

module.exports = {
  id: "D1-MANIFEST-002",
  severity: "error",
  description: "Each manifest file must be valid JSON",
  check(ctx) {
    const issues = [];
    for (const rel of MANIFEST_FILES) {
      const m = ctx.manifests[rel];
      if (!m || !m.exists) continue;
      if (m.parseError) {
        issues.push({
          file: rel,
          message: `invalid JSON: ${m.parseError}`,
        });
      }
    }
    return issues;
  },
};
