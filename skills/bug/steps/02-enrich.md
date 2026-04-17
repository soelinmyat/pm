---
name: Enrich
order: 2
description: Optionally adjust priority, labels, or fill in missing repro details
---

## Goal

Add optional refinement to a just-captured bug without turning quick capture into grooming.

## How

Only run this step if the user wants to refine the item after capture.

Ask at most three follow-up questions, one at a time:

1. **Priority** — "Priority? (critical / high / medium / low — default high for bugs)"
2. **Labels** — "Any extra labels beyond `bug`? (comma-separated, or 'skip')"
3. **Reproduction** — "Reproduction steps? (only ask if the reproduction stub is still pending)"

If the user provides answers:
- Update `priority` / `labels` / `updated` in the frontmatter via Edit.
- Replace the pending stub under `## Reproduction` with the provided steps.

If the user says "skip" or declines, end cleanly without edits.

## Done-when

Either the file has been updated with the user's refinements, or the user declined and the file is unchanged.

Say: "Bug captured. Run `/pm:dev {slug}` to fix when you want, or `/pm:list` to see it alongside other work."
