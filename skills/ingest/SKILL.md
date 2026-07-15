---
name: ingest
description: "Use when importing customer evidence from files or folders: support exports, interview notes, sales call notes, feature request CSVs, audio recordings, or other local evidence. Normalizes records into .pm/ and updates shared evidence artifacts under pm/evidence/."
---

# pm:ingest

## Purpose

Import customer evidence into PM.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.
Read `${CLAUDE_PLUGIN_ROOT}/references/evidence-system.md` before normalization; it is the shared executable provenance and privacy contract.

**Workflow:** `ingest` | **Telemetry steps:** `intake`, `normalize`, `synthesize`, `route-insights`, `report`

## Iron Law

**NEVER COMMIT RAW CUSTOMER DATA.**

## When NOT to use

- For one quick observation, use `pm:note`.
- For non-evidence files or data unrelated to customer feedback, interviews, support, or sales signals, stop instead of forcing an evidence schema.
- For market or competitor sources gathered from the web, use `pm:research`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ingest/steps/` in numeric filename order. If `.pm/workflows/ingest/` exists, same-named files there override defaults.

## Setup Expectations

`$pm-ingest` does **not** require full `$pm-setup`, but it does require the PM folder structure.

If the folders do not exist yet, bootstrap the minimum structure automatically:

```bash
mkdir -p {pm_dir}/evidence/research
mkdir -p {pm_dir}/evidence/transcripts
mkdir -p {pm_dir}/evidence/user-feedback
mkdir -p .pm/imports
mkdir -p .pm/evidence/records
mkdir -p .pm/evidence/conflicts
mkdir -p .pm/sessions
```

Also ensure `.pm/` is present in the project root `.gitignore` without duplicating the line.

Do not block on setup just because the user wants to import evidence first.

## Hard rules

- Never commit raw customer evidence into `{pm_dir}` — raw imports stay in `.pm/` (gitignored). Committed artifacts must be normalized, redacted where possible, and use portable source labels, never absolute paths.
- Warn about PII on every import, even when the data looks clean — automatic detection is not reliable enough to skip the review warning.
- Confirm ambiguous CSV/column mappings before creating records — mapping errors are the top cause of bad evidence and poison every downstream synthesis step.
- The import manifest detects source-file changes; the Evidence v2 ledger makes record registration idempotent and preserves changed content as revisions. Prefer an explicit rebuild over a guessed incremental merge.
- Don't invent structure for sparse or messy evidence, and don't overwrite external research sections in mixed topic files.
- Private normalized records retain local paths and content under `.pm/evidence/records/`; the committed ledger carries only portable identity, hashes, privacy state, lineage, and artifact bindings.

## Red Flags — Self-Check

- **"The file looks anonymized already."** Stop and include the PII review warning anyway.
- **"I can infer this CSV column."** Ask for confirmation when a mapping changes evidence meaning.
- **"Keeping the absolute path helps traceability."** Use a portable source label and keep machine-local paths private.
- **"A richer summary is better."** Keep uncertainty and sparse evidence visible instead of inventing structure.
- **"Re-importing will duplicate everything."** Check the SHA manifest and use its idempotent rebuild path.

## Escalation Paths

- **Input path is missing or unreadable:** "I can ingest a file or folder path of customer evidence. Want to provide one now, or stop here?"
- **Transcription dependencies are missing for audio imports:** "I can continue with text files, but audio ingest needs the transcription dependencies installed. Want to skip audio for now or install them first?"
- **CSV/schema mapping stays ambiguous after preview:** "The import schema is still ambiguous. Want to confirm the column mapping explicitly, or stop before I create bad evidence records?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Raw records are the strongest evidence." | Raw customer data creates privacy and portability risk in a shared repository. |
| "One inferred field will not affect synthesis." | A bad mapping compounds through every downstream finding and insight. |

## Before Marking Done

- [ ] Raw imports and manifests stay private while normalized, redacted evidence artifacts are saved under the correct PM paths.
- [ ] The user confirmed ambiguous mappings and received the PII review warning.
- [ ] Deduplication, required-field, Evidence v2 ledger/citation, privacy, synthesis, routing, and standard PM validation gates passed.
