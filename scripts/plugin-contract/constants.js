"use strict";

// Shared constants for plugin-contract validation and the D0 audit script.
// Single source of truth — Issue 1 (audit) and Issue 2 (validator) both import
// from here (per S-adv-1 advisory).

const MANIFEST_FILES = [
  ".claude-plugin/plugin.json",
  "plugin.config.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
];

// Directories/files that together constitute "plugin source" for the
// rule-pack walker. Relative to plugin root.
const PLUGIN_SOURCE_GLOBS = [
  "skills/**",
  "personas/**",
  "commands/**",
  ".claude-plugin/",
  ".codex-plugin/",
  "plugin.config.json",
];

const PRIORITY_SURFACES = [
  "skills/groom/steps/01-intake.md",
  "skills/dev/steps/02-intake.md",
  "skills/dev/steps/04-groom-readiness.md",
  "skills/ship/steps/07-merge-loop.md",
  "skills/review/SKILL.md",
  "skills/simplify/SKILL.md",
];

// Whitelist of tool names that may appear in an `allowed-tools:` frontmatter
// list. Extend deliberately — drift-detecting this list is the whole point.
const ALLOWED_TOOLS_WHITELIST = [
  "Bash",
  "Read",
  "Edit",
  "Glob",
  "Grep",
  "Write",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
  "NotebookEdit",
];

module.exports = {
  MANIFEST_FILES,
  PLUGIN_SOURCE_GLOBS,
  PRIORITY_SURFACES,
  ALLOWED_TOOLS_WHITELIST,
};
