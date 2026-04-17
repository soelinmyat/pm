# Scope Validation Methodology

Used by `pm:groom` during Step 4. Follow this guide to define scope precisely, apply the 10x filter, and produce a defensible in/out boundary before proposal drafting.

---

## 1. Strategy Alignment (scope-level check)

Read `strategy_check` from session state (extracted in Step 2).

**If `strategy_check.context` is available** (standard/full tier where `strategy.md` existed):

Read `strategy_check.context` from session state. Do NOT re-read `strategy.md` — Step 2 already parsed it.

**Current priorities:** Which of the top 3 priorities (from `strategy_check.context.priorities`) does this scope serve? Write it down explicitly. If you cannot name the priority, the scope is suspect.

**Non-goals against new scope items:** Step 2 already cleared the idea against non-goals. Only recheck here if **scope added items not covered by the original idea**. For each new in-scope item, check against `strategy_check.context.non_goals`. If conflict: stop and raise it explicitly.

**ICP:** Is the target user of this scope the ICP (from `strategy_check.context.icp`), or a secondary segment? Building for secondary segments is allowed, but it must be a conscious choice. Name it.

**If `strategy_check.context` is NOT available** (quick tier, or standard tier where `strategy.md` was missing):

Skip priority alignment, non-goal validation, and ICP checks. Still run the 10x filter (Section 2) and scope definition (Section 3). Write `strategy_context_available: false` in the session state under `scope:`. Tell the user:
> "Strategy alignment was not evaluated in this run (strategy context unavailable). Scope decisions are based on the 10x filter and direct user input only."

---

## 2. The 10x Filter

Before finalizing scope, work through these four questions with the user. Ask them ONE at a time — wait for each answer before presenting the next. Record answers in the state file.

**Q1: Is this meaningfully better than the best existing solution?**
"Meaningfully" means: faster, cheaper, simpler, or more accurate by a margin users can feel — not a marginal improvement that requires a press release to explain.

- Yes, clearly differentiated → `10x`
- Matches competitors, closes a gap → `gap-fill`
- Replicates what competitors already do well → `parity`
- Basic expectation users assume exists (auth, search, dark mode) → `table-stakes`

**Q2: Who specifically benefits, and can you name them?**
Vague beneficiaries ("all users," "teams") are a red flag. Name the persona, the workflow, and the friction point being removed.

**Q3: What does the user do today instead?**
If users have a workaround that is "good enough," the threshold for shipping is higher — you need to clear the switching cost, not just match the workaround.

**Q4: What does success look like in 90 days?**
Name one leading indicator (not a lagging metric like revenue). If you cannot name a measurable outcome, the scope may be too vague to ship.

### Filter Result: What to Do with Each Label

| Label | Meaning | Action |
|---|---|---|
| `10x` | Meaningfully better, clear differentiation | Proceed. Document the differentiation claim in the proposal. |
| `gap-fill` | Closes an expected capability gap | Proceed. Note that this is table stakes, not a moat. |
| `table-stakes` | Basic expected capability (auth, search, dark mode) | Proceed. No differentiation claim needed — users expect this to exist. |
| `parity` | Replicates what competitors do beyond table stakes | Flag it. Ask for explicit strategic intent before proceeding. |

Parity and table-stakes are different. Table-stakes features are things users assume any product has — not building them is a bug, not a strategy choice. Parity is actively copying a competitor's non-essential feature, which should be a deliberate call.

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

Write this to `{source_dir}/.pm/groom-sessions/{topic-slug}.md` under the `scope:` key. Do not proceed to Step 5 until both lists are confirmed by the user.

---

## 4. Impact/Effort Evaluation

For each in-scope item, assign a rough quadrant:

| Quadrant | Impact | Effort | Decision |
|---|---|---|---|
| Quick wins | High | Low | Do first. These build momentum and credibility. |
| Major bets | High | High | Worth it if aligned with a top priority. Size carefully. |
| Fill-ins | Low | Low | Fine to include if they're genuinely cheap. Don't over-invest. |
| Cut | Low | High | Remove from scope. |

**Effort signals** (rough heuristics, not story points):
- Low: UI change, config option, copy update, new query on existing data
- High: new data model, new integration, architectural change, new permission surface

**Impact signals:**
- High: unblocks a key ICP workflow, removes a top complaint theme from reviews, closes a named competitor gap
- Low: nice-to-have, edge-case coverage, secondary segment request

Mark each in-scope item with its quadrant in the state file under `scope.in_scope`. Items landing in "Cut" move to `scope.out_of_scope` with reason "low impact, high effort."

---

## 5. Scope Confirmation

Before leaving Step 4, confirm with the user:

> "Here's the confirmed scope for '{topic}':
>
> IN: {in_scope items}
> OUT: {out_of_scope items with reasons}
> 10x filter result: {label}
>
> Proceed to scope review?"

Do not advance to Step 5 without an explicit yes. Scope changes after proposal drafting are expensive.
