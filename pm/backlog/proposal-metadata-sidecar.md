---
type: backlog-issue
id: "PM-026"
title: "Proposal Metadata Sidecar"
outcome: "The dashboard can reliably read proposal metadata (title, date, verdict, phase, issue count) without parsing freeform HTML"
status: done
parent: "dashboard-proposal-hero"
children: []
labels:
  - "dashboard"
  - "groom"
  - "infrastructure"
priority: high
research_refs:
  - pm/research/dashboard-proposal-centric/findings.md
created: 2026-03-17
updated: 2026-03-17
---

## Outcome

When `phase-5.8` generates a proposal HTML file at `pm/backlog/proposals/{slug}.html`, it also writes a `proposal-meta.json` sidecar alongside it. The dashboard server reads this JSON to populate proposal cards without parsing the freeform HTML document. This decouples card rendering from HTML template structure.

Before: no structured metadata exists for proposals — extracting title/verdict/date requires brittle regex against HTML Claude writes freehand. After: metadata is a reliable JSON contract.

## Acceptance Criteria

1. `phase-5.8` writes `pm/backlog/proposals/{slug}.meta.json` alongside each `{slug}.html`.
2. JSON schema includes: `title` (string), `date` (YYYY-MM-DD), `verdict` (bar-raiser verdict string, e.g., "ready", "send-back"), `verdictLabel` (display label: "Ready" for "ready", "Needs Work" for "send-back", "Paused" for "pause"), `phase` (always "completed" for finished proposals), `issueCount` (integer), `gradient` (hero gradient CSS string, deterministically assigned from slug hash), `labels` (string array).
3. Existing proposal HTML generation is not broken — the sidecar is additive.
4. `server.js` can `JSON.parse()` the sidecar to populate proposal cards.
5. If the sidecar is missing (legacy proposals), the gallery degrades gracefully — shows the proposal with title derived from filename (kebab-case → title case), no verdict badge, no gradient (use neutral gray).
6. Draft proposals (from active `.groom-state.md`) do not have a sidecar — they are rendered from groom state fields only: `topic` → title, `phase` → badge label (human-readable), `started` → date. This is the canonical fallback for draft rendering, shared by PM-027 and PM-028.
7. This issue defines two shared helper functions in `server.js`: (a) `readProposalMeta(slug)` — reads and parses `{slug}.meta.json`, returns null if missing; (b) `readGroomState(pmDir)` — resolves `.pm/.groom-state.md` via `path.resolve(pmDir, '..', '.pm', '.groom-state.md')`, parses YAML frontmatter, returns null if missing or corrupted. Both helpers are consumed by PM-027, PM-028, PM-030.
8. Gradient assignment uses a deterministic hash of the slug to select from a predefined palette of 8 gradients. The palette and hash function are defined in this issue, not in consuming issues.

## User Flows

N/A — no user-facing workflow for this feature type. This is infrastructure that supports the proposal gallery.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

The sidecar schema is not just a data convention — it physically encodes PM's competitive differentiation. The `verdict` field (bar-raiser approval) and `issueCount` (delivery traceability) have no analogues in ChatPRD's document model (prompt-generated, no review pipeline) or Productboard Spark's output (no system-of-record writeback). The `phase: completed` field proves the proposal went through PM's full multi-phase groom — a provenance signal that competitors structurally cannot replicate. Schema design decisions should preserve this: resist simplifying to bare `title` + `date` which would make PM's cards indistinguishable from a generic document gallery.

## Technical Feasibility

**Build-on:** `phase-5.8-present.md` (at `${CLAUDE_PLUGIN_ROOT}/skills/groom/phases/phase-5.8-present.md`) already generates proposal HTML with all the data needed for the sidecar. The skill instructions just need an additional write step.

**Build-new:** JSON schema definition and a write instruction in phase-5.8. Server-side: a `readProposalMeta(slug)` helper function in `server.js`.

**Risk:** Coordinating a skills change with a server change — both must agree on the JSON schema. Define schema once, reference from both.

## Research Links

- [Dashboard Proposal-Centric Redesign](pm/research/dashboard-proposal-centric/findings.md)

## Notes

- This is the prerequisite for all gallery work. Must ship first. No other child issue should begin implementation until this is merged.
- Schema should be minimal and stable — resist adding fields until the gallery proves they're needed.

## Dependencies

- None — this is the foundation issue. All other child issues depend on this.
