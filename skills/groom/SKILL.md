---
name: groom
description: "Use when doing product discovery, feature grooming, or turning a product idea into structured issues. Orchestrates strategy check, research, scoping, and issue creation. Triggers on 'groom,' 'feature idea,' 'product discovery,' 'scope this,' 'create issues for.'"
---

# pm:groom

## Purpose

Orchestrate the full product discovery lifecycle: from raw idea to structured, research-backed issues ready for the sprint.

Research gates grooming. Strategy gates scoping. Neither is optional.

---

## Resume Check

Before doing anything else, check if `.pm/.groom-state.md` exists.

If it does, read it and say:

> "Found an in-progress grooming session for '{topic}' (last updated: {updated}, current phase: {phase}).
> Resume from {phase}, or start fresh?"

Wait for the user's answer. If resuming: skip completed phases. If starting fresh: delete the state file, then begin Phase 1.

---

## Lifecycle: intake -> strategy check -> research -> scope -> product & competitive review -> groom -> link

---

### Phase 1: Intake

1. Ask: "What's the idea? Describe the problem, who it affects, and why it matters now."
   One question. Wait for the full answer.

2. Clarify if needed:
   - Problem vs. solution: is this a user pain or a proposed feature?
   - Scope signal: is this a small UX improvement or a new capability area?
   - Why now: is there a trigger (competitor move, user request spike, strategic priority)?

3. Check `pm/research/` for existing context on this topic. If relevant findings exist, note them:
   > "Found related research at {path}. I'll use it in Phase 3."

4. Derive a topic slug from the idea (kebab-case, max 4 words).

5. Write initial state to `.pm/.groom-state.md`:

```yaml
topic: "{topic}"
phase: intake
started: YYYY-MM-DD
updated: YYYY-MM-DD
```

---

### Phase 2: Strategy Check

<HARD-GATE>
Strategy misalignment must be flagged explicitly. Do NOT silently proceed.
If pm/strategy.md is missing, do NOT skip this phase — offer to create it first.
</HARD-GATE>

1. Check if `pm/strategy.md` exists.

   If it does NOT exist:
   > "No strategy doc found. Strategy check requires one. Options:
   > (a) Run /pm:strategy now to create it, then continue grooming
   > (b) Skip strategy check and proceed at your own risk"
   Wait for selection. If (a): invoke pm:strategy, then return here when complete.

2. Read `pm/strategy.md`. Check the idea against:

   **Current priorities** (Section 5): Does this advance the stated top 3 priorities? Or does it pull focus away from them?

   **Explicit non-goals** (Section 6): Does this idea touch anything on the non-goals list?

   **ICP fit** (Section 2): Does the target user match the ICP? Or is this serving a secondary segment?

3. Determine alignment:

   - **Aligned:** Proceed. Note which priority this supports.
   - **Misaligned with non-goal:** STOP. Say:
     > "This conflicts with the explicit non-goal: '{non-goal}'.
     > Proceeding would undermine a deliberate product decision. Proceed anyway?"
     Wait for explicit yes/no. Do not soft-pedal this.
   - **Off-priority but not a non-goal:** Flag it:
     > "This doesn't map to any current top-3 priority. It's not a non-goal, but it
     > competes for focus. Proceed anyway?"

4. Update state:

```yaml
strategy_check:
  status: passed | failed | override | skipped
  checked_against: pm/strategy.md | null
  conflicts: [] | ["{non-goal text}"]
  supporting_priority: "{priority text}" | null
```

---

### Phase 3: Research

1. Invoke `pm:research {topic-slug}` for targeted investigation.
   Brief it on the grooming context: what problem, what user, what's already known.

2. Key questions to answer:
   - How do competitors handle this? (UI patterns, feature depth, limitations)
   - What do users expect based on reviews and community signals?
   - What does internal customer evidence in `pm/research/` say, if `/pm:ingest` has been used?
   - Is there a market signal validating this is a real problem?

3. Wait for research to complete. Do not proceed to Phase 4 until findings are written.

4. Update state:

```yaml
phase: research
research_location: pm/research/{topic-slug}/
```

---

### Phase 4: Scope

Follow the full methodology in `scope-validation.md`.

1. Present the scope definition template. Fill it collaboratively with the user:
   - What is explicitly IN scope for this initiative?
   - What is explicitly OUT of scope? (with reasons — prevents scope creep)

2. Apply the 10x filter (from `scope-validation.md`):
   > "Is this meaningfully better than what competitors offer — or incremental parity?"
   Document the filter result explicitly: `10x` | `parity` | `gap-fill`.

3. If the result is `parity`: flag it.
   > "This appears to be feature parity with {competitor}. Parity is a valid reason
   > to build, but not a differentiation story. Note the strategic intent before proceeding."

4. If `visual_companion: true` in `.pm/config.json`: offer the scope grid (impact/effort).
   > "Want a scope grid? I'll plot proposed scope items on impact vs. effort axes."

5. Update state:

```yaml
phase: scope
scope:
  in_scope: []
  out_of_scope: []
  filter_result: 10x | parity | gap-fill
```

---

### Phase 4.5: Product & Competitive Review

After scope is confirmed, dispatch **2 parallel subagents** to challenge the scoped initiative before drafting issues. This catches strategic misalignment and competitive blind spots that the strategy check (Phase 2) is too coarse to find.

Dispatch both in parallel (subagent_type: general-purpose, model: sonnet):

**Agent 1: Product Manager**

```
You are a product manager reviewing a scoped feature initiative for CleanLog, a janitorial operations SaaS targeting mid-market cleaning contractors (10-300 cleaners, multi-site, tight SLAs).

**Read before reviewing:** pm/strategy.md, pm/landscape.md, pm/competitors/index.md
**Groom state:** .pm/.groom-state.md (contains topic, scope, strategy check result, research location)
**Research:** Read all files in the research location from groom state

You are opinionated. You care about whether this moves the needle for the business, not whether the scope is well-formatted.

Review from these angles:

1. **JTBD clarity.** What job is the customer hiring this feature to do? Can you state it in one sentence? If not, the scope is too vague to draft issues from.
2. **ICP fit.** Does this solve a problem our ICP actually has, or is it a feature we think is cool? Would an ops director with 80 cleaners across 12 sites care about this?
3. **Prioritization.** Given our 3 pillars (operational replacement, payroll-readiness, exception-first ops), does this belong in 2026 or is it a distraction? Be harsh.
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

**Agent 2: Competitive Strategist**

```
You are a competitive strategist reviewing a scoped feature initiative for CleanLog.

**Read before reviewing:** pm/strategy.md, pm/landscape.md, pm/competitors/ (all profile.md and features.md files)
**Groom state:** .pm/.groom-state.md (contains topic, scope, 10x filter result, research location)
**Research:** Read all files in the research location from groom state

CleanLog competes on ease of use and reliability, not feature breadth. Our wedge is scheduling + payroll-readiness. Our differentiator is AI-native orchestration (Copilot proposes, system validates, user confirms). No incumbent has shipped meaningful AI features.

Review from these angles:

1. **Differentiation.** Does this make CleanLog more different from incumbents, or more similar? "Table stakes" features are fine if required for switching, but label them as such.
2. **Switching motivation.** Would this contribute to a contractor's decision to switch from JM/Swept/CleanSmarts? Or is it "nice to have" post-switch?
3. **Competitive response.** How easily can incumbents copy this? If trivially, it needs to be wrapped in something defensible.
4. **Non-goal violations.** Does any in-scope item creep toward explicit non-goals (full payroll processing, inventory, procurement, vendor marketplace, enterprise compliance)?
5. **AI-native opportunity.** Is there a Copilot integration angle missing from the scope?

**Output:**
## Competitive Review
**Verdict:** Strengthens position | Neutral | Weakens focus
**Blocking issues:** (strategic misalignment that should stop issue drafting)
- [issue] - [competitive risk]
**Opportunities:** (ways to sharpen competitive edge, non-blocking)
- [opportunity] - [why it matters]
```

**Handling findings:**

1. Merge both agent outputs. Deduplicate.
2. Fix all **Blocking issues** by adjusting scope (move items to out-of-scope, refine in-scope definitions). **Pushback** and **Opportunities** are advisory.
3. If blocking issues were fixed, re-dispatch reviewers (max 3 iterations).
4. If iteration 3 still has blocking issues, present to user for decision.
5. Update state:

```yaml
phase: product-review
product_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority
  competitive_verdict: strengthens | neutral | weakens
  blocking_issues_fixed: 0
  iterations: 1
```

---

### Phase 5: Groom

1. Draft a structured issue set: one parent issue + child issues for discrete work.

   Each issue must contain:
   - **Outcome statement:** What changes for the user when this ships? (not a task description)
   - **Acceptance criteria:** Numbered list. Testable, specific.
   - **Research links:** Paths to relevant findings in `pm/research/`.
   - **Customer evidence:** Include internal evidence count, affected segment, or source theme when available.
   - **Competitor context:** How competitors handle this, with specific references from Phase 3.
   - **Scope note:** Which in-scope items this issue covers.

2. Present the full draft set to the user before creating anything:
   > "Here are the proposed issues. Review them — are any missing, redundant, or
   > incorrectly scoped? I'll create them once you approve."

   If `visual_companion: true`: render issue preview cards (title, outcome, AC count, labels).

3. Wait for explicit approval. Accept edits inline.

4. Update state:

```yaml
phase: groom
issues:
  - slug: "{issue-slug}"
    title: "{title}"
    status: drafted
```

---

### Phase 6: Link (optional)

1. Check if Linear is configured (`.pm/config.json` has `linear: true` or Linear MCP is available).

2. **If Linear configured:**
   - Create parent issue first. Capture the Linear ID.
   - Create child issues, linking each to the parent.
   - Add research artifact links as attachments or description links.
   - Say: "Issues created in Linear. Parent: {ID}. Children: {IDs}."

3. **If no Linear:**
   - Write each issue to `pm/backlog/{issue-slug}.md` (see Backlog Issue Format below).
   - Link child issues to parent via `parent:` frontmatter field.

4. Update state, then clean up:

```yaml
issues:
  - slug: "{issue-slug}"
    status: created | linked
    linear_id: "{ID}" | null
```

Delete `.pm/.groom-state.md` after successful link. Grooming is complete.

Say:
> "Grooming complete for '{topic}'. {N} issues created.
> Recommended next: /pm:groom {next-idea} or update priorities in pm/strategy.md."

---

## State File Schema (.pm/.groom-state.md)

Only one state file at a time. If one exists when starting fresh, overwrite it.

```yaml
---
topic: "{topic name}"
phase: intake | strategy-check | research | scope | product-review | groom | link
started: YYYY-MM-DD
updated: YYYY-MM-DD

strategy_check:
  status: passed | failed | override | skipped
  checked_against: pm/strategy.md | null
  conflicts:
    - "{conflicting non-goal text}"
  supporting_priority: "{priority text}" | null

research_location: pm/research/{topic-slug}/ | null

scope:
  in_scope:
    - "{item}"
  out_of_scope:
    - "{item}: {reason}"
  filter_result: 10x | parity | gap-fill | null

product_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority | null
  competitive_verdict: strengthens | neutral | weakens | null
  blocking_issues_fixed: 0
  iterations: 1

issues:
  - slug: "{issue-slug}"
    title: "{title}"
    status: drafted | created | linked
    linear_id: "{Linear ID}" | null
---
```

---

## Error Handling

**Corrupted state file** (unparseable YAML, missing required fields):
> "The state file at .pm/.groom-state.md appears corrupted. Options:
> (a) Show me the file so I can fix it manually
> (b) Start fresh (deletes the state file)"

**Missing research refs** (phase advances but research files not found):
Warn the user. Offer to re-run Phase 3 before continuing. Do not silently proceed with empty research context.

**Strategy drift** (pm/strategy.md modified since strategy_check was recorded):
On every phase after strategy-check, compare the file's `updated:` date against the state's `strategy_check.checked_against`. If newer, flag:
> "pm/strategy.md was updated after the strategy check. Re-run the check before scoping?"

**Parallel sessions** (state file already exists when starting):
Never silently overwrite an existing state file. Always ask resume vs. fresh. Starting fresh requires explicit user confirmation before deleting.

---

## Backlog Issue Format (when no Linear)

Write to `pm/backlog/{issue-slug}.md`.

```markdown
---
type: backlog-issue
title: "{Issue Title}"
outcome: "{One-sentence: what changes for the user when this ships}"
status: drafted | approved | in-progress | done
parent: "{parent-issue-slug}" | null
children:
  - "{child-issue-slug}"
labels:
  - "{label}"
priority: critical | high | medium | low
research_refs:
  - pm/research/{topic-slug}/findings.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome

{Expand on the outcome statement. What does the user experience after this ships?
What were they unable to do before?}

## Acceptance Criteria

1. {Specific, testable condition.}
2. {Specific, testable condition.}
3. {Edge cases handled: ...}

## Competitor Context

{How do competitors handle this? Where do they fall short?
Reference specific profiles from pm/competitors/ if applicable.}

## Research Links

- [{Finding title}](pm/research/{topic-slug}/findings.md)

## Notes

{Open questions, implementation constraints, or deferred scope items.}
```
