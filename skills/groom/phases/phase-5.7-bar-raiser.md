### Phase 6.5: Bar Raiser Review

**Review gate pattern:** Follow `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md` for dispatch, collection, fix loop, and escalation mechanics.

<HARD-GATE>
The bar raiser review is required before presenting to the user. Do NOT skip based on team review results, time pressure, or perceived quality.
The bar raiser must NOT read team review findings — independent assessment is the entire point.
</HARD-GATE>

After the team review converges (no blocking issues or max iterations reached), dispatch a single bar raiser agent for a senior-level holistic review. The bar raiser has not been involved in the iterative process and brings fresh eyes.

Dispatch **1 agent** using the Agent tool with `model: "opus"`. The bar raiser performs the most judgment-heavy assessment in the pipeline — narrative coherence, ambition calibration, cross-cutting concerns — and benefits from stronger reasoning. If `.pm/config.json` has `agents.bar_raiser_model` set, use that model instead.

**Agent: Product Director — Bar Raiser**

Dispatch via Agent tool with `subagent_type: "pm:product-director"` and `model: "opus"`:

```
prompt: |
  Bar raiser review for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md (read ONLY: topic, scope, research_location, codebase_available — do NOT read review sections)
  Issues: pm/backlog/{slug}.md
  Wireframes: pm/backlog/wireframes/{slug}.html (if exists)
  Research: {research_location from groom state}
  Existing backlog: pm/backlog/*.md (for overlap check)

  Focus: bar raiser — narrative coherence, ambition calibration, "so what" test, cross-cutting concerns, executive anticipation, conviction check. Fresh eyes, independent assessment.
```

**Handling bar raiser findings:**

1. If verdict is **"Ready to present"**: proceed to Phase 7 (Present).
2. If verdict is **"Ready if {condition}"**: persist the condition in `bar_raiser.conditions` in the state file. If the bar raiser also lists blocking issues, those must be fixed first (treat as "Send back" until resolved, then re-assess). If no blocking issues, treat as "Ready to present" and surface the condition to the user in Phase 7 as an open item requiring acknowledgment before approval.
3. If verdict is **"Send back to team"**:
   - Address the bar raiser's blocking issues by revising the affected issues
   - Re-run Phase 6 (Team Review) with the revised issues — the team must validate the fixes
   - After team review converges, re-run the bar raiser
   - Max **2 bar raiser iterations**. If iteration 2 still returns "Send back," present to the user with unresolved concerns flagged.
4. If verdict is **"Pause initiative"**: present the bar raiser's assessment to the user immediately.
   > "The bar raiser recommends pausing this initiative. Rationale: {rationale}. How would you like to proceed?"
   Wait for user decision before continuing.
5. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Bar Raiser"
   - `{STEPPER_HTML}`: `bar-raiser` as current; `intake` through `team-review` as completed
   - `{CONTENT}`:

     ```html
     <h2>Bar Raiser Review</h2>
     <p>Iteration {N} of 2</p>

     <div class="verdict-row">
       <div class="verdict-card" style="flex:none;min-width:200px;">
         <div class="role">Product Director</div>
         <div class="verdict">{verdict}</div>
       </div>
     </div>

     <!-- Show conditions only if verdict is "Ready if {condition}" -->
     <h3>Conditions</h3>
     <ul>
       <li>{condition text}</li>
     </ul>

     <!-- Show blocking issues if verdict is "Send back" or has blocking items -->
     <h3>Blocking Issues</h3>
     <ol>
       <li>{issue} — {why}</li>
       <!-- or <p>None</p> -->
     </ol>

     <h3>Conviction</h3>
     <p>{bar raiser's honest assessment}</p>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

6. Update state:

```yaml
phase: bar-raiser
bar_raiser:
  verdict: ready | ready-if | send-back | pause
  iterations: {count}
  blocking_issues_fixed: {count}
```
