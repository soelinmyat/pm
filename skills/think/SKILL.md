---
name: think
description: "Use when the user is thinking through a product idea, exploring a concept, brainstorming approaches, or reasoning about a decision before committing to build. Lighter than groom — no ceremony, no issues, just structured thinking. Triggers on 'let's think about,' 'I'm thinking about,' 'what if we,' 'how might we,' 'let's explore,' 'I want to find a way to,' 'how should we approach,' 'what do you think about,' 'shall we think through,' 'brainstorm,' 'thinking through,' 'let's reason about,' 'help me think,' 'I'm wondering,' 'explore this idea,' 'what are our options,' 'tradeoffs,' 'pros and cons.'"
---

# pm:think

## Purpose

Structured product thinking before commitment. Explore ideas, challenge assumptions, weigh tradeoffs, and reach clarity — without the ceremony of grooming.

Think is the conversation you have *before* deciding whether to build. It produces a thinking artifact, not backlog issues.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, telemetry, and custom instructions.

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

## Interaction Rules

- **One question at a time.** Never bundle.
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
- **Not a research tool.** If the user needs market data or competitor analysis, invoke `pm:research quick` inline — but don't turn thinking into a research session.
- **Not a planning tool.** Think doesn't produce tasks, issues, or implementation plans. That's groom's job.

Think is the whiteboard conversation. Groom is the meeting that produces action items.
