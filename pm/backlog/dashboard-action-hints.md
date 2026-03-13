---
type: backlog-issue
title: "Dashboard Action Hints"
outcome: "Dashboard shows contextual command hints so users know which CLI commands to run for next actions"
status: idea
parent: null
children: []
labels:
  - "ideate"
  - "ux"
priority: medium
evidence_strength: moderate
scope_signal: small
strategic_fit: "Priority 2: Quality of groomed output"
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-13
---

## Outcome

The dashboard is read-only — users can't drag cards or click buttons to change state. But they can see exactly what command to run next. Every view shows contextual action hints:

- **Backlog Idea card:** "Run `/pm:groom google-docs-ingestion` to scope this idea"
- **Backlog Groomed card:** "Update status in `pm/backlog/google-docs-ingestion.md`"
- **Empty Groomed column:** "Run `/pm:groom <slug>` to move an idea here"
- **Empty Done column:** "Change `status: done` in the backlog file when shipped"
- **Landscape page:** "Run `/pm:research landscape` to refresh"
- **Competitor page:** "Run `/pm:research competitors` to re-profile"
- **Research page with no topics:** "Run `/pm:research <topic>` to investigate something"
- **Empty backlog:** "Run `/pm:ideate` to generate ideas from your knowledge base"

## Signal Sources

- Current dashboard gap: no guidance on how to change state. Users see data but don't know the next action.
- `pm/competitors/matrix.md`: No competitor has a read-only dashboard with CLI action hints — this is a unique UX pattern for editor-native tools.

## Competitor Context

- **ChatPRD:** Web app with clickable UI — no hints needed.
- **Productboard Spark:** Web app with interactive Jobs — no hints needed.
- **PM Skills Marketplace:** No dashboard at all.

This is a unique UX challenge for editor-native tools with visual companions. The dashboard bridges the gap between "seeing" and "doing."

## Implementation Approach

1. Add hint text to each dashboard view — small, muted text below headers or inside empty states.
2. Show the exact command with the correct slug/argument pre-filled.
3. Use a consistent style: code block with the command, brief explanation of what it does.
4. Hints are contextual — only show relevant commands for the current state.

## Dependencies

None. Pure server-side HTML additions.

## Open Questions

- Should hints be always visible or collapsible?
- Should individual backlog item pages show their full status history and available transitions?
