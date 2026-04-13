---
name: ingest
description: "Use when importing customer evidence from files or folders: support exports, interview notes, sales call notes, feature request CSVs, audio recordings, or other local evidence. Normalizes records into .pm/ and updates shared evidence artifacts under pm/evidence/."
---

# pm:ingest

Import customer evidence into PM.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, custom instructions, and interaction pacing.

**Workflow:** `ingest` | **Telemetry steps:** `intake`, `normalize`, `synthesize`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

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
