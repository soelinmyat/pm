# PM-041: Automated Learning Extraction from Groom State

**Parent:** PM-038 (Project Memory System)
**Date:** 2026-03-20

## Problem

The retro prompt (PM-040) captures subjective learnings from the user, but groom sessions also produce quantitative signals: scope that needed multiple review iterations, bar raiser send-backs, scope items tightened during review, and team review conditions. These signals are already in the state file but disappear when it is deleted. By extracting them automatically before deletion, we build a richer memory that the user never has to manually capture.

## Key Design Decisions

### Insertion point in Phase 6

PM-040 restructures Phase 6 into:
```
1. Check Linear config
2a. If Linear: create issues
2b. If no Linear: write to backlog
3. Validate artifacts
4. Update state (issues status)
5. Retro prompt (3 questions, skip logic)
6. Delete state file + say "Grooming complete"
```

PM-041 inserts a new **step 5.5** (or renumbered as step 6, pushing deletion to step 7) between the retro prompt and the state file deletion:

```
1. Check Linear config
2a. If Linear: create issues
2b. If no Linear: write to backlog
3. Validate artifacts
4. Update state (issues status)
5. Retro prompt (PM-040)
6. Automated learning extraction (PM-041) ← NEW
7. Delete state file + say "Grooming complete"
```

This ordering ensures:
- The state file still exists for extraction (AC7)
- Retro entries (user-written) come before extraction entries (auto-generated) in `pm/memory.md` (AC5)
- Extraction is silent — no user interaction (AC5)

### Extraction logic: threshold-based signals

The extraction reads the state file frontmatter and checks five conditions. Only conditions that meet the threshold produce a memory entry. Sessions with no signals produce no entries (AC3).

| # | Condition | Threshold | Learning text | Category |
|---|-----------|-----------|---------------|----------|
| 1 | `scope_review.iterations` > 1 | iterations > 1 | "Scope needed {N} iterations — blocking issues: {scope_review blocking issues summary}" | `scope` |
| 2 | `team_review.conditions` has at least one entry | conditions array non-empty | "Team review required: {conditions list}" | `review` |
| 3 | `bar_raiser.verdict` is `"send-back"` | verdict === "send-back" | "Bar raiser sent back: {bar_raiser.conditions[0] or verdict reason}" | `review` |
| 4 | Scope items moved from in-scope to out-of-scope during review | `scope_review.iterations` > 1 AND current `scope.out_of_scope` is non-empty (items were tightened) | "Scope tightened: {out_of_scope items}" | `scope` |
| 5 | Clean session | `scope_review.iterations` === 1 AND `bar_raiser.verdict` === "ready" | "Clean session — scope and reviews passed first iteration" | `quality` |

**Important nuances:**
- Condition 4 (scope tightened): The state file tracks `scope.in_scope` and `scope.out_of_scope`, but does not track the original pre-review in-scope list. We approximate this signal by checking: if `scope_review.iterations > 1` AND `scope.out_of_scope` is non-empty, items were likely moved during review. This is a conservative heuristic — the signal triggers only when there were multiple iterations AND out-of-scope items exist.
- Condition 5 (clean session) is mutually exclusive with conditions 1 and 4 (both require iterations > 1). It can coexist with conditions 2 and 3 in edge cases, but in practice a clean session means no team review conditions and no send-back.
- If the state file is missing or corrupted (frontmatter unparseable), skip extraction entirely with a warning message to the user (AC6). Do not crash.

### Entry format

Each extracted entry follows the PM-039 schema:

```yaml
- date: {today YYYY-MM-DD}
  source: {session-slug}
  category: scope | review | quality
  learning: "{generated text from threshold table}"
```

- `source` is the session slug (e.g., `"bulk-editing"`), not `"retro"` — distinguishing auto-extracted entries from user retro entries (AC4)
- `category` uses the values from the threshold table above (all valid per PM-039's `VALID_MEMORY_CATEGORIES`)
- No `detail` field — the learning text is self-contained

### Appending to pm/memory.md

Same write logic as PM-040's retro step:
1. If `pm/memory.md` does not exist, create it with the PM-039 schema (frontmatter + header)
2. Read and parse the frontmatter
3. Append all extraction entries to the `entries` array (after any retro entries that PM-040 just wrote)
4. Update the `updated` field
5. Write the file back

Because this runs after PM-040's retro step, the entries naturally appear after retro entries in the array.

## Task Breakdown

### Task 1: Add automated extraction step to `skills/groom/phases/phase-6-link.md`

**File:** `skills/groom/phases/phase-6-link.md`

After PM-040's modifications, the file will have steps 1-5 (retro) and step 6 (deletion). Insert a new step between them and renumber:

- Current step 5 (retro prompt from PM-040) stays as step 5
- Insert new step 6: "Automated learning extraction"
- Current step 6 (delete state file) becomes step 7

The new step 6 content:

```markdown
6. **Automated learning extraction.** Silently extract quantitative learnings from the state file. No user interaction.

   Read `.pm/groom-sessions/{slug}.md` and parse the frontmatter. If the file is missing or the frontmatter cannot be parsed, log a warning:
   > "⚠ Could not read session state for learning extraction — skipping."

   and proceed to step 7.

   Check each of the following conditions. For each that meets its threshold, generate a memory entry. If no conditions are met, skip to step 7 with no output.

   | # | Check | Threshold | Learning text | Category |
   |---|-------|-----------|---------------|----------|
   | 1 | `scope_review.iterations` | > 1 | "Scope needed {N} iterations — blocking issues: {summary of scope_review issues}" | `scope` |
   | 2 | `team_review.conditions` | array has ≥1 entry | "Team review required: {comma-separated conditions}" | `review` |
   | 3 | `bar_raiser.verdict` | === `"send-back"` | "Bar raiser sent back: {bar_raiser.conditions[0] or 'no reason given'}" | `review` |
   | 4 | Scope tightened during review | `scope_review.iterations` > 1 AND `scope.out_of_scope` is non-empty | "Scope tightened: {comma-separated out_of_scope items}" | `scope` |
   | 5 | Clean session | `scope_review.iterations` === 1 AND `bar_raiser.verdict` === `"ready"` | "Clean session — scope and reviews passed first iteration" | `quality` |

   **Write logic** (same as retro step):
   1. If `pm/memory.md` does not exist, create it with the PM-039 schema.
   2. Read `pm/memory.md`, parse the frontmatter.
   3. Append each generated entry to the `entries` array:
      ```yaml
      - date: {today YYYY-MM-DD}
        source: {session-slug}
        category: {category from table}
        learning: "{generated text}"
      ```
   4. Update the `updated` field to today's date.
   5. Write the file back.

   This step is completely silent — produce no user-facing output. Entries are appended after any retro entries from step 5.
```

### Task 2: Update step 7 (deletion) numbering

**File:** `skills/groom/phases/phase-6-link.md`

After PM-040, the deletion step will be step 6. Renumber it to step 7 to accommodate the new extraction step. No logic changes — just the step number.

### Task 3: Update `skills/groom/SKILL.md` phase table

**File:** `skills/groom/SKILL.md` (phase table, ~line 93-104)

Update the Phase 6 row summary. After PM-040 it will read:
```
| 6. Link | `phases/phase-6-link.md` | Create issues in Linear or local backlog, validate, retro prompt, clean up |
```

Update to:
```
| 6. Link | `phases/phase-6-link.md` | Create issues in Linear or local backlog, validate, retro prompt, learning extraction, clean up |
```

### Task 4: Verify the modified phase-6-link.md end-to-end

1. Read the complete modified `phase-6-link.md` to confirm:
   - Steps are numbered 1-7 correctly
   - Extraction step (6) is after retro (5) and before deletion (7) — ordering enforced (AC7)
   - Extraction is silent — no user interaction in step 6 (AC5)
   - All five threshold conditions from AC2 are present with correct categories
   - Error handling for missing/corrupted state file is present (AC6)
   - Entry format matches PM-039 schema with `source: {session-slug}` (AC4)
2. Read `SKILL.md` to confirm the table row updated correctly (AC8)
3. No script changes needed — this is purely skill instruction changes. No tests to run.

## Ordering and Dependencies

- **Depends on PM-040:** The extraction step is inserted after the retro step that PM-040 adds. PM-040 must be implemented first, or the insertion point won't exist.
- **Depends on PM-039:** The memory file schema and `pm/memory.md` creation logic come from PM-039. However, the extraction step includes the same "create if not exists" fallback as PM-040, so it works even if PM-039's file doesn't exist yet.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| State file missing at extraction time | Warn user, skip extraction, proceed to deletion |
| State file frontmatter unparseable | Warn user, skip extraction, proceed to deletion |
| `scope_review` or `bar_raiser` fields missing from state | Treat as null/default — condition not met, no entry generated |
| `pm/memory.md` doesn't exist | Create it with PM-039 schema before appending |
| `pm/memory.md` exists but has corrupt frontmatter | This is an edge case — attempt to parse; if it fails, skip extraction with warning |
| No conditions meet thresholds | No entries generated, no file writes, no output — proceed silently to deletion |

## Out of Scope

- Changes to `scripts/validate.js` or `scripts/server.js` (PM-039 handles parser/validator)
- User-interactive memory editing or review
- Surfacing memory entries at session start (PM-042)
- Tracking original pre-review in-scope list (would require state file schema change)
- Archiving or pruning old memory entries
