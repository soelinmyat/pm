"use strict";

// D1-FM-003 — every step file under skills/<name>/steps/ must declare an
// `order:` key in frontmatter.

module.exports = {
  id: "D1-FM-003",
  severity: "error",
  description: "Every step file must declare `order:` in frontmatter",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        if (!step.hasFrontmatter) {
          issues.push({
            file: step.relPath,
            message: "step file has no frontmatter (missing `order:` key)",
          });
          continue;
        }
        if (step.frontmatter.order === undefined || step.frontmatter.order === null) {
          issues.push({
            file: step.relPath,
            message: "missing required frontmatter key `order:`",
          });
        }
      }
    }
    return issues;
  },
};
