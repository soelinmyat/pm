# Output Style Guide

Reference for all groom phases. Read on demand — do not memorize.

Governing principle: **Ask one thing, say one thing.**

## Top Rules

1. **Verdict first.** Lead with the decision, status, or answer. Context comes after.
2. **Bullets over prose.** Never write a paragraph when a list works. Max 2 lines per bullet.
3. **Max 3 bullets before interaction.** If you need more, pause and ask the user first.
4. **20 words per sentence.** If a sentence is longer, split it.
5. **Flesch-Kincaid grade ≤ 8.** Write for a smart reader in a hurry, not an academic journal.
6. **No walls of text.** Max 2-line paragraphs. If you hit 3 lines, convert to bullets.
7. **One question per message.** Never bundle questions. Ask the most important one first.

## Parallel Agent Output

Collapse parallel reviewer results into a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|
| PM | Ship if — add offline AC | Outcome reads like a task |
| Competitive | Strengthens | Good differentiation vs. Cursor |
| EM | Feasible | Build on existing parser |

Then list only blocking items as bullets. Advisory items after user acknowledges blockers.

## Jargon Ban List

| Banned | Use instead |
|--------|-------------|
| leverage / utilize | use |
| facilitate | help, enable |
| in order to | to |
| prior to / subsequent to | before / after |
| going forward | next, from now on |
| in the event that | if |
| it should be noted that | (delete — just say it) |
| deep dive | review, analysis |
| circle back | revisit, follow up |
| paradigm / synergy / cadence | pattern / (rewrite) / schedule |

## Before / After Examples

### 1. Strategy check (Phase 2)

**Before:** "After conducting a thorough review of the product strategy document, I've determined that this feature idea aligns well with the current priorities outlined in Section 6..."

**After:**
> **Aligned.** Supports priority #1: "Ship features that make the free tier indispensable."
> - No non-goal conflicts
> - ICP fit: strong (solo developer match)

### 2. Scope review (Phase 4.5 — parallel agents)

**Before:** Three paragraphs per reviewer, 40+ lines each.
**After:**
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ship it | Clear JTBD, strong ICP fit |
> | Competitive | Strengthens | Fills gap no competitor covers |
> | EM | Feasible | Build on `scripts/parser.js` |
>
> No blocking issues. 2 advisory notes — want to see them?

### 3. Team review (Phase 5.5 — parallel agents)

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
