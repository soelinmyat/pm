"use strict";

// D1-TOOLS-001 — tool declarations must use the right frontmatter key and list
// only known tools. Skills/steps declare `allowed-tools:`; agents declare
// `tools:` (the Claude Code frontmatter keys differ, the whitelist is shared).
// Using the other file type's key is a drift error. Every listed tool must be in
// the shared whitelist OR be an `mcp__`-prefixed MCP tool — MCP tool names vary
// by host/server and cannot be enumerated here, so the prefix is the only
// compliant way to grant one.

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

function isAllowedTool(tool) {
  return tool.startsWith("mcp__") || ALLOWED_TOOLS_WHITELIST.includes(tool);
}

function hasKey(fm, key) {
  return Boolean(fm) && Object.prototype.hasOwnProperty.call(fm, key);
}

function unknownToolMessage(tool, key) {
  return `unknown tool "${tool}" in ${key}; whitelist: ${ALLOWED_TOOLS_WHITELIST.join(", ")} (or an mcp__ tool)`;
}

module.exports = {
  id: "D1-TOOLS-001",
  severity: "error",
  description:
    "Tool declarations use the right key (skills: `allowed-tools:`, agents: `tools:`) and only whitelisted or mcp__ tools",
  check(ctx) {
    const issues = [];

    // Agents declare tools via `tools:`; `allowed-tools:` is the wrong key here.
    for (const agent of ctx.agents || []) {
      const file = agent.relPath || `agents/${agent.name}.md`;
      if (hasKey(agent.frontmatter, "allowed-tools")) {
        issues.push({
          file,
          message: "agents use `tools:` for tool declarations, not `allowed-tools:`",
        });
      }
      for (const tool of checkList(agent.frontmatter && agent.frontmatter.tools)) {
        if (!isAllowedTool(tool)) {
          issues.push({ file, message: unknownToolMessage(tool, "tools") });
        }
      }
    }

    // Skills and steps declare tools via `allowed-tools:`; `tools:` is the wrong key.
    for (const skill of ctx.skills) {
      const skillFile = `skills/${skill.name}/SKILL.md`;
      if (hasKey(skill.skillFm, "tools")) {
        issues.push({
          file: skillFile,
          message: "skills use `allowed-tools:` for tool declarations, not `tools:`",
        });
      }
      for (const tool of checkList(skill.skillFm["allowed-tools"])) {
        if (!isAllowedTool(tool)) {
          issues.push({ file: skillFile, message: unknownToolMessage(tool, "allowed-tools") });
        }
      }
      for (const step of skill.steps) {
        if (hasKey(step.frontmatter, "tools")) {
          issues.push({
            file: step.relPath,
            message: "skills use `allowed-tools:` for tool declarations, not `tools:`",
          });
        }
        for (const tool of checkList(step.frontmatter["allowed-tools"])) {
          if (!isAllowedTool(tool)) {
            issues.push({ file: step.relPath, message: unknownToolMessage(tool, "allowed-tools") });
          }
        }
      }
    }

    return issues;
  },
};
