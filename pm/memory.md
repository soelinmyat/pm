---
type: project-memory
created: 2026-03-20
updated: 2026-03-22
entries:
  - date: 2026-03-20
    source: manual
    category: process
    learning: Project memory system bootstrapped with defined schema and validation
    detail: PM-039 established the pm/memory.md file format. Each entry captures date, source, category, learning, and optional detail. validate.js enforces the schema.
  - date: 2026-03-21
    source: retro
    category: quality
    learning: "Grooming session for remove-commands was largely smooth — pipeline worked well end-to-end"
  - date: 2026-03-21
    source: retro
    category: process
    learning: "Grooming ceremony (multi-reviewer iterations, bar raiser) takes time but user accepts the quality-speed tradeoff"
  - date: 2026-03-21
    source: retro
    category: process
    learning: "Final proposal should be more aggressively compact — understandable by a 16-year-old, information fed in smaller chunks"
  - date: 2026-03-21
    source: remove-commands
    category: review
    learning: "Team review required: AC4 routing anchor, AC9 parent duplication, AC8 cover definition, merge section-flag clarification, view AC3 testable criteria, sync Codex install gap"
  - date: 2026-03-21
    source: remove-commands
    category: scope
    learning: "Scope tightened: refactoring skill content, changing hook architecture, adding deprecated command stubs, modifying skill descriptions or trigger logic"
  - date: 2026-03-21
    source: retro
    category: quality
    learning: "Large groom-hero session (9 scope items, 5 issues, 3 review rounds) ran smoothly end-to-end"
  - date: 2026-03-21
    source: retro
    category: process
    learning: "Proposal HTML is still too complex — needs to be understandable by a 16-year-old with bite-sized information chunks, not dense executive format"
  - date: 2026-03-21
    source: retro
    category: process
    learning: "Visual companion during grooming (not just at the end) would improve the experience — relates to PM-036"
  - date: 2026-03-21
    source: groom-hero
    category: review
    learning: "Team review required 9 blocking fixes: parent AC duplication, untestable strategy gate, unmeasurable degradation, missing trust-signal framing, missing Fowler framing, self-referential competitor context, config schema mismatch, nav scope underestimation, scope review prompt resilience"
  - date: 2026-03-22
    source: retro
    category: quality
    learning: "Groom visual companion session ran smoothly end-to-end"
  - date: 2026-03-22
    source: retro
    category: process
    learning: "Retro should be 1 question, not 3 — too much ceremony at the end of a long session"
  - date: 2026-03-22
    source: groom-visual-companion
    category: review
    learning: "Team review required: success criteria placement, shareable artifact angle"
  - date: 2026-03-22
    source: retro
    category: process
    learning: "For features that produce visual artifacts (decks, templates), generate a visual example/mockup during grooming to validate design earlier"
  - date: 2026-03-22
    source: strategy-slide-deck
    category: review
    learning: "Team review required: on-demand /pm:strategy deck should handle missing strategy.md gracefully"
---

# Project Memory

Learnings captured from grooming sessions, retros, and manual observations.

Each entry in the YAML frontmatter above follows this schema:

- **date** (required): YYYY-MM-DD when the learning was captured
- **source** (required): session slug (e.g. `groom-session-001`), `retro`, or `manual`
- **category** (required): one of `scope`, `research`, `review`, `process`, `quality`
- **learning** (required): one-line summary of the insight
- **detail** (optional): expanded context for progressive disclosure

To add a new entry manually, append an object to the `entries` list in the frontmatter above and update the `updated` date.
