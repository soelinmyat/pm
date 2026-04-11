---
name: Retro
order: 11
description: Auto-extract learnings from dev session state, write to pm/memory.md
---

## Retro — Auto-Extract Learnings

Runs after EVERY task regardless of size. Applies to both single-issue and multi-task flows.

If extraction fails at any point, do NOT delete the state file. Instead, write `retro_failed: true` to the state file and say:
> "Retro extraction failed; session state preserved for retry."
Then stop — do not proceed to deletion.

---

### Step 1: Scan for extractable events

Read the dev session state file (`{source_dir}/.pm/dev-sessions/{slug}.md`) and check for these events:

| Event | Condition | Category | Learning template |
|-------|-----------|----------|-------------------|
| RFC review iterations > 1 | `Review` section shows multiple review passes (e.g., re-reviews, "Re-runs" > 0, multiple review gate entries) | `review` | "from RFC review: {N} review iterations required" |
| QA verdict Fail | `QA` section has `QA verdict: fail` (any case) | `quality` | "from QA: verdict was Fail — {issues found summary if available}" |
| Review blocking fixes | `Review` section shows blocking issues were fixed (count > 0) | `review` | "from review: {N} blocking fix(es) applied" |
| Merge conflicts encountered | `Merge-Watch` section has `Gate 5 (Conflicts)` = anything other than `pending` or `passed`, OR state file mentions conflict resolution | `process` | "from merge: merge conflicts encountered and resolved" |
| CI failures requiring intervention | `Merge-Watch` section has `Gate 1 (CI)` = `failed` or state mentions CI fix, OR `QA` section has `Re-runs` > 0 due to CI | `process` | "from CI: failures required manual intervention" |

---

### Step 2: No events — skip silently

If none of the conditions above match (clean session: XS task, shipped clean, no friction), log internally "no learnings detected" and skip to **Step 7** (state file deletion). Do NOT prompt the user.

---

### Step 3: Events found — present auto-extracted learnings

Build one learning entry per matched event using the templates above, filling in specifics from the session state. Present the list to the user:

> "Retro: {N} learning(s) extracted from this dev session:
> 1. [{category}] {learning text}
> 2. [{category}] {learning text}
> ...
> Pin a learning to keep it permanently (say 'pin 2').
> Options: (a) Accept as-is (b) Add your own learnings too (c) Accept auto-extracted only"

Wait for the user's answer.
- **(a) or (c):** Proceed with auto-extracted entries only.
- **(b):** Collect additional learnings from the user. Each user-provided learning needs `category` (offer the valid set: `scope`, `research`, `review`, `process`, `quality`) and a one-liner. Append them to the auto-extracted list.
- **Pin:** If the user says "pin {N}", mark that entry with `pinned: true`. Multiple pins allowed. Then continue with the accept/add flow.

This is a hard gate — at minimum the auto-extracted learnings must be written before state file deletion.

---

### Step 4: Deduplicate

Read `{pm_dir}/memory.md`. For each entry to write, check existing entries: if any existing entry matches on `source` + `date` + first 50 characters of `learning`, skip that entry (already written, likely from a prior retro attempt on the same session).

---

### Step 5: Write entries

**5a. Concurrent write guard.** Immediately before appending, re-read `{pm_dir}/memory.md` to get the latest state. Append new (non-duplicate) entries to the `entries` list from the freshly-read version, not from any earlier read.

**5b. Write.** Each entry uses this format inside the `entries` list:

```yaml
- date: {today, YYYY-MM-DD}
  source: "{slug}"
  category: "{mapped category}"
  learning: "{one-liner from template or user}"
  detail: "{optional — only if additional context is available}"
  pinned: true  # only if user pinned this entry
```

Write the updated `{pm_dir}/memory.md` preserving the existing frontmatter structure (`type: project-memory`).

**5c. Error recovery.** If the write fails, do NOT delete the state file. Write `retro_failed: true` to the state file and stop.

---

### Step 6: Post-write cap check and validation

**6a. Cap enforcement.** After writing, count total entries in `{pm_dir}/memory.md`. If count exceeds 50, follow the algorithm in `${CLAUDE_PLUGIN_ROOT}/references/memory-cap.md`:
- Move oldest non-pinned entries to `{pm_dir}/memory-archive.md` until count <= 50
- If all entries are pinned, warn the user

**6b. Validate.** Run:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
```
If validation fails, fix the entries and re-validate before proceeding.

---

### Step 7: Delete state file

Delete `{source_dir}/.pm/dev-sessions/{slug}.md` after successful retro extraction (or silent skip). Dev session is complete.

---

### Linear retro comment (M/L/XL)

**Linear** (if available and task is M/L/XL):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "{learnings summary}" })
```

---

### State File ({source_dir}/.pm/dev-sessions/{slug}.md)

The state file is the **single source of truth** for session state. Updated at every stage transition and task completion. **Deleted after retro.**

**Repo location:** Dev sessions always live in the source repo's `.pm/dev-sessions/` directory — even in separate-repo mode. This keeps dev state co-located with the code being modified. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}.md` as before.

After compaction or if context feels stale, read this file to recover full session state.

```markdown
# Dev Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | implement |
| Size | M |
| Task Count | 1 |
| Ticket | PROJ-456 |
| Repo root | /path/to/project |
| Active cwd | /path/to/project/.worktrees/feature-name |
| RFC | {pm_dir}/backlog/rfcs/feature-name.html |
| Branch | feat/feature-name |
| Worktree | .worktrees/feature-name |
| Started at | 2026-04-04T01:00:00Z |
| Stage started at | 2026-04-04T03:20:00Z |
| Completed at | null |

## Project Context
- Product: Example App — task management for teams
- Stack: Rails API + React frontend + React Native mobile
- Test command: pnpm test (inferred from package.json)
- Issue tracker: Linear (detected via MCP)
- Monorepo: yes (apps/api, apps/web-client, apps/mobile)
- CLAUDE.md: present
- AGENTS.md: present
- Strategy: present

## Decisions
- Platform: frontend (frontend + backend files modified)
- Spec review: passed (commit abc123)
- Plan review: passed (commit def456)
- Continuous execution: authorized
- Contract gate: passed (commit ghi789) — frontend detected, gate required
- Design critique: required (frontend files modified)
- E2E: yes (CRUD flow)

## Sub-Issues (only present when task_count > 1)

| # | ID | Title | Size | Status | PR | Retries | Started | Completed |
|---|----|-------|------|--------|----|---------|---------|-----------|
| 1 | ISSUE-001 | First task | S | Merged (PR #312) | #312 | 0 | ... | ... |
| 2 | ISSUE-002 | Second task | M | Implementing | — | 0 | ... | — |

## Tasks
- [x] 1. Add migration
- [x] 2. Model + backend tests
- [ ] 3. Frontend mock + components

## Key Files
- backend/app/controllers/api/v1/features_controller.rb
- frontend/src/features/feature-name/FeatureList.tsx

## Design Critique
- Status: pending
- Size routing: S (lite, 1 round) | M/L/XL (full)
- Report: (not yet run)

## QA
- QA verdict: pending
- Ship recommendation: pending
- Issues found: pending
- Issues fixed: none
- Issues deferred: none
- Confidence: pending
- Re-runs: 0

## Review
- Review gate: pending

## Merge-Watch
- Stage: pending
- PR: (not yet created)
- Gate 1 (CI): pending
- Gate 2 (Claude review): pending
- Gate 3 (Codex review): pending
- Gate 4 (Comments): pending
- Gate 5 (Conflicts): pending

## Linear Context (if sourced from Linear)
| Field | Value |
|-------|-------|
| Linear ID | {ID or null} |
| Linear readiness | dev-ready / needs-groom / null |
| Linear fetch | succeeded / failed / null |
| Linear gaps | [missing-ac, vague-scope, unclear-size] or [] |
| Linear labels | {labels or []} |

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

**Valid Stage values:** `intake`, `workspace`, `rfc-check`, `rfc-generation`, `rfc-review`, `rfc-approved`, `implement`, `simplify`, `design-critique`, `qa`, `review`, `ship`, `retro`.

The `rfc-approved` stage means: RFC was approved by the user, but they chose to stop and resume implementation in a new session. On resume, skip to Implementation via the resume path.

**Update rules:**
- Write the full file (not append) at each stage transition
- Keep `Stage started at` current at every stage transition and set `Completed at` when the session finishes
- Include all decisions made so far — a cold reader should understand the full context
- After design critique, add the report path
- Resume Instructions section must be populated at every stage transition. A cold reader should be able to continue the session from this section alone.
- After retro, delete the file
