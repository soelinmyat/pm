"use strict";

const { sectionByPrefix, sections, substantive } = require("../../lib/skill-authoring/markdown.js");

module.exports = {
  id: "D2-STEP-001-execution-contract",
  severity: "warning",
  description: "Procedural steps state a substantive Goal, How, and Done-when contract",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        const parsed = sections(step.body);
        for (const heading of ["Goal", "How", "Done-when"]) {
          const body = sectionByPrefix(parsed, heading);
          if (!substantive(body, heading === "How" ? 20 : 12)) {
            issues.push({
              file: step.relPath,
              message: `${heading} is missing or structurally thin`,
            });
          }
        }
        const how = sectionByPrefix(parsed, "How") || "";
        if (/^\s*do (it|the thing)[.!]?\s*$/i.test(how)) {
          issues.push({
            file: step.relPath,
            message: "How must provide procedure or decision criteria, not `Do the thing`",
          });
        }
      }
    }
    return issues;
  },
};
