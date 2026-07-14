"use strict";

const { sectionByPrefix, sections } = require("../../lib/skill-authoring/markdown.js");

module.exports = {
  id: "D2-SKILL-003-iron-law",
  severity: "error",
  description: "Each skill has one bright-line imperative Iron Law",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      const body = sectionByPrefix(sections(skill.skillBody), "Iron Law") || "";
      const laws = [...body.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1].trim());
      const valid = laws.length === 1 && laws[0] === laws[0].toUpperCase();
      const hedged = laws.some((law) => /\b(TRY|USUALLY|WHEN POSSIBLE|SHOULD|MAYBE)\b/.test(law));
      const compound = laws.some((law) => /\bAND\b/.test(law));
      if (!valid || hedged || compound) {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: "Iron Law must contain exactly one unhedged, bold, all-caps imperative rule",
        });
      }
    }
    return issues;
  },
};
