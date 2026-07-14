"use strict";

const {
  sectionByPrefix,
  sections,
  substantive,
  tableDataRows,
} = require("../../lib/skill-authoring/markdown.js");

module.exports = {
  id: "D2-SKILL-004-self-checks",
  severity: "error",
  description: "Self-check, escalation, rationalization, and done sections have useful shape",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      const parsed = sections(skill.skillBody);
      const file = `skills/${skill.name}/SKILL.md`;
      const redFlags = (sectionByPrefix(parsed, "Red Flags") || "")
        .split(/\r?\n/)
        .filter((line) => /^\s*-\s+/.test(line));
      if (
        redFlags.length < 4 ||
        redFlags.length > 6 ||
        redFlags.some(
          (line) =>
            !/["“][^"”]+["”]/.test(line) ||
            !/\b(stop|instead|route|ask|check|use|keep|include|validate|capture)\b/i.test(line)
        )
      ) {
        issues.push({
          file,
          message: "Red Flags must contain 4-6 quoted thought patterns with corrective action",
        });
      }
      const escalation = sectionByPrefix(parsed, "Escalation Paths") || "";
      if (
        !substantive(escalation) ||
        !/(`pm:[^`]+`|\b(stop|ask|switch|route)\b)/i.test(escalation)
      ) {
        issues.push({
          file,
          message: "Escalation Paths must name a destination skill or concrete stop/ask action",
        });
      }
      if (tableDataRows(sectionByPrefix(parsed, "Common Rationalizations")).length < 2) {
        issues.push({
          file,
          message: "Common Rationalizations needs at least two excuse/reality rows",
        });
      }
      const done = sectionByPrefix(parsed, "Before Marking Done") || "";
      const checks = done.split(/\r?\n/).filter((line) => /^\s*-\s+\[[ xX]\]/.test(line));
      if (checks.length < 3) {
        issues.push({
          file,
          message: "Before Marking Done needs at least three explicit checklist items",
        });
      }
    }
    return issues;
  },
};
