# Scope Validation Methodology

Used by `pm:groom` during Phase 4. Follow this guide to define scope precisely, apply the 10x filter, and produce a defensible in/out boundary before any issues are drafted.

---

## 1. Strategy Alignment (re-check at scope time)

Strategy check happened in Phase 2, but scope is where it bites. Before defining any boundary, re-read the relevant sections of `{pm_dir}/strategy.md`:

**Current priorities (Section 6):** Which of the top 3 priorities does this scope serve?
Write it down explicitly. If you cannot name the priority, the scope is suspect.

**Non-goals (Section 7):** Does any proposed in-scope item touch a stated non-goal?
If yes: stop. The non-goal exists because that decision was already made deliberately.
Do not reopen it silently through scope — raise it explicitly and get a decision.

**ICP (Section 2):** Is the target user of this scope the ICP, or a secondary segment?
Building for secondary segments is allowed, but it must be a conscious choice. Name it.

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
| `10x` | Meaningfully better, clear differentiation | Proceed. Document the differentiation claim in the parent issue. |
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

Write this to `.pm/groom-sessions/{topic-slug}.md` under the `scope:` key. Do not proceed to Phase 5 until both lists are confirmed by the user.

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

Before leaving Phase 4, confirm with the user:

> "Here's the confirmed scope for '{topic}':
>
> IN: {in_scope items}
> OUT: {out_of_scope items with reasons}
> 10x filter result: {label}
>
> Proceed to drafting issues?"

Do not advance to Phase 5 without an explicit yes. Scope changes after issue drafting are expensive.
