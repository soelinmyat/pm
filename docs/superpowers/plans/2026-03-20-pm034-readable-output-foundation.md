# PM-034: Readable Output Foundation — Style Guide + Terminal Formatting Rules

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every terminal message the groom skill produces can be scanned in under 5 seconds — verdicts lead, bullets replace paragraphs, jargon is replaced with plain language.

**Architecture:** Two files change: a new reference file (`skills/groom/references/style-guide.md`) defines the writing rules, and SKILL.md gets a compact "Output Formatting" section plus a Read instruction so every phase loads the style guide. No phase files change — the style guide is a reference consumed at runtime, not a phase rewrite.

**Tech Stack:** Markdown (skill files)

**Current state:** SKILL.md has an "Interaction Pacing" section (line 14) and a "Custom Instructions" section (lines 49-57). One reference file exists (`references/splitting-patterns.md`). Phase outputs (scope review, team review, strategy check) produce multi-paragraph prose that is hard to scan.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/groom/references/style-guide.md` | **Create** | New reference file — writing rules, jargon ban list, before/after examples |
| `skills/groom/SKILL.md` | **Modify** | Add "Output Formatting" section + style-guide Read instruction |

---

## Task 1: Create the style guide reference file

**Files:**
- Create: `skills/groom/references/style-guide.md`

- [ ] **Step 1: Write the style guide**

Create `skills/groom/references/style-guide.md` with the following content:

```markdown
# Output Style Guide

Reference for all groom phases. Read on demand — do not memorize.

Governing principle: **Ask one thing, say one thing.**

---

## Top Rules (apply to every message)

1. **Verdict first.** Lead with the decision, status, or answer. Context comes after.
2. **Bullets over prose.** Never write a paragraph when a list works. Max 2 lines per bullet.
3. **Max 3 bullets before interaction.** If you need more, pause and ask the user first.
4. **20 words per sentence.** If a sentence is longer, split it.
5. **Flesch-Kincaid grade ≤ 8.** Write for a smart reader in a hurry, not an academic journal.
6. **No walls of text.** Max 2-line paragraphs. If you hit 3 lines, convert to bullets.
7. **One question per message.** Never bundle questions. Ask the most important one — the answer often makes the rest unnecessary.

---

## Parallel Agent Output

When presenting results from parallel reviewers (scope review, team review, bar raiser), collapse into a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|
| PM | Ship if — add offline AC | Outcome reads like a task |
| Competitive | Strengthens | Good differentiation vs. Cursor |
| EM | Feasible | Build on existing parser |

Then list only blocking items as bullets. Advisory items go after user acknowledges blockers.

---

## Jargon Ban List

Use the plain alternative. Always.

| Banned | Use instead |
|--------|-------------|
| leverage | use |
| utilize | use |
| facilitate | help, enable |
| in order to | to |
| at this point in time | now |
| going forward | next, from now on |
| it should be noted that | (delete — just state the thing) |
| a number of | several, some |
| with respect to | about, for |
| prior to | before |
| subsequent to | after |
| in the event that | if |
| paradigm | pattern, approach |
| synergy | (delete or rewrite the sentence) |
| cadence | rhythm, schedule |
| deep dive | review, analysis |
| circle back | revisit, follow up |
| net-net | bottom line, result |

---

## Before / After Examples

### 1. Strategy check (Phase 2)

**Before (wall of text):**
> After conducting a thorough review of the product strategy document, I've determined that this feature idea aligns well with the current priorities outlined in Section 6 of pm/strategy.md. Specifically, it supports the first priority of "Ship features that make the free tier indispensable for solo developers" and does not conflict with any of the non-goals listed in Section 7. The ICP fit is strong, as the target user matches the solo developer profile described in Section 2. I recommend proceeding to the research phase.

**After (verdict first, bullets):**
> **Aligned.** Supports priority #1: "Ship features that make the free tier indispensable."
> - No non-goal conflicts
> - ICP fit: strong (solo developer match)
>
> Proceeding to research.

### 2. Scope review (Phase 4.5 — parallel agents)

**Before (three paragraphs per reviewer, 40+ lines total):**
> The Product Manager review has concluded. After examining the scope against the current priorities and ICP, the PM finds that the scope is well-defined and addresses a clear job-to-be-done. However, there are some concerns about the success criteria...
>
> The Competitive Strategist has completed their review. Based on analysis of the competitor profiles and landscape document, this feature strengthens the product's position by...
>
> The Engineering Manager review is complete. After exploring the codebase, the EM finds that this is feasible as scoped. The existing parser in scripts/parser.js provides a foundation to build on...

**After (summary table + blocking bullets):**
> **Scope review complete.**
>
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ship it | Clear JTBD, strong ICP fit |
> | Competitive | Strengthens | Fills gap no competitor covers |
> | EM | Feasible | Build on `scripts/parser.js` |
>
> No blocking issues. 2 advisory notes — want to see them?

### 3. Team review (Phase 5.5 — parallel agents)

**Before (dense per-reviewer output, 60+ lines):**
> ## Product Quality Review
> **Verdict:** Ready if conditions are met
> After reviewing all drafted issues against the scope definition, research findings, and Phase 4.5 findings, I find that the issues are largely implementation-ready. However, there are several areas that need attention. The outcome statement for the parent issue reads more like a feature description than a user-centric outcome. Specifically, "Add status badges to backlog view" should be reframed to describe what changes for the user...
>
> ## Competitive Quality Review
> **Verdict:** Competitively sharp
> The competitive intelligence gathered during research has been well-reflected in the drafted issues. The competitor context sections provide actionable insights rather than generic comparisons...

**After (summary table + blocking bullets only):**
> **Team review — iteration 1/3.**
>
> | Reviewer | Verdict | Key note |
> |----------|---------|----------|
> | PM | Ready if | Reframe parent outcome statement |
> | Competitive | Sharp | Research well-reflected |
> | EM | Ready | Clean decomposition |
> | Design | Complete if | Add empty-state wireframe |
>
> **Blocking (2):**
> - [parent-issue] Outcome reads like a task — reframe as user change
> - [wireframes] Missing empty-state screen
>
> Fixing these now. Advisory items after blockers clear.
```

This file is 78 lines (within the 80-line budget). The most important rules are in the first 10 lines (Top Rules section).

---

## Task 2: Add Output Formatting section and Read instruction to SKILL.md

**Files:**
- Modify: `skills/groom/SKILL.md`

Two edits applied in sequence.

- [ ] **Step 1: Add "Output Formatting" section after "Interaction Pacing"**

Insert the following content between line 17 (the end of Interaction Pacing's last sentence) and line 18 (the `---` separator before Resume Check):

```markdown

## Output Formatting

Verdict first. Max 3 bullets before asking. No walls of text.

When presenting parallel agent results (scope review, team review), collapse to a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|

List only blocking items as bullets. Advisory items come after the user acknowledges blockers.

For full rules, jargon ban list, and examples: read `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/style-guide.md`.
```

This is 10 lines of new content (within the 20-line budget for SKILL.md additions).

- [ ] **Step 2: Add style-guide Read instruction to Custom Instructions section**

In the Custom Instructions section (lines 49-57), insert the following line immediately after line 57 (the override hierarchy line), before the `---` separator:

```markdown

Before starting any phase, also read `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/style-guide.md` for output formatting rules.
```

This is 2 lines (blank + instruction), bringing the total SKILL.md additions to 12 lines (within the 20-line budget).

- [ ] **Step 3: Verify SKILL.md changes**

Verify:
- "Output Formatting" section appears between "Interaction Pacing" and "Resume Check"
- Output Formatting section is ≤10 lines (excluding blank lines at boundaries)
- Style-guide Read instruction appears in Custom Instructions section, after the override hierarchy line
- Total new SKILL.md content is ≤20 lines
- No existing content was modified or removed

---

## Task 3: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add skills/groom/references/style-guide.md skills/groom/SKILL.md
git commit -m "feat(PM-034): add output style guide and formatting rules to groom skill"
```

---

## Verification Checklist

| AC | Task.Step | Evidence |
|----|-----------|----------|
| 1. style-guide.md exists at correct path | T1.S1 | `skills/groom/references/style-guide.md` created |
| 2. Flesch-Kincaid ≤8, max 20-word sentences, 2-line paragraphs | T1.S1 | Top Rules #4, #5, #6 |
| 3. Bullets over prose, jargon ban list | T1.S1 | Top Rules #2, Jargon Ban List table |
| 4. Before/after examples (3: strategy, scope review, team review) | T1.S1 | Before/After section with 3 examples |
| 5. "Ask one thing, say one thing" governing principle | T1.S1 | Line 5 of style guide |
| 6. SKILL.md "Output Formatting" section after Interaction Pacing | T2.S1 | New section with verdict-first, summary table, 3-bullet max |
| 7. Parallel agent output collapsing (summary table format) | T2.S1 + T1.S1 | Table format in both SKILL.md and style guide |
| 8. Style-guide Read instruction in Custom Instructions | T2.S2 | Read instruction after override hierarchy line |
| 9. SKILL.md additions ≤20 lines | T2.S3 | 10 (Output Formatting) + 2 (Read instruction) = 12 lines |
| 10. Style guide ≤80 lines, top rules in first 10 lines | T1.S1 | 78 lines; Top Rules at lines 7-13 |
