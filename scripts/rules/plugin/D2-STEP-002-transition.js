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
        const advanceLines = String(step.body || "")
          .split(/\r?\n/)
          .filter((line) => /\*\*Advance:\*\*/i.test(line));
        const targets = advanceLines.flatMap((line) =>
          [...line.matchAll(/Step\s+(\d+(?:\.\d+)?)/gi)].map((match) => Number(match[1]))
        );
        const existing = new Set(ordered.map((entry) => Number(entry.frontmatter.order)));
        const current = Number(step.frontmatter.order);
        const invalid = targets.filter((target) => !existing.has(target));
        if (invalid.length > 0) {
          issues.push({
            file: step.relPath,
            message: `Advance references missing Step ${invalid[0]}`,
          });
        }
        if (index < ordered.length - 1) {
          const next = Number(ordered[index + 1].frontmatter.order);
          if (!targets.includes(next)) {
            issues.push({
              file: step.relPath,
              message: `non-final step must advance to existing Step ${next}`,
            });
          }
          const skips = targets.filter((target) => target > next);
          if (
            skips.length > 0 &&
            !advanceLines.some((line) => /\b(if|branch|condition|according)\b/i.test(line))
          ) {
            issues.push({
              file: step.relPath,
              message: "skipped Advance targets require an explicit branch condition",
            });
          }
        } else {
          if (targets.includes(current)) {
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
