"use strict";

// D1-SKILL-001 — every skills/<name>/SKILL.md that references
// skills/<name>/steps/ in its body must have at least one step file.

module.exports = {
  id: "D1-SKILL-001",
  severity: "error",
  description: "A skill that references its steps/ directory must have at least one step file",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      if (!skill.skillFmExists) continue;
      const body = skill.skillBody || "";
      const refersToSteps = body.includes(`skills/${skill.name}/steps/`);
      if (refersToSteps && skill.steps.length === 0) {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: `SKILL.md references skills/${skill.name}/steps/ but directory has no step files`,
        });
      }
    }
    return issues;
  },
};
