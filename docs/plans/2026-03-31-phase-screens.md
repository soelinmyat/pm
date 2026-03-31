# PM-061: Per-Phase Companion Screens

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each groom phase writes a rich, self-contained HTML companion screen to `.pm/sessions/groom-{slug}/current.html` so the browser shows formatted tables, scope grids, verdict summaries, and a phase stepper — not just terminal text.

**Architecture:** A reusable companion template (defined in `skills/groom/references/companion-template.md`) provides the HTML shell: header, phase stepper, content slot, footer. Each visual phase (4, 4.5, 5, 5.5, 5.7, 5.8) gets a write step added to its phase file that fills the content slot with phase-specific output. Non-visual phases (1, 2, 3, 6) write a placeholder with the stepper only. The write is conditional on `visual_companion` not being `false` in `.pm/config.json`. PM-060's `current.html` override in `handleSessionPage()` serves these files, and the `.pm/sessions/` watcher triggers WebSocket live-reload.

**Tech Stack:** Markdown (skill phase files), HTML/CSS (companion template), Mermaid.js CDN (Phase 5 diagrams)

---

## Current State

What **already works** (from PM-060):

| Feature | Location |
|---------|----------|
| `/session/{slug}` route serves `current.html` override | server.js `handleSessionPage()` |
| `.pm/sessions/` watched for live-reload | server.js `createDashboardServer()` |
| Phase 1 auto-opens dashboard | `skills/groom/phases/phase-1-intake.md` step 7 |
| `GROOM_PHASE_LABELS` maps phase keys to labels | server.js:1476-1487 |
| `DASHBOARD_CSS` provides design vocabulary | server.js:428-700 |
| `renderMarkdown()` handles tables, lists, Mermaid | server.js:284-420 |
| `visual_companion: true` default in config bootstrap | phase-1-intake.md:18 |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC8 | Companion template not defined | Task 1 |
| AC7, AC9 | Non-visual phase placeholder not defined | Task 2 |
| AC1 | Phase 4 companion screen write step | Task 3 |
| AC2 | Phase 4.5 companion screen write step | Task 4 |
| AC3 | Phase 5 companion screen write step | Task 5 |
| AC4 | Phase 5.5 companion screen write step | Task 6 |
| AC5 | Phase 5.7 companion screen write step | Task 7 |
| AC6 | Phase 5.8 companion screen write step | Task 8 |

---

## Shared Definitions

### Phase Stepper Mapping

The stepper covers all groom phases. Each phase has three labels: a gerund (in-progress), past-tense (completed), and a short label (upcoming/default).

| Key | Short Label | Gerund (current) | Past Tense (completed) |
|-----|-------------|-------------------|------------------------|
| `intake` | Intake | Capturing idea... | Idea captured |
| `strategy-check` | Strategy | Checking strategy... | Strategy checked |
| `research` | Research | Researching... | Research complete |
| `scope` | Scope | Defining scope... | Scope defined |
| `scope-review` | Scope Review | Reviewing scope... | Scope reviewed |
| `groom` | Groom | Drafting issues... | Issues drafted |
| `team-review` | Team Review | Reviewing issues... | Issues reviewed |
| `bar-raiser` | Bar Raiser | Raising the bar... | Bar raised |
| `present` | Present | Presenting... | Presented |

The phase stepper uses this sequence order: `['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'groom', 'team-review', 'bar-raiser', 'present']`. Phases before the current one show past-tense + checkmark. The current phase shows gerund. Phases after show short label, greyed out.

### Visual Companion Gate

Every write step is wrapped in this check:

```
Read `.pm/config.json`. If `preferences.visual_companion` is `false`, skip the HTML write silently.
If `true`, unset, or file missing/malformed, proceed with the write.
```

Only `false` disables. This matches PM-060 Task 4's opt-out semantics.

### File Write Pattern

All phases use this pattern to write `current.html`:

1. Resolve the session directory: `.pm/sessions/groom-{slug}/`
2. Create the directory if it doesn't exist: `mkdir -p`
3. Write `current.html` using the companion template from `skills/groom/references/companion-template.md`
4. Fill the `{TOPIC}`, `{PHASE_LABEL}`, `{STEPPER_HTML}`, and `{CONTENT}` slots

Each phase overwrites `current.html` (AC12). The browser auto-refreshes via WebSocket.

---

## Task 1: Create Companion Template Reference

**Files:**
- Create: `skills/groom/references/companion-template.md`

This template is the single source of truth for all companion screen HTML. All phase write steps reference it.

- [ ] **Step 1: Write the companion template**

Create `skills/groom/references/companion-template.md` with the following content:

````markdown
# Companion Screen Template

Reference template for per-phase companion screens written to `.pm/sessions/groom-{slug}/current.html`.

All phase write steps produce a complete HTML document following this structure. Fill the placeholder slots with phase-specific content.

## Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TOPIC} — {PHASE_LABEL}</title>
<style>
  :root {
    --bg: #0d0f12; --surface: #1a1d23; --border: #2a2e37;
    --text: #e8eaed; --text-muted: #8b8f96;
    --accent: #5e6ad2; --accent-subtle: #1e1f35;
    --success: #4ade80; --warning: #fb923c;
    --radius: 8px; --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem; }

  /* Header */
  .header { margin-bottom: 1.5rem; }
  .header h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  .header .phase-label {
    font-size: 0.8125rem; color: var(--accent); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;
  }

  /* Phase Stepper */
  .stepper { display: flex; gap: 0; margin-bottom: 2rem; overflow-x: auto; }
  .step {
    flex: 1; text-align: center; padding: 0.625rem 0.25rem;
    font-size: 0.6875rem; font-weight: 500; position: relative;
    border-bottom: 2px solid var(--border); color: var(--text-muted);
    white-space: nowrap; min-width: 0;
  }
  .step.completed { border-bottom-color: var(--success); color: var(--success); }
  .step.current { border-bottom-color: var(--accent); color: var(--accent); font-weight: 700; }
  .step .icon { display: block; font-size: 0.875rem; margin-bottom: 0.125rem; }

  /* Content */
  .content { margin-bottom: 2rem; }
  .content h2 { font-size: 1.125rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
  .content h3 { font-size: 0.9375rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  .content p { margin-bottom: 0.75rem; }
  .content ul { margin: 0.5rem 0 0.75rem 1.5rem; }
  .content li { margin-bottom: 0.25rem; }

  /* Tables */
  .content table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
  .content th, .content td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
  .content th {
    background: #1e2128; font-weight: 600; font-size: 0.8125rem;
    text-transform: uppercase; letter-spacing: 0.03em; color: var(--text-muted);
  }

  /* Scope Grid (two-column) */
  .scope-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1rem 0; }
  .scope-col {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1rem;
  }
  .scope-col h3 { margin-top: 0; }
  .scope-col.in-scope { border-left: 3px solid var(--success); }
  .scope-col.out-scope { border-left: 3px solid var(--warning); }

  /* Badge */
  .badge {
    display: inline-block; padding: 0.2em 0.6em; border-radius: 4px;
    font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-success { background: rgba(74,222,128,0.15); color: var(--success); }
  .badge-warning { background: rgba(251,146,60,0.15); color: var(--warning); }
  .badge-info { background: rgba(94,106,210,0.15); color: var(--accent); }

  /* Cards */
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1rem 1.25rem; margin-bottom: 0.75rem;
  }
  .card h3 { margin-top: 0; font-size: 0.9375rem; }
  .card .outcome { color: var(--text-muted); font-size: 0.875rem; margin-bottom: 0.5rem; }

  /* Verdict row */
  .verdict-row {
    display: flex; gap: 0.75rem; margin: 1rem 0; flex-wrap: wrap;
  }
  .verdict-card {
    flex: 1; min-width: 140px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 0.75rem 1rem; text-align: center;
  }
  .verdict-card .role { font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .verdict-card .verdict { font-size: 0.875rem; font-weight: 700; margin-top: 0.25rem; }

  /* Numbered list (for blocking issues) */
  .content ol { margin: 0.5rem 0 0.75rem 1.5rem; }
  .content ol li { margin-bottom: 0.375rem; }

  /* Collapsible */
  details { margin: 0.75rem 0; }
  summary {
    cursor: pointer; font-weight: 600; font-size: 0.875rem;
    color: var(--text-muted); padding: 0.5rem 0;
  }
  details[open] summary { color: var(--text); }

  /* Footer */
  .footer {
    margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border);
    font-size: 0.75rem; color: var(--text-muted); text-align: center;
  }

  /* Responsive */
  @media (max-width: 640px) {
    .scope-grid { grid-template-columns: 1fr; }
    .verdict-row { flex-direction: column; }
    .stepper { font-size: 0.5625rem; }
  }
</style>
<!-- Mermaid.js for diagram rendering (Phase 5) -->
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="phase-label">{PHASE_LABEL}</div>
    <h1>{TOPIC}</h1>
  </div>

  <div class="stepper">
    {STEPPER_HTML}
    <!-- Each step: <div class="step completed|current|upcoming"><span class="icon">...</span> Label</div> -->
  </div>

  <div class="content">
    {CONTENT}
  </div>

  <div class="footer">Powered by PM</div>
</div>
</body>
</html>
```

## Stepper Construction

Build `{STEPPER_HTML}` using this logic:

```
PHASE_ORDER = ['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'groom', 'team-review', 'bar-raiser', 'present']

LABELS = {
  intake:         { gerund: 'Capturing idea...',    past: 'Idea captured',     short: 'Intake' },
  strategy-check: { gerund: 'Checking strategy...', past: 'Strategy checked',  short: 'Strategy' },
  research:       { gerund: 'Researching...',        past: 'Research complete', short: 'Research' },
  scope:          { gerund: 'Defining scope...',     past: 'Scope defined',     short: 'Scope' },
  scope-review:   { gerund: 'Reviewing scope...',    past: 'Scope reviewed',    short: 'Scope Review' },
  groom:          { gerund: 'Drafting issues...',    past: 'Issues drafted',    short: 'Groom' },
  team-review:    { gerund: 'Reviewing issues...',   past: 'Issues reviewed',   short: 'Team Review' },
  bar-raiser:     { gerund: 'Raising the bar...',    past: 'Bar raised',        short: 'Bar Raiser' },
  present:        { gerund: 'Presenting...',         past: 'Presented',         short: 'Present' },
}

For each phase in PHASE_ORDER:
  if index < currentIndex  → class="step completed", icon="&#10003;", label=past
  if index == currentIndex → class="step current",   icon="&#9679;",  label=gerund
  if index > currentIndex  → class="step",           icon="",         label=short
```

## Content Slot

The `{CONTENT}` slot is phase-specific. Each phase write step in the plan specifies exactly what HTML to produce for the content area. Use the CSS classes defined above (`.scope-grid`, `.verdict-row`, `.card`, `.badge`, tables, etc.) to build content that is richer than terminal output.
````

- [ ] **Step 2: Verify the file was created**

Run: `cat skills/groom/references/companion-template.md | head -5`
Expected: Shows the title and first few lines.

- [ ] **Step 3: Commit**

```bash
git add skills/groom/references/companion-template.md
git commit -m "feat: add companion screen HTML template reference (PM-061 AC8)"
```

---

## Task 2: Add Placeholder Write Step for Non-Visual Phases

**Files:**
- Modify: `skills/groom/phases/phase-1-intake.md` (after step 7 visual companion auto-open)
- Modify: `skills/groom/phases/phase-2-strategy.md` (at end, before state update)
- Modify: `skills/groom/phases/phase-3-research.md` (at end, before state update)
- Modify: `skills/groom/phases/phase-6-link.md` (at end, before state update)

Non-visual phases write a placeholder `current.html` showing the phase stepper and "Phase N: {label} — in progress". The stepper is the rich element that makes this more useful than terminal output (AC10).

- [ ] **Step 1: Add write step to phase-1-intake.md**

After step 7 (visual companion auto-open) and before the state update block, add:

```markdown
8. **Companion screen (silent).**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Write `.pm/sessions/groom-{slug}/current.html` using the companion template (`${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`).

   - `{TOPIC}`: the topic from step 1
   - `{PHASE_LABEL}`: "Intake"
   - `{STEPPER_HTML}`: build per the template's stepper construction rules, with `intake` as current phase
   - `{CONTENT}`:
     ```html
     <div style="display:flex;align-items:center;justify-content:center;min-height:30vh;">
       <p style="font-size:1.125rem;color:var(--text-muted);">Phase 1: Intake — in progress</p>
     </div>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.
```

- [ ] **Step 2: Add write step to phase-2-strategy.md**

Before the state update, add a parallel write step. Same pattern as Step 1 but with:
- `{PHASE_LABEL}`: "Strategy Check"
- Stepper: `strategy-check` as current, `intake` as completed
- Content: `Phase 2: Strategy Check — in progress`

- [ ] **Step 3: Add write step to phase-3-research.md**

Before the state update, add a parallel write step. Same pattern:
- `{PHASE_LABEL}`: "Research"
- Stepper: `research` as current, `intake` + `strategy-check` as completed
- Content: `Phase 3: Research — in progress`

- [ ] **Step 4: Add write step to phase-6-link.md**

Before the state update, add a parallel write step. Same pattern:
- `{PHASE_LABEL}`: "Linking Issues"
- Stepper: all phases completed (this is the last phase)
- Content: `Phase 6: Linking Issues — in progress`

- [ ] **Step 5: Commit**

```bash
git add skills/groom/phases/phase-1-intake.md skills/groom/phases/phase-2-strategy.md skills/groom/phases/phase-3-research.md skills/groom/phases/phase-6-link.md
git commit -m "feat: placeholder companion screens for non-visual phases (PM-061 AC7)"
```

---

## Task 3: Phase 4 (Scope) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-4-scope.md`

Phase 4 produces: in-scope items, out-of-scope items with reasons, and the 10x filter result. The companion screen formats these as a two-column scope grid with a filter badge (AC1).

- [ ] **Step 1: Add companion screen write step to phase-4-scope.md**

After step 5 (scope grid offer) and before step 6 (state update), add:

```markdown
5.5. **Companion screen.**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Scope"
   - `{STEPPER_HTML}`: `scope` as current phase; `intake`, `strategy-check`, `research` as completed
   - `{CONTENT}`: Build this HTML using the actual scope data:

     ```html
     <h2>Scope Definition</h2>
     <span class="badge badge-success">10x</span> <!-- or badge-warning for parity, badge-info for gap-fill -->

     <div class="scope-grid">
       <div class="scope-col in-scope">
         <h3>In Scope</h3>
         <ul>
           <li>{in-scope item 1}</li>
           <li>{in-scope item 2}</li>
           <!-- one <li> per in_scope item -->
         </ul>
       </div>
       <div class="scope-col out-scope">
         <h3>Out of Scope</h3>
         <ul>
           <li><strong>{item}</strong> — {reason}</li>
           <!-- one <li> per out_of_scope item, with reason -->
         </ul>
       </div>
     </div>
     ```

     The filter result badge uses: `10x` → `badge-success`, `parity` → `badge-warning`, `gap-fill` → `badge-info`.

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.
```

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-4-scope.md
git commit -m "feat: Phase 4 scope grid companion screen (PM-061 AC1)"
```

---

## Task 4: Phase 4.5 (Scope Review) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-4.5-scope-review.md`

Phase 4.5 produces: reviewer verdict table (PM, Competitive, EM), blocking issues as a numbered list, and advisory items collapsed below (AC2).

- [ ] **Step 1: Add companion screen write step to phase-4.5-scope-review.md**

After step 4 ("If iteration 3 still has blocking issues...") and before step 5 (state update), add:

```markdown
4.5. **Companion screen.**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Scope Review"
   - `{STEPPER_HTML}`: `scope-review` as current; `intake` through `scope` as completed
   - `{CONTENT}`: Build from the merged review outputs:

     ```html
     <h2>Scope Review</h2>

     <div class="verdict-row">
       <div class="verdict-card">
         <div class="role">Product Manager</div>
         <div class="verdict">{pm_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Competitive Strategist</div>
         <div class="verdict">{competitive_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Engineering Manager</div>
         <div class="verdict">{em_verdict}</div>
       </div>
     </div>

     <h3>Blocking Issues</h3>
     <ol>
       <li>{blocking issue 1} — {why}</li>
       <!-- one <li> per blocking issue, or <p>None</p> if all resolved -->
     </ol>

     <details>
       <summary>Advisory Items ({count})</summary>
       <ul>
         <li>{advisory 1}</li>
         <!-- one <li> per advisory/pushback/opportunity item -->
       </ul>
     </details>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.
```

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-4.5-scope-review.md
git commit -m "feat: Phase 4.5 scope review verdict companion screen (PM-061 AC2)"
```

---

## Task 5: Phase 5 (Groom) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-5-groom.md`

Phase 5 produces: decomposition table, issue preview cards, and Mermaid user flow diagram. The Mermaid diagram uses a client-side `<script>` tag — not server-side `renderMarkdown()` (AC3).

- [ ] **Step 1: Add companion screen write step to phase-5-groom.md**

After Step 5 (draft issues) and before Step 6 (state update), add:

```markdown
#### Step 5.5: Companion screen

Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` with:

- `{TOPIC}`: the topic from groom state
- `{PHASE_LABEL}`: "Drafting Issues"
- `{STEPPER_HTML}`: `groom` as current; `intake` through `scope-review` as completed
- `{CONTENT}`: Build from the decomposition and drafted issues:

  ```html
  <h2>Decomposition</h2>
  <table>
    <thead><tr><th>Pattern</th><th>Fit</th><th>Verdict</th></tr></thead>
    <tbody>
      <tr><td>{pattern}</td><td>{fit rationale}</td><td><strong>{Selected/Rejected}</strong></td></tr>
      <!-- one row per candidate pattern from Step 3 -->
    </tbody>
  </table>

  <h2>Issues</h2>
  <!-- One card per drafted issue -->
  <div class="card">
    <h3>{issue title}</h3>
    <p class="outcome">{outcome statement}</p>
  </div>
  <!-- Repeat for each child issue -->

  <h2>User Flow</h2>
  <pre class="mermaid">
  {mermaid diagram source from Step 2a — raw text, not rendered}
  </pre>
  <!-- Mermaid.js script in template head renders this client-side -->
  ```

  If no Mermaid diagram was generated (non-UI feature type), omit the User Flow section.

Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
Do not mention this step to the user.
```

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-5-groom.md
git commit -m "feat: Phase 5 groom companion screen with decomposition + Mermaid (PM-061 AC3)"
```

---

## Task 6: Phase 5.5 (Team Review) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-5.5-team-review.md`

Phase 5.5 produces: reviewer verdict table (PM, Competitive, EM, Design), blocking issues, and iteration count (AC4).

- [ ] **Step 1: Add companion screen write step to phase-5.5-team-review.md**

After step 4 ("Advisory findings are accumulated...") and before step 5 (state update), add:

```markdown
4.5. **Companion screen.**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Team Review"
   - `{STEPPER_HTML}`: `team-review` as current; `intake` through `groom` as completed
   - `{CONTENT}`:

     ```html
     <h2>Team Review</h2>
     <p>Iteration {N} of 3</p>

     <div class="verdict-row">
       <div class="verdict-card">
         <div class="role">Product Manager</div>
         <div class="verdict">{pm_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Competitive Strategist</div>
         <div class="verdict">{competitive_verdict}</div>
       </div>
       <div class="verdict-card">
         <div class="role">Engineering Manager</div>
         <div class="verdict">{em_verdict}</div>
       </div>
       <!-- Include Design card only if design reviewer was dispatched -->
       <div class="verdict-card">
         <div class="role">Design Reviewer</div>
         <div class="verdict">{design_verdict}</div>
       </div>
     </div>

     <h3>Blocking Issues</h3>
     <ol>
       <li>{blocking issue 1}</li>
       <!-- or <p>None — all resolved</p> -->
     </ol>

     <details>
       <summary>Advisory Items ({count})</summary>
       <ul>
         <li>{advisory 1}</li>
       </ul>
     </details>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.
```

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-5.5-team-review.md
git commit -m "feat: Phase 5.5 team review verdict companion screen (PM-061 AC4)"
```

---

## Task 7: Phase 5.7 (Bar Raiser) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-5.7-bar-raiser.md`

Phase 5.7 produces: verdict, conditions, and iteration count (AC5).

- [ ] **Step 1: Add companion screen write step to phase-5.7-bar-raiser.md**

After step 4 ("If verdict is 'Pause initiative'...") and before step 5 (state update), add:

```markdown
4.5. **Companion screen.**

   Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

   Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

   Write `.pm/sessions/groom-{slug}/current.html` with:

   - `{TOPIC}`: the topic from groom state
   - `{PHASE_LABEL}`: "Bar Raiser"
   - `{STEPPER_HTML}`: `bar-raiser` as current; `intake` through `team-review` as completed
   - `{CONTENT}`:

     ```html
     <h2>Bar Raiser Review</h2>
     <p>Iteration {N} of 2</p>

     <div class="verdict-row">
       <div class="verdict-card" style="flex:none;min-width:200px;">
         <div class="role">Product Director</div>
         <div class="verdict">{verdict}</div>
       </div>
     </div>

     <!-- Show conditions only if verdict is "Ready if {condition}" -->
     <h3>Conditions</h3>
     <ul>
       <li>{condition text}</li>
     </ul>

     <!-- Show blocking issues if verdict is "Send back" or has blocking items -->
     <h3>Blocking Issues</h3>
     <ol>
       <li>{issue} — {why}</li>
       <!-- or <p>None</p> -->
     </ol>

     <h3>Conviction</h3>
     <p>{bar raiser's honest assessment}</p>
     ```

   Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
   Do not mention this step to the user.
```

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-5.7-bar-raiser.md
git commit -m "feat: Phase 5.7 bar raiser verdict companion screen (PM-061 AC5)"
```

---

## Task 8: Phase 5.8 (Present) Companion Screen

**Files:**
- Modify: `skills/groom/phases/phase-5.8-present.md`

Phase 5.8 produces: a link to the full HTML proposal and a session summary (AC6). This is the final visual phase — the stepper shows all phases completed.

- [ ] **Step 1: Add companion screen write step to phase-5.8-present.md**

After Step 1.5 (scannability check) and before Step 2 (open in dashboard), add:

```markdown
#### Step 1.7: Companion screen

Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` with:

- `{TOPIC}`: the topic from groom state
- `{PHASE_LABEL}`: "Presentation"
- `{STEPPER_HTML}`: `present` as current; all prior phases as completed
- `{CONTENT}`:

  ```html
  <h2>Session Complete</h2>

  <div class="card">
    <h3>Proposal</h3>
    <p><a href="/proposals/{topic-slug}" style="color:var(--accent);font-weight:600;">
      View full proposal &rarr;
    </a></p>
  </div>

  <h2>Session Summary</h2>
  <table>
    <tbody>
      <tr><th style="width:40%;">Phases completed</th><td>{count} of 9</td></tr>
      <tr><th>Issues drafted</th><td>{issue count}</td></tr>
      <tr><th>Scope review iterations</th><td>{scope_review.iterations}</td></tr>
      <tr><th>Team review iterations</th><td>{team_review.iterations}</td></tr>
      <tr><th>Bar raiser iterations</th><td>{bar_raiser.iterations}</td></tr>
    </tbody>
  </table>
  ```

Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
Do not mention this step to the user.
```

Note: The proposal link uses the dashboard route `/proposals/{topic-slug}` (not a file path) so it works when viewed through the dashboard. Step 2 opens the full proposal in the dashboard anyway, so this companion screen is a brief landing page before the user navigates to the full proposal.

- [ ] **Step 2: Commit**

```bash
git add skills/groom/phases/phase-5.8-present.md
git commit -m "feat: Phase 5.8 session summary companion screen (PM-061 AC6)"
```

---

## Implementation Order

```
Task 1 ──► Task 2 ──► Task 3 ──► Task 4 ──► Task 5 ──► Task 6 ──► Task 7 ──► Task 8
template    placeholders  scope    scope-rev   groom     team-rev   bar-raiser  present
```

Task 1 must be first (all others reference the template). Tasks 2-8 are independent of each other but should be done sequentially to avoid merge conflicts in nearby lines. No tasks modify `scripts/server.js` — all changes are to skill markdown files.

---

## Files Changed

| File | Change |
|------|--------|
| `skills/groom/references/companion-template.md` | New — HTML template with CSS, stepper logic, content slot |
| `skills/groom/phases/phase-1-intake.md` | Add step 8: placeholder companion screen write |
| `skills/groom/phases/phase-2-strategy.md` | Add companion screen write step before state update |
| `skills/groom/phases/phase-3-research.md` | Add companion screen write step before state update |
| `skills/groom/phases/phase-4-scope.md` | Add step 5.5: scope grid companion screen |
| `skills/groom/phases/phase-4.5-scope-review.md` | Add step 4.5: verdict table companion screen |
| `skills/groom/phases/phase-5-groom.md` | Add step 5.5: decomposition + Mermaid companion screen |
| `skills/groom/phases/phase-5.5-team-review.md` | Add step 4.5: team verdict companion screen |
| `skills/groom/phases/phase-5.7-bar-raiser.md` | Add step 4.5: bar raiser verdict companion screen |
| `skills/groom/phases/phase-5.8-present.md` | Add step 1.7: session summary companion screen |
| `skills/groom/phases/phase-6-link.md` | Add companion screen write step before state update |

---

## Risks

- **LLM output consistency.** The companion screen HTML is authored by the LLM during a groom session. If context pressure causes it to skip or malform the HTML, the fallback is PM-060's state-based view (already rendered by `handleSessionPage()`). This is acceptable — the companion screen is an enhancement, not a replacement.
- **Stepper accuracy.** The stepper depends on the LLM correctly identifying which phases are completed vs current. Mitigating by making the phase order a fixed constant in the template reference, not a dynamic lookup.
- **Mermaid rendering.** Phase 5's companion screen includes raw Mermaid source in a `<pre class="mermaid">` block. If the CDN is unreachable (offline/firewall), the user sees raw Mermaid text instead of a rendered diagram. Acceptable tradeoff — the text is still readable.
- **No server.js changes.** This plan only modifies skill markdown files. All server infrastructure (route override, watcher, live-reload) is provided by PM-060. If PM-060 is not implemented yet, companion screens will be written but not served.
