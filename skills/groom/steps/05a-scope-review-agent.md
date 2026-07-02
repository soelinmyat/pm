---
name: Scope Review (agent)
order: 5.1
description: Parallel reviewer dispatch with cap=2 iterations + anti-collusion framing + adversarial reviewer. Replaces 05-scope-review.md for agent tier.
applies_to: [agent]
---

### Step 05a: Scope Review (agent tier)

This step replaces `05-scope-review.md` for sessions where `groom_tier == "agent"`. The dispatcher selects this file via `applies_to: [agent]`.

**Key differences from co-pilot 05:**
- **Maximum 2 iterations** (co-pilot has 3). Agent tier escalates faster because the user reviews at scope-lock and proposal-ready anyway.
- **Anti-collusion framing** prepended to every reviewer prompt: explicit "find problems with this work, do not approve."
- **Adversarial reviewer** added as a 4th dispatch: "assume the synthesizer is wrong; what's the most likely mistake?"

---

#### Phase A: Dispatch reviewers in parallel

Read the synthesis block from session state (set by `04a-synthesis.md`). Dispatch four reviewers in parallel using `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`:

1. `@product-manager` — JTBD clarity, ICP fit, scope sanity
2. `@strategist` — competitive sharpness, differentiation, positioning
3. `@staff-engineer` — technical feasibility, codebase grounding, risk
4. `@adversarial-reviewer` — assume the synthesizer is wrong; what's the most likely mistake?

The first three reuse prompts from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md` — the agent-tier variants there have anti-collusion framing prepended. The adversarial reviewer prompt also lives in `team-reviewers.md` under "Adversarial Reviewer".

Each reviewer receives the synthesis YAML, the source citations, and the cited file paths. They may flag:
- **Blocking issues** — must be fixed before draft
- **Citation invalidity** — "cited source doesn't actually support this claim" (treated as blocking)
- **Advisory** — non-blocking concerns

---

#### Phase B: Convergence rule + iteration cap

**Convergence:** the loop terminates when **no reviewer returns blocking issues**. Advisory items are accumulated and surfaced in the proposal's Advisory Notes section.

**Iteration cap: maximum 2 iterations.**

| Iteration | Action |
|---|---|
| 1 (initial) | Run all four reviewers in parallel. If no blockers → converged. If blockers → fix and re-dispatch (iter 2). |
| 2 (after fix) | Re-run all four reviewers (not just the one that flagged — fixes can introduce new problems). If no blockers → converged. If blockers remain → escalate. |
| 3+ | Do not run. Escalate to user. |

Increment `iter_counts.scope_review` per iteration. Cap at 2.

**Fix mechanism:** the orchestrator (this step) edits the `synthesis:` block in session state to address blocking findings. Common fixes:
- Move scope item from in to out (or vice versa)
- Refine JTBD wording
- Add a missing risk
- Replace an invalid citation

If a fix changes the JTBD or scope materially, the orchestrator emits an updated `synthesis_notes` line documenting the change.

---

#### Phase C: Escalation on iter 3

If iter 2 still has blocking issues, escalate to the user:

> "Scope review didn't converge after 2 iterations. Blocking issues remaining:
>
> {list of blocking issues, each tagged with reviewer role}
>
> Options:
> (a) Approve as-is — proceed to draft with these as known limitations
> (b) Redirect — go back to scope-lock checkpoint with the reviewer feedback as guidance
> (c) Abort — stop the session"

This counts as an "exceptional checkpoint" — append to `checkpoints[]` with `name: scope-review-escalation` and the user's outcome.

---

#### Phase D: Persist findings + advance

Write the iteration outcome to session state:

```yaml
scope_review:
  iter_counts: {scope_review: 1 | 2}      # final count
  pm_verdict: ship-it | rethink-scope | wrong-priority | null
  competitive_verdict: strengthens | neutral | weakens | null
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting | null
  adversarial_verdict: no-issue-found | possible-mistake | likely-mistake
  blocking_issues_fixed: int
  advisory_notes: [...]                   # surfaced in proposal §10
  citation_validity_sampled:              # populated as reviewers flag invalid citations
    sampled: int
    valid: int
```

Increment `citation_validity_sampled.sampled` for each citation a reviewer reads; increment `valid` only when the citation actually supports the claim.

Advance `phase: draft-proposal`.
