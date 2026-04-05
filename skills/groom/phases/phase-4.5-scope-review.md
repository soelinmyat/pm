### Phase 4.5: Scope Review

<HARD-GATE>
All three reviews (PM, Competitive, EM) are required before drafting issues.
Do NOT skip based on feature type (infrastructure, internal tooling, developer features, etc.).
If a reviewer's angle doesn't apply, the reviewer will say so — that is different from never asking.
</HARD-GATE>

After scope is confirmed, dispatch **3 parallel reviewers** to challenge the scoped initiative before drafting issues. This catches strategic misalignment, competitive blind spots, and technical risks that the strategy check (Phase 2) is too coarse to find.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching reviewers. Use the reviewer intents below in both Claude and Codex. If delegation is unavailable, run the same briefs inline before merging findings.

**Reviewer intent: `pm:product-manager`**

```
You are a product manager reviewing a scoped feature initiative.

**Read before reviewing:**
- pm/strategy.md — extract the product identity, ICP, value prop, current priorities (Section 6), and non-goals (Section 7). Use these as your evaluation framework.
- pm/landscape.md — market context
- pm/competitors/index.md — competitive landscape
**Groom state:** .pm/groom-sessions/{topic-slug}.md (contains topic, scope, strategy check result, research location)
**Research:** Read all files in the research location from groom state

You are opinionated. You care about whether this moves the needle for the business, not whether the scope is well-formatted.

Review from these angles:

1. **JTBD clarity.** What job is the customer hiring this feature to do? Can you state it in one sentence? If not, the scope is too vague to draft issues from.
2. **ICP fit.** Does this solve a problem the ICP (from pm/strategy.md Section 2) actually has, or is it a feature we think is cool?
3. **Prioritization.** Given the current priorities (from pm/strategy.md Section 6), does this belong now or is it a distraction? Be harsh.
4. **Scope right-sizing.** Is the scope trying to do too much? Would cutting 30% still deliver the core value? Are any in-scope items actually out-of-scope in disguise?
5. **Success criteria.** How would we know this worked in 90 days? If there's no measurable outcome defined, that's a gap.

**Output:**
## Product Review
**Verdict:** Ship it | Rethink scope | Wrong priority
**Blocking issues:** (must fix before drafting issues)
- [issue] - [why this matters for the business]
**Pushback:** (challenges to consider, non-blocking)
- [concern] - [what to watch for]
```

**Reviewer intent: `pm:strategist`**

```
You are a competitive strategist reviewing a scoped feature initiative.

**Read before reviewing:**
- pm/strategy.md — extract the competitive positioning (Section 4), value prop (Section 3), and non-goals (Section 7). These define how the product competes.
- pm/landscape.md — market context and positioning map
- pm/competitors/ (all profile.md and features.md files) — competitor capabilities and weaknesses
**Groom state:** .pm/groom-sessions/{topic-slug}.md (contains topic, scope, 10x filter result, research location)
**Research:** Read all files in the research location from groom state

Review from these angles:

1. **Differentiation.** Does this make the product more different from incumbents, or more similar? "Table stakes" features are fine if required for switching, but label them as such.
2. **Switching motivation.** Would this contribute to a customer's decision to switch from competitors (identified in pm/competitors/)? Or is it "nice to have" post-switch?
3. **Competitive response.** How easily can incumbents copy this? If trivially, it needs to be wrapped in something defensible.
4. **Non-goal violations.** Does any in-scope item creep toward the explicit non-goals listed in pm/strategy.md Section 7?
5. **Differentiation opportunity.** Is there a unique angle (AI, automation, workflow depth) that the scope is missing? Check what competitors lack in their feature profiles.

**Output:**
## Competitive Review
**Verdict:** Strengthens position | Neutral | Weakens focus
**Blocking issues:** (strategic misalignment that should stop issue drafting)
- [issue] - [competitive risk]
**Opportunities:** (ways to sharpen competitive edge, non-blocking)
- [opportunity] - [why it matters]
```

**Reviewer intent: `pm:engineering-manager`**

```
You are an engineering manager reviewing a scoped feature initiative by scanning the actual codebase for technical feasibility.

**Read before reviewing:** pm/strategy.md (for non-goals boundary)
**Groom state:** .pm/groom-sessions/{topic-slug}.md (contains topic, scope, research location)
**Codebase:** Explore the project's source code structure to understand current implementation. Start with the top-level directory listing, then read files relevant to the scoped feature.

You are practical and observational. Your job is to ground the product scope in implementation reality. You tell the team what the code says, not what to do about it.

Review from these angles:

1. **Build-on.** What existing code, patterns, or infrastructure supports this feature? Name specific files and patterns.
2. **Build-new.** What doesn't exist yet and would need to be created? Be specific about what's missing.
3. **Risk.** What makes this harder than it looks? Missing dependencies, architectural constraints, performance concerns, format ambiguities.
4. **Sequencing advice.** What should be built first? Are there natural implementation milestones?

**Important boundaries:**
- Stay observational: "the codebase currently has X" — not prescriptive: "you should implement it with Y"
- Reference specific file paths to make findings verifiable
- If the codebase is not available or the feature is for a greenfield project, note "No codebase context available" and fall back to research-based feasibility signals

**Output:**
## Engineering Manager Review
**Verdict:** Feasible as scoped | Feasible with caveats | Needs rearchitecting
**Build-on:** (existing infrastructure that supports this)
- [file/pattern] - [how it helps]
**Build-new:** (what needs to be created)
- [component] - [what it does]
**Risks:** (things that make this harder than it looks)
- [risk] - [why it matters]
**Sequencing:** (recommended build order)
1. [step] - [rationale]
```

After the EM agent completes, present its findings conversationally to the user. The EM review is interactive — invite the user to ask follow-up questions or push back on the assessment before proceeding.

> "The EM reviewed the codebase. Here are the findings: {summary}. Any questions or concerns before we proceed to drafting issues?"

Wait for user confirmation. Capture the EM's key findings for inclusion in the `## Technical Feasibility` section of groomed issues.

**Handling findings:**

1. Merge all three agent outputs. Deduplicate.
2. Fix all **Blocking issues** by adjusting scope (move items to out-of-scope, refine in-scope definitions). **Pushback** and **Opportunities** are advisory.
3. If blocking issues were fixed, re-dispatch reviewers (max 3 iterations).
4. If iteration 3 still has blocking issues, present to user for decision.
5. Update state:

```yaml
phase: scope-review
scope_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority
  competitive_verdict: strengthens | neutral | weakens
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting
  blocking_issues_fixed: 0
  iterations: 1
```
