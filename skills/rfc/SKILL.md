---
name: rfc
description: "Use when generating or reviewing an RFC (Request for Comments) for a groomed feature. Use when the user says 'write an RFC', 'generate RFC', 'create an RFC', 'RFC for this feature', 'technical design', or when pm:dev routes M/L/XL work that needs an RFC. Takes a groomed proposal as input and produces a technical RFC ready for review."
---

# pm:rfc

## Purpose

Generate a technical RFC from a groomed product proposal. The RFC translates product intent into an engineering plan with tasks, contracts, and review gates.

RFC is the bridge between product (proposal) and engineering (implementation). No proposal means no product context means a garbage RFC.

## Iron Law

**NEVER GENERATE AN RFC WITHOUT A PROPOSAL.** The rfc skill takes a groomed proposal as input. No proposal = no product context = garbage RFC. If no proposal exists, stop and tell the user to run `/pm:groom` first.

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `rfc` | **Telemetry steps:** `intake`, `rfc-generation`, `rfc-review`, `approved`.

**When NOT to use:** XS/S work that doesn't need an RFC. Quick fixes, typo corrections, or config changes. When the user wants product discovery or scoping, use `pm:groom` instead. When the user wants to jump straight to implementation, use `pm:dev`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/rfc/steps/` in numeric filename order. If `.pm/workflows/rfc/` exists, same-named files there override defaults. Execute each step in order — each contains its own instructions, gates, and state update schemas.

---

## Resume

Before doing anything else, glob `{pm_state_dir}/rfc-sessions/*.md`.

If exactly one session exists, read it and say:

> "Found an in-progress RFC session for '{slug}' (last updated: {updated}, current stage: {stage}).
> Resume from {stage}, or start fresh?"

If multiple sessions exist, list them with slug, stage, and updated timestamp. Ask which to resume.

Wait for the user's answer. If resuming: skip completed stages. If starting fresh: delete the selected state file, then begin Step 1.

---

## References

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/state-schema.md` | Session state file schema |
| `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md` | Project context discovery contract |

---

## State File

Each RFC session has its own state file under `{pm_state_dir}/rfc-sessions/{slug}.md`. Write session state using the schema defined in `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/state-schema.md`.

---

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The proposal is thin but I can infer the intent."** Inference is invention. If the proposal lacks scope, ACs, or design direction, stop and tell the user to run `/pm:groom` to fill the gaps. Thin input produces thin RFCs.
- **"This is XS/S, but I'll write an RFC anyway to be thorough."** XS/S work doesn't need an RFC. Tell the user to run `/pm:dev` directly. Over-ceremony kills velocity.
- **"The RFC is already approved but the user invoked /rfc again."** Don't re-generate. Inform the user the RFC is approved and suggest `/pm:dev` to implement.
- **"I'll skip the review step since the RFC looks solid."** Review catches blind spots every time. Skipping review is skipping quality.
- **"Linear has enough context, I don't need the proposal."** Linear issues are summaries, not product context. The proposal has scope, design, research, and competitive context that Linear doesn't carry.

## Escalation Paths

- **No proposal exists:** "No product proposal found for '{slug}'. Run `/pm:groom {slug}` first to create one."
- **Proposal is draft/incomplete:** "The proposal for '{slug}' hasn't been approved yet (status: {status}). Run `/pm:groom` to complete it first."
- **RFC already approved:** "RFC already approved for '{slug}'. Run `/pm:dev` to implement."
- **XS/S size detected:** "This is {size} work — no RFC needed. Run `/pm:dev` directly."
- **User wants product scoping, not technical design:** "Sounds like you want product discovery. Run `/pm:groom` for that — RFC handles the technical plan."

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Proposal is close enough, skip groom" | Close enough means gaps. Gaps in the proposal become gaps in the RFC become bugs in the code. |
| "XS but complex, needs an RFC" | If it's complex, it's not XS. Re-size it first. |
| "Linear issue has all the context" | Linear carries tracking data, not product context. The proposal has research, competitive analysis, and design. |
| "Review is just rubber-stamping" | Review catches 30% of issues. Rubber-stamping is skipping. |
| "User is impatient, skip to generation" | Skipping intake means missing context. A fast bad RFC wastes more time than a slower good one. |

---

## Before Marking Done

- [ ] RFC generated from a valid proposal (status: proposed, planned, or in-progress)
- [ ] All review gates passed
- [ ] RFC path linked in proposal frontmatter (`rfc:` field)
- [ ] State file updated with final stage
- [ ] User confirmed the RFC captures the technical approach
