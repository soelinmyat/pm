"use strict";

const { SKILL_CLASSES, classForSkill } = require("../../lib/skill-authoring/classification.js");

const REQUIREMENTS = {
  lifecycle: [/authority/i, /evidence/i, /(advance|transition)/i],
  "evidence-pipeline": [/(source|provenance)/i, /(writeback|citation|output)/i],
  "reviewer-gate": [/(target|commit|diff)/i, /(report|finding)/i, /(round|remediation|fix)/i],
  "operational-effect": [/(authority|permission|consent)/i, /(recover|retry|idempot)/i],
  "read-only-projection": [/read.?only/i, /(empty|missing|error)/i],
  conversational: [/(question|decision)/i, /(confirm|confirmation)/i, /(promote|switch|route)/i],
  capture: [/(atomic|overwrite|collision)/i, /(route|routing|kind)/i],
  redirect: [/(deprecated|redirect)/i, /pm:[a-z-]+/i],
};

module.exports = {
  id: "D2-SKILL-005-class-contract",
  severity: "warning",
  description: "Every skill is classified and carries its class-specific safety boundaries",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      const file = `skills/${skill.name}/SKILL.md`;
      const skillClass = classForSkill(skill);
      if (!SKILL_CLASSES.includes(skillClass)) {
        issues.push({ file, message: "skill is missing a validator-owned class" });
        continue;
      }
      const body = skill.skillBody || "";
      const missing = REQUIREMENTS[skillClass].filter((pattern) => !pattern.test(body));
      if (missing.length > 0) {
        issues.push({
          file,
          message: `missing ${skillClass} class boundary (${missing.length} signal${missing.length === 1 ? "" : "s"})`,
        });
      }
    }
    return issues;
  },
};
