---
name: ingest
description: "Use when importing customer evidence from files or folders: support exports, interview notes, sales call notes, feature request CSVs, audio recordings, or other local evidence. Normalizes records into .pm/ and updates shared evidence artifacts under pm/evidence/."
---

# pm:ingest

## Purpose

Import customer evidence into PM.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `references/writing.md`.

**When NOT to use:** Single quick observations (use note). Non-evidence files. Data that isn't customer feedback, interviews, support signals, or sales notes.

**Workflow:** `ingest`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ingest/steps/` in numeric filename order. If `.pm/workflows/ingest/` exists, same-named files there override defaults.

## Setup Expectations

`$pm-ingest` does **not** require full `$pm-setup`, but it does require the PM folder structure.

If the folders do not exist yet, bootstrap the minimum structure automatically:

```bash
mkdir -p {pm_dir}/evidence/research
mkdir -p {pm_dir}/evidence/transcripts
mkdir -p {pm_dir}/evidence/user-feedback
mkdir -p .pm/imports
mkdir -p .pm/evidence
mkdir -p .pm/sessions
```

Also ensure `.pm/` is present in the project root `.gitignore` without duplicating the line.

Do not block on setup just because the user wants to import evidence first.

## Hard rules

- Never commit raw customer evidence into `{pm_dir}` — raw imports stay in `.pm/` (gitignored). Committed artifacts must be normalized, redacted where possible, and use portable source labels, never absolute paths.
- Warn about PII on every import, even when the data looks clean — automatic detection is not reliable enough to skip the review warning.
- Confirm ambiguous CSV/column mappings before creating records — mapping errors are the top cause of bad evidence and poison every downstream synthesis step.
- The manifest deduplicates by SHA, so re-import is safe; prefer a full rebuild over a silent, incorrect incremental merge.
- Don't invent structure for sparse or messy evidence, and don't overwrite external research sections in mixed topic files.
- Every committed record carries the required fields: id, source_path, source_type, topic, pain_point, summary.

## Escalation Paths

- **Input path is missing or unreadable:** "I can ingest a file or folder path of customer evidence. Want to provide one now, or stop here?"
- **Transcription dependencies are missing for audio imports:** "I can continue with text files, but audio ingest needs the transcription dependencies installed. Want to skip audio for now or install them first?"
- **CSV/schema mapping stays ambiguous after preview:** "The import schema is still ambiguous. Want to confirm the column mapping explicitly, or stop before I create bad evidence records?"
