---
name: think
description: "Use when exploring a product idea or reasoning through a decision before committing to build. Lighter than groom — no ceremony, just structured thinking."
---

# pm:think

## Purpose

Structured product thinking before commitment. Explore ideas, challenge assumptions, weigh tradeoffs, and reach clarity — without the ceremony of grooming.

Think is the conversation you have *before* deciding whether to build. It produces a thinking artifact, not backlog issues.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, and custom instructions.

**When NOT to use:** When the user asks "what do you think about X" wanting a quick opinion, not a structured thinking session. Also skip when they've already decided and want to build — go straight to `pm:dev`.

**Workflow:** `think` | **Telemetry steps:** `capture`, `reframe`, `explore-approaches`, `pressure-test`, `synthesize`.

Execute the loaded workflow steps in order. They're conversational beats, not phases — follow the natural rhythm without announcing them or tracking state.

## When to use think vs groom

| Signal | Skill |
|--------|-------|
| "Let's think about X" / "What if we" / "How should we approach" | **think** |
| "Groom this" / "Create issues" / "Spec this out" / "Break this down" | **groom** |
| User is exploring, no build commitment | **think** |
| User wants sprint-ready issues | **groom** |
| Conversation started as thinking, user says "let's do this" | **think** → promote to **groom** |

## Interaction Pacing

- **Be a thinking partner, not a note-taker.** Challenge, reframe, push back.
- **No ceremony.** No state files, no agents, no review gates during thinking.
- **Verdicts first.** Lead with your take, then explain.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.


## Resuming past thinking

If the user references a past topic, check `{pm_dir}/thinking/` for a matching file.

If found:
> "Found thinking on '{topic}' from {date}. Pick up where we left off?"

If resumed, read the file and continue from the last state. The thinking might need updating — the user may have new context or the landscape may have changed.

## Multiple ideas in one session

If the user wants to think through several ideas, handle them sequentially. Finish one (synthesize + save) before starting the next. Don't interleave.

## What think is NOT

- **Not a spec writer.** Think produces a summary, not a design doc. If the user wants a spec, that's groom → design phase.
- **Not a research tool.** If the user needs durable market data or competitor analysis, switch to `pm:research`. If they just need a quick factual answer, answer directly — don't turn thinking into a research session.
- **Not a planning tool.** Think doesn't produce tasks, issues, or implementation plans. That's groom's job.

Think is the whiteboard conversation. Groom is the meeting that produces action items.

## Before Marking Done

- [ ] Thinking artifact saved to `{pm_dir}/thinking/{slug}.md`
- [ ] User confirmed the synthesis captures their thinking accurately
- [ ] Promotion to groom offered (if the idea has legs)
