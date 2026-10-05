# Audio Normalization Pipeline

For each transcribed audio file, after the raw transcript is available in `{pm_state_dir}/evidence/transcripts/`:

## 1. Speaker Role Inference

**If the transcript was produced without diarization** (intake fell back to `--no-diarize` because pyannote/HF_TOKEN were missing), there are no speaker turns to attribute — skip role inference, leave `speakers` empty in the frontmatter, and treat speaker roles as `unknown`, not customer endorsement. Separate reported experience from interviewer prompts only where the text supports that distinction; otherwise retain the ambiguity. Leading questions such as “Would bulk approval save you time?” do not establish customer demand. Note the limitation in the import summary. Continue with PII redaction (§2) as normal.

Otherwise, read the diarized transcript. In a single LLM pass:
- Infer who is the interviewer and who is the customer from conversational patterns (who asks questions vs. who describes problems).
- Assign roles: `interviewer`, `customer`, `unknown`. For 3+ speakers, assign `customer-a`, `customer-b`, etc.
- Confirm with the user:
  > "Speaker A sounds like the interviewer, Speaker B the customer — correct?"

## 2. PII Redaction (same LLM pass as role inference)

- Replace real names with role labels: `[Interviewer]`, `[Customer A]`
- Replace company names with `[Company A]`, `[Company B]`
- Replace emails, phone numbers, addresses with `[redacted]`
- Do NOT promise perfect redaction — warn the user (see PII rule in Step 2).

## 3. Save Redacted Transcript

After explicit review of the sanitized rendering, save to `{pm_dir}/evidence/transcripts/{slug}.md`; until then keep it private and unbound:

```markdown
---
type: evidence
evidence_type: transcript
source_origin: internal
created: 2026-04-02
updated: 2026-04-02
sources: []
cited_by: []
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

## 4. Extract Evidence Records

Extract evidence records from the redacted transcript. Each distinct reliable observation (including jobs, successes, workarounds, constraints, pain, and counterevidence) becomes a normalized record with `speaker_role` on quotes. Use `unknown` when attribution is unavailable; several excerpts from one interview remain one originating observation chain, not independent corroboration.
