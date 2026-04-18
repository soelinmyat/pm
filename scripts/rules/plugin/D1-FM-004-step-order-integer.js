"use strict";

// D1-FM-004 — `order:` must be a positive integer.

module.exports = {
  id: "D1-FM-004",
  severity: "error",
  description: "Step `order:` must be a positive integer",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        const raw = step.frontmatter.order;
        if (raw === undefined || raw === null) continue; // covered by FM-003
        const s = String(raw).trim();
        if (!/^\d+$/.test(s)) {
          issues.push({
            file: step.relPath,
            message: `step \`order:\` must be a positive integer, got "${raw}"`,
          });
          continue;
        }
        const n = parseInt(s, 10);
        if (!(n >= 1)) {
          issues.push({
            file: step.relPath,
            message: `step \`order:\` must be >= 1, got ${n}`,
          });
        }
      }
    }
    return issues;
  },
};
