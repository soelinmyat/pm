# Groom Output Style Guide

Groom-specific formatting supplement. For shared prose rules, jargon ban list, and quality checklist, see `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

---

## Parallel Agent Output

Collapse parallel reviewer results into a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|
| PM | Ship if — add offline AC | Outcome reads like a task |
| Competitive | Strengthens | Good differentiation vs. Cursor |
| EM | Feasible | Build on existing parser |

Then list only blocking items as bullets. Advisory items after user acknowledges blockers.

---

## Before / After Examples

### Strategy check (Phase 2)

**Before:** "After conducting a thorough review of the product strategy document, I've determined that this feature idea aligns well with the current priorities outlined in Section 6..."

**After:**
> **Aligned.** Supports priority #1: "Ship features that make the free tier indispensable."
> - No non-goal conflicts
> - ICP fit: strong (solo developer match)

### Scope review (Phase 4.5 — parallel agents)

**Before:** Three paragraphs per reviewer, 40+ lines each.
**After:**
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ship it | Clear JTBD, strong ICP fit |
> | Competitive | Strengthens | Fills gap no competitor covers |
> | EM | Feasible | Build on `scripts/parser.js` |
>
> No blocking issues. 2 advisory notes — want to see them?

### Team review (Phase 5.5 — parallel agents)

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
