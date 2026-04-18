"use strict";

// D1-STEP-001 — step filenames under skills/*/steps/ must match the
// `NN-slug.md` pattern with a two-digit numeric prefix.

module.exports = {
  id: "D1-STEP-001",
  severity: "error",
  description: "Step filenames must be of the form NN-slug.md",
  check(ctx) {
    const issues = [];
    const pattern = /^\d{2}-[a-z0-9][a-z0-9-]*\.md$/;
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        if (!pattern.test(step.fileName)) {
          issues.push({
            file: step.relPath,
            message: `step filename "${step.fileName}" must match NN-slug.md (two-digit prefix)`,
          });
        }
      }
    }
    return issues;
  },
};
