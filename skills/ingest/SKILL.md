---
name: ingest
description: "Use when importing customer evidence from files or folders: support exports, interview notes, sales call notes, feature request CSVs, audio recordings, or other local evidence. Normalizes records into .pm/ and updates shared evidence artifacts under pm/evidence/."
---

# pm:ingest

## Purpose

Import customer evidence into PM.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER COMMIT RAW CUSTOMER EVIDENCE INTO `{pm_dir}`.** Raw imports belong in `.pm/`; committed artifacts must be normalized, redacted where possible, and written with portable source labels.

**When NOT to use:** Single quick observations (use note). Non-evidence files. Data that isn't customer feedback, interviews, support signals, or sales notes.

**Workflow:** `ingest` | **Telemetry steps:** `intake`, `normalize`, `synthesize`, `route-insights`, `report`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ingest/steps/` in numeric filename order. If `.pm/workflows/ingest/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

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

## Guardrails

1. Do not commit raw customer evidence into `{pm_dir}/`.
2. Do not invent structure for sparse or messy evidence.
3. Do not overwrite external research sections in mixed topic files.
4. Use portable labels in committed source references.
5. Prefer a full rebuild over a silent, incorrect incremental merge.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The raw file is small, committing it is fine."** Size is irrelevant. Raw customer evidence does not belong in committed PM artifacts.
- **"I can infer the column mapping without asking."** CSV mapping errors poison every downstream synthesis step. Confirm ambiguous mappings.
- **"Only a few records parsed, synthesis can wait."** Unsynthesized evidence is effectively invisible to the rest of PM.
- **"This quote looks safe enough; no need to warn about PII."** PII detection is not reliable enough to skip the review warning.

## Escalation Paths

- **Input path is missing or unreadable:** "I can ingest a file or folder path of customer evidence. Want to provide one now, or stop here?"
- **Transcription dependencies are missing for audio imports:** "I can continue with text files, but audio ingest needs the transcription dependencies installed. Want to skip audio for now or install them first?"
- **CSV/schema mapping stays ambiguous after preview:** "The import schema is still ambiguous. Want to confirm the column mapping explicitly, or stop before I create bad evidence records?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Data looks clean, skip PII check" | Obvious PII is 20% of real PII. Automatic detection is not reliable — warn the user. |
| "Small file, skip normalization" | Small files with wrong structure corrupt the manifest. Normalize everything. |
| "CSV columns are obvious" | Column mapping errors are the #1 cause of bad evidence records. Always confirm. |
| "Re-import will duplicate" | The manifest deduplicates by SHA. Re-import is safe — skipping is risky. |

## Before Marking Done

- [ ] PII warning shown to the user (even if data looks clean)
- [ ] Manifest updated with all imported records
- [ ] Every record has required fields (id, source_path, source_type, topic, pain_point, summary)
- [ ] Committed files use portable source labels (not absolute paths)
- [ ] Raw customer evidence stays in `.pm/` (gitignored), not in `{pm_dir}/`
