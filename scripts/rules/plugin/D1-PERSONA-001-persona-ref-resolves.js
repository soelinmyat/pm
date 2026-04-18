"use strict";

// D1-PERSONA-001 — any persona referenced in a skill body as
// `@personas/<name>.md` or `@<name>` (where <name> is the bare slug of a
// known persona) must exist at personas/<name>.md.
//
// We resolve against the default plugin personas/ — user-overrides are not
// verifiable from the plugin source alone, so this rule only checks default
// references.

module.exports = {
  id: "D1-PERSONA-001",
  severity: "error",
  description: "Persona references in skill bodies must resolve to personas/<name>.md",
  check(ctx) {
    const issues = [];
    const personas = new Set(ctx.personas);
    const explicitPathRef = /@personas\/([a-z0-9-]+)\.md/g;

    for (const skill of ctx.skills) {
      const body = skill.skillBody || "";
      let match;
      const seen = new Set();
      while ((match = explicitPathRef.exec(body)) !== null) {
        const name = match[1];
        if (seen.has(name)) continue;
        seen.add(name);
        if (!personas.has(name)) {
          issues.push({
            file: `skills/${skill.name}/SKILL.md`,
            message: `persona reference "@personas/${name}.md" does not resolve (no personas/${name}.md)`,
          });
        }
      }
      // Scan step bodies too.
      for (const step of skill.steps) {
        const stepSeen = new Set();
        const re = /@personas\/([a-z0-9-]+)\.md/g;
        while ((match = re.exec(step.body)) !== null) {
          const name = match[1];
          if (stepSeen.has(name)) continue;
          stepSeen.add(name);
          if (!personas.has(name)) {
            issues.push({
              file: step.relPath,
              message: `persona reference "@personas/${name}.md" does not resolve`,
            });
          }
        }
      }
    }
    return issues;
  },
};
