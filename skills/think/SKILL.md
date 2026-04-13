---
name: think
description: "Use when exploring a product idea, reasoning through a decision, or challenging assumptions before committing to build. Use when the user says 'let's think about', 'what if we', 'how should we approach', 'should we', 'I'm not sure whether', or describes a tradeoff without a clear direction. Use when the user has an idea but hasn't validated the framing. Lighter than groom — structured thinking, not ceremony."
---

# pm:think

## Purpose

Structured product thinking before commitment. Explore ideas, challenge assumptions, weigh tradeoffs, and reach clarity — without the ceremony of grooming.

Think is the conversation you have *before* deciding whether to build. It produces a thinking artifact, not backlog issues.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

## Iron Law

**NEVER SKIP REFRAME EVALUATION.** Every idea must be tested against at least one reframing lens before approaches are explored — no exceptions. The conclusion may be "the current framing holds," but that must be an explicit conclusion, not a shortcut. If you catch yourself jumping from capture straight to "here are three approaches," stop and evaluate the framing first.

**When NOT to use:** When the user asks "what do you think about X" wanting a quick opinion, not a structured thinking session. Also skip when they've already decided and want to build — go straight to `pm:dev`.

**Workflow:** `think` | **Telemetry steps:** `capture`, `ground`, `reframe`, `explore-approaches`, `pressure-test`, `synthesize`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/think/steps/` in numeric filename order. If `.pm/workflows/think/` exists, same-named files there override defaults. Execute each step in order — they're conversational beats, not phases. Follow the natural rhythm without announcing them or tracking state.

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
- **No process ceremony.** No session state files, no agents, no review gates. The thinking artifact at the end is the only durable output — but no overhead getting there.
- **Verdicts first.** Lead with your take, then explain.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.


## Multiple ideas in one session

If the user wants to think through several ideas, handle them sequentially. Finish one (synthesize + save) before starting the next. Don't interleave.

## What think is NOT

- **Not a spec writer.** Think produces a summary, not a design doc. If the user wants a spec, that's groom → design phase.
- **Not a research tool.** If the user needs durable market data or competitor analysis, switch to `pm:research`. If they just need a quick factual answer, answer directly — don't turn thinking into a research session.
- **Not a planning tool.** Think doesn't produce tasks, issues, or implementation plans. That's groom's job.

Think is the whiteboard conversation. Groom is the meeting that produces action items.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The user already knows what they want, I'll just validate it."** That's sycophancy, not thinking. Challenge the framing even when the user sounds confident.
- **"Let me research this thoroughly before forming an opinion."** Think is not research. You have 1-2 web searches max. If you need more, escalate to `pm:research`.
- **"I should present all options neutrally."** No. Lead with your recommendation. False neutrality wastes the user's time.
- **"This is getting complex, let me write a detailed spec."** Think produces a summary, not a spec. If you're writing more than a page, you've crossed into groom territory.
- **"The user rejected my reframe, so the original framing must be right."** The reframe still did its job — it forced the user to defend their framing. That's the point.
- **"We've been going back and forth, but I think one more round will converge."** If you've exchanged 4+ times on the same beat without convergence, synthesize what you have and surface the disagreement as an open question.

## Escalation Paths

- **Needs data, not opinions:** "This needs evidence before we can think clearly about it. Want me to run `/pm:research` on [specific question]?"
- **Thinking is done, user wants to build:** "This has legs. Want to groom it into a proposal?" (standard synthesize offer)
- **No convergence after 4+ exchanges on one beat:** Synthesize the current state, name the sticking point explicitly, and save the artifact as `active` with the disagreement captured in open questions.
- **Scope creep — multiple ideas emerging:** "We're branching into [second idea]. Let me save this one first, then we can think through that separately."

## Resume

Think does not persist mid-session state. The thinking artifact (`{pm_dir}/thinking/{slug}.md`) is the only durable output, written at the end during synthesize.

If a matching thinking artifact exists (detected during the ground step), resume means:
1. Read the saved artifact.
2. Ask what has changed since it was written.
3. Re-enter at reframe or pressure-test, depending on whether the new context changes the framing or only the chosen direction.

Resume is "reopen the summary and continue the conversation" — not a hidden state machine.

## Status Definitions

The thinking artifact's `status` field tracks where the idea stands:

| Status | Meaning | Set when |
|--------|---------|----------|
| `active` | Idea is being explored, not yet resolved | Default on creation |
| `parked` | Idea is valid but not worth pursuing now | User says "not now" or "park this" — or the idea fails pressure-test but isn't dead |
| `promoted` | Idea graduated to grooming | User accepts the groom promotion at the end of synthesize |

Only the user's explicit signal changes status. Don't auto-park ideas that feel stale — ask first.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I already know what to build, skip thinking" | You know what to build *given your current framing*. Think challenges the framing. The 10-minute version often saves a week. |
| "This is too small for structured thinking" | Small ideas with wrong assumptions become small features nobody uses. |
| "I'll just think while I code" | Coding commits you to an approach. Thinking is free to change direction. |
| "The user already decided, don't push back" | Thinking partners push back. That's the value. If the idea survives, it's stronger. |

## Before Marking Done

- [ ] Thinking artifact saved to `{pm_dir}/thinking/{slug}.md` with valid frontmatter (see schema in `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md`)
- [ ] Thinking index updated at `{pm_dir}/thinking/index.md`
- [ ] Strategy and insights checked during ground step (or noted as absent)
- [ ] User confirmed the synthesis captures their thinking accurately (explicit confirmation before saving)
- [ ] Promotion to groom offered (if the idea has legs)
- [ ] If promoted: artifact updated with `status: promoted` and `promoted_to: {groom-slug}`
