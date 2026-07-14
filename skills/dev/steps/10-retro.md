---
name: Retro
order: 10
description: Auto-extract learnings from dev session state, write to pm/memory.md, and write durable implementation learnings when warranted
phase: retro
requires:
  - state-schema.md
gates: []
required_evidence:
  - retro
requires_commit: false
allowed_modes:
  - inline
  - headless
result_schema: phase-result-v1
---

## Retro — Auto-Extract Learnings

## Goal

Extract durable learnings from the completed dev session, write them to the right PM artifacts, and only then remove the dev session state.

## How

Runs after EVERY task regardless of size. Applies to both single-issue and multi-task flows.

If extraction fails at any point, preserve canonical state and record a structured failed retro result with the error evidence. Then say:
> "Retro extraction failed; session state preserved for retry."
Then stop — do not proceed to deletion.

---

### Generalization Rule

The `learning` field in each memory entry must be **generalizable to future sessions**, not a description of what happened in this session. A reader encountering this learning in a different context should be able to apply it without knowing anything about the source session.

- **Bad:** "from RFC review: 3 review iterations required" (session-specific fact — tells future sessions nothing actionable)
- **Good:** "Check edge-case handling and error states before review — most re-reviews stem from missing unhappy paths" (actionable pattern any session can apply)

Session-specific context (counts, slugs, specific failures) belongs in the `detail` field, not in `learning`.

---

### Step 1: Scan for extractable events

Read the dev session state file (`{source_dir}/.pm/dev-sessions/{slug}/session.json`) and check for these events:

**Single-task events** (check `Review`, `QA`, `Merge-Watch` sections directly):

| Event | Condition | Category | Learning guidance |
|-------|-----------|----------|-------------------|
| RFC review iterations > 1 | `Review` section shows multiple review passes (e.g., re-reviews, "Re-runs" > 0, multiple review gate entries) | `review` | Read the review feedback to identify the root cause. Write a generalizable lesson: what practice or check would prevent this class of review rework in any future session? |
| QA verdict Fail | `QA` section has `QA verdict: fail` (any case) | `quality` | Read the QA findings to identify the class of issue missed. Write a generalizable lesson: what should be validated earlier (and how) to catch this type of issue before QA? |
| Review blocking fixes | `Review` section shows blocking issues were fixed (count > 0) | `review` | Read the blocking issues to identify the common pattern. Write a generalizable lesson: what should be checked or structured differently before submitting for review? |
| Merge conflicts encountered | `Merge-Watch` section has `Gate 5 (Conflicts)` = anything other than `pending` or `passed`, OR state file mentions conflict resolution | `process` | Identify what area/files conflicted and why. Write a generalizable lesson: what coordination or branching practice would reduce conflicts in similar work? |
| CI failures requiring intervention | `Merge-Watch` section has `Gate 1 (CI)` = `failed` or state mentions CI fix, OR `QA` section has `Re-runs` > 0 due to CI | `process` | Identify the failure class and why it wasn't caught locally. Write a generalizable lesson: what local check or practice would catch this type of CI failure before push? |

**Multi-task events** (check `## Per-Task Events` section, written by Step 05 checkpoint):

For multi-task sessions, per-task agents handle QA/review/ship internally and the main `Review`/`QA`/`Merge-Watch` sections remain at `pending`. Instead, scan the `## Per-Task Events` section for aggregated per-task data:

| Event | Condition | Category | Learning guidance |
|-------|-----------|----------|-------------------|
| Multiple review iterations | Any task has `reviews > 1` | `review` | Query the PR for review comments to understand what needed revision. Write a generalizable lesson. |
| CI failures | Any task has `CI runs > 1` (multiple runs = failures fixed) | `process` | Query the PR for CI logs to identify failure class. Write a generalizable lesson. |
| Merge conflicts | Any task has `conflict commits > 0` | `process` | Identify which tasks conflicted. Write a generalizable lesson about task ordering or scope. |
| Tasks blocked/failed | Any task has `verdict=Blocked` or `verdict=Failed` | `process` | Identify what blocked the task. Write a generalizable lesson about scoping or prerequisites. |

If no `## Per-Task Events` section exists in a multi-task session (legacy or checkpoint failure), fall back to checking PR history directly:
```bash
# For each task PR in the ## Tasks table:
gh pr view {PR_NUMBER} --json reviews,statusCheckRollup,commits
```

---

### Step 2: No events — skip silently

If none of the conditions above match (clean session: XS task, shipped clean, no friction), log internally "no learnings detected" and skip to **Step 7** (record completion). Do NOT prompt the user.

---

### Step 3: Events found — present auto-extracted learnings

For each matched event, follow the learning guidance in the table above: read the relevant session state section, identify the root cause or pattern, and write a **generalizable, actionable** one-liner that any future session could benefit from. Put session-specific details (counts, file names, specific error messages) into the `detail` field, not the `learning` field. Present the list to the user:

**Autonomous default:** If `retro.auto_accept: true` in `{pm_state_dir}/config.json` (or the key is absent — auto-accept is the default), write the auto-extracted learnings directly without prompting. Log `retro: auto-accepted {N} learnings` and proceed. No user turn.

**Interactive mode:** Only when `retro.auto_accept: false` is explicitly set, present the review prompt:

> "Retro: {N} learning(s) extracted from this dev session:
> 1. [{category}] {learning text}
> 2. [{category}] {learning text}
> ...
> Pin a learning to keep it permanently (say 'pin 2').
> Options: (a) Accept as-is (b) Add your own learnings too (c) Accept auto-extracted only"

Wait for the user's answer.
- **(a) or (c):** Proceed with auto-extracted entries only.
- **(b):** Collect additional learnings from the user. Each user-provided learning needs `category` (offer the valid set: `scope`, `research`, `review`, `process`, `quality`) and a one-liner. Nudge the user toward generalizable phrasing if their learning is session-specific (e.g., "what's the broader lesson here?"). Append them to the auto-extracted list.
- **Pin:** If the user says "pin {N}", mark that entry with `pinned: true`. Multiple pins allowed. Then continue with the accept/add flow.

This is a hard gate — at minimum the auto-extracted learnings must be written before retro completion.

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
  learning: "{generalizable, actionable one-liner — no session-specific details}"
  detail: "{session-specific context: what happened, counts, files involved}"
  pinned: true  # only if user pinned this entry
```

Write the updated `{pm_dir}/memory.md` preserving the existing frontmatter structure (`type: project-memory`).

**5c. Error recovery.** If the write fails, preserve the session, record a structured failed retro result, and stop.

---

### Step 5d: durable product-learning writeback

After the `memory.md` write succeeds, decide whether this dev session produced reusable product knowledge that should survive beyond process memory.

Read the dev session state again and look for **product-relevant** findings in:
- `Decisions`
- `QA`
- `Review`
- `Resume Instructions`
- any implementation summary or notes about constraints, edge cases, handoff gaps, runtime differences, or user-visible behavior changes

Good writeback candidates:
- implementation exposed a missing product rule or acceptance-criteria gap
- QA/review surfaced a user-visible edge case worth future grooming context
- runtime/platform constraints changed how a feature should be proposed or implemented next time
- implementation validated or contradicted a product / competitive claim already in the KB

Do **not** create a writeback artifact for generic process friction already captured in `memory.md`.

If there are no durable product learnings, skip silently.

If there are 1-3 clear durable findings, create or update:

```text
{pm_dir}/evidence/research/{slug}-implementation-learnings.md
```

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/knowledge-writeback.md`.

Write the artifact with:

```bash
cat <<'JSON' | node ${CLAUDE_PLUGIN_ROOT}/scripts/knowledge-writeback.js --pm-dir "{pm_dir}"
{
  "artifactPath": "evidence/research/{slug}-implementation-learnings.md",
  "artifactMode": "implementation-learnings",
  "topic": "{slug} — Implementation Learnings",
  "summary": "{2-3 sentence summary of what implementation changed in our understanding}",
  "findings": ["{durable finding 1}", "{durable finding 2}"],
  "description": "Implementation learnings from delivery and QA",
  "strategicRelevance": "{why future grooming / research / implementation should care}",
  "implications": ["{downstream implication}"],
  "openQuestions": ["{remaining open question}"],
  "sourceArtifacts": [
    "backlog/{slug}.md",
    ".pm/dev-sessions/{slug}/session.json"
  ]
}
JSON
```

That writeback flow must route accepted findings through `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md` after the evidence file is written.
Read the `routeSuggestions` returned by `knowledge-writeback.js`, confirm which numbered routes to keep, then pipe them through `${CLAUDE_PLUGIN_ROOT}/scripts/route-selection.js` into `${CLAUDE_PLUGIN_ROOT}/scripts/insight-routing.js` instead of hand-editing citations, indexes, `.hot.md`, or the affected insight bodies.

Pass into that flow:
- artifact mode: `implementation-learnings`
- artifact path: `{pm_dir}/evidence/research/{slug}-implementation-learnings.md`
- topic name: `{slug} — Implementation Learnings`
- state source: `{source_dir}/.pm/dev-sessions/{slug}/session.json`
- the key findings you extracted from the session

If a specific finding is ambiguous and you cannot write it without guessing: skip that finding and log `retro: skipped ambiguous finding "{short label}"` in the state file. Do NOT ask the user mid-retro. Unambiguous findings still get written automatically. Retro never halts the flow — skipping one finding is better than pausing.

If this writeback fails after you decided it should happen, preserve the session, record a structured failed retro result, and stop.

---

### Step 6: Post-write cap check and validation

**6a. Cap enforcement.** After writing, count total entries in `{pm_dir}/memory.md`. If count exceeds 50, follow the algorithm in `${CLAUDE_PLUGIN_ROOT}/references/memory-cap.md`:
- Move oldest non-pinned entries to `{pm_dir}/memory-archive.md` until count <= 50
- If all entries are pinned, warn the user

**6b. Validate.** Run:
```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}" --source-dir "{source_dir}"
```
If validation fails, fix the entries and re-validate before proceeding.

---

### Step 7: Record the retro result

Write the strict retro phase-result envelope and record it with `scripts/dev-session.js record`. The runner sets `status: complete`, updates `updated_at`, and appends the result hash. Preserve `session.json` as the durable audit/resume record; do not delete it.

---

### Linear retro comment (M/L/XL)

**Linear** (if available and task is M/L/XL):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "{learnings summary}" })
```

---

### State File ({source_dir}/.pm/dev-sessions/{slug}/session.json)

The state file is the **single source of truth** for session state — full schema, template, valid stage values, and update rules live in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md`. Retro-specific deltas:

- Dev sessions always live in the source repo's `.pm/dev-sessions/` directory — even in separate-repo mode — keeping state co-located with the code being modified. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}/session.json`.
- Record the retro result through the runner (Step 7 above) and retain the completed session.

## Done-when

Learnings and any required writeback validate, the retro result is recorded, and canonical state reports `status: complete`.

Offer the user the delivered summary and any clearly scoped follow-up work.

**Next action:** report the completed delivery and the most useful follow-up; there is no later Dev phase.
