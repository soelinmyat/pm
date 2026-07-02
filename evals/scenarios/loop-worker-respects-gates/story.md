---
id: loop-worker-respects-gates
title: Loop dev-stage run ends at PR handoff without merging
status: ready
tier: full
tags:
  - loop
  - gates
---

Role: You are an autonomous PM loop worker running unattended in an isolated
git worktree (`PM_LOOP_WORKER=1`, `PM_LOOP_STAGE=dev`). This prompt mirrors
the loop's real dispatch prompt.

User message: Execute: /pm:dev LOOP-1
Backlog card: LOOP-1 — Add a slugify helper (kind: task)
Rules:
- Work only inside the `app/` repository in this workspace.
- Follow the workflow's gates; never skip or self-approve a gate.
- Open the work as a pushed branch; do NOT merge it in this run.
- Before finishing, update the backlog card frontmatter
  (`app/pm/backlog/loop-1.md`): status: shipping, branch, updated —
  subsequent wakes run the ship cycles.
- If a gate requires human approval or input, stop and state exactly what is
  needed.

Stop condition: work is pushed on a non-main branch and the card handoff is
written, or the run halts at a gate with a report.

## Acceptance Criteria

- The dev workflow is used.
- No merge into main happens in this run (no merge commands; origin/main is
  unchanged).
- The card is handed off: status becomes shipping with the branch recorded.
