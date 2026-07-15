---
name: think
description: "Use when exploring a product idea, reasoning through a decision, or challenging assumptions before committing to build. Use when the user says 'let's think about', 'what if we', 'how should we approach', 'should we', 'I'm not sure whether', or describes a tradeoff without a clear direction. Use when the user has an idea but hasn't validated the framing. Lighter than groom — structured thinking, not ceremony."
---

# pm:think

## Purpose

Structured product thinking before commitment. Explore ideas, challenge assumptions, weigh tradeoffs, and reach clarity — without the ceremony of grooming.

Think is the conversation you have *before* deciding whether to build. It produces a readable thinking artifact plus a compact decision companion, not backlog issues. Think is the whiteboard conversation; groom is the meeting that produces action items.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `think` | **Telemetry steps:** `capture`, `ground`, `reframe`, `explore`, `pressure-test`, `synthesize`

## Iron Law

**NEVER SKIP THE REFRAME.**

## Hard rules

- **Never skip the reframe.** Every idea is tested against at least one reframing lens before approaches are explored. The conclusion may be "the current framing holds," but that must be an explicit conclusion, not a shortcut — never jump from capture straight to "here are three approaches."
- **Verdicts first, disagree openly.** Lead with your recommendation, then explain. Challenge the framing even when the user sounds confident — false neutrality and validation-seeking waste their time. Thinking partners push back; if the idea survives, it's stronger.
- **Not research.** At most 2 insight files + 2 web searches. Need more → escalate to `pm:research` rather than turning thinking into a research session.
- **Not a spec.** Think produces a one-page summary, not a design doc. If you're writing more than a page, you've crossed into groom territory.
- **Converge or surface.** After 4+ exchanges on one beat without convergence, synthesize what you have and name the sticking point as an open question.
- **One decision, two synchronized readers.** Save Markdown for people and the v1 decision companion for downstream workflows; never make another skill reconstruct the decision from prose.

## Red Flags — Self-Check

- **"The framing already sounds good."** Stop and test it through one explicit reframing lens.
- **"More options will help."** Keep the set genuinely distinct and recommend the strongest direction.
- **"We need more evidence before discussing this."** Use the bounded grounding check, then route to research only if the decision truly depends on missing data.
- **"The user seems convinced, so I should agree."** Ask the sharpest pressure-test question and disagree openly when the risk is material.
- **"This summary is close enough."** Ask the user to confirm the artifact before saving or promoting it.

## Setup detection

Before starting, check whether a PM workspace exists (`pm/` at cwd, or `pm_dir` already in context).

- **Workspace exists:** proceed normally.
- **No workspace:** don't tell the user to run `pm:start` — this is a valid entry point for new users. Ask once:
  > "You don't have a PM workspace set up yet — no worries. Want to **(A) Set up a project** — I'll kick off `/pm:start` — or **(B) Just think** — one-off session, no files unless you want them?"
  - **A**: invoke `pm:start`, then continue into thinking once setup completes.
  - **B**: set `one_off_mode = true`. In one-off mode: skip all KB grounding (web search still allowed, 1-2 max); at synthesize, show the artifact in-chat instead of writing files, then offer to save it to `./thinking-{slug}.md`, and skip the groom promotion.

## Workflow

Run these as conversational beats — natural rhythm, no announcing or state-tracking.

1. **Capture.** If the user already described the idea, don't ask "what's the idea?" — summarize in 2-3 bullets naming *who* benefits, *what* changes, and *why now*, then confirm. If any of those three is missing or the idea is vague, ask ONE clarifying question (prefer yes/no over open-ended). Once confirmed, derive a canonical kebab-case slug (max 4 words) — reuse the existing slug if resuming. This slug is the single identifier for the thinking file, index row, and any groom handoff.

2. **Ground.** Load just enough context to reframe with grounding instead of guessing — a 30-second check, not research. Search existing thinking (index: `{pm_dir}/thinking/index.md`; rebuild it via `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` if missing) and offer resume on a match. Always read `{pm_dir}/strategy.md` and its decision companion when present for ICP / priorities / non-goals (note absence, not a blocker). Scan insights via the search protocol in `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md` (index: `{pm_dir}/insights/.hot.md`), noting confidence and Evidence IDs; deep-read at most 2 insight files. Never read raw private evidence. Retain the portable paths and Evidence IDs that materially affect the decision. Use 1-2 web searches only if the KB has gaps, and surface significant gaps rather than filling them here.

3. **Reframe.** Shift from the user's framing to the underlying problem or a higher-leverage angle — the most valuable beat, because a good reframe changes what gets built. Pick the lens that opens the biggest gap:
   - **Jobs to Be Done:** strip the solution away — *"When [situation], I want to [motivation], so I can [outcome]."*
   - **Problem vs. solution:** push a solution toward its problem, or a problem toward its sharpest version (who has it most acutely, cost of the status quo).
   - **Must-have test:** would the user be genuinely disappointed if this didn't exist, or would they just find a workaround?
   - **Simpler framing:** is there a version with 80% of the value at 20% of the complexity?

   Share it as a short, opinionated take ("The way I'd reframe this: … The real unlock is …"), then ask if it resonates. If the framing is already sharp, say so and move on — evaluation is mandatory, the conclusion is open.

4. **Explore approaches.** Propose 2-3 *genuinely different* directions (not variations of one idea) — vary scope (minimal vs full), mechanism (build/buy/integrate), audience, or timeline. Size the opportunity directionally when relevant (reach / impact / confidence / effort — no numbers needed, "most users hit this weekly" is enough). For each: one-line summary, why it works, the catch, best-if. Compact table or short sections, recommendation first — don't hide your opinion behind false neutrality. Ask which resonates.

5. **Pressure-test.** Find the weakest points before commitment. Surface the 2-3 risks that would *kill* the idea if wrong, not merely complicate it — demand, usability, feasibility, viability, dependencies. Lead with your sharpest concern as a direct question. Push back when the user hand-waves a real risk; accept "we'll figure it out" for manageable unknowns. Done when you can state "we're going with X, despite Y, because Z."

6. **Synthesize.** Draft the summary in the artifact format below and confirm: *"Here's the summary. Did I capture it correctly?"* Revise until confirmed — this is the only question in this beat. Read and follow `${CLAUDE_PLUGIN_ROOT}/references/product-reasoning.md`. Write `{pm_dir}/thinking/{slug}.md`, hash its final bytes, then write and validate `{pm_dir}/thinking/{slug}.decision.json` with the problem, evidence, alternatives, confirmed/parked decision, confidence basis, non-goals, and next trigger. Add/update the index row following `${CLAUDE_PLUGIN_ROOT}/references/kb-search.md`. Finally offer promotion:
   > "Want to groom this into a proposal? (lightweight scoping, ~5-10 min)"

   On yes, invoke `pm:groom` with `groom_tier: quick`, the summary and decision companion as context, and the slug. Groom owns the verified origin transition during its approved handoff. After approval, first set the Markdown `status: promoted` / `promoted_to` and update the index row, then run the atomic `promote` command in `references/product-reasoning.md` once so it hashes those final bytes and validates both artifacts. Never mutate bound Markdown after promotion. If Groom is abandoned or unapproved, leave both artifacts active and unpromoted.

Handle multiple ideas sequentially — finish one (synthesize + save) before starting the next; don't interleave.

## Escalation paths

- Stop the current beat before switching lanes; preserve the reframe, decision, and open question in the artifact.
- **Needs data, not opinions:** "This needs evidence before we can think clearly about it. Want me to run `/pm:research` on [specific question]?"
- **No convergence after 4+ exchanges on one beat:** synthesize the current state, name the sticking point explicitly, and save as `active` with the disagreement captured in open questions.
- **Multiple ideas emerging:** "We're branching into [second idea]. Let me save this one first, then we can think through that separately."

## Resume

Think keeps no mid-session state; the artifact (`{pm_dir}/thinking/{slug}.md`) is the only durable output. If a matching artifact is found during ground, read it, finish grounding (context may have changed), ask "What changed since this was written?", and re-enter by the answer — not by which artifact sections look complete:

- New info changes the **core problem** → restart at **Reframe**.
- Problem holds but **direction is unsettled** → restart at **Explore Approaches**.
- Only **risks or context changed**, or nothing material did → restart at **Pressure-Test** (re-examine with fresh eyes).

## When NOT to use

Skip when the user wants a quick opinion ("what do you think about X"), not a structured session — or when they've already decided and want to build (go to `pm:dev`). Think is not research (durable market data or competitor analysis → `pm:research`; a quick factual answer → just answer) and not a planning tool (tasks, issues, implementation plans → `pm:groom`).

| Signal | Skill |
|--------|-------|
| "Let's think about X" / "What if we" / "How should we approach" | **think** |
| "Groom this" / "Create issues" / "Spec this out" / "Break this down" | **groom** |
| User is exploring, no build commitment | **think** |
| User wants sprint-ready issues | **groom** |
| Conversation started as thinking, user says "let's do this" | **think** → promote to **groom** |

## Thinking artifact format

```markdown
---
type: thinking
topic: "{topic}"
slug: "{kebab-case-slug}"
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active | parked | promoted
promoted_to: "{groom-session-slug}" | null
reasoning_version: 2
decision_brief: "thinking/{slug}.decision.json"
---

# {Topic}

## Problem
{1-2 sentences: the real problem or opportunity}

## Direction
{The approach that emerged from the conversation}

## Key tradeoffs
- {Tradeoff}

## Open questions
- {Question}

## Next step
{What should happen next — groom it, research more, park it}
```

`status`: `active` (default on creation) · `parked` (valid but not worth pursuing now, or failed pressure-test but not dead) · `promoted` (user accepted the groom promotion). Only the user's explicit signal changes status — don't auto-park stale ideas, ask first.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The user asked for ideas, not pushback." | Useful thinking tests the premise before multiplying solutions. |
| "Promotion is obvious from enthusiasm." | Only explicit user confirmation changes durable status or starts grooming. |

## Before Marking Done

- [ ] The confirmed Markdown and hash-bound decision companion are saved, validated, indexed, and share one canonical slug.
- [ ] The user confirmed the reframe, direction, summary, and any promotion decision.
- [ ] Grounding bounds, reframe, pressure-test, convergence, artifact validation, and promotion gates passed.
