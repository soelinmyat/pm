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

2. **Define Jobs-to-be-Done.** Before drawing scope boundaries, identify the user jobs this feature serves. Each job follows the JTBD format:

   > **When** [situation/trigger], **I want to** [action/capability], **so I can** [desired outcome]

   Guidelines:
   - Derive jobs from the research findings (Phase 3) and the problem statement (Phase 1). Every job should trace back to a real user need — not an implementation idea.
   - Ask the user: "What are the key jobs users need to get done here?" Present your suggested jobs and let them add, remove, or reword.
   - Keep it to 3-7 jobs. Fewer than 3 means the scope is too narrow or the jobs are too broad. More than 7 means some jobs should be deferred to out-of-scope.
   - Jobs are the foundation for user flows in Phase 5. Each flow will trace how a job gets done. If a job can't be turned into a flow, it's probably a feature label, not a job — rewrite it.
   - Rank jobs by importance. The ranking drives which flows are `featured` (shown inline) vs hidden behind "View all" in the progressive proposal.

   Wait for the user to confirm the job list before proceeding.

3. Present the scope definition template. Fill it collaboratively with the user:
   - What is explicitly IN scope for this initiative? (each item should map to one or more jobs)
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

4. Apply the 10x filter (from `scope-validation.md`):
   > "Is this meaningfully better than what competitors offer — or incremental parity?"
   Document the filter result explicitly: `10x` | `parity` | `gap-fill`.

5. If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

6. If `visual_companion: true` in `.pm/config.json`: offer the scope grid (impact/effort).
   > "Want a scope grid? I'll plot proposed scope items on impact vs. effort axes."

7. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Scope"
   - `{STEPPER_HTML}`: `scope` as current phase; `intake`, `strategy-check`, `research` as completed
   - `{CONTENT}`: Build this HTML using the actual scope data:

     ```html
     <h2>Scope Definition</h2>
     <span class="badge badge-success">10x</span>
     <!-- Use badge-success for 10x, badge-warning for parity, badge-info for gap-fill -->

     <div class="scope-grid">
       <div class="scope-col in-scope">
         <h3>In Scope</h3>
         <ul>
           <li>{in-scope item 1}</li>
           <li>{in-scope item 2}</li>
           <!-- one <li> per in_scope item -->
         </ul>
       </div>
       <div class="scope-col out-scope">
         <h3>Out of Scope</h3>
         <ul>
           <li><strong>{item}</strong> — {reason}</li>
           <!-- one <li> per out_of_scope item, with reason -->
         </ul>
       </div>
     </div>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

8. Update state:

```yaml
phase: scope
jobs:
  - when: "{situation/trigger}"
    want: "{action/capability}"
    so: "{desired outcome}"
    rank: 1
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | parity | gap-fill
```
