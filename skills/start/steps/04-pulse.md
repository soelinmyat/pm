---
name: Pulse
order: 4
description: Initialized project with no active work — bias toward next useful lane
---

## Pulse Mode

### Goal

Surface the next useful PM lane when the project is initialized but there is no active work to resume.

Use this when the project is initialized but there is no active work to resume.

The behavior is the same as Resume Mode (including auto-push in step 2 and evidence detection in step 3), except the recommendation should bias toward the next useful lane:

- `pm:strategy` when insights or evidence exist but strategy is missing
- `pm:refresh` when insights or evidence are stale
- `pm:refresh` when uncited evidence is accumulating and needs routing or consolidation
- `pm:research` when hungry insights exist and need stronger evidence
- `pm:groom` when backlog discovery is the best next move
- First-workflow selector when the workspace exists but is still effectively empty

When compounding signals exist, prefer naming the concrete targets:
- uncited evidence as KB-relative file paths
- hungry insights by topic name

When the user explicitly invoked `/pm:start`, Pulse Mode should still offer the same short follow-up choice:

- continue with `Next:`
- choose one of the `Also:` options

## Notes

- PM does not require integrations to be useful. Linear and Ahrefs are optional enhancements.
- Configure Linear or Ahrefs only when the chosen workflow needs them.
- Markdown backlog mode and web-search-only research are valid defaults.
- `pm:start` may route internally to other skills such as `pm:ingest`, `pm:research`, `pm:think`, `pm:groom`, or `pm:dev`.
- Do not force users to memorize those lanes during onboarding. `pm:start` should do the routing.
- The runtime hook and the explicit `pm:start` resume flow should use the same `scripts/start-status.js` output.
- When compounding signals exist, `pm:start` should surface them as actionable lanes rather than burying them inside a freshness summary.
- `pm:start` is the public entry point for PM.
- Dashboard sync setup is handled by `pm:setup` or `pm:sync`. `pm:start` only reads sync status — it never configures sync itself.

### Done-when

Pulse mode has produced a clear `Next:` recommendation, optional `Also:` alternatives, and any explicit `/pm:start` follow-up prompt needed to let the user choose how to proceed.
