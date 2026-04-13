---
name: Ground
order: 2
description: Load just enough context to have an informed conversation — strategy, insights, targeted research, light web search
---

## Ground

**Goal:** Before reframing, load the context that makes thinking informed rather than speculative. This is not research — it's a 30-second context check.

**Progressive loading — stop as soon as you have enough:**

### 0. Past thinking check (always)

Search for existing thinking on this topic using the search protocol in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` (domain: `thinking`, index: `{pm_dir}/thinking/index.md`).

If a match is found:
> "Found thinking on '{topic}' from {date} (status: {status}). Pick up where we left off, or start fresh?"

If the user resumes:
1. Read the full artifact. Check its `status` field.
2. Continue through the rest of this ground step (strategy/insights may have changed).
3. After grounding, resume from the last incomplete beat — if all sections are filled, start from pressure-test (re-examine with fresh eyes).
4. The user may have new context — ask before assuming the old direction still holds.

If no match or the user says "start fresh" — continue grounding as normal.

### 1. Strategy (always)

Read `{pm_dir}/strategy.md`. Extract what's relevant to the captured topic:
- ICP — does this topic match who we serve?
- Priorities — does this align with current priorities?
- Non-goals — does this conflict with anything we've explicitly ruled out?

If strategy doesn't exist, note it and move on. Thinking won't have strategic grounding — that's fine, not a blocker.

### 2. Insights scan (if insights exist)

Use the search protocol in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` to find relevant insights. The insights domain uses `{pm_dir}/insights/.hot.md` as its index.

Generate 3-5 keywords from the captured topic (including synonyms), grep the hot index, and note what comes back:
- Confidence levels (high = load-bearing evidence; low = signal worth mentioning)
- Evidence count (4+ sources = strong pattern; 1 source = anecdote)

Surface relevant context briefly:
> "What we already know about this area: [1-3 bullets]"

If nothing is relevant, say so and move on — absence of context is itself useful information.

### 3. Targeted deep-read (only if needed)

If an insight is directly relevant and you need detail beyond the summary, read that one insight file. It gives you the full synthesis + source citations.

**Max 2 insight files.** If you need more context than that, surface it as an output: "We should run /pm:research on [topic] before committing to a direction."

Do NOT read raw evidence files (notes, transcripts, feedback). The insight layer exists so you don't have to.

### 4. Light web research (only if KB has gaps)

If the topic involves something the KB doesn't cover — a competitor move, market shift, technical feasibility — do 1-2 targeted web searches.

This is "let me quickly check if [X] is true." Not a research session. If you need more than 2 searches, surface it: "This needs proper research — want me to switch to /pm:research?"

### Rules

- Total grounding: < 30 seconds of processing
- Strategy is always read (cheapest, highest-value context)
- Never read raw evidence files — use the insight layer
- If significant gaps exist, surface them as output, don't try to fill them here
- Web research: 1-2 searches max
- No user interaction in this step except the resume question (if past thinking found)

**Done-when:** You have context on what we already know about this space. You can now reframe with grounding instead of guessing. Briefly share what you found (or didn't find) as you transition to the reframe.
