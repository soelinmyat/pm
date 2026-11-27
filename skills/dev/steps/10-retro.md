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

Before the terminal record, inspect the run with `dev-session storage --session <session.json>`. Completion removes misplaced `node_modules`, Xcode DerivedData outputs and stopped database clusters from the session and lists them as `storage_cleanup`. It keeps and blocks on a generated folder that holds referenced evidence or a running database; move that evidence out, or stop the server, and retry. Completion requests a review for large archives. For necessary large evidence, pass `--retain-large-evidence "<reason>"` on the terminal record. Retry the same result after resolving storage issues. After the terminal record, run `dev-session close --session <session.json> --json` again; it follows `completion.json` to the archived run.

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

A clean session can validate a product assumption or expose a domain constraint. Inspect the product-learning candidates in **Step 5d** even with no defects/rework. If there are neither supported memory lessons nor durable product findings, record no learnings and proceed to **Step 6c** silently. Do not fabricate a lesson to fill an artifact.

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

### Step 6c: File follow-up items (Design Director path)

Skip this step silently when the session has no Design Director report.

1. **Collect.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/dev-session.js follow-ups --session <session.json> --json`. It reads every director report in this session and lists the system notes and the findings marked `filed`, with key, class, dimension, scope, location, wanted change and source report. Work from this list. Do not re-type findings from memory.
2. **Not merged.** When `fileable` is false (`not merged`, `parked`, or a headless run's open PR), file nothing. List the items in the retro summary as held in their reports and go to Step 7.
3. **Merge duplicates.** The command already merges reviews of the same finding and identical wording across runs. When two items are the same system-level issue in different words, keep one and record the other with `--state merged --into <key>`.
4. **Classify.** `scope: system` means the fix edits a shared component, a token or a screen outside `design_context.surfaces`. `scope: local` is a leftover of this change. When an item carries `scope_check`, or its wanted change edits a shared component or token, decide and pass `--scope system` or `--scope local` when you record it.
5. **Search first.** For each pending item, look for an existing open item about the same component, token or screen. Linear: `list_issues` with those words, open states only. Native: `{pm_dir}/backlog/*.md` without `status: done`, including the `Follow-up key:` line of earlier filings.
6. **File.**
   - **Linear project** (`integrations.linear.enabled: true` in `{pm_state_dir}/config.json`): follow `${CLAUDE_PLUGIN_ROOT}/references/linear-operations.md`. Ask one batched question that lists every pending item with its scope and the planned action: add an occurrence comment to a named open issue, or create a new issue in the configured team and project. Create or comment on nothing before the answer. File what the user approves, record what they decline as `declined`, and leave every item `pending` when there is no answer or the Linear tools are unavailable.
   - **Native knowledge-base project**: file directly, with no question. Create new items through the `pm:task` capture path in `${CLAUDE_PLUGIN_ROOT}/references/capture.md`: `capture-backlog.js`, `kind: task`, labels `design-follow-up` plus `system` or `local`, and a body with the location, observation, wanted change, source report and `Follow-up key: {key}`. Add an occurrence to an existing open task or bug with the hash-guarded `enrich` action, using the SHA-256 of the file's current bytes. Never edit a backlog file directly. When the match is another kind of item, create a new task that cites it.
7. **Record each outcome** as it happens: `dev-session.js follow-up-record --session <session.json> --key <key> --state filed --tracker linear|backlog --ref <CLE-123 | backlog/{slug}.md> --action created|occurrence-added`. Use `--state declined` or `--state merged --into <key>` for the others. A filed item is final, so a rerun skips it.
8. **Report.** List in the retro summary what was filed, with each reference, what was merged or declined, and what is still pending. Pending items stay in the session; `follow-ups` still lists them after completion.

### Step 6d: State how the merge was decided

Read `session.json` `merge_authorization.decisions`. When the last decision is `merge`, open the retro summary with:

> Merged automatically, with no human review of the merge, under the standing authorization {approved_by} gave at {approved_at} when approving {proposal_id} revision {revision}. merge-check passed at {commit}: CI {ci.status} ({check names}), gates {name: status at commit, each}, Design Director {verdict} ({report path}) with mechanical checks {pass|fail}.

Take each value from that decision's `evidence`. When the last decision is `refuse`, say the work was not merged, list every reason code and message, and name the open PR. When there is no decision, say nothing about it.

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

Learnings and any required writeback validate, follow-up items from a merged director run are filed or recorded as pending, the retro result is recorded, and canonical state reports `status: complete`.

Offer the user the delivered summary and any clearly scoped follow-up work.

**Next action:** report the completed delivery and the most useful follow-up; there is no later Dev phase.
