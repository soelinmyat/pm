"use strict";

// D1-FM-001 — every skills/<name>/SKILL.md must have a `name:` key in
// frontmatter.

module.exports = {
  id: "D1-FM-001",
  severity: "error",
  description: "SKILL.md must declare a `name:` in frontmatter",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      if (!skill.skillFmExists) continue;
      if (!skill.skillFm.name || String(skill.skillFm.name).trim() === "") {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: "missing required frontmatter key `name:`",
        });
      }
    }
    return issues;
  },
};
