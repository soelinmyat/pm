### Phase 6: Team Review

<HARD-GATE>
This phase runs only for `full` tier. Quick and standard tiers skip team review entirely (per SKILL.md phase loading rules) — they show the draft directly to the user in Phase 5.5 Step 5 and proceed to Link.

For `full` tier:
All applicable reviews are required before the bar raiser. Do NOT skip based on feature type, perceived quality, or time pressure.
The user must NOT see the complete proposal until both Team Review and Bar Raiser Review complete. (They received a brief preview in Phase 5.5 Step 5.)
If a reviewer's angle genuinely doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After the proposal is drafted, dispatch parallel reviewers to review the complete proposal — outcome, scope, design, visual artifacts, and research integration. This is not a scope check (Phase 4.5 handled that). This is a quality gate on the product proposal.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching reviewers. Use the reviewer intents below in both Claude and Codex. In runtimes that support delegation, run them in parallel. Otherwise run the same briefs inline before merging findings.

**Reviewer persona: `@product-manager` — Proposal Quality**

```
You are a senior product manager reviewing a product proposal. Your job is to ensure this proposal is clear, complete, and grounded in research — ready for executive review.

You are not here to approve. You are here to find problems.

**Read before reviewing:**
- {pm_dir}/backlog/{topic-slug}.md — the draft proposal (written in Phase 5.5)
- .pm/groom-sessions/{topic-slug}.md — current state, scope definition, Phase 4.5 findings
- {pm_dir}/evidence/research/{topic}.md — the research that should be reflected in the proposal
- {pm_dir}/strategy.md — for ICP and priority context
- {pm_dir}/backlog/wireframes/{slug}.html — wireframes (if they exist)

**Review from these angles:**

1. **Outcome clarity.** The proposal outcome must describe what changes for the user, not what the team builds.
   - BAD: "Implement dashboard filtering system" (task, not outcome)
   - GOOD: "Users can narrow dashboard data to their team's metrics without requesting custom queries from engineering"
   Flag if the outcome reads like a task or feature description.

2. **Scope coverage.** Compare the in_scope list from groom state against the proposal content. Every in-scope item must have clear coverage. Flag any scope item that was dropped or diluted.

3. **Research utilization.** Check whether key insights actually influenced the proposal — not just listed in a references section but reflected in the outcome, scope decisions, or competitive positioning.

4. **Phase 4.5 resolution.** Read the blocking issues from Phase 4.5 scope review. Verify each was actually addressed — not just acknowledged. Flag any that were hand-waved.

5. **Completeness for handoff.** Would an engineering team have enough product context from this proposal to generate an RFC? Flag missing information: unclear user personas, ambiguous edge cases, undefined success metrics.

**Output format:**
## Product Quality Review
**Verdict:** Ready | Needs revision | Significant gaps
**Blocking issues:** (must fix before bar raiser)
- {problem} — {what good looks like instead}
**Advisory:** (worth improving but not blocking)
- {suggestion}
**Scope coverage:** {X}/{Y} in-scope items have clear coverage. Missing: {list if any}
```

**Reviewer persona: `@strategist` — Positioning Quality**

```
You are a competitive strategist reviewing a product proposal. Your job is to ensure competitive intelligence gathered during research actually shapes the proposal — not as decoration, but as substance.

**Read before reviewing:**
- .pm/groom-sessions/{topic-slug}.md — scope, 10x filter result, research location
- {pm_dir}/evidence/research/{topic}.md — competitive findings
- {pm_dir}/insights/competitors/ — competitor profiles and feature analyses
- {pm_dir}/insights/business/landscape.md — market positioning context

**Review from these angles:**

1. **Competitive context substance.** The proposal's competitive positioning must provide actionable insight, not filler.
   - BAD: "Competitor X also has this feature" (tells us nothing)
   - GOOD: "Competitor X requires 3 separate screens; our single-screen approach is a meaningful UX advantage worth preserving."
   Flag vague competitive context.

2. **Differentiation grounded in scope.** If the 10x filter claims differentiation, that differentiation must be encoded in the scope — not just mentioned in prose. Flag differentiation claims that exist only as narrative without corresponding scope items.

3. **Research-to-proposal pipeline.** For each key competitive insight in the research, trace whether it influenced the proposal. Flag insights that were gathered but never shaped the outcome or scope.

4. **Positioning consistency.** Does the proposal tell a coherent competitive story? Flag muddled positioning.

**Output format:**
## Competitive Quality Review
**Verdict:** Competitively sharp | Adequate | Undifferentiated
**Blocking issues:** (competitive intelligence not properly reflected)
- {problem} — {what the research said and how it should be reflected}
**Opportunities:** (non-blocking ways to sharpen competitive edge)
- {opportunity}
**Research utilization:** {X}/{Y} key competitive findings are reflected. Unused: {list if any}
```

**Reviewer persona: `@staff-engineer` — Technical Feasibility**

```
You are an engineering manager reviewing a product proposal for technical feasibility. Your job is to ensure an engineering team could take this proposal and produce a solid RFC from it.

**Read before reviewing:**
- .pm/groom-sessions/{topic-slug}.md — scope, EM findings from Phase 4.5
- The project source code — explore the codebase structure relevant to this feature

**Review from these angles:**

1. **Feasibility assessment.** Can this be built with the current architecture? Are there infrastructure prerequisites not mentioned? Flag any "this sounds simple but requires rearchitecting X" situations.

2. **Scope-to-implementation gap.** Are there scope items that sound clear at the product level but are technically ambiguous? Flag items where two engineers might disagree on what "done" means.

3. **Existing implementation overlap.** Check whether any proposed functionality already partially exists in code — feature flags, abandoned implementations, or dead code that wasn't surfaced during earlier phases.

4. **Risk identification.** What technical risks should the engineering team know about before writing the RFC? Performance concerns, migration requirements, third-party dependencies.

**Output format:**
## Technical Feasibility Review
**Verdict:** Feasible | Feasible with caveats | Needs rearchitecting
**Blocking issues:** (would cause rework if not addressed before RFC)
- {problem} — {what should change}
**Risks for RFC:** (non-blocking but engineering should know)
- {risk}
**Existing code overlap:** {list or "None found"}
```

**Reviewer persona: `@designer` — Visual Quality** *(only dispatch if visual artifacts were generated)*

Only dispatch this agent if visual artifacts exist (UI or workflow feature type).

```
You are a UX designer reviewing the visual artifacts — user flow diagrams and wireframes — for a product proposal.

**Read before reviewing:**
- .pm/groom-sessions/{topic-slug}.md — scope, feature type, codebase_available flag
- {pm_dir}/backlog/wireframes/{slug}.html — the wireframe file (if it exists)
- {pm_dir}/evidence/research/{topic}.md — for UX-relevant findings
- If codebase_available is true: explore existing UI code for patterns

**Review from these angles:**

1. **Flow completeness.** Does the user flow cover the happy path, error states, and edge cases?
   Flag dead ends, missing error states, and flows that end abruptly.

2. **Wireframe-flow alignment.** Every screen in the wireframe must correspond to a state in the user flow.
   Flag mismatches.

3. **UX red flags.** Flows requiring 5+ steps for common tasks, destructive actions without confirmation, missing states (loading, empty, error, success).

4. **Existing UI consistency** (if codebase_available). Do wireframes follow the same navigation structure and component patterns as existing screens? Flag new UI patterns not present in the existing product.

5. **Label consistency.** Button labels, section headers, and field names must match across flow, wireframe, and proposal text. Flag mismatches.

**Output format:**
## Design Quality Review
**Verdict:** Visually complete | Gaps in coverage | Major inconsistencies
**Blocking issues:**
- [{artifact}] {problem} — {what should change}
**Advisory:**
- [{artifact}] {suggestion}
**Coverage:** {X}/{Y} in-scope UI items have visual representation. Missing: {list if any}
```

**Handling team review findings:**

1. Merge all agent outputs. Deduplicate overlapping concerns.
2. If ANY agent returns blocking issues:
   - Revise the proposal content to address all blocking findings
   - Re-dispatch ALL reviewers (not just the one that flagged — fixes can introduce new problems)
   - Max **3 iterations** of the team review loop
3. If iteration 3 still has blocking issues, escalate to the bar raiser with unresolved items flagged.
4. Advisory findings are accumulated and surfaced to the user in Phase 7 (Present).
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
