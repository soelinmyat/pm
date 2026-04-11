---
name: ingest
description: "Use when importing customer evidence from files or folders: support exports, interview notes, sales call notes, feature request CSVs, audio recordings, or other local evidence. Normalizes records into .pm/ and updates shared evidence artifacts under pm/evidence/."
---

# pm:ingest

## Purpose

Import customer evidence into PM.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

`$pm-ingest` is the internal-evidence lane:
- support tickets
- interview notes
- call transcripts
- sales notes
- feature request exports
- churn reasons

It does two things in one workflow:
1. Normalize raw evidence into `.pm/` (runtime state)
2. Update durable evidence artifacts in `{pm_dir}/evidence/`

The user should think: "I have customer evidence. Ingest it."

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:ingest`:
- run start / run end
- one step span for `intake`
- one step span for `normalize`
- one step span for `synthesize`

If a manifest or findings file is updated, pass the artifact path as `--output-file` so token estimates are tied to the real artifact size.

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

---

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

---

## Command Surface

### With a path

```text
$pm-ingest <path>
```

Examples:

```text
$pm-ingest ~/Downloads/interviews/
$pm-ingest ~/Desktop/support-export.csv
$pm-ingest ./customer-notes/
```

### Without a path

If no path is provided:
- If prior imports exist, ask:
  > "Do you want to refresh research from existing imported evidence, or ingest a new file/folder path?"
- If no prior imports exist, ask:
  > "Provide a file or folder path containing customer evidence to ingest."

---

## Supported Inputs

### Text formats

- `.md`
- `.txt`
- `.csv`
- `.json`

### Audio formats

- `.mp3`
- `.wav`
- `.m4a`
- `.ogg`
- `.flac`
- `.webm`

Audio files are transcribed locally via `scripts/transcribe.py` (faster-whisper + pyannote.audio). If the transcription dependencies are not installed, ingest warns and skips audio files gracefully — it does not block text-based imports.

### Deferred

- `.pdf`
- `.docx`
- direct cloud URLs
- live SaaS integrations

If a folder is provided:
- scan recursively
- ignore hidden files and system artifacts
- report skipped files and unsupported formats

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Flow

### Phase 1: Intake

1. Accept the path, or ask for one if missing.
2. Determine whether it is a file or directory.
3. Preview:
   - supported text files found
   - supported audio files found (list separately with format and duration if detectable)
   - unsupported files skipped
   - likely source types detected
4. Infer `source_type` from filename, content, or CSV headers:
   - `interview`
   - `support`
   - `sales`
   - `notes`
   - `feedback`
   - `unknown`
5. If confidence is low, ask a one-line confirmation:
   > "This looks like support tickets — correct?"
6. For CSV files:
   - detect headers
   - propose a column mapping
   - ask for confirmation before importing
   - cache the confirmed mapping in the import manifest for repeat imports of the same schema
7. **For audio files** (`.mp3`, `.wav`, `.m4a`, `.ogg`, `.flac`, `.webm`):
   - Check if transcription dependencies are available:
     ```bash
     python3 -c "import faster_whisper" 2>/dev/null
     ```
   - If **not installed**: warn and skip audio files. Do not block text imports.
     > "Skipping N audio file(s) — faster-whisper not installed. Run: pip install -r ${CLAUDE_PLUGIN_ROOT}/scripts/requirements.txt"
   - If **installed**: transcribe each audio file:
     ```bash
     python3 ${CLAUDE_PLUGIN_ROOT}/scripts/transcribe.py "<audio_file>" --output ".pm/evidence/transcripts/<slug>.txt"
     ```
   - If transcription fails for a single file (corrupt, too long, OOM), warn and skip that file — continue with the rest.
   - Default `source_type` for audio: `interview` (override if filename suggests otherwise, e.g., `sales-call-*` → `sales`).
8. Before importing, check `.pm/imports/manifest.json`:
   - unchanged file: skip by default and tell the user it was already imported
   - same path, different hash: ask whether to re-import and replace prior records for that file
   - missing prior source file on refresh: report it and offer to remove orphaned records

Ask for confirmation if:
- the file count is very large
- the source type is ambiguous
- CSV mapping is ambiguous
- re-import will replace many existing records

### Phase 2: Normalize

Write normalized evidence into `.pm/`.

Structure:

```text
.pm/
  imports/
    manifest.json
  evidence/
    source-0001.json
    source-0002.json
    transcripts/
      prospect-interview-20260402.txt   # raw diarized transcript (gitignored)
{pm_dir}/
  evidence/
    transcripts/
      prospect-interview-20260402.md    # redacted transcript (committed)
```

Rules:
- raw files stay at their original path
- `.pm/` stays gitignored
- one normalized JSON record per evidence item
- manifest tracks imports and synthesis state

#### Audio normalization (additional steps)

For each transcribed audio file, after the raw transcript is available in `.pm/evidence/transcripts/`:

1. **Speaker role inference.** Read the diarized transcript. In a single LLM pass:
   - Infer who is the interviewer and who is the customer from conversational patterns (who asks questions vs. who describes problems).
   - Assign roles: `interviewer`, `customer`, `unknown`. For 3+ speakers, assign `customer-a`, `customer-b`, etc.
   - Confirm with the user:
     > "Speaker A sounds like the interviewer, Speaker B the customer — correct?"

2. **PII redaction** (same LLM pass as role inference):
   - Replace real names with role labels: `[Interviewer]`, `[Customer A]`
   - Replace company names with `[Company A]`, `[Company B]`
   - Replace emails, phone numbers, addresses with `[redacted]`
   - Do NOT promise perfect redaction — warn the user (see PII rule below).

3. **Save redacted transcript** to `{pm_dir}/evidence/transcripts/{slug}.md` (safe to commit):
   ```markdown
   ---
   type: transcript
   source: prospect-interview-20260402.m4a
   speakers:
     - id: A
       role: interviewer
     - id: B
       role: customer
   transcribed_at: 2026-04-02T10:00:00Z
   ---

   [00:01:23] [Interviewer]: How do you currently handle bulk edits?
   [00:01:45] [Customer A]: We do them one by one. It takes forever.
   ```

4. **Extract evidence records** from the redacted transcript. Each distinct topic/pain point becomes a separate normalized record with `speaker_role` on quotes.

### Required record fields

Every normalized record must include:

```json
{
  "id": "uuid-or-stable-hash",
  "source_path": "/absolute/path/to/file",
  "source_type": "interview|support|sales|notes|feedback|unknown",
  "source_format": "md|txt|csv|json|audio",
  "imported_at": "2026-03-12T10:00:00Z",
  "topic": "bulk editing",
  "pain_point": "editing many rows is slow",
  "summary": "Customer requested batch edits for repetitive workflows.",
  "quote": "Editing 50 rows one by one is painful.",
  "raw_ref": {
    "file": "/absolute/path/to/file",
    "row": 14,
    "section": "Pain points"
  }
}
```

**Additional fields for audio-sourced records:**

```json
{
  "speaker_role": "customer|interviewer|unknown",
  "transcript_ref": "{pm_dir}/evidence/transcripts/prospect-interview-20260402.md",
  "timestamp": "00:01:45"
}
```

Optional fields are best-effort only:
- `event_date`
- `title`
- `account`
- `segment`
- `persona`
- `requested_outcome`
- `severity`
- `confidence`
- `tags`

Do not hallucinate optional values. Leave them null or omit them when the source is unclear.

If `topic`, `pain_point`, or `summary` cannot be extracted reliably:
- skip that item
- report it as a parse warning

### Import manifest

Maintain `.pm/imports/manifest.json`:

```json
{
  "version": 1,
  "last_synthesis_at": "2026-03-12T10:05:00Z",
  "imports": [
    {
      "path": "/absolute/path/to/support-export.csv",
      "kind": "file",
      "sha256": "abc123",
      "imported_at": "2026-03-12T10:00:00Z",
      "record_count": 143,
      "format_hint": "csv-support",
      "column_mapping": {
        "title": "Subject",
        "description": "Body",
        "priority": "Severity",
        "date": "Created At"
      }
    },
    {
      "path": "/absolute/path/to/prospect-interview.m4a",
      "kind": "file",
      "sha256": "def456",
      "imported_at": "2026-04-02T10:00:00Z",
      "record_count": 8,
      "format_hint": "audio-interview",
      "transcript_path": "{pm_dir}/evidence/transcripts/prospect-interview.md"
    }
  ]
}
```

### Replacement and refresh behavior

- **Unchanged file:** skip unless the user explicitly asks to re-import
- **Modified file at same path:** replace old records for that file, then re-synthesize affected themes
- **Deleted or moved file:** report it; do not delete evidence automatically
- **No-arg refresh:** process new/changed imports and re-synthesize affected themes only
- **Full rebuild:** if the manifest or evidence state looks stale, offer:
  > "Rebuild research from all normalized evidence?"

Use full rebuild as the fallback when incremental state is ambiguous.

### Phase 3: Synthesize Research

<HARD-GATE>
Synthesis is required after normalization. Do NOT skip because the record count is small.
Even 2-3 records can reveal a theme. Without synthesis, evidence stays in .pm/ and never reaches {pm_dir}/evidence/research/ — invisible to downstream skills.
</HARD-GATE>

**Load Hot Index** (pre-step).
Before clustering, load the hot index to identify existing insight topics for dedup and cluster naming.

```bash
# Check for hot index
if [ -f "{pm_dir}/insights/.hot.md" ]; then
  node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"
fi
```

- If `{pm_dir}/insights/.hot.md` exists, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"` and parse the output table. Use existing insight topics to inform cluster naming (align new clusters with existing topic names where they overlap) and dedup (skip creating a new cluster when an existing insight already covers the same topic). Log: "Hot index loaded ({N} insights)".
- If a match is found in the hot index, read the full insight `.md` file to confirm the overlap before merging or deduplicating.
- If `{pm_dir}/insights/.hot.md` does not exist, fall back to reading insight files directly (current behavior). Log: "Hot index not found, falling back to direct file scan".

Cluster records into **problem clusters**, not just filenames or raw keywords.

Granularity rule:
- cluster by the outcome the user wants
- not by broad category ("onboarding")
- not by atomized complaint fragments

Good themes:
- bulk-editing
- onboarding-friction
- reporting-gaps
- integration-fragility

Score clusters by:
- frequency
- severity
- recency
- segment concentration
- strategic relevance to `{pm_dir}/strategy.md` if it exists

For audio-sourced records, use `speaker_role` to weight quote selection:
- Prefer `customer` quotes for pain points and representative quotes
- Use `interviewer` quotes only for context (what prompted the response)
- Link audio-sourced quotes to their transcript: `[View transcript]({pm_dir}/evidence/transcripts/{slug}.md)`

### Shared research knowledge base

Write durable outputs into the existing shared knowledge base:

```text
{pm_dir}/
  evidence/
    index.md
    log.md
    research/
      index.md
      log.md
      bulk-editing.md
    transcripts/
      log.md
    user-feedback/
      log.md
```

`$pm-ingest` and `$pm-research` share the `evidence/research/` pool. `$pm-ingest` also owns evidence-side pool bookkeeping.

After every successful write, update the relevant indexes and append touched paths to the matching logs:
- `{pm_dir}/evidence/index.md`
- `{pm_dir}/evidence/log.md`
- `{pm_dir}/evidence/research/index.md` and `{pm_dir}/evidence/research/log.md` when a research topic changes
- `{pm_dir}/evidence/transcripts/log.md` when a transcript file changes
- `{pm_dir}/evidence/user-feedback/log.md` when normalized feedback artifacts are emitted there

### `{pm_dir}/evidence/index.md`

Keep the top-level evidence index current. It is the shared entry point for all evidence pools.

Rules:
- Ensure the touched pool is represented under the correct section (`Research Evidence`, `Other Evidence Pools`, or future pool sections).
- Add or update the topic bullet when a research artifact changes.
- Preserve unrelated bullets and pool descriptions.
- Never remove another skill's entry unless the underlying file was intentionally deleted.

### `{pm_dir}/evidence/research/index.md`

Keep the research pool index current:

```markdown
# Index

| Topic/Source | Description | Updated | Status |
|---|---|---|---|
| [bulk-editing.md](bulk-editing.md) | Bulk Editing | 2026-03-12 | internal |
| [ai-pricing-models.md](ai-pricing-models.md) | AI Pricing Models | 2026-03-11 | external |
| [onboarding-friction.md](onboarding-friction.md) | Onboarding Friction | 2026-03-12 | mixed |
```

Rules:
- `Status` is `internal`, `external`, or `mixed`
- `Updated` should reflect the topic file's most recent evidence-aware date
- update only the row for the topic you touched
- never delete another skill's row content

### `{pm_dir}/evidence/research/{slug}.md`

Use this unified schema:

```markdown
---
type: evidence
evidence_type: research
topic: Bulk Editing
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_origin: internal|external|mixed
cited_by: []
sources:
  - label: support-export.csv
    rows: [12, 14, 31]
    imported: YYYY-MM-DD
evidence_count: 17
segments:
  - SMB
  - Mid-market
confidence: high
---

# Bulk Editing

## Summary
2-3 sentences on what this theme is and why it matters.

## Findings
Numbered findings. Prefix customer-evidence findings with `[internal]`.

## Representative Quotes
> "Editing 50 rows one by one is painful."

## Strategic Relevance
How this supports or challenges the current strategy.
If inferred, label it clearly.

## Implications
What this means for the product.

## Open Questions
What this research still does not answer.

## Source References
- support-export.csv (rows 12, 14, 31) — imported 2026-03-12
```

### Mixed-origin write contract

When a topic already exists from `pm:research`, do **not** overwrite it wholesale.

Ownership rules:
- `source_origin`: set to `mixed` when both internal and external evidence exist
- `sources`: append your source refs; do not remove the other skill's refs
- `evidence_count`, `segments`, `confidence`: owned by `$pm-ingest`
- `cited_by`: preserve existing values unless another workflow updates them separately
- `Summary`: rewrite to incorporate both internal and external evidence
- `Findings`: append your own numbered findings prefixed `[internal]`
- `Representative Quotes`: owned by `$pm-ingest`
- `Strategic Relevance`: rewrite to incorporate current evidence
- `Implications`: rewrite to incorporate current evidence
- `Open Questions`: additive
- `Source References`: additive

Write protocol:
1. Read the existing file if present
2. Parse frontmatter and body sections
3. Update only the sections you own
4. Merge shared sections carefully
5. Write the file back

### Provenance and privacy

Committed research must use **portable source labels**, not machine-specific absolute paths.

Good committed reference:
- `support-export.csv (rows 12, 14, 31)`
- `interview-ops-lead.md (section: Pain points)`
- `prospect-interview-20260402.m4a (transcript: {pm_dir}/evidence/transcripts/prospect-interview-20260402.md, 00:01:45)`

Absolute local paths belong only in:
- `.pm/imports/manifest.json`
- `.pm/evidence/*.json`

### PII rule

Do **not** promise perfect redaction.

Instead:
- redact obvious names or account identifiers when safe
- keep quotes short and relevant
- warn the user explicitly:
  > "Review these findings before committing. Automatic PII detection is not reliable enough to guarantee safe redaction."

### Post-write Validation

After writing or updating any `{pm_dir}/` artifacts, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
```

If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

### Phase 3.5: Route Findings to Insight Topics

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.
Pass all evidence file paths written or updated during Phase 3 and
their key findings as input. Batch all evidence together for one
routing pass (not one per file).

If no insight domains exist and no `{pm_dir}/strategy.md` exists, skip.

### Phase 4: Report Back

End with a concise import report:
- files imported (text + audio separately)
- audio files transcribed (with duration if available)
- records created
- files skipped (with reason: unsupported format, missing deps, transcription failure)
- replacements performed
- themes created or updated
- parse warnings

Then recommend the next best step:
- `$pm-strategy` if new evidence changes ICP or priorities
- `$pm-groom` if the evidence strengthens a feature decision
- `pm:start` if the user wants to review the updated research on the dashboard

---

## Guardrails

1. Do not commit raw customer evidence into `{pm_dir}/`.
2. Do not invent structure for sparse or messy evidence.
3. Do not overwrite external research sections in mixed topic files.
4. Use portable labels in committed source references.
5. Prefer a full rebuild over a silent, incorrect incremental merge.
