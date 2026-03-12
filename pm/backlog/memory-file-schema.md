---
type: backlog-issue
id: "PM-039"
title: "Define Project Memory File Schema"
outcome: "pm/memory.md has a defined, validated schema so learnings are structured consistently and retrievable by future sessions"
status: done
parent: "project-memory-system"
children: []
labels:
  - "memory"
  - "schema"
priority: high
research_refs:
  - pm/research/memory-improvement-loop/findings.md
created: 2026-03-20
updated: 2026-03-20
---

## Outcome

After shipping, `pm/memory.md` has a clear frontmatter schema and entry format that all memory-writing features (retro prompt, automated extraction) use consistently. The schema supports structured entries with dates, source citations, categories, and one-line summaries — enabling progressive disclosure at read time.

## Acceptance Criteria

1. `pm/memory.md` uses YAML frontmatter with `type: project-memory`, `created`, and `updated` fields, plus an `entries:` key containing a YAML list of entry objects.
2. Each entry object has required fields: `date` (YYYY-MM-DD), `source` (session slug or "retro" or "manual"), `category` (one of: scope, research, review, process, quality), `learning` (one-line summary string). Optional field: `detail` (expanded context string for progressive disclosure).
3. Example entry structure in frontmatter:
   ```yaml
   entries:
     - date: 2026-03-20
       source: "memory-improvement-loop"
       category: review
       learning: "Scope needed 2 iterations — blocking issue was missing success criteria"
       detail: "PM reviewer flagged no measurable 90-day outcome. Added 3 success criteria."
   ```
4. The file is valid markdown readable by humans without tooling. Users can manually add entries following the schema.
5. `scripts/validate.js` is extended: when `pm/memory.md` exists, validates that every entry has all required fields (`date`, `source`, `category`, `learning`) and that `category` is one of the 5 allowed values. Exits non-zero with a descriptive error listing the invalid entry when validation fails. The groom flow surfaces the validation output but does not crash.
6. `validate.js` prints a non-blocking warning when `pm/memory.md` exceeds 50 entries: "Memory file has {N} entries — consider pruning entries older than 6 months."

## User Flows

N/A — schema definition, no user interaction.

## Wireframes

N/A — no user-facing workflow for this feature type.

## Competitor Context

GitHub Copilot stores memories as structured facts with subject, claim, citations, and justification. Claude-Mem uses SQLite with vector embeddings — overkill for PM's scale. PM's approach is simpler: plain markdown with structured entries, version-controlled, human-editable. This matches PM's design philosophy of files-over-databases.

## Technical Feasibility

Low effort with one parser caveat. Follows existing patterns:
- `pm/strategy.md` and `pm/landscape.md` already use frontmatter schemas
- `scripts/validate.js` already validates `pm/backlog/` and `pm/strategy.md` — extending to `pm/memory.md` follows the same pattern
- **Parser upgrade required:** The `parseFrontmatter()` in `scripts/validate.js` (lines 21-57) only handles flat scalar arrays — it cannot parse the array-of-objects structure that `entries:` requires. The `parseFrontmatter()` in `scripts/server.js` (lines 136-215) does handle nested objects. Implementation must port or share the parser before AC5 can be satisfied.
- No other new infrastructure required

## Research Links

- [Memory System and Improvement Loop](pm/research/memory-improvement-loop/findings.md) — Finding 1: extraction pipelines that produce structured knowledge outperform raw logging

## Notes

- Schema is simple enough that manual entries are easy — `source: "manual"` is a valid source value.
- Categories are fixed for v1 (scope, research, review, process, quality). Extensibility deferred to v2.
- The pruning mechanism (stale entry removal) is a guideline for v1, not automated — automation deferred to v2.
- This issue has no dependencies and must be implemented first. PM-040, PM-041, and PM-042 all depend on this schema.
- PM's markdown-in-repo approach is immune to the main failure mode of cloud-based memory (vendor lock-in, data portability). The memory file is `git clone` away.
