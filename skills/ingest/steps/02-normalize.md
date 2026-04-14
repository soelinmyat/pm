---
name: Normalize
order: 2
description: Write normalized evidence records into .pm/ with dedup, manifest tracking, and PII redaction
---

## Normalize Evidence

**Goal:** Convert raw evidence inputs into normalized `.pm/` records and manifest entries with enough provenance to support safe synthesis.

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

#### Audio normalization

For audio-sourced evidence, read and follow `${CLAUDE_PLUGIN_ROOT}/skills/ingest/references/audio-pipeline.md` for the full audio normalization flow (speaker role inference, PII redaction, redacted transcript generation, and evidence record extraction).

### Required record fields

Every evidence item becomes one JSON record. These fields are the minimum needed to trace a finding back to its source and cluster it by topic — without them, synthesis has nothing to work with.

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

**Done-when:** Normalized evidence records and manifest entries exist for every accepted import, skipped items have been reported with warnings, and committed references remain portable.
