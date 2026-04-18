"use strict";

// D1-STEP-003 — every step file must declare a `description:` key in
// frontmatter.

module.exports = {
  id: "D1-STEP-003",
  severity: "error",
  description: "Every step file must declare `description:` in frontmatter",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        if (!step.hasFrontmatter) continue; // FM-003 reports the bigger problem
        if (!step.frontmatter.description || String(step.frontmatter.description).trim() === "") {
          issues.push({
            file: step.relPath,
            message: "missing required frontmatter key `description:`",
          });
        }
      }
    }
    return issues;
  },
};
