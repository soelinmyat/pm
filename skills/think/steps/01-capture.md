---
name: Capture
order: 1
description: Understand what's on the user's mind — summarize or ask one clarifying question
---

## Capture

**Goal:** Establish a shared understanding of the idea so the rest of the conversation is grounded in the same thing.

**How:**

If the user already described the idea (in this message or earlier in the conversation), don't ask "what's the idea?" — you already have it. Summarize your understanding in 2-3 bullets and confirm:

> "Here's what I'm hearing: [summary]. That right?"

A good summary names the *who* (who benefits), the *what* (what changes for them), and the *why now* (what triggered this). If any of those three are missing from the user's input, that's your clarifying question.

If the idea is vague, ask ONE clarifying question — the one that unlocks the most understanding. Prefer "Is this about X?" (yes/no) over open-ended questions. Pick the question that resolves the most ambiguity about scope or intent.

### Slug derivation

After the user confirms the summary, derive the canonical slug:

- Kebab-case, max 4 words, derived from the confirmed topic
- If resuming an existing artifact (detected in the next step), reuse that artifact's slug
- This slug is the **single identifier** used for the thinking file (`{pm_dir}/thinking/{slug}.md`), the index row, and any groom handoff

Store the slug for all subsequent steps. Do not re-derive it later.

**Done-when:** The user confirms the summary is accurate, or corrects it and you've incorporated the correction. You should be able to state the idea in one sentence, and you have a canonical slug.
