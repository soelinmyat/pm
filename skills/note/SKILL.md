---
name: note
description: "Use when capturing a customer signal, product observation, or evidence worth remembering. Quick-capture into the shared product brain."
---

# pm:note

## Purpose

Capture one durable product observation into the shared evidence pool. Notes are lightweight and fast by design — they preserve the signal now so downstream research and grooming can synthesize it later.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER LET A PRODUCT SIGNAL DIE IN CHAT.** If the user is handing you a real observation worth remembering, write it to the notes pool before the conversation moves on.

**When NOT to use:** Bulk evidence imports from files (use ingest). Research that needs web sources (use research). If the observation belongs in an existing research file, update that file directly.

**Workflow:** `note` | **Telemetry steps:** `capture`, `enrich`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/note/steps/` in numeric filename order. If `.pm/workflows/note/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"This is obvious enough that I’ll remember it later."** You won’t. Notes exist because product signals evaporate fast.
- **"It’s only one observation, so it doesn’t need structure."** Single signals become patterns only if they enter the shared pool.
- **"I should normalize this like ingest."** Note is intentionally lightweight. Don’t turn quick capture into a full evidence pipeline.
- **"The note is saved, so enrichment isn’t worth offering."** Enrichment is optional, but it is often the difference between noise and useful context.

## Escalation Paths

- **User wants to import a file or batch of evidence:** "This looks like a heavier evidence import. Want to switch to `/pm:ingest` instead of a quick note?"
- **User wants synthesis, not capture:** "If you want this folded into a research artifact right now, I can use `/pm:research` or update the existing topic file instead."
- **Observation is too vague to capture:** "I can save it, but I need one concrete observation first. What did you notice?"

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
