"use strict";

// D1-FM-004 — `order:` must be a positive number (integer or decimal).
// Decimals are reserved for variant steps (e.g. `01a-intake-agent.md` uses
// `order: 1.1` to slot between primary steps 1 and 2). Primary steps use
// integers; the loader sorts numerically so 1.1 falls between 1 and 2.

module.exports = {
  id: "D1-FM-004",
  severity: "error",
  description: "Step `order:` must be a positive number",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        const raw = step.frontmatter.order;
        if (raw === undefined || raw === null) continue; // covered by FM-003
        const s = String(raw).trim();
        // Accept positive integers or simple decimals (one optional fractional
        // part). Reject negatives, NaN, scientific notation, leading dots.
        if (!/^\d+(\.\d+)?$/.test(s)) {
          issues.push({
            file: step.relPath,
            message: `step \`order:\` must be a positive number, got "${raw}"`,
          });
          continue;
        }
        const n = parseFloat(s);
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
