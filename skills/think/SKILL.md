---
name: think
description: "Use when the user is thinking through a product idea, exploring a concept, brainstorming approaches, or reasoning about a decision before committing to build. Lighter than groom — no ceremony, no issues, just structured thinking. Triggers on 'let's think about,' 'I'm thinking about,' 'what if we,' 'how might we,' 'let's explore,' 'I want to find a way to,' 'how should we approach,' 'what do you think about,' 'shall we think through,' 'brainstorm,' 'thinking through,' 'let's reason about,' 'help me think,' 'I'm wondering,' 'explore this idea,' 'what are our options,' 'tradeoffs,' 'pros and cons.'"
---

# pm:think

## Purpose

Structured product thinking before commitment. Explore ideas, challenge assumptions, weigh tradeoffs, and reach clarity — without the ceremony of grooming.

Think is the conversation you have *before* deciding whether to build. It produces a thinking artifact, not backlog issues.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`. Steps: `capture`, `reframe`, `explore-approaches`, `pressure-test`, `synthesize`.

## When to use think vs groom

| Signal | Skill |
|--------|-------|
| "Let's think about X" / "What if we" / "How should we approach" | **think** |
| "Groom this" / "Create issues" / "Spec this out" / "Break this down" | **groom** |
| User is exploring, no build commitment | **think** |
| User wants sprint-ready issues | **groom** |
| Conversation started as thinking, user says "let's do this" | **think** → promote to **groom** |

## Interaction Rules

- **One question at a time.** Never bundle.
- **Be a thinking partner, not a note-taker.** Challenge, reframe, push back.
- **No ceremony.** No state files, no agents, no review gates during thinking.
- **Verdicts first.** Lead with your take, then explain.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Custom Instructions

Before starting, check for user instructions:

1. If `pm/instructions.md` exists, read it.
2. If `pm/instructions.local.md` exists, read it (overrides shared on conflict).
3. If neither exists, proceed normally.

---

## The Flow

Think follows 5 beats. They're conversational, not phases — you don't announce them or track state. Just follow the natural rhythm.

### 1. Capture

Understand what's on the user's mind.

If the user already described the idea (in this message or earlier in the conversation), don't ask "what's the idea?" — you already have it. Summarize your understanding in 2-3 bullets and confirm:

> "Here's what I'm hearing: [summary]. That right?"

If the idea is vague, ask ONE clarifying question — the one that unlocks the most understanding. Prefer "Is this about X?" (yes/no) over open-ended questions.

### 2. Reframe

Challenge the framing. This is the most valuable beat — it's where Superpower's "10-star product" and GStack's forcing questions live.

Ask yourself (don't dump these on the user — pick the one that matters most):
- Is this a solution or a problem? What's the real job to be done?
- Who specifically benefits and why would they care?
- What's the version of this that's 10x better than what they described?
- What would make this a "must-have" vs "nice-to-have"?
- Is there a simpler framing that captures the same value?

Share your reframe as a short, opinionated take:

> "The way I'd reframe this: [reframe]. The real unlock is [insight]."

Then ask if the reframe resonates or if you're off base. One question.

### 3. Explore approaches

Propose **2-3 distinct approaches** with clear tradeoffs. Not variations of the same idea — genuinely different directions.

For each approach:
- **One-line summary** of what it is
- **Why it works** (1-2 bullets)
- **The catch** (1-2 bullets)
- **Best if** (when you'd pick this one)

Format as a compact table or short sections. Ask which direction resonates — or if none do.

### 4. Pressure-test

Once a direction emerges, stress-test it:
- **Assumptions:** What are we assuming that might not be true?
- **Risks:** What could go wrong?
- **Open questions:** What do we still not know?
- **Dependencies:** What has to be true first?

Don't list all of these — surface the 2-3 that actually matter for this idea. Have a back-and-forth. This beat can be multiple exchanges.

### 5. Synthesize

When the thinking reaches a natural conclusion, produce a **thinking summary**. This is the artifact.

```markdown
---
type: thinking
topic: "{topic}"
slug: "{kebab-case-slug}"
created: YYYY-MM-DD
status: active | parked | promoted
promoted_to: "{groom-session-slug}" | null
---

# {Topic}

## Problem
{1-2 sentences: what's the real problem or opportunity}

## Direction
{The approach that emerged from the conversation}

## Key tradeoffs
- {Tradeoff 1}
- {Tradeoff 2}

## Open questions
- {Question 1}
- {Question 2}

## Next step
{What should happen next — groom it, research more, park it, etc.}
```

Save to `pm/thinking/{slug}.md`. Create the `pm/thinking/` directory if it doesn't exist.

After saving, ask ONE question:

> "Want to groom this into issues?"

- **Yes** → Invoke `pm:groom` with the thinking summary as context. The groom skill will pick up from here — it can skip or shorten intake since the thinking is already captured.
- **No** → Done. The thinking is saved and can be revisited later.

---

## Resuming past thinking

If the user references a past topic, check `pm/thinking/` for a matching file.

If found:
> "Found thinking on '{topic}' from {date}. Pick up where we left off?"

If resumed, read the file and continue from the last state. The thinking might need updating — the user may have new context or the landscape may have changed.

---

## Multiple ideas in one session

If the user wants to think through several ideas, handle them sequentially. Finish one (synthesize + save) before starting the next. Don't interleave.

---

## What think is NOT

- **Not a spec writer.** Think produces a summary, not a design doc. If the user wants a spec, that's groom → design phase.
- **Not a research tool.** If the user needs market data or competitor analysis, invoke `pm:research quick` inline — but don't turn thinking into a research session.
- **Not a planning tool.** Think doesn't produce tasks, issues, or implementation plans. That's groom's job.

Think is the whiteboard conversation. Groom is the meeting that produces action items.
