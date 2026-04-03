### Phase 4: Scope

<HARD-GATE>
Formal scoping is required before review. Do NOT skip based on perceived simplicity or feature type.
Even "obvious" features benefit from explicit in-scope / out-of-scope boundaries.
If the scope is genuinely small, the exercise will be fast — that is different from skipping it.
</HARD-GATE>

Follow the full methodology in `scope-validation.md`.

**Comprehension check:** Before defining scope, confirm you can state: (a) the strategy check result from Phase 2 (passed/failed/override), (b) the top 3 research findings from Phase 3, and (c) the primary competitive gaps relevant to this feature. If you cannot, re-read `.pm/groom-sessions/{slug}.md` and the research files at the research_location. Scoping without this context produces generic boundaries.

1. **Codebase reality check** (if `codebase_available: true` in groom state):
   Before defining scope, review the codebase context from Phase 1 and check the current state of relevant code. This grounds the scope in implementation reality:
   - What already exists that this feature can build on? (reduces scope)
   - What infrastructure is missing that must be built? (expands scope)
   - Are there architectural constraints that make certain approaches impractical? (shapes scope)

   Surface findings to the user:
   > "Based on the codebase: {existing_thing} already handles {related_capability}. We can build on that for {in-scope items}. However, {missing_thing} doesn't exist yet and would need to be created."

2. Present the scope definition. Fill it collaboratively with the user.

   **Write scope at the JTBD / outcome level, not implementation detail.** Each scope item should describe a user job or outcome, not a specific task or UI change. Implementation details belong in Phase 5 (issues).

   Good: "Live progress visibility: users see the proposal fill in as each phase completes"
   Bad: "Phase 2 strategy: inline verdict badge, remove companion placeholder"

   Format each item as: **Noun phrase**: clarifier (8-15 words max). Excluded items must include a reason.

   - What is explicitly IN scope for this initiative?
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

3. **Success metric.** Ask:
   > "What's the one metric that tells us this worked?"

   Guide the user toward an **outcome metric** (what changed for users), not an output metric (what we shipped). The metric should have:
   - **What to measure** — a specific, queryable metric
   - **Target** — a number or directional threshold (exact for optimization work, directional for new features)
   - **Timeframe** — when to evaluate (must be evaluable within 2-4 weeks of launch)

   Good: "New user activation rate from 34% to 45% within 30 days"
   Bad: "Every phase has a visible artifact" (that's an output, not an outcome)
   Bad: "Improve user experience" (unmeasurable)

   For exploratory / 0-to-1 work where no baseline exists, use qualitative: "5 of 10 beta users report this solves their workflow problem."

   Store as `success_metric` in the state file. Keep it to one line — this appears in the hero metrics strip on the proposal.

4. Apply the 10x filter (from `scope-validation.md`):
   > "Is this meaningfully better than what competitors offer — or incremental parity?"
   Document the filter result explicitly: `10x` | `parity` | `gap-fill`.

5. If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

6. If `visual_companion: true` in `.pm/config.json`: offer the scope grid (impact/effort).
   > "Want a scope grid? I'll plot proposed scope items on impact vs. effort axes."

7. **Dashboard update.** The progressive proposal at `/groom/{slug}` auto-renders the scope section from the state file — included/excluded lists, scope review verdicts, and differentiator badge.

8. Update state:

```yaml
phase: scope
success_metric: "{measurable outcome — e.g., 'grooming sessions complete 40% faster'}"
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | parity | gap-fill
```
