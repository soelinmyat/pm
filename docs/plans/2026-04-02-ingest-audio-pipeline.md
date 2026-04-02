# Plan: PM-114 — Ingest audio detection + LLM speaker role inference

**Parent:** PM-112 (Audio transcription for pm:ingest)
**Depends on:** PM-113 (transcription script must exist at `scripts/transcribe.py`)
**Date:** 2026-04-02

## Goal

When `pm:ingest` encounters audio files (.mp3, .wav, .m4a, .ogg, .flac, .webm), it transcribes them via `scripts/transcribe.py`, infers speaker roles, redacts PII, and produces evidence records with `speaker_role` attribution. The dashboard serves redacted transcripts as reader views.

## Architecture

- **SKILL.md changes (prompt engineering):** Audio detection in Phase 1, transcription + role inference + PII redaction in Phase 2, speaker-weighted synthesis in Phase 3.
- **server.js changes (code):** New `/transcripts/{slug}` route serving markdown transcripts as styled reader views with quote highlighting.
- **No new scripts.** Depends on PM-113's `scripts/transcribe.py` for transcription. LLM handles role inference and PII redaction.

## Tech Stack

- Existing: Node.js (server.js), Markdown (SKILL.md), Python (transcribe.py from PM-113)
- New dependencies: None

## Contract with Done

1. `pm:ingest ~/folder-with-audio/` detects audio files and includes them in the preview.
2. Each audio file is transcribed via `scripts/transcribe.py`; failures warn and skip.
3. LLM infers speaker roles (interviewer/customer/unknown) and redacts PII in one pass.
4. User confirms role assignments before proceeding.
5. Redacted transcript saved to `pm/evidence/transcripts/{slug}.md`.
6. Normalized records include `source_format: "audio"` and `speaker_role`.
7. Synthesis weights `speaker_role: customer` quotes higher.
8. SKILL.md lists audio formats as supported; `audio` removed from deferred list.
9. Import manifest records `format_hint: "audio-interview"`.
10. Research findings link to transcript via "View transcript" link.
11. Dashboard serves `/transcripts/{slug}` as a reader view.

## Files in Scope

| File | Change Type |
|------|-------------|
| `skills/ingest/SKILL.md` | Modify — audio detection, transcription, role inference, PII redaction, synthesis weighting |
| `scripts/server.js` | Modify — add `/transcripts/{slug}` route |

---

## Tasks

### Task 1: Update SKILL.md — Supported Inputs section

Move audio formats from "Deferred" to "Supported" and add audio-specific notes.

**File:** `skills/ingest/SKILL.md`

**Replace the Supported Inputs section (lines ~95–113) with:**

```markdown
## Supported Inputs

### Supported in v1

- `.md`
- `.txt`
- `.csv`
- `.json`

### Supported — Audio

- `.mp3`
- `.wav`
- `.m4a`
- `.ogg`
- `.flac`
- `.webm`

Audio files require Python 3.8+ and the dependencies listed in `scripts/transcribe.py`. If dependencies are missing, ingest warns and skips audio files — it does not block text-based imports.

### Deferred

- `.pdf`
- `.docx`
- direct cloud URLs
- live SaaS integrations

If a folder is provided:
- scan recursively
- ignore hidden files and system artifacts
- report skipped files and unsupported formats
```

- [ ] Replace the Supported Inputs section in SKILL.md

---

### Task 2: Update SKILL.md — Phase 1 (Intake) audio detection

Add audio file detection and preview reporting to Phase 1.

**File:** `skills/ingest/SKILL.md`

**Insert after step 3 (Preview) in Phase 1, before step 4 (Infer source_type):**

```markdown
3a. **Audio file handling:** For each audio file found:
    - Check that `scripts/transcribe.py` exists in `${CLAUDE_PLUGIN_ROOT}/scripts/`.
    - Check Python availability: `python3 --version`.
    - Report audio files separately in the preview:
      > "Found 3 audio files (.mp3, .wav). These will be transcribed and analyzed for speaker roles."
    - If `transcribe.py` or Python is missing, warn:
      > "Audio files found but transcription is unavailable (missing Python/dependencies). These files will be skipped."
```

- [ ] Add audio detection to Phase 1 in SKILL.md

---

### Task 3: Update SKILL.md — Phase 2 (Normalize) audio transcription + role inference + PII redaction

Add the audio-specific normalize flow after the existing normalize rules.

**File:** `skills/ingest/SKILL.md`

**Insert a new subsection after "Import manifest" and before "Replacement and refresh behavior":**

```markdown
### Audio normalization

For each audio file detected in Phase 1:

#### Step 1: Transcribe

Run the transcription script:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/transcribe.py "<audio-file-path>"
```

This produces a diarized transcript (JSON with speaker labels and timestamps). If transcription fails:
- Log the error as a parse warning.
- Skip this file — do not block other imports.
- Continue to the next file.

#### Step 2: Speaker role inference + PII redaction (single LLM pass)

Read the diarized transcript and perform BOTH of these in one pass:

**Role inference:** Analyze the conversation pattern to assign each speaker a role:
- `interviewer` — asks questions, guides the conversation
- `customer` — describes problems, answers about their workflow
- `unknown` — cannot determine role confidently

Heuristics: The interviewer typically speaks first, asks more questions, and uses phrases like "tell me about", "can you describe", "how do you". The customer describes pain points, mentions tools/workflows, and answers questions.

**PII redaction:** In the same pass, redact personally identifiable information:
- Real names → role labels: `[Interviewer]`, `[Customer A]`, `[Customer B]`
- Company names → `[Company A]`, `[Company B]`
- Email addresses → `[email]`
- Phone numbers → `[phone]`
- Other identifiable details → `[redacted]`

Preserve the speaker labels from diarization (e.g., SPEAKER_00 → [Interviewer], SPEAKER_01 → [Customer A]).

#### Step 3: Confirm speaker roles

Ask the user to confirm the role assignment:

> "Speaker A (SPEAKER_00) sounds like the **interviewer** — asks questions, guides the conversation. Speaker B (SPEAKER_01) sounds like a **customer** — describes pain points and workflows. Correct?"

Wait for confirmation. If the user corrects a role, update the mapping before saving.

#### Step 4: Save transcripts

**Raw transcript** (unredacted): Save to `.pm/evidence/transcripts/{slug}-raw.json` (gitignored with `.pm/`).

**Redacted transcript** (committed): Save to `pm/evidence/transcripts/{slug}.md` in this format:

```markdown
---
type: transcript
source_file: "original-filename.mp3"
speakers:
  - id: SPEAKER_00
    role: interviewer
  - id: SPEAKER_01
    role: customer
transcribed_at: YYYY-MM-DDTHH:MM:SSZ
redacted: true
---

# Transcript: {slug}

**Source:** {original filename}
**Speakers:** [Interviewer], [Customer A]

---

[00:00] **[Interviewer]:** Tell me about your current workflow for managing customer feedback.

[00:15] **[Customer A]:** We use [Company A]'s tool right now, but the biggest pain point is...

[00:45] **[Interviewer]:** How often does that happen?

[01:02] **[Customer A]:** Almost daily. Our team of about 20 people spends...
```

Ensure the `pm/evidence/transcripts/` directory exists:
```bash
mkdir -p pm/evidence/transcripts
```

#### Step 5: Create normalized records

Create one normalized evidence record per meaningful segment of the transcript. Each record must include:

```json
{
  "id": "uuid-or-stable-hash",
  "source_path": "/absolute/path/to/audio-file.mp3",
  "source_type": "interview",
  "source_format": "audio",
  "imported_at": "2026-04-02T10:00:00Z",
  "topic": "extracted topic",
  "pain_point": "extracted pain point",
  "summary": "What the customer described.",
  "quote": "Almost daily. Our team of about 20 people spends...",
  "speaker_role": "customer",
  "raw_ref": {
    "file": "/absolute/path/to/audio-file.mp3",
    "transcript": "pm/evidence/transcripts/{slug}.md",
    "timestamp": "01:02"
  }
}
```

Key differences from text-based records:
- `source_format` is `"audio"` (not md/txt/csv/json)
- `speaker_role` field is required: `"interviewer"`, `"customer"`, or `"unknown"`
- `raw_ref.transcript` points to the redacted transcript file
- `raw_ref.timestamp` is the approximate timestamp in the audio

**Extraction rule:** Focus on segments where the customer speaks. Interviewer quotes are only included when they provide essential context for a customer quote. Weight customer segments for extraction — they contain the pain points.

#### Import manifest entry for audio

```json
{
  "path": "/absolute/path/to/audio-file.mp3",
  "kind": "file",
  "sha256": "abc123",
  "imported_at": "2026-04-02T10:00:00Z",
  "record_count": 8,
  "format_hint": "audio-interview",
  "transcript_path": "pm/evidence/transcripts/{slug}.md"
}
```
```

- [ ] Add audio normalization subsection to Phase 2 in SKILL.md

---

### Task 4: Update SKILL.md — Phase 3 (Synthesize) speaker role weighting

Add speaker role weighting instructions to the synthesis phase.

**File:** `skills/ingest/SKILL.md`

**Insert after the "Score clusters by" list in Phase 3:**

```markdown
### Speaker role weighting

When synthesizing audio-sourced evidence:
- **Prefer `speaker_role: customer` quotes** for Representative Quotes in findings. Customer quotes carry the actual pain points.
- **Deprioritize `speaker_role: interviewer` quotes** — use only when the interviewer's question provides essential context for a customer quote.
- **Mark `speaker_role: unknown` quotes** with lower confidence.

In findings files, audio-sourced quotes include a transcript link:

```markdown
> "Almost daily. Our team of about 20 people spends hours on this."
> — [Customer A], [View transcript](/transcripts/{slug})
```

The "View transcript" link points to the dashboard route that renders the redacted transcript.
```

- [ ] Add speaker role weighting to Phase 3 in SKILL.md

---

### Task 5: Update SKILL.md — PII rule for audio

Update the existing PII rule section to address audio-specific redaction.

**File:** `skills/ingest/SKILL.md`

**Replace the PII rule section with:**

```markdown
### PII rule

Do **not** promise perfect redaction.

Instead:
- redact obvious names or account identifiers when safe
- keep quotes short and relevant
- warn the user explicitly:
  > "Review these findings before committing. Automatic PII detection is not reliable enough to guarantee safe redaction."

**Audio-specific PII handling:**

Audio transcripts receive a dedicated redaction pass (Step 2 of audio normalization) that replaces names with role labels. This is more thorough than text-based redaction because the full transcript is processed in a single LLM pass. However, the same warning applies — the user must review redacted transcripts before committing.

The redacted transcript at `pm/evidence/transcripts/{slug}.md` is designed to be commit-safe, but the user should still verify before committing.
```

- [ ] Update PII rule section in SKILL.md

---

### Task 6: Add transcript viewer route to server.js

Add a `/transcripts/{slug}` route to `routeDashboard()` that serves redacted transcript markdown files as styled reader views.

**File:** `scripts/server.js`

**Insert in `routeDashboard()` after the `/session/` route block (after line ~1859) and before the `/proposals` route:**

```javascript
  } else if (urlPath.startsWith('/transcripts/')) {
    const slug = decodeURIComponent(urlPath.slice('/transcripts/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleTranscriptPage(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
```

**Add the `handleTranscriptPage` function** (insert near `handleResearchTopic`, around line ~4776):

```javascript
function handleTranscriptPage(res, pmDir, slug) {
  const transcriptPath = path.join(pmDir, 'evidence', 'transcripts', slug + '.md');

  if (!fs.existsSync(transcriptPath)) {
    const html = dashboardPage('Transcript Not Found', '/kb?tab=research', `
<div class="empty-state">
  <p>No transcript found for <code>${escHtml(slug)}</code>.</p>
  <p><a href="/kb?tab=research">&larr; Back to research</a></p>
</div>`);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(transcriptPath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);

  const sourceFile = data.source_file || slug;
  const speakers = (data.speakers || [])
    .map(s => `<span class="speaker-badge speaker-${s.role}">${escHtml(s.role)}</span>`)
    .join(' ');

  // Check for ?highlight= query param to highlight a quoted section
  const urlObj = new URL(req.url, 'http://localhost');
  const highlight = urlObj.searchParams.get('highlight') || '';

  let renderedBody = renderMarkdown(body);

  // If highlight param provided, wrap matching text in <mark>
  if (highlight) {
    const escaped = escHtml(highlight);
    renderedBody = renderedBody.replace(
      new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      '<mark class="transcript-highlight">$&</mark>'
    );
  }

  const html = dashboardPage(`Transcript: ${escHtml(sourceFile)}`, '/kb?tab=research', `
<div class="page-header">
  <p class="breadcrumb"><a href="/kb?tab=research">&larr; Research</a></p>
  <h1>Transcript: ${escHtml(sourceFile)}</h1>
  <div class="transcript-meta">
    <span class="meta-label">Speakers:</span> ${speakers}
    ${data.transcribed_at ? `<span class="meta-sep">·</span> <span class="meta-label">Transcribed:</span> ${escHtml(String(data.transcribed_at).slice(0, 10))}` : ''}
    ${data.redacted ? '<span class="meta-sep">·</span> <span class="badge badge-green">PII Redacted</span>' : ''}
  </div>
</div>
<div class="markdown-body transcript-reader">${renderedBody}</div>`);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

**Add CSS for transcript reader** (in the dashboard CSS block):

```css
/* Transcript reader */
.transcript-reader p strong {
  color: var(--accent);
}
.transcript-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
.meta-sep { color: var(--border); }
.speaker-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: capitalize;
}
.speaker-interviewer { background: var(--bg-secondary); color: var(--text-secondary); }
.speaker-customer { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.speaker-unknown { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.transcript-highlight {
  background: rgba(251, 191, 36, 0.25);
  padding: 0.1rem 0.2rem;
  border-radius: 2px;
}
```

**Note:** The `handleTranscriptPage` function needs access to `req` for the highlight query param. Since `routeDashboard` receives `req`, pass it through. Actually — looking at the existing code, the query params are already parsed from `rawUrl` at the top of `routeDashboard`. We should use `urlObj` (already available in scope) instead of re-parsing. Update the function signature to accept a `highlight` parameter:

```javascript
// In routeDashboard, the route call becomes:
handleTranscriptPage(res, pmDir, slug, urlObj.searchParams.get('highlight') || '');

// And the function signature:
function handleTranscriptPage(res, pmDir, slug, highlight) {
  // ... remove the URL parsing inside the function, use highlight param directly
```

- [ ] Add `/transcripts/{slug}` route to routeDashboard in server.js
- [ ] Add `handleTranscriptPage` function to server.js
- [ ] Add transcript reader CSS to server.js

---

### Task 7: Update SKILL.md — Setup Expectations

Add `pm/evidence/transcripts` to the bootstrap directory list.

**File:** `skills/ingest/SKILL.md`

**In the Setup Expectations section, add to the mkdir block:**

```bash
mkdir -p pm/evidence/transcripts
```

- [ ] Add pm/evidence/transcripts to bootstrap directories in SKILL.md

---

### Task 8: Manual testing verification

After implementation, verify:

1. Create a test folder with a mix of `.md` and `.mp3` files.
2. Run `pm:ingest <test-folder>` — confirm audio files appear in preview.
3. Confirm transcription is called (or warns gracefully if deps missing).
4. Confirm speaker role confirmation prompt appears.
5. Confirm redacted transcript saved to `pm/evidence/transcripts/`.
6. Confirm `/transcripts/{slug}` renders in dashboard.
7. Confirm research findings include "View transcript" links.
8. Confirm `?highlight=quoted+text` highlights the passage in the transcript viewer.

- [ ] Verify audio detection in intake preview
- [ ] Verify graceful failure when transcription deps missing
- [ ] Verify transcript viewer route on dashboard

---

## Implementation Order

Tasks 1-5 are all SKILL.md edits and can be done as sequential edits to a single file.
Task 6 is server.js and is independent of Tasks 1-5.
Task 7 is a small SKILL.md edit that can be combined with Tasks 1-5.
Task 8 is manual verification after all other tasks.

**Recommended sequence:** Tasks 1-5+7 (SKILL.md, one file) → Task 6 (server.js) → Task 8 (verify).

## Files Changed

| File | Change |
|------|--------|
| `skills/ingest/SKILL.md` | Audio formats supported, Phase 1 detection, Phase 2 transcription + role inference + PII redaction, Phase 3 speaker weighting, updated PII rule, bootstrap dirs |
| `scripts/server.js` | `/transcripts/{slug}` route, `handleTranscriptPage()` function, transcript reader CSS |
