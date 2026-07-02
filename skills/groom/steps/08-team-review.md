---
name: Team Review
order: 8
description: Team reviewers and the bar raiser run as one concurrent wave on the proposal (full tier only)
applies_to: [full, agent]
---

### Step 8: Team Review + Bar Raiser

This is a review gate. Run the canonical dispatch-collect-fix loop from `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md` with these parameters:

| Parameter | Value |
|-----------|-------|
| Artifact | The complete drafted proposal — `{pm_dir}/backlog/{topic-slug}.md` + wireframes |
| Reviewers | Team: `@product-manager` (Proposal quality, scope coverage, research utilization), `@strategist` (Competitive positioning, differentiation), `@staff-engineer` (Technical feasibility, scope-to-implementation gap), `@designer` (Flow completeness, wireframe alignment — only if visual artifacts exist). Concurrent: `@product-manager` as **Bar Raiser** (product director, fresh eyes, holistic) |
| Briefs | `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md` (team briefs + § Bar Raiser brief) |
| Dispatch | ALL reviewers — team and bar raiser — in ONE parallel wave via `agent-runtime.md`. Claude Code: `subagent_type` per the library's mapping (`pm:product-manager`, `pm:strategist`, `pm:staff-engineer`, `pm:designer`) |
| Independence | The bar raiser must NOT read team review findings or state review sections — independent assessment is the entire point. Concurrency makes this structural: it runs before team findings exist. |
| Iteration caps | Team loop: 3 · Bar raiser send-backs: 2 (tracked separately; agent tier: 2 for both) |
| Verdicts | PM: `ready \| needs-revision \| significant-gaps` · Competitive: `sharp \| adequate \| undifferentiated` · EM: `ready \| needs-restructuring \| missing-prerequisites` · Design: `complete \| gaps \| inconsistencies \| null` · Bar raiser: `Ready to present \| Send back to team \| Pause initiative` |
| Blocking fix | Revise the proposal content, then re-dispatch the whole wave — team reviewers AND a fresh bar raiser |
| Escalation | Team cap with blocking issues → user decision. Bar raiser cap-2 still "Send back to team" → present with unresolved concerns flagged. "Pause initiative" → user immediately. |

<HARD-GATE>
This step runs only for `full` and `agent` tiers. Quick and standard tiers skip team review entirely (per SKILL.md step loading rules) — they show the draft directly to the user in Step 7 and proceed to Link.

All applicable reviews — including the bar raiser — are required before presenting. Do NOT skip based on feature type, perceived quality, time pressure, or team review results.
The user must NOT see the complete proposal until the wave converges. (They received a brief preview in Step 7.)
If a reviewer's angle genuinely doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

This is not a scope check (Step 5 handled that). This is a quality gate on the product proposal — outcome, scope, design, visual artifacts, and research integration — plus the last-gate holistic read from someone who wasn't involved in drafting.

**Handling the wave's findings:**

1. Merge the team agents' outputs. Deduplicate overlapping concerns. Keep the bar raiser's output separate — it is an independent signal, not another vote to merge.
2. If ANY team reviewer returns blocking issues, OR the bar raiser says **Send back to team**: revise the proposal to address all blocking findings, then re-dispatch the entire wave (fixes can introduce new problems, and a revised proposal needs a fresh fresh-eyes read).
3. If the bar raiser says **Pause initiative**: stop and present its assessment to the user immediately.
   > "The bar raiser recommends pausing this initiative. Rationale: {rationale}. How would you like to proceed?"
4. Advisory findings are accumulated and surfaced to the user in Step 10 (Present).
5. Update state (both blocks — the schema is unchanged from the sequential era):

The bar-raiser send-back count lives in its own state block:

```yaml
phase: team-review
team_review:
  pm_verdict: ready | needs-revision | significant-gaps
  competitive_verdict: sharp | adequate | undifferentiated
  em_verdict: ready | needs-restructuring | missing-prerequisites
  design_verdict: complete | gaps | inconsistencies | null
  blocking_issues_fixed: {count}
  iterations: {count}
bar_raiser:
  verdict: ready | send-back | pause
  iterations: {count}
  blocking_issues_fixed: {count}
```

**Agent tier (headless):** same wave, tighter parameters — the anti-collusion prepend from `team-reviewers.md` § Agent-tier is prepended to every brief, a fifth `@adversarial-reviewer` joins the wave, both caps drop to 2, citation validity is sampled, and escalation follows `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/tier-gating.md`. Record `adversarial_verdict` and `citation_validity_sampled` in state.
