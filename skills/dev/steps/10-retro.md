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

Extract evidence-supported durable learnings from the completed dev session, write them to the right PM artifacts, and preserve the canonical session and report evidence.

## How

Runs after EVERY task regardless of size. Applies to both single-issue and multi-task flows.

If extraction fails at any point, preserve canonical state and record a structured failed retro result with the error evidence. Then say:
> "Retro extraction failed; session state preserved for retry."
Then stop and retain the session for retry.

---

### Generalization Rule

The `learning` field in each memory entry must be **generalizable to future sessions**, not a description of what happened in this session. A reader encountering this learning in a different context should be able to apply it without knowing anything about the source session.

- **Bad:** "from RFC review: 3 review iterations required" (session-specific fact — tells future sessions nothing actionable)
- **Good:** "For leave approval, test denied permissions and workspace-timezone date boundaries alongside the happy path; successful approval alone does not validate these rules" (bounded to the observed failure class, actionable without inventing a population-wide frequency)

Session-specific context (counts, slugs, specific failures) belongs in the `detail` field, not in `learning`.

---

### Step 1: Scan canonical evidence for extractable events

Read `{source_dir}/.pm/dev-sessions/{slug}/session.json` and follow the recorded attempts, phase results and evidence paths to the actual immutable review reports, QA reports, implementation results, and observed delivery/CI receipts. Consult `state-schema.md` and the current runner contract; Markdown `Review`, `QA`, `Merge-Watch`, or `Per-Task Events` headings are legacy resume aids, not current canonical reports. Do not infer their absence means no review occurred.

| Observed event | Evidence needed | Supported lesson |
|----------------|-----------------|------------------|
| QA defect/fix | Finding, fixture/journey, observed result, expectation source, fix and recheck | The domain/UI failure mode and a relevant way to expose it |
| Review defect/fix | Actual bound reviewer finding and changed code/test evidence | The assumption or boundary missed; distinguish confirmed bug from preference |
| CI failure | A failed check conclusion and diagnostic log, then the relevant repair/recheck | The concrete failure class and applicable local/integration check |
| Integration conflict | Actual conflicting paths/contract and resolution evidence | The boundary or incompatible assumptions, if reusable for this task class |
| Blocked/failed work unit | Worker result plus missing dependency/context/runtime evidence | A supported prerequisite or scope assumption; distinguish environment from product defect |
| Validated or contradicted product assumption | Relevant domain/source/runtime evidence | A bounded product fact or open question for future grooming/research |

A CI run count, review iteration count, or repeated capture is **not evidence of a failure, cause, or frequency**. Runs may reflect new commits, cancelled jobs or routine confirmation. Inspect actual conclusions and findings. Delegated workers own implementation evidence; the root owns integrated QA, Review and delivery. Do not resurrect legacy per-unit QA/review/ship authority or query guessed task PRs. If an existing authorized remote receipt is needed, perform a read-only lookup and cite it; unavailable evidence stays unknown.

### Step 2: No defect events — still inspect product learning

A clean session can validate a product assumption or expose a domain constraint. Inspect the product-learning candidates in **Step 5d** even with no defects/rework. If there are neither supported memory lessons nor durable product findings, record no learnings and proceed to **Step 7** silently. Do not fabricate a lesson to fill an artifact.

---

### Step 3: Events found — present auto-extracted learnings

For each observed event, inspect the cited report/attempt and distinguish symptoms, supported cause, and hypotheses. Write a **bounded, actionable** one-liner for the task/domain where evidence applies. A single session cannot establish what usually causes failures across the product. Include the supporting artifact and applicable conditions in the detail; omit unsupported causal claims. Put session-specific details (counts, file names, specific error messages) into the `detail` field, not the `learning` field. Present the list to the user:

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

After writing any supported memory entries (or finding none), decide whether this dev session produced reusable product knowledge that should survive beyond process memory. Clean execution does not bypass this inspection.

Read the recorded intake/context, implementation, QA and Review evidence artifacts and delivery results for **product-relevant** findings. Trace each candidate to an observed rule/constraint or source-backed decision; preserve the fixture, platform and scope needed to interpret it. Do not treat an implementer's summary or an old Markdown heading as corroboration of its own claim.

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

If a specific finding is ambiguous and you cannot write it without guessing: retain the uncertainty as a clearly bounded open question when useful, omit the asserted finding, and log `retro: skipped ambiguous finding "{short label}"` in retro evidence recorded through the runner. Do not hand-edit unsupported state fields. Do NOT ask the user mid-retro. Unambiguous findings still get written automatically. Retro never halts the flow — skipping one finding is better than pausing.

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
