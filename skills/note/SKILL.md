---
name: note
description: "Use when capturing a customer signal, product observation, or evidence worth remembering. Quick-capture into the shared product brain."
---

# pm:note

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `note` | **Telemetry steps:** `capture`, `enrich`.

**When NOT to use:** Bulk evidence imports from files (use ingest). Research that needs web sources (use research). If the observation belongs in an existing research file, update that file directly.

## Purpose

Capture one-sentence product observations into the shared evidence pool. Notes are lightweight — no file paths, no normalization pipeline. They feed into groom and research via the digest pre-step.

---

## Capture Flow

1. **Extract note text** from the user's message or argument.
   - If no text is provided, ask: "What did you observe?"
   - Wait for the response before continuing.

2. **Parse source type** from the message:
   - If user says `--source "sales call"` or similar, use that value.
   - If user says "sales call:", "support thread:", "user interview:", or "from a customer" — infer the source type.
   - Default source: `observation`.

3. **Generate timestamp**: `YYYY-MM-DD HH:MM` in local time.

4. **Infer tags** from note content:
   - Competitor names mentioned → `competitor`
   - Performance/speed/timeout keywords → `performance`
   - Integration/API/plugin keywords → `integration`
   - Pricing/cost keywords → `pricing`
   - Churn/cancel/leave keywords → `churn`
   - Feature request patterns → `feature-request`
   - User can override tags with `--tags "tag1, tag2"`.

5. **Write the note** using the shared helper:
   - Call `writeNote(pmDir, text, source, tags)` from `${CLAUDE_PLUGIN_ROOT}/scripts/note-helpers.js`.
   - This creates/appends to `{pm_dir}/evidence/notes/YYYY-MM.md` with correct frontmatter.

6. **Confirm** to the user:
   > "Note saved to `{pm_dir}/evidence/notes/YYYY-MM.md`. Want to add more context?"
   - If user says no or ignores, flow ends.
   - If user says yes, proceed to Interview Mode below.

---

## Interview Mode (opt-in enrichment)

After a note is saved, if the user wants to add context, ask 3-4 follow-up questions chosen dynamically based on the note content. Ask them **one at a time**.

### Question Selection

Analyze the note text and tags. Pick the most relevant questions from this pool:

| Field | Question | Best for |
|---|---|---|
| **Who** | "Who was this about? (role, segment, company size)" | sales call, user interview, support thread |
| **Severity** | "How much does this impact users? (blocking, painful, minor annoyance)" | support thread, performance, churn |
| **Context** | "What were they trying to do when this came up?" | any source |
| **Compare** | "Did they compare us to anything else?" | competitor, sales call |

**Selection rules:**
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

### Rules
- The original note is already saved before interview starts. It is never lost.
- Frontmatter `note_count` and `digested_through` are NOT modified by interview mode — enrichment is metadata on an existing entry.
- Tags may be updated if interview answers reveal new categories.
- User can say "skip" or "no" at any question to end the interview early.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll add this to the research file directly" | Notes feed the evidence pool. Research files are synthesized output. Mixing raw signals with analysis corrupts both. |
| "One note isn't worth the ceremony" | Notes compound. A single observation is noise — the 10th one on the same topic is a pattern. |
| "I'll remember this for later" | You won't. The conversation ends, the signal is lost. Write it down now. |

## Before Marking Done

- [ ] Note saved to `{pm_dir}/evidence/notes/YYYY-MM.md`
- [ ] Source type set (observation, sales call, support thread, user interview)
- [ ] Tags inferred or provided
- [ ] User offered interview mode for enrichment
