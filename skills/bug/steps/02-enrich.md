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

If the user provides answers, compose the complete three-section body when body content changes, then write a private JSON request containing:

- `action: "enrich"` and `kind: "bug"`;
- the Step 1 receipt `slug` and `expectedSha256`;
- only requested `priority` and `labels` changes;
- the complete `body` when body content changes.

Invoke the helper with `--request-file` and guarantee cleanup on success or failure. Do not interpolate user text into shell syntax or use Edit on the backlog Markdown. If the helper says the item changed since capture, stop and read the current item before offering a new refinement; never retry with a guessed hash.

If the user says "skip" or declines, end cleanly without edits.

Say: "Bug captured. Run `/pm:dev {slug}` to fix when you want, or `/pm:list` to see it alongside other work."

## Done-when

Requested refinements have a new validated receipt, or the user declines enrichment without changing the original capture.

Offer the concrete next action: run `/pm:dev {slug}` to fix or `/pm:list` to survey the backlog.
