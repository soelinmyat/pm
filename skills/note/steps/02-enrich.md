---
name: Enrich
order: 2
description: Optionally ask a few follow-up questions and append the answers to the saved note entry
---

## Goal

Add optional context to a saved note without turning quick capture into a full ingest workflow.

## How

Only run this step if the user wants to add context after the note is saved.

Ask 2-4 follow-up questions chosen dynamically based on the note content. Ask them **one at a time**.

### Question Selection

Analyze the note text and tags. Pick the most relevant questions from this pool:

| Field | Question | Best for |
|---|---|---|
| **Who** | "Who was this about? (role, segment, company size)" | sales call, user interview, support thread |
| **Severity** | "How much does this impact users? (blocking, painful, minor annoyance)" | support thread, performance, churn |
| **Context** | "What were they trying to do when this came up?" | any source |
| **Compare** | "Did they compare us to anything else?" | competitor, sales call |

Selection rules:
- Sales-tagged notes → prioritize Who and Compare
- Support-tagged notes → prioritize Severity and Context
- Always include Context unless the note already provides enough
- Max 4 questions, min 2

### Enrichment Format

Append enrichment fields to the same note entry (same h3 section, same file). Do not create a new entry. Read the monthly log, find the entry by timestamp, and append below the body:

```markdown
### 2026-04-09 14:32 — sales call
Lost deal to CompetitorX — they had native Slack integration.
Tags: competitor, integration
- **Who:** Mid-market SaaS, 50-person eng team
- **Severity:** Deal-breaker — they chose CompetitorX specifically for this
- **Context:** Evaluating tools for cross-team product alignment
- **Compare:** CompetitorX has native Slack bot, we require manual copy-paste
```

Rules:
- The original note is already saved before interview starts. It is never lost.
- Frontmatter `note_count` and `digested_through` are not modified by interview mode — enrichment is metadata on an existing entry.
- Tags may be updated if interview answers reveal new categories.
- User can say "skip" or "no" at any question to end the interview early.

## Done-when

The requested enrichment has been appended to the saved note entry, or the step has been skipped cleanly because the user declined or ended the follow-up early.
