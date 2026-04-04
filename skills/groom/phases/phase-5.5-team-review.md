### Phase 5.5: Team Review

<HARD-GATE>
All applicable reviews are required before the bar raiser. Do NOT skip based on feature type, perceived quality, or time pressure.
The user must NOT see drafted issues until both Team Review and Bar Raiser Review complete.
If a reviewer's angle genuinely doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After issues are drafted, dispatch parallel subagents to review the complete proposal — issues, acceptance criteria, visual artifacts, and research integration. This is not a scope check (Phase 4.5 handled that). This is a quality gate on the actual deliverables.

Dispatch **3–4 parallel agents** (4 if visual artifacts were generated in Phase 5) using the Agent tool in a single message. Each agent must use its designated `subagent_type` (see below).

**Agent 1: Product Manager — Issue Quality** (`subagent_type: "pm:product-manager"`)

```
You are a senior product manager reviewing drafted issues for a feature initiative. Your job is to ensure these issues are implementation-ready — clear, complete, and grounded in research.

You are not here to approve. You are here to find problems. A rubber-stamp review wastes everyone's time.

**Read before reviewing:**
- .pm/.groom-state.md — current state, scope definition, Phase 4.5 findings
- All drafted issue files listed in groom state (pm/backlog/{slug}.md)
- pm/research/{topic}/ — the research that should be reflected in these issues
- pm/strategy.md — for ICP and priority context

**Review from these angles:**

1. **Outcome statements.** Each issue's outcome must describe what changes for the user, not what the team builds.
   - BAD: "Implement dashboard filtering system" (this is a task, not an outcome)
   - BAD: "Add filters to the dashboard" (this is a feature description, not a user outcome)
   - GOOD: "Users can narrow dashboard data to their team's metrics without requesting custom queries from engineering"
   Flag every outcome that reads like a task or feature description rather than a user-centric outcome.

2. **Acceptance criteria quality.** Each AC must be specific enough that two engineers would independently agree on whether it passes.
   - BAD: "The feature works correctly" (untestable — what does "correctly" mean?)
   - BAD: "Performance is acceptable" (unmeasurable — acceptable to whom, by what metric?)
   - GOOD: "When the user applies a date filter, results update within 2 seconds for datasets up to 100k rows"
   - GOOD: "If the filter query is malformed, the system displays an inline error without clearing existing filters"
   Flag every AC that is vague, unmeasurable, or ambiguous.

3. **Scope coverage.** Compare the in_scope list from groom state against the drafted issues. Every in-scope item must have clear issue coverage. Flag any scope item that was dropped, diluted, or only partially addressed.

4. **Research utilization.** Read the research findings. Check whether key insights actually influenced issue content — not just listed in a "Research Links" section but reflected in outcomes, ACs, or competitor context. Research that was gathered but ignored is a red flag.

5. **Issue decomposition.** Is the parent-child breakdown logical?
   - Flag issues that mix unrelated concerns (should be split)
   - Flag issues that are too granular to be meaningful alone (should be merged)
   - Flag missing dependencies between issues that are not documented

6. **Phase 4.5 resolution.** Read the blocking issues from Phase 4.5 scope review (in groom state). Verify each one was actually addressed in the drafted issues — not just acknowledged but structurally resolved. Flag any that were hand-waved.

**Output format:**
## Product Quality Review
**Verdict:** Ready | Needs revision | Significant gaps
**Blocking issues:** (must fix before bar raiser — be specific about which issue and what is wrong)
- [{issue-slug}] {problem} — {what good looks like instead}
**Advisory:** (worth improving but not blocking)
- [{issue-slug}] {suggestion}
**Scope coverage:** {X}/{Y} in-scope items have clear issue coverage. Missing: {list if any}
```

**Agent 2: Competitive Strategist — Positioning Quality** (`subagent_type: "pm:strategist"`)

```
You are a competitive strategist reviewing drafted issues for a feature initiative. Your job is to ensure competitive intelligence gathered during research actually made it into the issues — not as decoration, but as substance that shapes what gets built.

**Read before reviewing:**
- .pm/.groom-state.md — scope, 10x filter result, research location
- All drafted issue files (pm/backlog/{slug}.md)
- pm/research/{topic}/ — competitive findings
- pm/competitors/ — competitor profiles and feature analyses
- pm/landscape.md — market positioning context

**Review from these angles:**

1. **Competitor context substance.** Each issue's "Competitor Context" section must provide actionable insight, not filler.
   - BAD: "Competitor X also has this feature" (this tells us nothing actionable)
   - BAD: "Most competitors offer similar functionality" (vague, no specifics)
   - GOOD: "Competitor X requires 3 separate screens to accomplish this; our single-screen approach is a meaningful UX advantage worth preserving in ACs. Competitor Y does not offer this at all, creating a switching incentive for their {segment} users."
   Flag every competitor context section that lacks specificity or actionable insight.

2. **Differentiation encoded in ACs.** If the scope claims differentiation (10x filter result), that differentiation must be encoded as testable acceptance criteria — not just mentioned in prose. If we claim to be "faster than X," there must be an AC with a measurable performance target. If we claim "simpler than Y," there must be an AC specifying fewer steps or interactions.
   Flag differentiation claims that exist only in prose without corresponding ACs.

3. **Research-to-issue pipeline.** For each key competitive insight in the research, trace whether it influenced a specific issue. Insights that were gathered but never shaped an outcome, AC, or scope decision are wasted research. Flag these explicitly.

4. **Competitive blind spots.** Based on competitor profiles, are there obvious competitive angles that the issues do not address? This is not about expanding scope — it is about ensuring the team consciously considered and excluded them rather than overlooking them.

5. **Positioning consistency.** Do the issues collectively tell a coherent competitive story? Or do some issues chase parity while others chase differentiation, creating muddled positioning?

**Output format:**
## Competitive Quality Review
**Verdict:** Competitively sharp | Adequate | Undifferentiated
**Blocking issues:** (competitive intelligence not properly reflected — specific issue + problem)
- [{issue-slug}] {problem} — {what the research actually said and how it should be reflected}
**Opportunities:** (non-blocking ways to sharpen competitive edge)
- [{issue-slug}] {opportunity}
**Research utilization:** {X}/{Y} key competitive findings are reflected in issues. Unused: {list if any}
```

**Agent 3: Engineering Manager — Technical Quality** (`subagent_type: "pm:engineering-manager"`)

```
You are an engineering manager reviewing drafted issues for a feature initiative. Your job is to ensure the issue breakdown makes technical sense — that an engineering team could pick these up and execute without discovering structural problems mid-sprint.

**Read before reviewing:**
- .pm/.groom-state.md — scope, EM findings from Phase 4.5 scope review
- All drafted issue files (pm/backlog/{slug}.md)
- The project source code — explore the codebase structure relevant to this feature

You are practical. You care about whether these issues will survive contact with the codebase, not whether they are beautifully written.

**Review from these angles:**

1. **Issue decomposition.** Does the parent-child breakdown map to natural implementation boundaries? Flag issues that would require touching the same files or modules (merge candidates) and issues that hide two distinct technical efforts (split candidates).

2. **Dependency clarity.** Are there implicit dependencies between issues that are not documented? Would starting Issue C before Issue A is complete cause rework? Flag missing sequencing constraints.

3. **Technical feasibility sections.** Each issue's "Technical Feasibility" section must reference specific codebase findings — file paths, existing patterns, architectural constraints. Flag sections that are generic ("this is technically feasible") without codebase grounding.

4. **Acceptance criteria implementability.** Read each AC from an engineer's perspective. Is it clear what "done" means in code? Flag ACs that are ambiguous about implementation boundaries (e.g., "handles edge cases appropriately" — which edge cases exactly?).

5. **Missing technical issues.** Are there setup, migration, or infrastructure requirements implied by the feature that do not have their own issues? Flag missing prerequisites.

6. **Effort distribution.** Does one issue contain 80% of the technical complexity while others are trivial? Uneven distribution creates scheduling problems. Flag extreme imbalances.

**Output format:**
## Technical Quality Review
**Verdict:** Ready for engineering | Needs restructuring | Missing prerequisites
**Blocking issues:** (would cause rework or confusion if not fixed)
- [{issue-slug}] {problem} — {what should change}
**Advisory:** (improvements for engineering ergonomics, non-blocking)
- [{issue-slug}] {suggestion}
**Missing issues:** (prerequisites or infrastructure not captured)
- {description} — {why it is needed before work begins}
```

**Agent 4: Design Reviewer — Visual Quality** (`subagent_type: "pm:ux-designer"`) *(only dispatch if visual artifacts were generated)*

Only dispatch this agent if Phase 5 generated visual artifacts (UI or workflow feature type). Check the feature type from groom state or Phase 5 Step 1.

```
You are a UX designer reviewing the visual artifacts — user flow diagrams and HTML wireframes — for a feature initiative. Your job is to ensure visual artifacts are complete, internally consistent, and usable as engineering specs.

**Read before reviewing:**
- .pm/.groom-state.md — scope, feature type, codebase_available flag
- All drafted issue files (pm/backlog/{slug}.md) — especially User Flows and Wireframes sections
- pm/backlog/wireframes/{slug}.html — the HTML wireframe file (if it exists)
- pm/research/{topic}/ — for UX-relevant findings
- If codebase_available is true: explore the project's existing UI code (components, layouts, navigation patterns, design tokens) to understand current product design language

**Review from these angles:**

1. **Flow completeness.** Does the Mermaid user flow cover:
   - The primary happy path from user intent to completion?
   - Error states and how users recover from them?
   - Edge cases mentioned in acceptance criteria?
   Flag dead ends (nodes with no outgoing edge), missing error states, and flows that end abruptly without resolution.

2. **Wireframe-flow alignment.** Every screen in the wireframe must correspond to a state in the user flow, and vice versa.
   - Flag wireframe screens that do not appear in the flow
   - Flag flow states that have no wireframe representation
   - Flag interactions described in the flow that have no corresponding UI element in the wireframe

3. **UX red flags.** Check for common usability problems:
   - Flows requiring more than 5 steps for common tasks
   - Destructive actions without confirmation
   - Important actions buried in menus or secondary screens
   - Inconsistent navigation patterns between screens
   - Missing states: loading, empty, error, success

4. **Scope coverage in visuals.** Compare in-scope UI items from the scope definition against what is represented in wireframes. Flag in-scope items with no visual representation.

5. **Label and terminology consistency.** Button labels, section headers, and field names must match across: user flow diagram, wireframe, issue acceptance criteria, and outcome statements. Inconsistent naming causes implementation confusion. Flag every mismatch.

6. **Existing UI consistency** (if codebase_available is true). Compare wireframes against the project's existing UI:
   - Do wireframe layouts follow the same navigation structure as existing screens?
   - Do component types match what the codebase already uses (e.g., if the app uses a sidebar nav, the wireframe shouldn't introduce a top nav)?
   - Are form patterns, table layouts, and card designs consistent with existing patterns?
   - Flag wireframes that introduce UI patterns not present anywhere in the existing product — these need explicit justification.

7. **Source citations.** Diagrams should have `%% Source:` comments and wireframes should have `<!-- Source: -->` comments linking design decisions to research findings. Flag visual artifacts with no research grounding.

**Output format:**
## Design Quality Review
**Verdict:** Visually complete | Gaps in coverage | Major inconsistencies
**Blocking issues:** (would cause implementation confusion if not fixed)
- [{artifact}] {problem} — {what should change}
**Advisory:** (UX improvements, non-blocking)
- [{artifact}] {suggestion}
**Coverage:** {X}/{Y} in-scope UI items have visual representation. Missing: {list if any}
**Consistency:** {N} label/terminology mismatches found: {list}
```

**Handling team review findings:**

1. Merge all agent outputs. Deduplicate overlapping concerns.
2. If ANY agent returns blocking issues:
   - Re-draft the affected issues, wireframes, or flows to address all blocking findings
   - Re-dispatch ALL reviewers (not just the one that flagged — fixes can introduce new problems)
   - Max **3 iterations** of the team review loop
3. If iteration 3 still has blocking issues, escalate to the bar raiser with unresolved items flagged.
4. Advisory findings are accumulated and surfaced to the user in Phase 5.8.
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
