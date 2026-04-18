"use strict";

// D1-FM-002 — every skills/<name>/SKILL.md must declare `description:` in
// frontmatter.

module.exports = {
  id: "D1-FM-002",
  severity: "error",
  description: "SKILL.md must declare a `description:` in frontmatter",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      if (!skill.skillFmExists) continue;
      if (!skill.skillFm.description || String(skill.skillFm.description).trim() === "") {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: "missing required frontmatter key `description:`",
        });
      }
    }
    return issues;
  },
};
