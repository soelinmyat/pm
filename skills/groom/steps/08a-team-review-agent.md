---
name: Team Review (agent)
order: 8.1
description: Parallel reviewer dispatch on the drafted proposal with cap=2 iterations + anti-collusion framing + adversarial reviewer. Replaces 08-team-review.md for agent tier.
applies_to: [agent]
---

### Step 08a: Team Review (agent tier)

This step replaces `08-team-review.md` for sessions where `groom_tier == "agent"`. The dispatcher selects this file via `applies_to: [agent]`.

**Purpose differs from 05a:** scope-review (05a) reviewed the *synthesis* (JTBD, scope, risks). Team review (this step) reviews the *complete proposal* — outcome, scope, design, visual artifacts, and research integration. Same convergence + iter-cap mechanism, different artefact under review.

**Key differences from co-pilot 08:**
- **Maximum 2 iterations** (co-pilot has 3).
- **Anti-collusion framing** prepended to every reviewer prompt.
- **Adversarial reviewer** added as a 4th dispatch.
- `@designer` is **conditional** — dispatch only if visual artifacts (wireframes/mockups) exist for the proposal. Agent tier is non-UI-focused; designer rarely fires.

---

#### Phase A: Dispatch reviewers in parallel

Read the drafted proposal at `{pm_dir}/backlog/{slug}.md` (and `{pm_dir}/backlog/proposals/{slug}.html`). Dispatch reviewers in parallel:

1. `@product-manager` — proposal quality, scope coverage in the prose, research utilization
2. `@strategist` — competitive positioning substance, differentiation grounded in scope
3. `@staff-engineer` — technical feasibility, scope-to-implementation gap
4. `@adversarial-reviewer` — assume the proposal is wrong; what's the most likely mistake?
5. `@designer` (conditional) — only if the proposal has wireframes/mockups linked

Reviewer prompts live in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md`. The agent-tier variants there carry anti-collusion framing.

Each reviewer can flag:
- **Blocking issues** — must be fixed before approval
- **Citation invalidity** — "cited source doesn't support claim" (blocking)
- **Advisory** — non-blocking improvements

---

#### Phase B: Convergence rule + iteration cap

Same as 05a Phase B — **maximum 2 iterations, cap on `iter_counts.team_review`.**

| Iteration | Action |
|---|---|
| 1 | Run all reviewers in parallel. Converge if no blockers. |
| 2 | Re-run all reviewers (not just the flaggers) after fixing. Converge if no blockers. |
| 3+ | Escalate to user. |

**Fix mechanism:** the orchestrator edits the proposal markdown (and optionally re-renders the HTML) to address blocking findings. Common fixes:
- Strengthen the outcome / problem framing
- Add a missing risk
- Tighten a competitive claim
- Replace an invalid citation
- Add an advisory item to the Advisory Notes section instead of fixing inline

---

#### Phase C: Escalation on iter 3

Same as 05a Phase C. Escalation appends to `checkpoints[]` with `name: team-review-escalation` and the user's outcome (approve / redirect / abort).

---

#### Phase D: Persist findings + advance

Write the iteration outcome to session state:

```yaml
team_review:
  iter_counts: {team_review: 1 | 2}
  pm_verdict: ready | needs-revision | significant-gaps | null
  competitive_verdict: sharp | adequate | undifferentiated | null
  em_verdict: ready | needs-restructuring | missing-prerequisites | null
  adversarial_verdict: no-issue-found | possible-mistake | likely-mistake
  design_verdict: complete | gaps | inconsistencies | null      # null when @designer not dispatched
  blocking_issues_fixed: int
  advisory_notes: [...]                                          # appended to proposal §10
```

Continue updating `citation_validity_sampled` from the synthesizer's citations as reviewers flag.

Advance `phase: proposal-ready` and proceed to `11-link.md` (which presents the proposal-ready checkpoint and finalizes).
