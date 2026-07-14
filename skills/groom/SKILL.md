---
name: groom
description: "Use when a validated product idea needs a sprint-ready proposal or PRD: 'groom this', 'scope this', 'write a proposal', 'create a PRD', 'spec this out', or turn approved thinking into product scope. Produces an explicitly approved, machine-readable proposal plus an accessible HTML reader and RFC/Dev handoff. Do not use for open-ended 'should we build this?' exploration; use pm:think first."
---

# pm:groom

## Purpose

Turn a validated idea into an evidence-backed, explicitly approved product proposal. Groom owns product scope, acceptance criteria, design requirements, and decision quality; it does not approve an RFC, create implementation work, or ship code.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `groom` | **Telemetry steps:** `intake`, `research`, `scope`, `synthesis`, `design`, `draft`, `review`, `presentation`, `approval`, `handoff`, `retro`

## Iron Law

**NEVER CLAIM PRODUCT APPROVAL WITHOUT AN EXACT HASH-BOUND APPROVAL AUDIT.**

## When NOT to use

- For deciding whether an idea is worth pursuing, use `pm:think`.
- For market/evidence work without a proposal decision, use `pm:research`.
- For technical architecture or issue decomposition, use `pm:rfc` after Groom approval.
- For implementation, use `pm:dev` after the required product and technical approvals.

## Contract

- Canonical private state is `.pm/groom-sessions/{slug}/session.json`; mutate it only through `scripts/groom-session.js`.
- Canonical product content is `{pm_dir}/backlog/proposals/{slug}.json`. Generate HTML and backlog Markdown projections with `scripts/proposal-render.js`; never maintain twins by hand.
- Validate source, projections, lifecycle, and approval with `scripts/proposal-check.js`.
- Drafting and review do not imply approval. Ask one direct approval question in the approval phase and bind the answer to exact proposal bytes.
- Any substantive proposal revision invalidates review and approval and returns the session to the earliest affected phase.
- Review coverage is a set of independent decision questions. It may run inline or across available workers; never require a fixed worker count or persona name.
- External effects such as tracker writes require explicit authority and an idempotent effect receipt.
- Phase transitions advance only after the runner validates current evidence and records the strict result.

## Tier Gating

| Tier | Required depth |
|---|---|
| `quick` | Intake, bounded evidence assessment, scope, draft, approval, handoff |
| `standard` | Adds strategy-aware research, synthesis, design requirements, and core review questions |
| `full` | Adds complete review-question coverage and presentation/artifact quality |
| `agent` | Provider-neutral full flow with stricter KB freshness and citation requirements |

Tier changes depth, not proposal integrity, artifact validation, or explicit approval. Select using `references/tier-gating.md`; capability limits are recorded in runtime state rather than inferred from provider names.

## Resume

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/groom-session.js status --session {source_dir}/.pm/groom-sessions/{slug}/session.json --json` when a canonical session exists. Resume the returned phase without repeating completed work. If only legacy `.pm/groom-sessions/{slug}.md` exists, migrate it with the runner and retain the migration record.

## Steps

Read every `.md` file in `${CLAUDE_PLUGIN_ROOT}/skills/groom/steps/` in numeric filename order. If `.pm/workflows/groom/` contains a same-named file, use that project override. For each routed phase, build its bounded prompt with `scripts/groom-prompt.js`, execute only that phase, return a strict result envelope, and record it through `scripts/groom-session.js` before advancing.

## References

| Reference | Use |
|---|---|
| `references/tier-gating.md` | Tier eligibility and depth |
| `references/state-schema.md` | Canonical session/result/approval contract |
| `references/proposal-format.md` | Canonical structured proposal fields and projections |
| `references/review-questions.md` | Independent product-review question coverage |
| `references/scope-validation.md` | Scope and non-goal heuristics |
| `references/prototype-format.md` | Optional visual prototype contract |

## Red Flags — Self-Check

- **"The Markdown says proposed, so it is approved."** Stop and check canonical JSON plus the approval audit.
- **"I can repair the HTML or hash directly."** Instead regenerate every projection from the canonical proposal source.
- **"Three reviewers ran, so coverage is complete."** Check every required decision question and its evidence-bound result.
- **"Quick tier can skip research or approval."** Stop; use a bounded evidence assessment and explicit approval.
- **"This model needs different product policy."** Keep policy provider-neutral and capture only actual capability differences.
- **"Engineering can settle the open product decision."** Stop, resolve it, or include an explicitly owned open decision before handoff.

## Escalation Paths

- **Idea is not validated:** Stop and route to `pm:think`: "This still needs framing. Want to run `/pm:think` before we scope it?"
- **Evidence is insufficient:** "The proposal cannot support this decision yet. Run `/pm:research {topic}` or approve a narrower evidence-bounded scope."
- **Scope will not converge:** "The scope still contains independent outcomes. Split it into focused proposals, or choose the first outcome now."
- **Approval is withheld:** "The reviewed proposal is saved at the approval boundary. Resume Groom when you are ready to approve or revise it."
- **User requests technical work:** "Product scope is ready. Run `/pm:rfc {slug}` for technical design after approval."

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The proposal looks complete." | Completeness is established by schema, question coverage, and executable acceptance criteria. |
| "Review consensus is approval." | Review is advisory evidence; approval is a separate human decision bound to exact bytes. |
| "A projection edit is harmless." | It creates source drift and can mislead downstream consumers. Regenerate instead. |

## Before Marking Done

- [ ] Canonical proposal JSON, generated HTML/Markdown, and approval audit are saved and mutually verified.
- [ ] The user explicitly confirmed the exact reviewed proposal, or the session remains at `awaiting_approval`.
- [ ] Research, scope, review-question, artifact, lifecycle, and handoff gates passed for the routed tier.
- [ ] RFC/Dev can consume the approved execution contract without reconstructing decisions from prose.
- [ ] External effects, if any, have authority and verified receipts.
