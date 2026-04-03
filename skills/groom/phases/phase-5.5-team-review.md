### Phase 5.5: Team Review

**Review gate pattern:** Follow `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md` for dispatch, collection, fix loop, and escalation mechanics.

<HARD-GATE>
All applicable reviews are required before the bar raiser. Do NOT skip based on feature type, perceived quality, or time pressure.
The user must NOT see drafted issues until both Team Review and Bar Raiser Review complete.
If a reviewer's angle genuinely doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After issues are drafted, dispatch parallel subagents to review the complete proposal — issues, acceptance criteria, visual artifacts, and research integration. This is not a scope check (Phase 4.5 handled that). This is a quality gate on the actual deliverables.

Dispatch **3–4 parallel agents** (4 if visual artifacts were generated in Phase 5) using the Agent tool in a single message. Each agent must use `model: "opus"`.

**Agent 1: Product Manager — Issue Quality**

Dispatch via Agent tool with `subagent_type: "pm:product-manager"` and `model: "opus"`:

```
prompt: |
  Review the drafted issues for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Issues: pm/backlog/{slug}.md
  Research: {research_location from groom state}

  Focus: issue quality review — outcome statements, AC quality, scope coverage, research utilization, issue decomposition, Phase 4.5 resolution.
```

**Agent 2: Competitive Strategist — Positioning Quality**

Dispatch via Agent tool with `subagent_type: "pm:strategist"` and `model: "opus"`:

```
prompt: |
  Review the drafted issues for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Issues: pm/backlog/{slug}.md
  Research: {research_location from groom state}

  Focus: positioning quality review — competitor context substance, differentiation encoded in ACs, research-to-issue pipeline, competitive blind spots, positioning consistency.
```

**Agent 3: Engineering Manager — Technical Quality**

Dispatch via Agent tool with `subagent_type: "pm:engineering-manager"` and `model: "opus"`:

```
prompt: |
  Review the drafted issues for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Issues: pm/backlog/{slug}.md

  Focus: technical quality review — issue decomposition, dependency clarity, technical feasibility sections, AC implementability, missing technical issues, effort distribution. Explore the codebase.
```

**Agent 4: UX Designer — Visual Quality** *(only dispatch if visual artifacts were generated)*

Only dispatch this agent if Phase 5 generated visual artifacts (UI or workflow feature type). Check the feature type from groom state or Phase 5 Step 1.

Dispatch via Agent tool with `subagent_type: "pm:ux-designer"` and `model: "opus"`:

```
prompt: |
  Review the visual artifacts for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Issues: pm/backlog/{slug}.md
  Wireframes: pm/backlog/wireframes/{slug}.html
  Research: {research_location from groom state}

  Focus: visual artifact review — flow completeness, wireframe-flow alignment, UX red flags, scope coverage in visuals, label consistency, existing UI consistency, source citations.
```

**Handling team review findings:**

**Conditional verdicts:** If a reviewer returns a "Ready if {condition}" (or equivalent) verdict, treat it as non-blocking but persist the condition text in the state file under `team_review.conditions`. Surface all accumulated conditions to the bar raiser and the user in Phase 5.8 as open items requiring acknowledgment. Conditions survive context compression because they live in the state file, not just conversation history.

1. Merge all agent outputs. Deduplicate overlapping concerns.
2. If ANY agent returns blocking issues:
   - Re-draft the affected issues, wireframes, or flows to address all blocking findings
   - Re-dispatch ALL reviewers (not just the one that flagged — fixes can introduce new problems)
   - Max **3 iterations** of the team review loop
3. If iteration 3 still has blocking issues, escalate to the bar raiser with unresolved items flagged.
4. Advisory findings are accumulated and surfaced to the user in Phase 5.8.
5. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Team Review"
   - `{STEPPER_HTML}`: `team-review` as current; `intake` through `groom` as completed
   - `{CONTENT}`:

     ```html
     <h2>Team Review</h2>
     <p>Iteration {N} of 3</p>

     <div class="verdict-row">
       <div class="verdict-card">
         <div class="role">Product Manager</div>
         <div class="verdict">{pm_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Competitive Strategist</div>
         <div class="verdict">{competitive_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Engineering Manager</div>
         <div class="verdict">{em_verdict}</div>
       </div>
       <!-- Include Design card only if design reviewer was dispatched -->
       <div class="verdict-card">
         <div class="role">Design Reviewer</div>
         <div class="verdict">{design_verdict}</div>
       </div>
     </div>

     <h3>Blocking Issues</h3>
     <ol>
       <li>{blocking issue 1}</li>
       <!-- or <p>None — all resolved</p> -->
     </ol>

     <details>
       <summary>Advisory Items ({count})</summary>
       <ul>
         <li>{advisory 1}</li>
       </ul>
     </details>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

6. Update state:

```yaml
phase: team-review
team_review:
  pm_verdict: ready | ready-if | needs-revision | significant-gaps
  competitive_verdict: sharp | sharp-if | adequate | undifferentiated
  em_verdict: ready | ready-if | needs-restructuring | missing-prerequisites
  design_verdict: complete | complete-if | gaps | inconsistencies | null
  blocking_issues_fixed: {count}
  iterations: {count}
```
