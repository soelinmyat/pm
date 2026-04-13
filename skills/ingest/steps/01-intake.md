---
name: Intake
order: 1
description: Parse input path, detect source types, validate files, and check import manifest
---

## Intake

**Goal:** Validate the import target, understand what kind of evidence it contains, and determine whether ingest can proceed safely.

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

### Supported Inputs

#### Text formats

- `.md`
- `.txt`
- `.csv`
- `.json`

#### Audio formats

- `.mp3`
- `.wav`
- `.m4a`
- `.ogg`
- `.flac`
- `.webm`

Audio files are transcribed locally via `scripts/transcribe.py` (faster-whisper + pyannote.audio). If the transcription dependencies are not installed, ingest warns and skips audio files gracefully — it does not block text-based imports.

#### Deferred

- `.pdf`
- `.docx`
- direct cloud URLs
- live SaaS integrations

If a folder is provided:
- scan recursively
- ignore hidden files and system artifacts
- report skipped files and unsupported formats

### Command Surface

#### With a path

```text
$pm-ingest <path>
```

Examples:

```text
$pm-ingest ~/Downloads/interviews/
$pm-ingest ~/Desktop/support-export.csv
$pm-ingest ./customer-notes/
```

#### Without a path

If no path is provided:
- If prior imports exist, ask:
  > "Do you want to refresh research from existing imported evidence, or ingest a new file/folder path?"
- If no prior imports exist, ask:
  > "Provide a file or folder path containing customer evidence to ingest."

**Done-when:** The source path, source type, and any CSV/audio prerequisites are resolved, and the user has confirmed any ambiguous or high-impact import decisions before normalization begins.
