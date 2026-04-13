---
name: ideate
description: "Use when the user wants to discover what to build next, generate feature ideas from the knowledge base, or mine gaps and opportunities. Use when the user says 'what should we build', 'generate ideas', 'what's missing', 'find opportunities', 'brainstorm features', or wants evidence-backed feature candidates ranked by strategic fit."
---

# pm:ideate

## Purpose

Surface what to build next from the existing knowledge base. `pm:ideate` mines strategy, landscape, competitor gaps, customer evidence, and existing backlog to generate ranked feature ideas grounded in evidence rather than intuition.

Ideas are early-stage backlog items. They live in `{pm_dir}/backlog/` with `status: idea` and get promoted to `drafted` when groomed via `pm:groom`.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**EVERY IDEA MUST CITE AT LEAST ONE SIGNAL SOURCE WITH A FILE PATH.** No signal, no idea. Unsourced ideas are opinions dressed as features.

## When NOT to use

When the user already knows what to build and wants to scope it — use `pm:groom`. When they want to explore a single idea — use `pm:think`. Ideate is for discovery across the full KB, not deep-diving one idea.

**Workflow:** `ideate` | **Telemetry steps:** `audit`, `mine`, `filter`, `shape`, `rank`, `present`, `write`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/ideate/steps/` in numeric filename order. If `.pm/workflows/ideate/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"I already know this product well enough to skip the audit."** The audit catches capabilities you'd otherwise duplicate. Read strategy, feature matrix, and codebase. Every time.
- **"This idea doesn't have a clear signal source, but it's a good idea."** That's an Iron Law violation. Drop it or find the signal.
- **"The user probably wants more ideas, let me add a few extras."** Quality over quantity. 5 well-sourced ideas beat 15 thin ones. Cut the weakest.
- **"These filters are too strict, I'm dropping too many ideas."** The filters are the value. Show what was filtered out and why — the user can override, but you don't skip.
- **"Let me scope this idea in detail while I'm here."** Ideate shapes ideas, it doesn't scope them. If the user wants depth, hand off to `pm:think` or `pm:groom`.

## Escalation Paths

- **KB too thin to generate ideas:** "Not enough data to mine. Run `/pm:research` and `/pm:strategy` first to build the knowledge base."
- **User wants to deep-dive one idea:** "Want to explore '{idea}' further? I can run `/pm:think` to challenge the framing, or `/pm:groom` to scope it into a proposal."
- **User wants to groom an idea immediately:** Invoke `pm:groom` with the idea context pre-loaded. Groom intake recognizes `status: idea` backlog items and pre-fills from them.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I know the product, skip the audit" | The audit catches duplicates. You miss things every time you skip it. |
| "This idea is obviously good, it doesn't need a signal" | Obvious to whom? Signal sources make ideas defensible, not just plausible. |
| "The filters are too aggressive, I'm losing good ideas" | Show the filtered-out list. The user can override — but unsourced, undifferentiated ideas waste groom cycles. |
| "Let me flesh out the top idea in detail" | Ideate shapes, it doesn't scope. Hand off to think or groom for depth. |

## Before Marking Done

- [ ] All ideas cite at least one signal source with file path
- [ ] All 5 filters applied to every candidate
- [ ] No duplicate of existing backlog items
- [ ] Ideas written to `{pm_dir}/backlog/` with `status: idea` and valid frontmatter
- [ ] User confirmed the ideas list (or selected which to save)
