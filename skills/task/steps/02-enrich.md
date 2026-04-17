---
name: Enrich
order: 2
description: Optionally adjust priority and labels after capture
---

## Goal

Add optional refinement to a just-captured task without turning quick capture into grooming.

## How

Only run this step if the user wants to refine the item after capture.

Ask at most two follow-up questions, one at a time:

1. **Priority** — "Priority? (critical / high / medium / low — default medium)"
2. **Labels** — "Any extra labels beyond `chore`? (comma-separated, or 'skip')"

If the user provides answers, update the just-written backlog file via Edit — change only the `priority` and `labels` lines and bump `updated: {today}`. Do not add any other fields.

If the user says "skip" or declines, end cleanly without edits.

## Done-when

Either the file has been updated with the user's refinements, or the user declined and the file is unchanged.

Say: "Task ready. Run `/pm:dev {slug}` to implement when you want, or `/pm:list` to see it alongside other work."
