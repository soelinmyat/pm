"use strict";

// D1-CMD-001 — every commands/<slug>.md that references a plugin skill via
// `${CLAUDE_PLUGIN_ROOT}/skills/<slug>/` must have that <slug> as an
// existing directory under skills/.

module.exports = {
  id: "D1-CMD-001",
  severity: "error",
  description: "Commands that reference a skill must point to an existing skills/<slug>/ dir",
  check(ctx) {
    const issues = [];
    const skillNames = new Set(ctx.skills.map((s) => s.name));
    const skillPathPattern = /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([a-z0-9-]+)\//g;
    for (const cmd of ctx.commands) {
      let match;
      const seen = new Set();
      while ((match = skillPathPattern.exec(cmd.body)) !== null) {
        const slug = match[1];
        if (seen.has(slug)) continue;
        seen.add(slug);
        if (!skillNames.has(slug)) {
          issues.push({
            file: `commands/${cmd.name}.md`,
            message: `command references skills/${slug}/ but skills/${slug}/ does not exist`,
          });
        }
      }
    }
    return issues;
  },
};
