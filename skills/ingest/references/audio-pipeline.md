# Audio Normalization Pipeline

For each transcribed audio file, after the raw transcript is available in `.pm/evidence/transcripts/`:

## 1. Speaker Role Inference

Read the diarized transcript. In a single LLM pass:
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

Save to `{pm_dir}/evidence/transcripts/{slug}.md` (safe to commit):

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

## 4. Extract Evidence Records

Extract evidence records from the redacted transcript. Each distinct topic/pain point becomes a separate normalized record with `speaker_role` on quotes.
