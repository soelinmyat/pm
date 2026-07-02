---
name: Scope Review
order: 5
description: Three parallel reviewers (PM, Competitive, EM) challenge the scope before drafting
applies_to: [standard, full, agent]
---

### Step 5: Scope Review

This is a review gate. Run the canonical dispatch-collect-fix loop from `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md` with these parameters:

| Parameter | Value |
|-----------|-------|
| Artifact | The scoped initiative — groom session state `scope` block + `strategy_check.context` |
| Reviewers | `@product-manager` (product manager — business value), `@strategist` (competitive strategist — positioning), `@staff-engineer` (engineering manager — feasibility, scans the codebase) |
| Briefs | `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md` § Scope Review briefs |
| Dispatch | All reviewers in one parallel wave via `agent-runtime.md` |
| Iteration cap | 3 (agent tier: 2) |
| Verdicts | PM: `ship-it \| rethink-scope \| wrong-priority` · Competitive: `strengthens \| neutral \| weakens` · EM: `feasible \| feasible-with-caveats \| needs-rearchitecting` |
| Blocking fix | Adjust scope (move items out-of-scope, refine in-scope definitions), then re-dispatch the whole wave |
| Escalation | Cap reached with blocking issues → present to user for decision |

<HARD-GATE>
All three reviews (PM, Competitive, EM) are required before drafting the proposal.
Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If a reviewer's angle doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

This catches strategic misalignment, competitive blind spots, and technical risks that the strategy check (Step 2) is too coarse to find.

**Step-specific behavior on top of the canonical loop:**

1. **Interactive EM checkpoint (co-pilot tiers only — never in the agent tier).** After the EM agent completes, present its findings conversationally to the user — invite follow-up questions or pushback before proceeding:
   > "The EM reviewed the codebase. Here are the findings: {summary}. Any questions or concerns before we proceed to proposal drafting?"
   Wait for user confirmation. Capture the EM's key findings for the `## Technical Feasibility` section of the proposal.
2. **Opportunity capture.** For each non-blocking **Opportunity** from the Competitive Review (and any non-blocking opportunity from PM Review), call `writeNote(pmDir, body, 'groom-opportunity', inferredTags)` via `scripts/note-helpers.js`. Skip if a backlog item with a matching slug already exists in `{pm_dir}/backlog/`. Log: "Captured N opportunities as notes." If zero opportunities were surfaced, skip silently.

**Agent tier (headless):** same gate, tighter parameters — the artifact is the synthesis YAML from Step 4a, the anti-collusion prepend from `team-reviewers.md` § Agent-tier is prepended to every brief, a fourth `@adversarial-reviewer` joins the wave (its `likely-mistake` verdict is blocking), the iteration cap is 2, and the interactive EM checkpoint is skipped (opportunity capture still runs — it is autonomous-safe). Increment `iter_counts.scope_review` per iteration; record `adversarial_verdict` and `citation_validity_sampled` in state. At the cap with blocking issues, run the escalation checkpoint in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/tier-gating.md` § Agent-tier review escalation (`name: scope-review-escalation`).

**State update:**

```yaml
phase: scope-review
scope_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority
  competitive_verdict: strengthens | neutral | weakens
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting
  blocking_issues_fixed: 0
  iterations: 1
```
