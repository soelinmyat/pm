"use strict";

const { classForSkill } = require("../../lib/skill-authoring/classification.js");

module.exports = {
  id: "D2-CMD-001-surface-parity",
  severity: "error",
  description: "Commands and skills preserve name, destination, and deprecation parity",
  check(ctx) {
    const issues = [];
    const skills = new Map(ctx.skills.map((skill) => [skill.name, skill]));
    for (const command of ctx.commands) {
      const file = `commands/${command.name}.md`;
      const skill = skills.get(command.name);
      if (!skill) continue;
      if (command.frontmatter?.name && command.frontmatter.name !== command.name) {
        issues.push({ file, message: `command name must equal filename slug ${command.name}` });
      }
      const commandDeprecated = /\bdeprecated\b/i.test(
        String(command.frontmatter?.description || "")
      );
      const skillDeprecated = /\bdeprecated\b/i.test(String(skill.skillFm?.description || ""));
      if (commandDeprecated !== skillDeprecated) {
        issues.push({ file, message: "command and skill deprecation promises diverge" });
      }
      if (classForSkill(skill) === "redirect") {
        const commandDestination = command.body.match(/skills\/([a-z0-9-]+)\/SKILL\.md/i)?.[1];
        const skillDestination = skill.skillBody.match(/skills\/([a-z0-9-]+)\/SKILL\.md/i)?.[1];
        if (!commandDestination || !skillDestination || commandDestination !== skillDestination) {
          issues.push({
            file,
            message: "redirect command and skill must name the same exact destination",
          });
        }
      } else if (!command.body.includes(`skills/${command.name}/SKILL.md`)) {
        issues.push({ file, message: `command must dispatch to skills/${command.name}/SKILL.md` });
      }
    }
    return issues;
  },
};
