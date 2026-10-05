# Groom Output Style Guide

Groom-specific formatting supplement. For shared prose rules, jargon ban list, and quality checklist, see `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

---

## Interaction Rules

**One question at a time.** Prefer yes/no questions for confirmations. When there are genuinely multiple options (resume/fresh, tier selection, escalation choices), a short labeled menu is fine — but never more than 3-4 options, and never compound questions where "yes" is ambiguous.

Bad: "Keep the CLE-1374 implementation and proceed to CLE-1373? Or revert?"
Good: "Keep the CLE-1374 implementation and proceed to CLE-1373?"
Also good (when options are needed): "(a) Proceed with quick tier (b) Build prerequisites first"

**Verify before claiming.** During codebase scans (Step 1, Step 4), search using multiple terms, check both API and frontend code, and verify with the user before claiming a feature doesn't exist. Hallucinating gaps leads to wasted grooming effort. When in doubt, ask: "I couldn't find X — can you confirm it's not built?"

---

## Parallel Agent Output

Collapse parallel reviewer results into a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|
| PM | Ship if — add offline AC | Outcome reads like a task |
| Competitive | Strengthens | Good differentiation vs. Cursor |
| EM | Feasible | Build on existing parser |

Then show blocking items and any material advisory limitation before the decision. Low-confidence conclusions, accepted domain risks and uncertainties that could reverse scope or value remain visible; harmless polish suggestions can stay in the detailed artifact. Do not hide consequential uncertainty behind an optional reveal.

---

## Before / After Examples

### Strategy check (Step 2)

**Before:** "After conducting a thorough review of the product strategy document, I've determined that this feature idea aligns well with the current priorities outlined in Section 6..."

**After:**
> **Aligned.** Supports priority #1: "Ship features that make the free tier indispensable."
> - No non-goal conflicts
> - ICP fit: strong (solo developer match)

### Scope review (Step 5 — parallel agents)

**Before:** Three paragraphs per reviewer, 40+ lines each.
**After:**
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ship it | Clear JTBD, strong ICP fit |
> | Competitive | Strengthens | Fills gap no competitor covers |
> | EM | Feasible | Build on `scripts/parser.js` |
>
> No blocking issues. Material limitation: demand beyond the two pilot teams is unverified; the first release is scoped to their workflow. Two polish notes are in the detailed review.

### Team review (Step 8 — parallel agents)

**Before:** Dense per-reviewer sections, 60+ lines. Verdict buried after preamble.
**After:**
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ready if | Reframe parent outcome |
> | Competitive | Sharp | Research well-reflected |
> | EM | Ready | Clean decomposition |
> | Design | Complete if | Add empty-state wireframe |
>
> **Blocking (2):**
> - [parent-issue] Outcome reads like a task — reframe as user change
> - [wireframes] Missing empty-state screen
