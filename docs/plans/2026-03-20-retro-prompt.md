# PM-040: Retro Prompt at Groom Session End

**Parent:** PM-038 (Project Memory System)
**Date:** 2026-03-20

## Problem

Grooming sessions end without reflection. Users never capture what worked or what didn't, so the same friction repeats across sessions. By prompting a short retro at the end of Phase 6 (Link), we capture learnings into `pm/memory.md` automatically — feeding future sessions with real experience data.

## Key Design Decisions

### Insertion point in Phase 6

The retro step inserts **after step 4 (validate artifacts)** and **before the current step 5 (update state + delete state file)**. The state file deletion moves to a new final step that runs only after the retro completes or is skipped. This ensures the session can be resumed if the retro is interrupted mid-conversation.

Current Phase 6 flow:
```
1. Check Linear config
2. Create issues (Linear or local)
3. (implied — no explicit step 3) → this is the "If no Linear" branch
4. Validate artifacts
5. Update state + delete state file + say "Grooming complete"
```

New Phase 6 flow:
```
1. Check Linear config
2a. If Linear: create issues
2b. If no Linear: write to backlog
3. Validate artifacts
4. Update state (issues status)
5. Retro prompt (3 questions, skip logic)
6. Delete state file + say "Grooming complete"
```

### Retro interaction pattern

Three questions, asked one at a time per the skill's pacing rule ("Ask ONE question at a time"). Each question maps to a fixed category — no AI inference needed.

| # | Question | Category |
|---|----------|----------|
| 1 | "What worked well in this session?" | `quality` |
| 2 | "What was slow or frustrating?" | `process` |
| 3 | "What should we do differently next time?" | `process` |

**Skip logic:** If the user says "skip" (or equivalent: "none", "nothing", "pass", "n/a", "no"), that question is bypassed and all remaining questions are skipped too. Any answers already given before the skip are still written. No error, no empty entries.

**Pacing:** Each question is asked individually. No follow-up probes, no clarifying sub-questions. Ask → receive answer → write entry → ask next (or finish if skipped/done).

### Memory entry format

Each answer produces one entry appended to `pm/memory.md`, following the schema from PM-039:

```yaml
- date: 2026-03-20
  source: retro
  category: quality | process
  learning: "{user's answer, lightly cleaned — one line}"
```

- `source` is always `"retro"` (fixed, per AC3)
- `category` is the predetermined value from the table above (no inference)
- `learning` is the user's answer trimmed to a single line. If the answer is multi-sentence, keep the first sentence and truncate with "..." only if over ~120 chars. No AI rephrasing — preserve the user's words.
- `detail` is omitted (optional field; retro answers are short enough to not need it)

### File creation

If `pm/memory.md` does not exist yet (PM-039 may not have shipped), create it with the schema before appending:

```markdown
---
type: project-memory
created: {today}
updated: {today}
entries: []
---

# Project Memory

Learnings captured from grooming sessions, retros, and manual observations.
```

If it already exists, read it, parse the frontmatter, append new entries to the `entries` array, and update the `updated` date. Write the entire file back.

## Task Breakdown

### Task 1: Modify `skills/groom/phases/phase-6-link.md` — restructure steps

**File:** `skills/groom/phases/phase-6-link.md`

1. Renumber steps for clarity. Separate "update state" from "delete state file" — they are currently bundled in step 5.
2. After the validate step (current step 4) and after the state update (setting issue statuses), insert a new retro section (step 5).
3. Move the state file deletion and "Grooming complete" message to a new final step (step 6) that runs after the retro.

The restructured file should have these logical blocks:
- Steps 1-3: Issue creation (Linear or local) + validation (unchanged logic, renumbered)
- Step 4: Update state with issue statuses
- Step 5: Retro prompt (new — see Task 2 for content)
- Step 6: Delete state file + closing message

### Task 2: Write the retro prompt instructions in phase-6-link.md

**File:** `skills/groom/phases/phase-6-link.md` (inside the new step 5)

The retro step instructions should specify:

```markdown
5. **Retro prompt.** Before deleting the state file, run a short retrospective:

   Say:
   > "Quick retro before we wrap up — three short questions."

   Ask the following questions **one at a time**. Wait for the user's answer before asking the next.

   | # | Question | Category |
   |---|----------|----------|
   | 1 | "What worked well in this session?" | quality |
   | 2 | "What was slow or frustrating?" | process |
   | 3 | "What should we do differently next time?" | process |

   **After each answer:**
   - If the user skips (says "skip", "none", "nothing", "pass", "n/a", or "no"):
     skip this question and all remaining questions. Do not write an entry for skipped questions.
   - Otherwise: write the answer as an entry to `pm/memory.md` (see write logic below), then ask the next question.

   **Write logic for each answered question:**
   1. If `pm/memory.md` does not exist, create it:
      ```yaml
      ---
      type: project-memory
      created: {today YYYY-MM-DD}
      updated: {today YYYY-MM-DD}
      entries: []
      ---

      # Project Memory

      Learnings captured from grooming sessions, retros, and manual observations.
      ```
   2. Read `pm/memory.md`. Parse the frontmatter.
   3. Append a new entry to the `entries` array using the **golden serialization format** (2-space indent for `- `, 4-space indent for continuation fields, quote values containing colons):
      ```yaml
      - date: {today YYYY-MM-DD}
        source: retro
        category: {category from table}
        learning: "{user's answer — preserve their words, trim to one line}"
      ```
   4. Update the `updated` field to today's date.
   5. Write the file back.

   **Serialization rules:** Use exactly 2-space indent + dash for entry start, 4-space indent for continuation fields. Quote any value containing a colon. This matches the parseFrontmatter() format validated in PM-039's round-trip test.

   After all 3 questions are answered (or a skip ends the retro), say:
   > "Retro captured — {N} learning(s) saved to pm/memory.md."

   If all questions were skipped (user skipped on question 1), say nothing about retro and proceed to step 6.
```

### Task 3: Update the final step (state file deletion) in phase-6-link.md

**File:** `skills/groom/phases/phase-6-link.md`

Move the state file deletion (`Delete .pm/groom-sessions/{slug}.md`) and the "Grooming complete" closing message to the new final step (step 6). This ensures the state file persists through the retro.

The closing message remains the same:
```
> "Grooming complete for '{topic}'. {N} issues created.
> Recommended next: /pm:ideate for more ideas, /pm:groom {next-idea}, or update priorities in pm/strategy.md."
```

### Task 4: Update `skills/groom/SKILL.md` phase table

**File:** `skills/groom/SKILL.md` (the phase table around line 93-104)

Update the Phase 6 row in the table to reflect the new retro step:

| Phase | File | Summary |
|-------|------|---------|
| 6. Link | `phases/phase-6-link.md` | Create issues in Linear or local backlog, validate, **retro prompt**, clean up |

The change is small: add "retro prompt" to the summary column for Phase 6.

### Task 5: Verify and test

1. Read the modified `phase-6-link.md` end-to-end to confirm:
   - Steps are numbered correctly
   - Retro is after validation and state update, before deletion
   - Skip logic is unambiguous
   - Write logic references the correct schema
2. Read `SKILL.md` to confirm the table row updated correctly
3. No script changes needed — this is purely skill instruction changes. No tests to run.

## Out of Scope

- Memory extraction from groom session content (PM-041)
- Surfacing memory entries at session start (PM-042)
- Archiving or pruning old memory entries
- Changes to `scripts/validate.js` or `scripts/server.js` (PM-039 handles the parser/validator)
- Linear-specific retro integration
