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

const MUTATION_COMMANDS = [
  /`(?:mkdir|rm|mv|cp|touch)\b[^`]*`/i,
  /`git\s+(?:add|commit|push|merge|tag)\b[^`]*`/i,
  /`(?:POST|PUT|PATCH|DELETE)\s+\/[^`]*`/i,
  /```[^`]*(?:writeFile|appendFile|mkdirSync|rmSync|unlinkSync)[^`]*```/i,
];

function mutationCommand(skill) {
  const text = [skill.skillBody, ...skill.steps.map((step) => step.body || "")].join("\n");
  return MUTATION_COMMANDS.find((pattern) => pattern.test(text));
}

module.exports = {
  id: "D2-SKILL-005-class-contract",
  severity: "error",
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
      if (skillClass === "read-only-projection" && mutationCommand(skill)) {
        issues.push({
          file,
          message: "read-only projection contains an executable mutation command",
        });
      }
    }
    return issues;
  },
};
