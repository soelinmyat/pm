# Scope Validation Methodology

Used by `pm:groom` during Step 3 (Scope). Follow this guide to define scope precisely, apply the 10x filter, and produce a defensible in/out boundary before proposal drafting.

---

## 1. Strategy Alignment (scope-level check)

Use the current Research phase evidence and authoritative strategy artifact when available. Read the actual priorities, non-goals and target segment; do not rely on nonexistent cached session fields or assume an earlier parse is still current. Name which priority this outcome serves, check exclusions and newly added scope against the actual non-goals, and identify any deliberate secondary-segment choice. Do not manufacture three priorities when the strategy has a different shape.

If strategy context is unavailable, record that limitation in the Scope phase evidence. User/problem evidence may still support a bounded outcome, but alignment remains unknown. Do not add `strategy_check` or `scope` keys to the closed canonical session. Tell the user: “Strategy alignment was not evaluated because strategy context is unavailable; scope uses available problem evidence and explicit assumptions.”

---

## 2. The 10x Filter

Before finalizing scope, answer these questions from available evidence. Ask the user only about unresolved choices that materially change the outcome. Record reasoning in the Scope phase evidence, not new session fields.

**Q1: Is this meaningfully better than the best existing solution?**
"Meaningfully" means: faster, cheaper, simpler, or more accurate by a margin users can feel — not a marginal improvement that requires a press release to explain.

- Yes, clearly differentiated → `10x`
- Matches competitors, closes a gap → `gap-fill`
- Replicates what competitors already do well → `parity`
- Basic expectation established for this audience and task → `table-stakes`

**Q2: Who specifically benefits, and can you name them?**
Vague beneficiaries ("all users," "teams") are a red flag. Name the persona, the workflow, and the friction point being removed.

**Q3: What does the user do today instead?**
If users have a workaround that is "good enough," the threshold for shipping is higher — you need to clear the switching cost, not just match the workaround.

**Q4: What observable change would establish success, and over what relevant period?**
Name an outcome and, when useful, an earlier indicator connected to it. Distinguish leading from lagging measures and choose the horizon for the task; do not invent a universal 90-day target or claim a proxy proves success.

### Filter Result: What to Do with Each Label

| Label | Meaning | Action |
|---|---|---|
| `10x` | Meaningfully better, clear differentiation | Proceed. Document the differentiation claim in the proposal. |
| `gap-fill` | Closes an expected capability gap | Proceed. Explain the missing capability and its user consequence; establish audience expectations before calling it table stakes. |
| `table-stakes` | Basic expected capability for this audience and task | Proceed. No differentiation claim needed — users expect this to exist. |
| `parity` | Replicates what competitors do beyond table stakes | Flag it. Ask for explicit strategic intent before proceeding. |

Parity and table-stakes are different. Establish table stakes from this audience, domain and task; search or dark mode is not universally required. Missing a required correctness or authorization rule can be a defect, while other omissions can be deliberate scope choices. Parity is actively copying a competitor's non-essential feature, which should be a deliberate call.

---

## 3. Scope Definition Template

Fill this out collaboratively. Every line in the OUT column needs a reason — "not now" is not a reason. Reasons: out of ICP, non-goal, too complex for this initiative, dependency on unbuilt infrastructure.

```
Initiative: {topic}
Date: YYYY-MM-DD

IN SCOPE
--------
- {Item}: {one-line description of what is included}
- {Item}: ...

OUT OF SCOPE
------------
- {Item}: {reason — non-goal / wrong ICP / deferred to follow-on / infra dependency}
- {Item}: ...

OPEN QUESTIONS (scope-adjacent, not yet decided)
-----------
- {Question}: {who needs to decide, and by when}
```

Retain this as structured Scope phase output and bind its artifact in the existing `groom-phase-result-v1` scope evidence. Use `scripts/groom-session.js` to record the result; proposal content never lives in session state. Resolve material ambiguity before advancing through the canonical runner.

---

## 4. Impact/Effort Evaluation

For each in-scope item, assign a rough quadrant:

| Quadrant | Impact | Effort | Decision |
|---|---|---|---|
| Quick wins | High | Low | Prefer when they deliver the coherent outcome; cheapness alone does not establish priority. |
| Major bets | High | High | Worth it if aligned with a top priority. Size carefully. |
| Fill-ins | Low | Low | Include only when necessary to the outcome or explicitly justified; avoid cheap scope accumulation. |
| Reconsider | Low | High | Defer only if this is independent of the promised outcome and required safety/domain behavior. |

**Effort signals** (rough heuristics, not story points):
- Estimate from the actual interactions, state transitions, data changes, permissions, migration and integration seams. A UI navigation change can be costly; an established model change can be small.
- Name uncertainty and evidence from existing implementation rather than infer effort from the UI/backend label.

**Impact signals:**
- Assess frequency, severity, recoverability, affected audience and domain obligations. A frequent irritation and a rare irreversible loss have different but potentially high impact.
- A competitor gap or request is an input, not proof of value. Trace it to the user job.
- Rare but critical authorization, cancellation, concurrency, data integrity and recovery behavior can be necessary for a coherent outcome; do not classify edge-case coverage as low impact by default.

Record the reasoning and uncertainty alongside each quadrant in the retained Scope phase output. Before excluding an item, test whether the remaining scope still fulfills its claimed outcome safely. An exclusion remains a risk when it leaves a dependency, harm or unsupported assumption; naming it a non-goal does not make the risk disappear.

Example: overlapping time-off requests may be rare, but preventing duplicate approval and incorrect balances belongs to correct request handling. Defer optional analytics before deferring the concurrency rule. Estimate a new navigation route from discoverability, permissions and return-context behavior, not from the label "UI change."

---

## 5. Scope Confirmation

Before leaving Step 3, present the coherent in/out boundary, material assumptions and differentiation claim. Ask for a decision only when an unresolved choice materially changes the scope; existing authorized intent can resolve routine choices. Do not require a new blanket approval ceremony.

Record the Scope phase result through the canonical runner. Follow `steps/03-scope.md` and its frozen tier route: quick advances to Design (Step 5), standard/full to Synthesis (Step 4). Do not skip synthesis or hand-edit the phase.

## Semantic calibration

Use examples to assess meaning, not as text to copy into every proposal.

- **Testable acceptance:** “Submitting an empty title keeps the form open and identifies the title field.” This is concise and observable. “Deliver a seamless, robust form experience that delights users” gives no observable pass condition.
- **Real alternative:** “Keep CSV export and add a scheduled reminder: cheaper to maintain, but users still import manually.” This is a selectable mechanism with a sacrifice. “Build the same integration with a more delightful interface” is a variation, not an alternative.
- **Falsifiable risk:** “If the provider cannot revoke tokens immediately, do not launch shared workspaces; verify revocation in the sandbox before approval.” “Integration may be challenging due to complex market dynamics” has no trigger or consequence.

Do not reward length. Ask whether the criterion can fail, the alternative could be chosen, and the risk would change the decision.
