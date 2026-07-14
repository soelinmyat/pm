"use strict";

module.exports = {
  id: "D2-SKILL-002-reference-directives",
  severity: "error",
  description: "Skills declare shared runtime, writing, and step-resolution directives",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      if (!skill.skillFmExists) continue;
      const body = skill.skillBody || "";
      const file = `skills/${skill.name}/SKILL.md`;
      if (!body.includes("${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md")) {
        issues.push({ file, message: "missing shared skill-runtime.md directive" });
      }
      if (skill.name !== "setup" && !body.includes("${CLAUDE_PLUGIN_ROOT}/references/writing.md")) {
        issues.push({ file, message: "missing shared writing.md directive" });
      }
      if (skill.steps.length > 0) {
        if (!body.includes(`skills/${skill.name}/steps/`)) {
          issues.push({
            file,
            message: "step-based skill does not declare its default steps path",
          });
        }
        if (!body.includes(`.pm/workflows/${skill.name}/`)) {
          issues.push({
            file,
            message: "step-based skill does not declare its workflow override path",
          });
        }
      }
    }
    return issues;
  },
};
