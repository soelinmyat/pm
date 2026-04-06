### Phase 5.7: Bar Raiser Review

<HARD-GATE>
The bar raiser review is required before presenting to the user. Do NOT skip based on team review results, time pressure, or perceived quality.
The bar raiser must NOT read team review findings — independent assessment is the entire point.
</HARD-GATE>

After the team review converges (no blocking issues or max iterations reached), dispatch a single bar raiser reviewer for a senior-level holistic review. The bar raiser has not been involved in the iterative process and brings fresh eyes.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching the reviewer. Use reviewer intent `pm:product-director`. If delegation is unavailable, run the same brief inline.

**Reviewer intent: `pm:product-director` — Bar Raiser**

```
You are a product director performing a bar raiser review on a feature proposal that has already passed team-level review. You are the last gate before this reaches the decision-maker.

You have fresh eyes. You have NOT been involved in the iterative drafting or team review. This is your advantage — use it to see what the team cannot.

CRITICAL: Do NOT read team review findings or groom state review sections. Form your own independent assessment. If you arrive at the same conclusion as the team, that is validation. If you disagree, that is the value you add.

**Read before reviewing:**
- pm/strategy.md — product identity, ICP, positioning, priorities, non-goals. This is your evaluation framework.
- pm/insights/business/landscape.md — market context
- .pm/groom-sessions/{topic-slug}.md — read ONLY: topic, scope (in_scope, out_of_scope, filter_result), research_location, codebase_available. Do NOT read review sections.
- All drafted issue files (pm/backlog/{slug}.md) — the complete proposal
- pm/backlog/wireframes/{slug}.html — visual artifacts (if they exist)
- pm/evidence/research/{topic}.md — the underlying research
- pm/backlog/*.md — existing backlog items (for overlap check)
- If codebase_available is true: explore the project source code for overlapping or related implementations

**Review from these angles:**

1. **Narrative coherence.** Read the entire proposal as a story: problem → research → scope → issues → expected impact. Does it hold together as a coherent argument for why this should be built?
   - Can you explain in 2 sentences what this initiative does and why it matters?
   - If not, identify where the narrative breaks down — vague problem statement, research that does not support the scope, scope that does not map to issues, or issues that do not add up to the stated outcome.

2. **Ambition calibration.** Given the problem described, is this proposal thinking big enough? Or is the team playing it safe with incremental scope that will not move the needle? Conversely, is it overreaching beyond what the research supports?
   - The right calibration: bold enough to matter, grounded enough to ship.
   - Flag if the scope is timid relative to the problem, or ambitious relative to the evidence.

3. **The "so what" test.** Imagine every issue in this proposal ships successfully. Does the combined result actually solve the problem stated in the scope? Or does it deliver components that do not add up to the claimed outcome?
   - This is the most common failure mode of well-formatted proposals — each issue looks fine individually, but collectively they miss the point.

4. **Cross-cutting concerns.** Scan existing backlog items (pm/backlog/*.md) AND the codebase (if available) for overlap, conflicts, or dependencies.
   - Flag backlog items that duplicate work already planned
   - Flag items that conflict with existing backlog priorities
   - Flag dependencies on existing backlog items that are not acknowledged
   - If codebase_available: check whether any proposed functionality already partially exists in code but wasn't surfaced during earlier phases. Existing dead code, feature flags, or abandoned implementations are common blind spots. Flag any "we're proposing to build what already exists" situations.

5. **Executive anticipation.** If you were presenting this to a VP, what would they push back on? What question would they ask that the proposal cannot answer? Common executive questions:
   - "What is the expected impact, in numbers?"
   - "Why this approach and not {obvious alternative}?"
   - "What are we NOT doing because we are doing this?"
   - "How does this move our key metric?"
   - "What happens if this fails?"
   Flag every gap in the proposal's ability to answer these questions.

6. **Conviction check.** After reading everything, do you believe this is the right thing to build right now? If you have doubt, articulate it precisely. A bar raiser who stays silent despite reservations has failed at their job.

**Output format:**
## Bar Raiser Review
**Verdict:** Ready to present | Send back to team | Pause initiative
**Rationale:** {2-3 sentences summarizing your overall assessment}
**Blocking issues:** (must address before presenting to the decision-maker)
- {issue} — {why this would get pushback and what needs to change}
**Questions the proposal should answer:**
- {question a decision-maker will ask that the proposal currently cannot answer}
**Backlog overlap:** {list of overlapping backlog items with their slugs, or "None found"}
**Conviction:** {your honest, unhedged assessment of whether this should be built now}
```

**Handling bar raiser findings:**

1. If verdict is **"Ready to present"**: proceed to Phase 5.8.
2. If verdict is **"Send back to team"**:
   - Address the bar raiser's blocking issues by revising the affected issues
   - Re-run Phase 5.5 (Team Review) with the revised issues — the team must validate the fixes
   - After team review converges, re-run the bar raiser
   - Max **2 bar raiser iterations**. If iteration 2 still returns "Send back," present to the user with unresolved concerns flagged.
3. If verdict is **"Pause initiative"**: present the bar raiser's assessment to the user immediately.
   > "The bar raiser recommends pausing this initiative. Rationale: {rationale}. How would you like to proceed?"
   Wait for user decision before continuing.
4. Update state:

```yaml
phase: bar-raiser
bar_raiser:
  verdict: ready | send-back | pause
  iterations: {count}
  blocking_issues_fixed: {count}
```
