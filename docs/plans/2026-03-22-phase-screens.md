# PM-061: Per-Phase Companion Screens — Implementation Plan

**Issue:** PM-061 (child of groom-visual-companion)
**Date:** 2026-03-22
**Status:** Plan
**Depends on:** PM-060 (session route — serves `current.html` override)

---

## Overview

Add a companion screen HTML template and per-phase write steps so that each groom phase writes a rich, formatted `current.html` to `.pm/sessions/groom-{slug}/`. The dashboard's session route (PM-060) already serves this file and auto-refreshes via WebSocket. This issue adds the content.

---

## Task 1: Create companion template reference

**File:** `skills/groom/references/companion-template.md` (new file)

**What to do:**

Define a reusable HTML template that all phase write steps reference. The template provides consistent structure across all companion screens.

The template must include:

1. **HTML boilerplate** — DOCTYPE, charset, viewport meta tag.
2. **Inline CSS** — self-contained styling. Reuse the design vocabulary from `DASHBOARD_CSS` in `server.js:428`: system font stack, `#2563eb` accent, neutral grays, `--radius: 10px`, card shadows. No external CSS.
3. **Mermaid.js CDN** — `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>` (matches `dashboardPage()` at server.js:900). Only needed by Phase 5 screens but harmless to include universally.
4. **Header** — topic name, current phase label.
5. **Phase stepper** — horizontal bar showing all 9 phases with:
   - Completed phases: checkmark icon + past-tense label (green text)
   - Current phase: spinner/pulse dot + present-continuous label (accent blue)
   - Upcoming phases: greyed out text + future label
6. **Content slot** — `{CONTENT}` placeholder where each phase injects its specific HTML.
7. **Footer** — "Powered by PM" with muted text.

**Phase stepper labels** (derived from `GROOM_PHASE_LABELS` in server.js:1247):

| Phase | Past (completed) | Present (current) | Future (upcoming) |
|-------|-------------------|--------------------|--------------------|
| 1 - Intake | Intake complete | Taking intake... | Intake |
| 2 - Strategy | Strategy checked | Checking strategy... | Strategy Check |
| 3 - Research | Research done | Researching... | Research |
| 4 - Scope | Scope defined | Defining scope... | Scoping |
| 4.5 - Scope Review | Scope reviewed | Reviewing scope... | Scope Review |
| 5 - Groom | Issues drafted | Drafting issues... | Drafting Issues |
| 5.5 - Team Review | Team reviewed | Team reviewing... | Team Review |
| 5.7 - Bar Raiser | Bar raiser done | Bar raising... | Bar Raiser |
| 5.8 - Present | Presented | Presenting... | Presentation |
| 6 - Link | Issues linked | Linking issues... | Link Issues |

**Template format in the reference file:** The file should contain the full HTML as a fenced code block inside a markdown document. Phase write steps will be instructed to "use the template from `companion-template.md`" — the LLM reads the template, fills in the stepper state and content slot, and writes the result.

**CSS design tokens to match dashboard:**

```css
:root {
  --bg: #f7f8fb;
  --surface: #ffffff;
  --border: #e2e5ea;
  --text: #1e2128;
  --text-muted: #6b7280;
  --accent: #2563eb;
  --success: #16a34a;
  --warning: #ea580c;
  --radius: 10px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.07);
}
```

**Key decisions:**
- Template is a markdown reference file (like `splitting-patterns.md`), not a JS function. The LLM reads it and generates HTML — there is no programmatic templating engine.
- Inline CSS only — the file must render correctly when opened directly in a browser.
- Phase stepper is CSS-only (no JS animation). Uses `::before` pseudo-elements for checkmarks and connecting lines.
- The stepper is a horizontal flexbox bar, not a vertical sidebar. Each phase is a small box with an icon and label below.

**AC coverage:** AC8 (template in references), AC9 (stepper labels), AC10 (content not in terminal).

---

## Task 2: Add companion write step to Phase 4 (Scope)

**File:** `skills/groom/phases/phase-4-scope.md`

**What to do:**

Add a new step 8 (after PM-060's step 7 — opt-in prompt) that writes the companion screen. This step must come AFTER the opt-in check so the companion directory only gets content when visual_companion is true.

```markdown
7. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-3 completed (checkmarks), phase 4 current (pulse), phases 4.5-5.8 upcoming (greyed).
   - Content: a two-column grid showing in-scope items (left, green left-border) and out-of-scope items with reasons (right, gray left-border). Below the grid, a badge showing the 10x filter result:
     - `10x` → green badge
     - `parity` → amber badge
     - `gap-fill` → blue badge

   Create the `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
```

**Content structure (unique to this phase — not in terminal):**
- Two-column CSS grid (`grid-template-columns: 1fr 1fr`) for in-scope vs out-of-scope.
- Each item is a card with white background, subtle border, and the item text.
- Out-of-scope items include the reason in muted text below the item.
- 10x badge uses the same badge styling as the proposal template.

**AC coverage:** AC1 (scope grid + badge), AC11 (conditional), AC12 (overwrites).

---

## Task 3: Add companion write step to Phase 4.5 (Scope Review)

**File:** `skills/groom/phases/phase-4.5-scope-review.md`

**What to do:**

Add a new step at the end (after step 5 — state update) that writes the companion screen.

```markdown
6. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-4 completed, phase 4.5 current, phases 5-5.8 upcoming.
   - Content:
     a. **Reviewer verdict table** — 3-column HTML table:
        | Reviewer | Verdict | Key note |
        Rows: PM, Competitive, EM. Verdict cells color-coded:
        - Ship it / Strengthens / Feasible → green background
        - Ship if / Strengthens if / Feasible with caveats → amber background
        - Rethink / Weakens / Needs rearchitecting → red background
     b. **Blocking issues** — numbered list with red left-border card. Each item: issue text + "why this matters" in muted text.
     c. **Advisory items** — inside a `<details><summary>Advisory (N items)</summary>` collapsed section.
     d. **Iteration count** — small muted text: "Iteration {N} of 3".
```

**AC coverage:** AC2 (verdict table, blocking issues, advisory collapsed), AC11, AC12.

---

## Task 4: Add companion write step to Phase 5 (Groom)

**File:** `skills/groom/phases/phase-5-groom.md`

**What to do:**

Add a new step after Step 6 (state update) that writes the companion screen.

```markdown
#### Step 8: Companion screen

If `visual_companion: true` in `.pm/config.json`:

Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` using the template with:
- Phase stepper: phases 1-4.5 completed, phase 5 current, phases 5.5-5.8 upcoming.
- Content:
  a. **Decomposition table** — HTML table showing the pattern evaluation from Step 3:
     | Pattern | Fit | Verdict |
     Selected row highlighted with accent background.
  b. **Issue preview cards** — for each drafted issue, a card with:
     - Issue title (bold)
     - Outcome statement (one line, muted text)
     - AC count badge: "N ACs"
     Parent card: blue left-border. Child cards: light blue left-border, indented.
  c. **Mermaid user flow diagram** — if generated in Step 2a, include the Mermaid source in a `<pre class="mermaid">` block. The Mermaid.js CDN script in the template handles rendering. If no diagram was generated (API/data/infrastructure feature), omit this section.
```

**Key decision:** Mermaid diagrams are rendered client-side via the CDN script already in the template — no server-side rendering needed. This is the only phase that uses Mermaid.js, but the CDN script is included in all screens for simplicity (it's a small no-op on pages without `<pre class="mermaid">` blocks).

**AC coverage:** AC3 (decomposition table, issue previews, Mermaid diagram), AC11, AC12.

---

## Task 5: Add companion write step to Phase 5.5 (Team Review)

**File:** `skills/groom/phases/phase-5.5-team-review.md`

**What to do:**

Add a new step at the end (after step 5 — state update) that writes the companion screen.

```markdown
6. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-5 completed, phase 5.5 current, phases 5.7-5.8 upcoming.
   - Content:
     a. **Reviewer verdict table** — 4-column HTML table (or 3 if no Design reviewer):
        | Reviewer | Verdict | Key note |
        Rows: PM, Competitive, EM, Design (if applicable). Same color-coding as Phase 4.5.
     b. **Blocking issues** — numbered list with red left-border card.
     c. **Iteration count** — "Iteration {N} of 3" in muted text.
     d. **Conditions** — if any reviewer returned "Ready if {condition}", show conditions in an amber card.
```

**AC coverage:** AC4 (verdict table with Design, blocking issues, iteration count), AC11, AC12.

---

## Task 6: Add companion write step to Phase 5.7 (Bar Raiser)

**File:** `skills/groom/phases/phase-5.7-bar-raiser.md`

**What to do:**

Add a new step at the end (after step 5 — state update) that writes the companion screen.

```markdown
6. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-5.5 completed, phase 5.7 current, phase 5.8 upcoming.
   - Content:
     a. **Verdict badge** — large centered badge:
        - "Ready to present" → green
        - "Ready if {condition}" → amber, with condition text below
        - "Send back to team" → red
        - "Pause initiative" → gray
     b. **Conditions** — if present, listed in an amber card below the verdict.
     c. **Conviction statement** — the bar raiser's honest assessment, in a blockquote card.
     d. **Iteration count** — "Bar raiser iteration {N} of 2" in muted text.
```

**AC coverage:** AC5 (verdict, conditions, iteration count), AC11, AC12.

---

## Task 7: Add companion write step to Phase 5.8 (Present)

**File:** `skills/groom/phases/phase-5.8-present.md`

**What to do:**

Add a new step between Step 1.5 (scannability check) and Step 2 (open in browser) that writes the companion screen.

```markdown
#### Step 1.7: Companion screen

If `visual_companion: true` in `.pm/config.json`:

Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` using the template with:
- Phase stepper: phases 1-5.7 completed, phase 5.8 current.
- Content:
  a. **Proposal link** — prominent button/link: "View Full Proposal →" linking to `pm/backlog/proposals/{topic-slug}.html`. This is a relative file path link that works when opened directly.
  b. **Session summary card** — white card with:
     - Phases completed: list with checkmarks
     - Issues drafted: count
     - Total review iterations: scope review + team review + bar raiser iterations
     - Bar raiser verdict badge (same color-coding as Phase 5.7)
```

**AC coverage:** AC6 (proposal link, session summary), AC11, AC12.

---

## Task 8: Add placeholder companion screen for non-visual phases

**Files:** `skills/groom/phases/phase-1-intake.md`, `phase-2-strategy.md`, `phase-3-research.md`, `phase-6-link.md`

**What to do:**

Add a companion write step to each of these 4 phase files. The step writes a placeholder screen.

**Phase 1 (Intake):** Add after step 6 (state file creation):

```markdown
7. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phase 1 current, phases 2-5.8 upcoming.
   - Content: centered placeholder text:
     "Phase 1: Intake — in progress"
     Below: "Collecting context and setting up the session."

   Create the `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
```

**Phase 2 (Strategy Check):** Add after step 4 (state update):

```markdown
5. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phase 1 completed, phase 2 current, phases 3-5.8 upcoming.
   - Content: centered placeholder text:
     "Phase 2: Strategy Check — in progress"
     Below: "Checking alignment with product strategy."
```

**Phase 3 (Research):** Add after step 4 (state update):

```markdown
5. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-2 completed, phase 3 current, phases 4-5.8 upcoming.
   - Content: centered placeholder text:
     "Phase 3: Research — in progress"
     Below: "Investigating competitors, users, and market signals."
```

**Phase 6 (Link):** Add after step 5 (state update), before step 6 (retro):

```markdown
5.5. **Companion screen** (if `visual_companion: true` in `.pm/config.json`):

   Read the companion template from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` using the template with:
   - Phase stepper: phases 1-5.8 completed, phase 6 current (all phases done).
   - Content: centered placeholder text:
     "Phase 6: Linking Issues — in progress"
     Below: "Writing issues to backlog and running retro."
```

**Key decision:** Placeholder screens still use the full template with the phase stepper. The stepper is the key value — it shows progress at a glance. The placeholder content is minimal but the stepper makes it richer than the terminal.

**AC coverage:** AC7 (placeholder with stepper), AC9 (stepper labels), AC10 (stepper not in terminal), AC11, AC12.

---

## Task 9: Verify conditional guard in all write steps

**Files:** All 10 phase files modified in Tasks 2-8.

**What to do:**

Verify that every companion write step starts with the same conditional guard:

```
If `visual_companion: true` in `.pm/config.json`:
```

This means:
- If `.pm/config.json` does not exist → no write (config bootstrap in Phase 1 creates it with `visual_companion: true`, so this only happens if bootstrap failed).
- If `visual_companion: false` → no write.
- If `visual_companion` key is absent (legacy config) → no write. The key must be explicitly `true`.

Also verify that each write step creates the `.pm/sessions/groom-{slug}/` directory before writing `current.html`. Phase 1 creates it first; subsequent phases can assume it exists but should handle the case where it doesn't (mkdir -p equivalent).

**AC coverage:** AC11 (conditional on config).

---

## Implementation Order

1. **Task 1** — Create `skills/groom/references/companion-template.md` (the template all phases reference)
2. **Task 8** — Add placeholder screens to phases 1, 2, 3, 6 (simplest — proves the template works)
3. **Task 2** — Phase 4 companion screen (scope grid)
4. **Task 3** — Phase 4.5 companion screen (scope review verdicts)
5. **Task 4** — Phase 5 companion screen (decomposition + Mermaid)
6. **Task 5** — Phase 5.5 companion screen (team review verdicts)
7. **Task 6** — Phase 5.7 companion screen (bar raiser verdict)
8. **Task 7** — Phase 5.8 companion screen (proposal link + summary)
9. **Task 9** — Verify all conditional guards are consistent

Tasks 2-8 are independent of each other (each modifies a different file) and could be parallelized. Task 1 must come first (all others reference the template). Task 9 is a final verification pass.

---

## Files Changed

| File | Change |
|---|---|
| `skills/groom/references/companion-template.md` | New file: HTML template with stepper, header, content slot, footer |
| `skills/groom/phases/phase-1-intake.md` | Add step 8: placeholder companion screen |
| `skills/groom/phases/phase-2-strategy.md` | Add step 5: placeholder companion screen |
| `skills/groom/phases/phase-3-research.md` | Add step 5: placeholder companion screen |
| `skills/groom/phases/phase-4-scope.md` | Add step 8: scope grid companion screen |
| `skills/groom/phases/phase-4.5-scope-review.md` | Add step 6: verdict table companion screen |
| `skills/groom/phases/phase-5-groom.md` | Add Step 8: decomposition + issue previews + Mermaid |
| `skills/groom/phases/phase-5.5-team-review.md` | Add step 6: verdict table companion screen |
| `skills/groom/phases/phase-5.7-bar-raiser.md` | Add step 6: verdict badge companion screen |
| `skills/groom/phases/phase-5.8-present.md` | Add Step 1.7: proposal link + session summary |
| `skills/groom/phases/phase-6-link.md` | Add step 5.5: placeholder companion screen |

---

## Risks and Mitigations

- **LLM output consistency.** The companion template is read and filled by the LLM, not by a templating engine. Quality may vary across sessions. **Mitigation:** The template is detailed with exact CSS classes, HTML structure, and content specifications. The reference file serves as a strong prompt anchor. If a phase's companion screen is malformed, the session route falls back to the rendered state file (PM-060 AC1).
- **Context pressure.** Reading the template reference adds ~2K tokens per phase. **Mitigation:** The template file is compact (similar to `splitting-patterns.md` at ~4.5K). Each phase only reads it once. The fallback (PM-060 state render) ensures the session page always shows something.
- **Directory creation race.** Multiple phases write to `.pm/sessions/groom-{slug}/`. If the directory doesn't exist, the write fails silently. **Mitigation:** Phase 1 creates the directory. All other phases include a "create if not exists" guard.
- **Mermaid.js CDN availability.** Phase 5 depends on the Mermaid CDN for diagram rendering. **Mitigation:** Same CDN URL used by the dashboard (`dashboardPage()` at server.js:900) and proposal HTML files. If offline, diagrams show as raw text — acceptable degradation.
