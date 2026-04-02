---
type: backlog-issue
id: "PM-114"
title: "Ingest audio detection + LLM speaker role inference"
outcome: "pm:ingest automatically handles audio files, redacts PII, and attributes quotes to the right speaker role"
status: done
parent: "audio-transcription-ingest"
children: []
labels:
  - "ingest"
  - "audio"
priority: medium
research_refs: []
created: 2026-04-02
updated: 2026-04-02
---

## Outcome

When `pm:ingest` encounters audio files in a folder, it transcribes them via the bundled script (PM-113), then the LLM reads the diarized transcript to infer who is the interviewer and who is the customer. Quotes in evidence records carry `speaker_role` attribution so downstream synthesis surfaces customer pain — not interviewer prompts.

## Acceptance Criteria

1. Ingest Phase 1 (intake) detects audio files among supported formats and reports them in the preview.
2. For each audio file, calls `scripts/transcribe.py` and captures the diarized transcript.
3. If transcription fails (missing deps, corrupt file), warns and skips that file — does not block other files.
4. LLM reads transcript and infers speaker roles: `interviewer`, `customer`, `unknown`.
5. LLM redacts PII in the same pass: real names → role labels (`[Interviewer]`, `[Customer A]`), company names → `[Company A]`, etc.
6. Confirmation prompt: "Speaker A sounds like the interviewer, Speaker B the customer — correct?"
7. Redacted transcript saved to `pm/evidence/transcripts/{slug}.md` (safe to commit).
8. Normalized records include `source_format: "audio"` and quotes include `speaker_role`.
9. Synthesize phase uses `speaker_role: customer` to weight quote selection and pain point extraction.
10. SKILL.md updated: audio formats added to supported inputs, `audio` removed from deferred list.
11. Import manifest records audio files with `format_hint: "audio-interview"` or similar.
12. Research findings page links audio-sourced quotes to their full transcript ("View transcript" link).
13. Dashboard serves `pm/evidence/transcripts/{slug}.md` as a reader view with the quoted section highlighted.

## Technical Feasibility

- **Modify existing skill.** Changes to `skills/ingest/SKILL.md` — add audio detection to Phase 1, speaker inference to Phase 2.
- **Depends on PM-113.** Transcription script must exist before this can work.
- **LLM inference:** No new tooling — the LLM already processes transcript content during normalize. Adding role inference is a prompt-level change in the skill definition.

## Notes

- Speaker role inference works best with interview-style audio (2 speakers, Q&A pattern). Group calls with 3+ speakers may need manual role assignment.
- PII redaction and role inference happen in a single LLM pass to avoid double-processing.
- Raw (unredacted) transcript stays in `.pm/evidence/` (gitignored). Redacted version goes to `pm/evidence/transcripts/` (committed).
