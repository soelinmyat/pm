---
type: backlog-issue
id: PM-008
title: "Dashboard Action Hints"
outcome: "Dashboard shows contextual command hints so users know which CLI commands to run for next actions"
status: done
parent: null
children: []
labels:
  - "ux"
priority: medium
evidence_strength: moderate
scope_signal: small
strategic_fit: "Priority 2: Quality of groomed output"
competitor_gap: unique
dependencies: []
created: 2026-03-13
updated: 2026-03-14
---

## Outcome

The dashboard is read-only — users can't drag cards or click buttons to change state. But they can see exactly what command to run next. Every view shows contextual action hints:

- **Backlog Idea card:** `/pm:groom <slug>` hint on each card
- **Backlog column hints:** "Run `/pm:groom <slug>` to scope an idea" (Idea column), "Edit `pm/backlog/<slug>.md` to update status" (Groomed column)
- **Backlog detail page:** Status-aware hint below the title — groom hint for ideas, edit hint for in-progress items, no hint for shipped
- **Home dashboard:** "Suggested next" section with contextual guidance based on knowledge base state (no strategy → suggest strategy, has ideas → suggest grooming, etc.)
- **Landscape tab:** "Run `/pm:refresh` to update" hint when content exists
- **Competitors tab:** "Run `/pm:research competitors` to re-profile" hint when profiles exist
- **Empty states:** Already had command hints (pre-existing)

## Signal Sources

- Current dashboard gap: no guidance on how to change state. Users see data but don't know the next action.
- `pm/competitors/matrix.md`: No competitor has a read-only dashboard with CLI action hints — this is a unique UX pattern for editor-native tools.

## Competitor Context

- **ChatPRD:** Web app with clickable UI — no hints needed.
- **Productboard Spark:** Web app with interactive Jobs — no hints needed.
- **PM Skills Marketplace:** No dashboard at all.

This is a unique UX challenge for editor-native tools with visual companions. The dashboard bridges the gap between "seeing" and "doing."

## Acceptance Criteria

1. Home dashboard shows a "Suggested next" section with the right command based on knowledge base state
2. Kanban idea cards show `/pm:groom <slug>` hint
3. Kanban columns show contextual guidance below the header
4. Backlog detail pages show status-aware action hint below the title
5. Populated landscape tab shows refresh hint
6. Populated competitors tab shows re-profile hint
7. Hints are always visible (not collapsible)
8. All hint text uses consistent `.action-hint` styling (muted, small, code-highlighted commands)

## User Flows

N/A — no user-facing workflow for this feature type.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Scope

**In scope:**
- Kanban card hints (idea cards only)
- Kanban column hints (idea and groomed columns)
- Backlog detail page action hint (status-aware)
- Home dashboard "Suggested next" section
- Landscape and competitors refresh hints

**Out of scope:**
- Collapsible/toggle behavior (decided: always visible)
- Status transition UI (stays file-edit only)
- Copy-to-clipboard buttons (future enhancement)
- Click-to-run integration (not possible browser → CLI)
- Status history on detail pages

## Technical Feasibility

**Verdict: Feasible as scoped.**
- **Build-on:** Empty states already use the exact pattern. Home dashboard already computes stats and staleness. Kanban already has status mapping and slug data.
- **Build-new:** CSS for `.action-hint`, `.col-hint`, `.kanban-item-hint`, `.suggested-next` classes. Hint text generation logic per view. Home dashboard "suggested next" logic scanning backlog for first idea.
- **Risk:** None. Pure additive HTML/CSS. No new dependencies, no state changes.

## Research Links

- No dedicated research topic — this was scoped from the ideation writeup and competitive gap analysis.

## Notes

- Resolved: hints are always visible (not collapsible) — keeps it simple, no toggle logic.
- Resolved: no status transitions on detail pages — stays file-edit only, consistent with the read-only dashboard philosophy.
- The home dashboard "Suggested next" follows a priority waterfall: strategy → landscape → competitors → backlog → ideate.
