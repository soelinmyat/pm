"use strict";

const {
  operativeMarkdown,
  sectionByPrefix,
  sections,
  substantive,
} = require("../../lib/skill-authoring/markdown.js");

const REQUIRED = [
  "Purpose",
  "Iron Law",
  "When NOT to use",
  "Red Flags",
  "Escalation Paths",
  "Common Rationalizations",
  "Before Marking Done",
];

module.exports = {
  id: "D2-SKILL-001-contract-sections",
  severity: "error",
  description: "Skill entry points contain the required substantive contract sections",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      if (!skill.skillFmExists) continue;
      const parsed = sections(skill.skillBody);
      for (const heading of REQUIRED) {
        const body = sectionByPrefix(parsed, heading);
        if (!substantive(body)) {
          issues.push({
            file: `skills/${skill.name}/SKILL.md`,
            message: `missing or non-substantive "${heading}" section`,
          });
        }
      }
      const description = String(skill.skillFm.description || "");
      if (!/\buse when\b/i.test(description) || description.length < 35) {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: "description must be trigger-rich and include a concrete `Use when...` phrase",
        });
      }
      const operative = operativeMarkdown(skill.skillBody);
      const declaration = operative.match(
        /^\s*\*\*Workflow:\*\*\s*`([^`]+)`\s*\|\s*\*\*Telemetry steps:\*\*\s*(.+)$/im
      );
      if (!declaration) {
        issues.push({
          file: `skills/${skill.name}/SKILL.md`,
          message: "missing Workflow/telemetry declaration",
        });
      } else {
        const telemetry = [...declaration[2].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
        const invalid = telemetry.filter((token) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(token));
        if (telemetry.length === 0) {
          issues.push({
            file: `skills/${skill.name}/SKILL.md`,
            message:
              "Workflow/telemetry declaration must list at least one backticked telemetry step",
          });
        }
        if (invalid.length > 0) {
          issues.push({
            file: `skills/${skill.name}/SKILL.md`,
            message: `telemetry step names must use lowercase kebab-case: ${invalid.join(", ")}`,
          });
        }
      }
    }
    return issues;
  },
};
