"use strict";

// D1-STEP-001 — step filenames under skills/*/steps/ must match either:
//   - `NN-slug.md` (two-digit prefix) — primary step
//   - `NNa-slug.md` (two-digit + lowercase letter) — variant step that runs
//     in place of NN for a specific tier (gated via `applies_to:` frontmatter)
// The variant pattern was introduced for the groom skill's agent tier
// (PM-233), where each agent-variant step replaces the same-numbered
// co-pilot step. The letter suffix encodes which co-pilot step the variant
// replaces and keeps file order stable.

module.exports = {
  id: "D1-STEP-001",
  severity: "error",
  description: "Step filenames must be of the form NN-slug.md or NNa-slug.md",
  check(ctx) {
    const issues = [];
    const pattern = /^\d{2}[a-z]?-[a-z0-9][a-z0-9-]*\.md$/;
    for (const skill of ctx.skills) {
      for (const step of skill.steps) {
        if (!pattern.test(step.fileName)) {
          issues.push({
            file: step.relPath,
            message: `step filename "${step.fileName}" must match NN-slug.md or NNa-slug.md`,
          });
        }
      }
    }
    return issues;
  },
};
