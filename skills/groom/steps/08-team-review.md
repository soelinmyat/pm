---
name: Team Review
order: 8
description: 3-4 parallel agents review the proposal for quality (max 3 iterations, full tier only)
---

### Step 8: Team Review

<HARD-GATE>
This step runs only for `full` tier. Quick and standard tiers skip team review entirely (per SKILL.md step loading rules) — they show the draft directly to the user in Step 7 and proceed to Link.

For `full` tier:
All applicable reviews are required before the bar raiser. Do NOT skip based on feature type, perceived quality, or time pressure.
The user must NOT see the complete proposal until both Team Review and Bar Raiser Review complete. (They received a brief preview in Step 7.)
If a reviewer's angle genuinely doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After the proposal is drafted, dispatch parallel reviewers to review the complete proposal — outcome, scope, design, visual artifacts, and research integration. This is not a scope check (Step 5 handled that). This is a quality gate on the product proposal.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching reviewers. Use the reviewer intents below in both Claude and Codex. In runtimes that support delegation, run them in parallel. Otherwise run the same briefs inline before merging findings.

**Reviewer personas:** Load prompts from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md`. Dispatch these reviewers:

| Persona | Angle | Always run? |
|---------|-------|-------------|
| `@product-manager` | Proposal quality, scope coverage, research utilization | Yes |
| `@strategist` | Competitive positioning, differentiation, research-to-proposal pipeline | Yes |
| `@staff-engineer` | Technical feasibility, scope-to-implementation gap, risk identification | Yes |
| `@designer` | Flow completeness, wireframe alignment, UX red flags | Only if visual artifacts exist |

**Handling team review findings:**

1. Merge all agent outputs. Deduplicate overlapping concerns.
2. If ANY agent returns blocking issues:
   - Revise the proposal content to address all blocking findings
   - Re-dispatch ALL reviewers (not just the one that flagged — fixes can introduce new problems)
   - Max **3 iterations** of the team review loop
3. If iteration 3 still has blocking issues, escalate to the bar raiser with unresolved items flagged.
4. Advisory findings are accumulated and surfaced to the user in Step 10 (Present).
5. Update state:

```yaml
phase: team-review
team_review:
  pm_verdict: ready | needs-revision | significant-gaps
  competitive_verdict: sharp | adequate | undifferentiated
  em_verdict: ready | needs-restructuring | missing-prerequisites
  design_verdict: complete | gaps | inconsistencies | null
  blocking_issues_fixed: {count}
  iterations: {count}
```
