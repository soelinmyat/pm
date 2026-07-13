"use strict";

module.exports = {
  id: "D2-STEP-002-transition",
  severity: "warning",
  description:
    "Step transitions advance to the next existing step and final steps offer a next action",
  check(ctx) {
    const issues = [];
    for (const skill of ctx.skills) {
      const ordered = [...skill.steps].sort(
        (a, b) => Number(a.frontmatter.order) - Number(b.frontmatter.order)
      );
      for (let index = 0; index < ordered.length; index++) {
        const step = ordered[index];
        const matches = [
          ...String(step.body || "").matchAll(/\*\*Advance:\*\*[^\n]*Step\s+(\d+(?:\.\d+)?)/gi),
        ];
        const current = Number(step.frontmatter.order);
        if (index < ordered.length - 1) {
          const next = Number(ordered[index + 1].frontmatter.order);
          if (matches.length === 0 || !matches.some((match) => Number(match[1]) === next)) {
            issues.push({
              file: step.relPath,
              message: `non-final step must advance to existing Step ${next}`,
            });
          }
        } else {
          if (matches.some((match) => Number(match[1]) === current)) {
            issues.push({
              file: step.relPath,
              message: "final step cannot advance circularly to itself",
            });
          }
          if (!/(next action|offer|proceed to|continue with|advance:)/i.test(step.body || "")) {
            issues.push({
              file: step.relPath,
              message: "final step must summarize and offer a concrete next action",
            });
          }
        }
      }
    }
    return issues;
  },
};
