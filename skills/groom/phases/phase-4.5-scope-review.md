### Phase 4.5: Scope Review

**Review gate pattern:** Follow `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md` for dispatch, collection, fix loop, and escalation mechanics.

<HARD-GATE>
All three reviews (PM, Competitive, EM) are required before drafting issues.
Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If a reviewer's angle doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After scope is confirmed, dispatch **3 parallel subagents** to challenge the scoped initiative before drafting issues. This catches strategic misalignment, competitive blind spots, and technical risks that the strategy check (Phase 2) is too coarse to find.

Use the **Agent tool** to dispatch all three reviewers in a single message (3 parallel Agent tool calls). Each agent must use `model: "opus"`.

**Agent 1: Product Manager**

Dispatch via Agent tool with `subagent_type: "pm:product-manager"` and `model: "opus"`:

```
prompt: |
  Review the scope for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Research: {research_location from groom state}

  Focus: scope review — JTBD clarity, ICP fit, prioritization, scope right-sizing, success criteria.
```

**Agent 2: Competitive Strategist**

Dispatch via Agent tool with `subagent_type: "pm:strategist"` and `model: "opus"`:

```
prompt: |
  Review the scope for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Research: {research_location from groom state}

  Focus: scope review — differentiation, switching motivation, competitive response, non-goal violations, differentiation opportunities.
```

**Agent 3: Engineering Manager**

Dispatch via Agent tool with `subagent_type: "pm:engineering-manager"` and `model: "opus"`:

```
prompt: |
  Review the scope for "{topic}".

  Groom state: .pm/groom-sessions/{slug}.md
  Research: {research_location from groom state}

  Focus: scope review — build-on (existing code), build-new, risks, sequencing advice. Explore the codebase for technical feasibility.
```

After the EM agent completes, present its findings conversationally to the user. The EM review is interactive — invite the user to ask follow-up questions or push back on the assessment before proceeding.

> "The EM reviewed the codebase. Here are the findings: {summary}. Any questions or concerns before we proceed to drafting issues?"

Wait for user confirmation. Capture the EM's key findings for inclusion in the `## Technical Feasibility` section of groomed issues.

**Handling findings:**

1. Merge all three agent outputs. Deduplicate.
2. Fix all **Blocking issues** by adjusting scope (move items to out-of-scope, refine in-scope definitions). **Pushback** and **Opportunities** are advisory.
3. If blocking issues were fixed, re-dispatch reviewers (max 3 iterations).
4. If iteration 3 still has blocking issues, present to user for decision.
5. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Scope Review"
   - `{STEPPER_HTML}`: `scope-review` as current; `intake` through `scope` as completed
   - `{CONTENT}`: Build from the merged review outputs:

     ```html
     <h2>Scope Review</h2>

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
     </div>

     <h3>Blocking Issues</h3>
     <ol>
       <li>{blocking issue 1} — {why}</li>
       <!-- one <li> per blocking issue, or <p>None</p> if all resolved -->
     </ol>

     <details>
       <summary>Advisory Items ({count})</summary>
       <ul>
         <li>{advisory 1}</li>
         <!-- one <li> per advisory/pushback/opportunity item -->
       </ul>
     </details>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.

6. Update state:

```yaml
phase: scope-review
scope_review:
  pm_verdict: ship-it | ship-if | rethink-scope | wrong-priority
  competitive_verdict: strengthens | strengthens-if | neutral | weakens
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting
  blocking_issues_fixed: 0
  iterations: 1
```
