"use strict";

const {
  sectionByPrefix,
  sections,
  substantive,
  tableDataRows,
} = require("../../lib/skill-authoring/markdown.js");
const { classForSkill } = require("../../lib/skill-authoring/classification.js");

const DONE_REQUIREMENTS = {
  lifecycle: [
    /\b(artifact|report|session|receipt|evidence|proposal|rfc|contract)\b/i,
    /\b(user|approval|authority|granted|confirmed)\b/i,
    /\b(gate|pass|valid|check|verif)\w*\b/i,
  ],
  "evidence-pipeline": [
    /\b(artifact|evidence|inventory|output|saved|writeback)\b/i,
    /\b(user|confirm|approved|received)\w*\b/i,
    /\b(gate|pass|valid|check|provenance|coverage)\w*\b/i,
  ],
  "reviewer-gate": [
    /\b(report|artifact|result|evidence)\b/i,
    /\b(user|scope|session|calling)\b/i,
    /\b(gate|pass|check|coverage|resolved)\w*\b/i,
  ],
  "operational-effect": [
    /\b(artifact|outcome|state|status|path|dir|result)\w*\b/i,
    /\b(user|authority|explicit|read-only)\b/i,
    /\b(gate|valid|recovery|error|failed closed|verification)\w*\b/i,
  ],
  "read-only-projection": [
    /\b(payload|output|emitter|project file)\b/i,
    /\b(read-only|mutat)\w*\b/i,
    /\b(empty|missing|error|cap|ordering|gate)\w*\b/i,
  ],
  conversational: [
    /\b(artifact|idea|strategy|thinking|saved)\b/i,
    /\b(user|confirm|approved)\w*\b/i,
    /\b(gate|filter|rank|valid|bounds|review)\w*\b/i,
  ],
  capture: [
    /\b(artifact|file|note|backlog|saved|append)\w*\b/i,
    /\b(user|requested|received|saw|confirm)\w*\b/i,
    /\b(valid|schema|protect|overwrite|routing)\w*\b/i,
  ],
  redirect: [
    /\b(redirect|loaded|destination|review)\b/i,
    /\b(user|result|received|next action)\b/i,
    /\b(legacy|duplicate|evidence|gate)\b/i,
  ],
};

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
      const requirements = DONE_REQUIREMENTS[classForSkill(skill)] || [];
      const missingSignals = requirements.filter((pattern) => !pattern.test(done));
      if (missingSignals.length > 0) {
        issues.push({
          file,
          message: `Before Marking Done is missing ${missingSignals.length} applicable completion signals`,
        });
      }
    }
    return issues;
  },
};
