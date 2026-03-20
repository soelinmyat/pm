# PM-035: Scannable Proposal Template — Glanceable HTML with One-Sentence Summaries

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users opening a proposal grasp the key decision — what, why, and whether to approve — within 10 seconds, without scrolling past the first screen.

**Architecture:** One new file (`skills/groom/templates/proposal-reference.html`) and one edit to `skills/groom/phases/phase-5.8-present.md`. The reference template is a complete, self-contained HTML file that future proposals replicate — it uses a fictional "Dashboard Filtering System" as example content.

**Tech Stack:** HTML + inline CSS (no JS except mermaid CDN)

**Current state:**
- `skills/groom/templates/proposal-reference.html` does NOT exist yet — phase-5.8-present.md references it, but it was never created.
- `pm/backlog/proposals/simple-readable-output.html` is the best existing proposal — already uses collapsible `<details><summary>` ACs, one-sentence section leads (`.section-lead`), and good visual hierarchy.
- `pm/backlog/proposals/groom-drafting-quality.html` is the "dense" proposal — no section leads, multi-sentence competitive cells, no collapsible ACs, review card notes that run to 2+ lines.

**Key scannability gaps to fix (comparing simple-readable-output.html vs ACs):**
1. Body text already has `max-width: 65ch` on `.section p, .section li` — KEEP this.
2. Section spacing is `margin-bottom: 3rem` on `.section` — already meets AC5 (≥2rem). KEEP.
3. Missing: a proper competitive table with color-coded cells (AC6). The simple-readable-output.html has no table at all; groom-drafting-quality.html has one but with long phrases.
4. Missing: review card notes are not explicitly capped to one line (AC7).
5. Missing: phase-5.8 scannability check step (AC9).
6. The template should follow PM-034 style guide principles (verdict first, plain language, no jargon).

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/groom/templates/proposal-reference.html` | **Create** | Complete reference template with fictional content |
| `skills/groom/phases/phase-5.8-present.md` | **Modify** | Add scannability check step before opening |

---

## Task 1: Create the proposal reference template

**Files:**
- Create: `skills/groom/templates/proposal-reference.html`

- [ ] **Step 1: Write the complete HTML template**

Create `skills/groom/templates/proposal-reference.html` as a self-contained HTML file using the fictional "Dashboard Filtering System" proposal. Base the structure on `simple-readable-output.html` (which already has good bones) but apply these scannability improvements:

**Structure (10 sections, matching phase-5.8-present.md order):**

1. **Hero header** — Feature name, one-sentence outcome subtitle, 5-metric strip (Issues, Team Reviews, Bar Raiser, Differentiator, Priority)
2. **Sticky TOC nav** — Anchor links to each section
3. **Problem & Context** — section-lead sentence, short body, callout for key signal
4. **Scope Overview** — section-lead sentence, 2-column grid (in/out), 10x filter badge
5. **User Flows** — section-lead sentence, mermaid diagram in `<pre class="mermaid">` with `%% Source:` citation
6. **Wireframes** — section-lead sentence, iframe placeholder with standalone link
7. **Competitive Context** — section-lead sentence, color-coded comparison table with SHORT phrases
8. **Technical Feasibility** — section-lead sentence, 4-box color-coded grid (green/blue/amber/purple), verdict badge
9. **Issue Breakdown** — section-lead sentence, parent card (blue border) + child cards (light blue border), collapsible ACs via `<details><summary>`
10. **Review Summary** — section-lead sentence, pipeline stepper, verdict cards grid, advisory card (amber)
11. **Open Questions** — section-lead sentence, numbered question list

**CSS rules to enforce (inline `<style>`):**

Carry forward from simple-readable-output.html with these additions/changes:

```css
/* AC4: Body text max-width */
.section p, .section li { max-width: 65ch; }

/* AC5: Section spacing */
.section { margin-bottom: 3rem; }  /* already present, keep ≥2rem */

/* AC6: Competitive table color-coded cells */
.comp-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.comp-table th { background: #f9fafb; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.04em; color: #666; padding: 0.6rem 0.75rem; text-align: left; }
.comp-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #f3f4f6; }
.comp-table .us { background: #f0fdf4; color: #166534; font-weight: 600; }
.comp-table .competitor-weak { background: #fef2f2; color: #991b1b; }
.comp-table .competitor-partial { background: #fffbeb; color: #92400e; }
/* Cells use SHORT phrases, not sentences — e.g. "Not offered", "Static checklist", "2-3 approaches" */

/* AC7: Review card notes capped to one line */
.review-card-note {
  font-size: 0.83rem; color: #777; line-height: 1.4;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}

/* AC3: Collapsible ACs */
details { margin-top: 0.5rem; }
summary { font-size: 0.85rem; font-weight: 600; color: #2563eb; cursor: pointer; }
.ac-list { font-size: 0.88rem; padding-left: 1.25rem; color: #555; margin-top: 0.5rem; }

/* Feasibility grid (new — not in simple-readable-output.html) */
.feasibility-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
.feasibility-box { border-radius: 10px; padding: 1rem 1.25rem; }
.feasibility-box.build-on { background: #f0fdf4; border-left: 4px solid #16a34a; }
.feasibility-box.build-new { background: #eff6ff; border-left: 4px solid #2563eb; }
.feasibility-box.risks { background: #fffbeb; border-left: 4px solid #f59e0b; }
.feasibility-box.sequencing { background: #faf5ff; border-left: 4px solid #7c3aed; }
.feasibility-box h4 { font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; margin-bottom: 0.5rem; }
```

**Fictional content for "Dashboard Filtering System":**

- Hero: "Dashboard Filtering System" / "Users find the exact data view in under 3 clicks." / 3 Issues / 2 Rounds / Ready / 10x / High
- Problem: "Users waste time scrolling instead of filtering." / Body about filter UX gap.
- Scope: In — multi-select filters, saved views, URL-encoded state. Out — natural language search, export.
- Competitive table (SHORT phrases):

| Capability | Competitor A | Competitor B | Ours |
|---|---|---|---|
| Multi-select filters | Single-select only | Not offered | Multi-select + saved |
| URL state | No deep links | Partial | Full URL encoding |
| Saved views | Premium tier | Not offered | Free tier included |

- Feasibility: Build-on (existing parser), Build-new (filter UI), Risks (performance with 10k+ rows), Sequencing (parser → UI → saved views)
- Issues: 1 parent (PM-EX1) + 2 children (PM-EX2, PM-EX3) with collapsible ACs
- Review: All passed, verdict Ready
- Questions: 2 questions about performance and saved view limits

**Key scannability patterns to demonstrate:**
- Every section opens with `<p class="section-lead">One sentence summary here.</p>` (AC2)
- Competitive table cells are max 4 words where possible (AC6)
- Review card notes are one short phrase each (AC7)
- All AC lists are inside `<details><summary>Show acceptance criteria (N)</summary>` (AC3)

- [ ] **Step 2: Verify the template**

Verify:
- File exists at `skills/groom/templates/proposal-reference.html`
- Every section has a `.section-lead` as its first child after the title (AC2)
- All AC lists use `<details><summary>` (AC3)
- `.section p, .section li` has `max-width: 65ch` (AC4)
- `.section` has `margin-bottom` ≥ 2rem (AC5)
- Competitive table has `.us`, `.competitor-weak`, `.competitor-partial` color classes (AC6)
- `.review-card-note` has `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` (AC7)
- Only external dependency is mermaid CDN (no other JS)
- Self-contained: all styles inline in `<style>` block
- Print and responsive media queries present

---

## Task 2: Add scannability check step to phase-5.8-present.md

**Files:**
- Modify: `skills/groom/phases/phase-5.8-present.md`

- [ ] **Step 1: Insert scannability check before "Open in browser"**

Insert a new step between the current Step 1 (Generate) and Step 2 (Open in browser). The current Step 2 becomes Step 3, Step 3 becomes Step 4. Insert after the closing of Step 1's content and before `#### Step 2: Open in browser`:

```markdown
#### Step 1.5: Scannability check

Before opening the proposal, verify these three things:

1. **Section leads.** Every section after the hero opens with exactly one bold or `.section-lead` sentence. If any section lead is longer than one sentence, shorten it.
2. **Collapsible ACs.** All acceptance criteria lists are inside `<details><summary>` tags. None are expanded by default.
3. **One-line review notes.** Each review card note is a single short phrase (under ~60 characters). Truncate or rephrase any that wrap to two lines.

If any check fails, fix it before proceeding.
```

- [ ] **Step 2: Verify the edit**

Verify:
- The scannability check appears between Step 1 (Generate) and Step 2 (Open in browser)
- It contains exactly 3 checks: section leads, collapsible ACs, one-line review notes
- Existing step numbering is adjusted (original Step 2 → Step 2 still works since we used "Step 1.5", or renumber to Step 2/Step 3/Step 4)

---

## Task 3: Commit

- [ ] **Step 1: Stage and commit**

```bash
git add skills/groom/templates/proposal-reference.html skills/groom/phases/phase-5.8-present.md
git commit -m "feat(PM-035): add scannable proposal reference template and scannability check"
```

---

## Verification Checklist

| AC | Task.Step | Evidence |
|----|-----------|----------|
| 1. proposal-reference.html at correct path | T1.S1 | `skills/groom/templates/proposal-reference.html` created |
| 2. Every section opens with one-sentence summary | T1.S1 | `.section-lead` on every section |
| 3. ACs use `<details><summary>` (CSS-only, no JS) | T1.S1 | `<details>` wrapping all `.ac-list` elements |
| 4. Body text max-width: 65ch | T1.S1 | `.section p, .section li { max-width: 65ch; }` |
| 5. Section spacing ≥2rem | T1.S1 | `.section { margin-bottom: 3rem; }` |
| 6. Competitive table: color-coded, short phrases | T1.S1 | `.us`, `.competitor-weak`, `.competitor-partial` classes; cells ≤4 words |
| 7. Review card notes capped at one line | T1.S1 | `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` |
| 8. Follows PM-034 style guide | T1.S1 | Verdict-first patterns, plain language, no jargon |
| 9. phase-5.8 scannability check step | T2.S1 | Step 1.5 with 3 verification checks |
