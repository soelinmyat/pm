"use strict";

// D1-TOOLS-001 — if `allowed-tools:` is set on a SKILL.md or step file,
// every entry must be in the known-tools whitelist.

const { ALLOWED_TOOLS_WHITELIST } = require("../../plugin-contract/constants.js");

function checkList(value) {
  // Accept arrays from parser or string values.
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    // Inline "[Bash, Read]" parsed as string fallback — split on commas.
    const s = value
      .trim()
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    return s;
  }
  return [];
}

module.exports = {
  id: "D1-TOOLS-001",
  severity: "error",
  description: "Every entry in `allowed-tools:` must be in the known-tools whitelist",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      const skillTools = checkList(skill.skillFm["allowed-tools"]);
      for (const tool of skillTools) {
        if (!ALLOWED_TOOLS_WHITELIST.includes(tool)) {
          issues.push({
            file: `skills/${skill.name}/SKILL.md`,
            message: `unknown tool "${tool}" in allowed-tools; whitelist: ${ALLOWED_TOOLS_WHITELIST.join(", ")}`,
          });
        }
      }
      for (const step of skill.steps) {
        const tools = checkList(step.frontmatter["allowed-tools"]);
        for (const tool of tools) {
          if (!ALLOWED_TOOLS_WHITELIST.includes(tool)) {
            issues.push({
              file: step.relPath,
              message: `unknown tool "${tool}" in allowed-tools; whitelist: ${ALLOWED_TOOLS_WHITELIST.join(", ")}`,
            });
          }
        }
      }
    }
    return issues;
  },
};
