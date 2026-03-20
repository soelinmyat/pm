# PM-042: Memory Injection at Phase 1 Session Start

**Parent:** PM-038 (Project Memory System)
**Date:** 2026-03-20

## Problem

Groom sessions start from scratch every time. Even though PM-040 and PM-041 capture retro answers and quantitative signals into `pm/memory.md`, that accumulated context is never surfaced back to the user. By injecting recent learnings at Phase 1 start, the plugin establishes continuity between sessions — the user sees what was learned before they commit to a new scope.

## Key Design Decisions

### Insertion point in Phase 1

The memory injection inserts as **step 3.5** — after the existing `pm/research/` check (step 3) and before the codebase scan (step 4). This mirrors the pattern of step 3: read a file, surface a one-liner, then move on.

Current Phase 1 flow:
```
1. Ask "What's the idea?"
2. Clarify if needed (follow-ups)
3. Check pm/research/ for existing context
4. Codebase scan
5. Derive topic slug
6. Create session state file
```

New Phase 1 flow (for non-backlog ideas):
```
1. Ask "What's the idea?"
2. Clarify if needed (follow-ups)
3. Check pm/research/ for existing context
3.5. Memory injection — surface recent learnings from pm/memory.md
4. Codebase scan
5. Derive topic slug
6. Create session state file
```

For the backlog-idea fast path (top of file), the injection inserts **after the pre-fill confirmation and after step 3** (research check), before step 4. The user has confirmed the idea context but hasn't started scoping yet — this is the right moment to surface memory.

### Selection logic: recency only

v1 uses deterministic recency selection — no relevance ranking, no keyword matching. Read `pm/memory.md`, parse the `entries` array, sort by `date` descending, take the first 5. This is simple, predictable, and avoids any AI-inference overhead.

If fewer than 5 entries exist, surface all of them. If zero entries exist (or the file is missing), skip silently.

### Token budget

Each entry's `learning` field is a one-line summary (~100 tokens). With max 5 entries, the injected context is ~500 tokens. The `detail` field (which can be longer) is never injected automatically — only shown on-demand when the user requests it. This keeps the injection lightweight and avoids pushing the user's actual idea out of context.

### Interaction pattern

The injection is a brief, skippable information block:

```
> From past sessions:
> - {learning 1}
> - {learning 2}
> - {learning 3}
> Want detail on any of these before we proceed?
```

If the user asks for detail on one or more entries:
1. Show the full `detail` field for the requested entry(ies) as a fenced blockquote immediately below the summary.
2. Then prompt: "Ready to proceed with intake?"

If the user says no / proceeds / gives any non-detail-request response, continue to step 4 (codebase scan).

### Silent skip

If `pm/memory.md` does not exist, or exists but the `entries` array is empty, skip the entire step with no output. No "no memories found" message — this avoids noise for new projects or first-time sessions.

If the file exists but frontmatter is unparseable, also skip silently (defensive — don't block intake on a malformed memory file).

## Task Breakdown

### Task 1: Add memory injection step to `skills/groom/phases/phase-1-intake.md`

**File:** `skills/groom/phases/phase-1-intake.md`

Insert a new step 3.5 between the current step 3 (pm/research/ check) and step 4 (codebase scan). The new step:

```markdown
3.5. **Memory injection.** Check `pm/memory.md` for past session learnings.

   If `pm/memory.md` does not exist, or exists but has no entries, or frontmatter cannot be parsed — skip this step silently. Do not print any message.

   If entries exist:
   1. Read `pm/memory.md` and parse the frontmatter.
   2. Sort the `entries` array by `date` descending (most recent first).
   3. Take the first 5 entries (or all if fewer than 5).
   4. Surface them as one-line summaries:

      > "From past sessions:
      > - {entry1.learning}
      > - {entry2.learning}
      > - {entry3.learning}
      > Want detail on any of these before we proceed?"

   5. If the user asks for detail on a specific entry:
      - Show the `detail` field (if it exists) as a fenced blockquote below the summary line.
      - If no `detail` field exists for that entry, say: "No additional detail recorded for that entry."
      - Then ask: "Ready to proceed with intake?"
   6. If the user says no detail is needed (or gives any response that isn't a detail request), proceed to step 4.

   **Token budget:** Only surface the `learning` field (one-line summaries). Never inject the `detail` field automatically. Full detail is on-demand only. Max 5 entries ≈ 500 tokens.
```

### Task 2: Add memory injection for backlog-idea fast path

**File:** `skills/groom/phases/phase-1-intake.md`

The backlog-idea fast path at the top of the file currently says "Skip to step 3 after confirmation." The memory injection should also apply to backlog ideas — after the research check (step 3) completes, step 3.5 runs before step 4.

No change needed to the fast-path text itself — the "Skip to step 3" directive means steps 3, 3.5, 4, 5, 6 all run in order. But add a clarifying note to the fast-path block:

```markdown
Skip to step 3 after confirmation. (Steps 3, 3.5, 4, 5, 6 run normally.)
```

This makes it explicit that memory injection applies to both paths.

### Task 3: Update `skills/groom/SKILL.md` phase table

**File:** `skills/groom/SKILL.md` (phase table, ~line 93-104)

Update the Phase 1 row summary to reflect the new memory injection step:

Current:
```
| 1. Intake | `phases/phase-1-intake.md` | Capture the idea, clarify, derive slug, write initial state |
```

Updated:
```
| 1. Intake | `phases/phase-1-intake.md` | Capture the idea, clarify, surface past learnings, derive slug, write initial state |
```

### Task 4: Verify end-to-end

1. Read the modified `phase-1-intake.md` to confirm:
   - Step 3.5 is between step 3 (research check) and step 4 (codebase scan)
   - Silent skip logic is present for missing/empty/corrupt memory file
   - Token budget constraint is explicit (summaries only, max 5)
   - Detail-on-demand interaction pattern is clear
   - Both code paths (new idea + backlog idea) include memory injection
2. Read `SKILL.md` to confirm the Phase 1 summary row updated correctly
3. No script changes needed — this is purely skill instruction changes. No tests to run.

## Ordering and Dependencies

- **Depends on PM-039:** The memory file schema (`pm/memory.md` with frontmatter `entries` array) is defined by PM-039. The injection step reads this file.
- **Depends on PM-040 and PM-041 for value:** Without retro entries (PM-040) or extracted learnings (PM-041), the memory file will be empty and this step will skip silently. But PM-042 does not depend on them structurally — it reads whatever entries exist.
- **No dependency on Phase 6 changes:** PM-042 only modifies Phase 1. It does not conflict with PM-040/PM-041's Phase 6 changes.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `pm/memory.md` does not exist | Skip silently — no output |
| `pm/memory.md` exists but `entries` is empty `[]` | Skip silently — no output |
| `pm/memory.md` frontmatter is unparseable | Skip silently — no output, don't block intake |
| `pm/memory.md` has fewer than 5 entries | Surface all entries (no padding) |
| User asks for detail but entry has no `detail` field | Say "No additional detail recorded for that entry." |
| User gives ambiguous response to "want detail?" | Treat as "no detail needed" — proceed to step 4 |

## Out of Scope

- Relevance-based filtering or keyword matching (future enhancement for v2)
- Memory search or query interface
- Changes to `scripts/validate.js` or `scripts/server.js` (PM-039 handles parser/validator)
- Memory file creation (PM-040 and PM-041 handle file creation on first write)
- Memory archiving or pruning
