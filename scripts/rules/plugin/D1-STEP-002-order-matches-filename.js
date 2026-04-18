"use strict";

// D1-STEP-002 — step frontmatter `order:` must equal the filename's NN prefix.

module.exports = {
  id: "D1-STEP-002",
  severity: "error",
  description: "Step frontmatter `order:` must equal the filename's NN prefix",
  check(ctx) {
    const issues = [];
    const pattern = /^(\d{2})-.+\.md$/;
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        const m = step.fileName.match(pattern);
        if (!m) continue; // filename-ordering rule handles it
        const prefix = parseInt(m[1], 10);
        const raw = step.frontmatter.order;
        if (raw === undefined || raw === null) continue; // FM-003 handles
        const orderNum = parseInt(String(raw).trim(), 10);
        if (Number.isNaN(orderNum)) continue; // FM-004 handles
        if (orderNum !== prefix) {
          issues.push({
            file: step.relPath,
            message: `\`order: ${orderNum}\` does not match filename prefix "${m[1]}"`,
          });
        }
      }
    }
    return issues;
  },
};
