---
type: project-memory
created: 2026-03-20
updated: 2026-03-20
entries:
  - date: 2026-03-20
    source: manual
    category: process
    learning: Project memory system bootstrapped with defined schema and validation
    detail: PM-039 established the pm/memory.md file format. Each entry captures date, source, category, learning, and optional detail. validate.js enforces the schema.
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
