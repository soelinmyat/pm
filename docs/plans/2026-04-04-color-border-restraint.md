# PM-119: Color and Border Restraint Pass

**Size:** M | **Depends:** PM-117 (tokens), PM-118 (typography/spacing)
**Outcome:** 90% grayscale, color only when meaningful, nearly invisible borders.

---

## Color Inventory

### Hardcoded hex colors in DASHBOARD_CSS (lines 446-1216)

| Current Color | Where Used | Count | Proposed Replacement |
|---------------|-----------|-------|---------------------|
| `#0d0f12` | `--bg` dark theme | 1 | Keep as token definition |
| `#1a1d23` | `--surface` dark theme | 1 | Keep as token definition |
| `#2a2e37` | `--border` dark theme | 1 | **Replace with** `rgba(255,255,255,0.08)` for near-invisible borders |
| `#e8eaed` | `--text` dark | 1 | Keep as token definition |
| `#8b8f96` | `--text-muted` dark, `.kanban-label` color, `.badge-archived` color | 3 | Keep as token, reference via `var(--text-muted)` |
| `#5e6ad2` | `--accent` both themes | 2 | Keep as unified accent |
| `#7c85e0` | `--accent-hover` dark | 1 | Keep as token definition |
| `#1e1f35` | `--accent-subtle` dark | 1 | Keep as token definition |
| `#111318` | `--dark`, `--sidebar-bg`, `pre` background | 3 | Keep as token; `pre` should use `var(--dark)` |
| `#4ade80` | `--success` dark, `.badge-ready/fresh/green`, `.scope-small`, `.quadrant-q1` colors | 6 | All reference `var(--success)` |
| `#fb923c` | `--warning` dark | 1 | Keep as token |
| `#38bdf8` | `--info` dark, `.badge-evidence` color | 2 | Reference `var(--info)` |
| `#f8f9fb` | `--bg` light | 1 | Keep as token definition |
| `#ffffff` | `--surface` light, `--sidebar-text` dark | 2 | Keep as token definitions |
| `#e2e5ea` | `--border` light | 1 | **Replace with** `rgba(0,0,0,0.06)` for near-invisible borders |
| `#1e2128` | `--text` light, `pre` color, `th` bg, `.badge` bg, `p code` bg, `.kanban-label` bg | 7 | Create `var(--surface-raised)` for elevated bg; others use `var(--text)` |
| `#6b7280` | `--text-muted` light, `.badge-empty` color, `.quadrant-q4` color | 3 | Use `var(--text-muted)` |
| `#4f5bc4` | `--accent-hover` light | 1 | Keep as token definition |
| `#eef0ff` | `--accent-subtle` light | 1 | Keep as token definition |
| `#1a1a2e` | `--dark` light | 1 | Keep as token definition |
| `#16a34a` | `--success` light | 1 | Keep as token definition |
| `#ea580c` | `--warning` light | 1 | Keep as token definition |
| `#0891b2` | `--info` light | 1 | Keep as token definition |
| `#dc2626` | `.priority-critical`, `.bar-fill-red` | 2 | Create `var(--error)` token |
| `#f59e0b` | `.priority-high` | 1 | Use `var(--warning)` |
| `#3b82f6` | `.priority-medium` | 1 | Use `var(--info)` |
| `#9ca3af` | `.priority-low`, scrollbar light | 2 | Create `var(--text-faint)` |
| `#818cf8` | `.badge-in-progress`, `.badge-origin-internal`, `.scope-medium`, `.quadrant-q3` color | 4 | **Reduce** — use `var(--accent)` for all purple-ish tones |
| `#fbbf24` | `.badge-aging/origin-mixed`, `.scope-large`, `.quadrant-q2` color | 4 | Use `var(--warning)` |
| `#f87171` | `.badge-stale`, `.swot-weaknesses h4` | 2 | Create `var(--error-text)` |
| `#1a2040` | `.badge-in-progress/origin-internal/groom/draft`, `.scope-medium` bg | 5 | Create `var(--badge-accent-bg)` |
| `#132b1a` | `.badge-ready/fresh/green/approved/dev`, `.scope-small`, `.quadrant-q1` bg | 6 | Create `var(--badge-success-bg)` |
| `#2e2810` | `.badge-aging/origin-mixed`, `.scope-large`, `.quadrant-q2` bg | 4 | Create `var(--badge-warning-bg)` |
| `#2e1a1a` | `.badge-stale`, `.heatmap-missing` bg | 2 | Create `var(--badge-error-bg)` |
| `#222630` | `.badge-empty/origin-external`, `.quadrant-q4` bg | 3 | Create `var(--badge-neutral-bg)` |
| `#0d2530` | `.badge-evidence` bg | 1 | Create `var(--badge-info-bg)` |
| `#0d1f0d` | `.swot-strengths` bg | 1 | Use `var(--badge-success-bg)` (adjust if needed) |
| `#1f0d0d` | `.swot-weaknesses` bg | 1 | Use `var(--badge-error-bg)` |
| `#0d1520` | `.swot-opportunities` bg | 1 | Use `var(--badge-accent-bg)` |
| `#1f1a0d` | `.swot-threats` bg | 1 | Use `var(--badge-warning-bg)` |
| `#1a3a1a` | `.swot-strengths` border | 1 | Use `var(--border)` (near-invisible) |
| `#3a1a1a` | `.swot-weaknesses` border | 1 | Use `var(--border)` |
| `#1a2540` | `.swot-opportunities` border | 1 | Use `var(--border)` |
| `#3a3010` | `.swot-threats` border | 1 | Use `var(--border)` |
| `#044842` | `.scatter-dot.highlight`, `.bar-fill-teal` | 2 | Create `var(--teal)` |
| `#2563eb` | `.bar-fill-blue`, fallback accents, `.stat-card-link` | 4 | Use `var(--accent)` (unified to `#5e6ad2`) |
| `#3a3f4a` | scrollbar thumb hover dark | 1 | Use lighter `var(--border)` |
| `#c4c8d0` | `pre` text color dark | 1 | Use `var(--text-muted)` |
| `#fff` | various text-on-accent, toggle active | 4 | Keep as literal or create `var(--text-on-accent)` |

### Hardcoded colors in inline styles (HTML generation)

| Line | Color | Proposed |
|------|-------|----------|
| 3529 | `#2563eb` | `var(--info)` |
| 3538 | `#16a34a` | `var(--success)` |
| 4250 | `#6366f1`, `#dc2626`, `#2563eb`, `#16a34a`, `#044842` | Scatter segment colors — keep as data-driven, but define as CSS variables |
| 4981 | `#fff`, `#e5e7eb`, `#7c3aed` | `var(--surface)`, `var(--border)`, `var(--accent)` |
| 5094 | `#ef4444` | Use `var(--error)` |

---

## Badge Palette Reduction

### Current badges (18 distinct visual styles)

```
badge-ready, badge-fresh, badge-green  -> All green -> MERGE into semantic "success"
badge-approved, badge-dev              -> Green     -> MERGE into "success"
badge-aging, badge-origin-mixed        -> Amber     -> MERGE into semantic "warning"
badge-stale                            -> Red       -> Semantic "error"
badge-in-progress, badge-groom, badge-draft, badge-origin-internal -> Purple -> MERGE into semantic "info" (accent)
badge-empty, badge-origin-external, badge-archived -> Gray -> Semantic "neutral"
badge-evidence                         -> Blue      -> Semantic "info"
```

### Proposed 4 semantic badges + 1 neutral

| Semantic Class | Color | Replaces |
|---------------|-------|----------|
| `.badge--success` | green (var(--success)) | badge-ready, badge-fresh, badge-green, badge-approved, badge-dev |
| `.badge--warning` | amber (var(--warning)) | badge-aging, badge-origin-mixed |
| `.badge--error` | red (var(--error)) | badge-stale |
| `.badge--info` | accent blue (var(--accent)) | badge-in-progress, badge-groom, badge-draft, badge-origin-internal, badge-evidence |
| `.badge--neutral` | grayscale | badge-empty, badge-origin-external, badge-archived |

The old class names are kept as aliases during migration (empty rules pointing to semantic tokens) to avoid breaking any tests.

---

## Border Strategy

### Current
- `--border: #2a2e37` (dark) / `#e2e5ea` (light) — visible, solid borders everywhere

### Proposed
- `--border: rgba(255,255,255,0.08)` (dark) / `rgba(0,0,0,0.06)` (light) — near-invisible
- `--border-strong: rgba(255,255,255,0.15)` (dark) / `rgba(0,0,0,0.12)` (light) — for intentional dividers (kanban columns, tables)
- Cards use `var(--surface)` vs `var(--bg)` differentiation instead of visible borders
- SWOT box borders replaced with `var(--border)` (near-invisible) — color in background is enough

---

## TDD Task Breakdown

### Task 1: Define new semantic color tokens

**Test:** Assert `:root` block contains `--error`, `--error-text`, `--teal`, `--text-on-accent`, `--text-faint` tokens. Assert `--border` value uses `rgba()`.

**Impl:** Add new tokens to both dark and light `:root` blocks. Change `--border` from hex to rgba.

### Task 2: Define badge semantic tokens

**Test:** Assert `:root` block contains `--badge-success-bg`, `--badge-warning-bg`, `--badge-error-bg`, `--badge-info-bg`, `--badge-neutral-bg` tokens.

**Impl:** Add 5 badge background tokens + 5 badge text tokens to both themes.

### Task 3: Replace hardcoded hex in badge classes with var() references

**Test:** For each badge class (`.badge-ready`, `.badge-stale`, etc.), assert CSS rule uses `var(--badge-*)` instead of hex. Run regex: no `#` in badge rules.

**Impl:** Update all badge class definitions in DASHBOARD_CSS to use semantic tokens.

### Task 4: Replace hardcoded hex in SWOT, quadrant, heatmap, and scope classes

**Test:** Assert `.swot-*`, `.quadrant-*`, `.heatmap-*`, `.scope-*` rules contain no raw hex colors (only `var()` references).

**Impl:** Replace ~30 hardcoded hex values in visualization classes.

### Task 5: Replace hardcoded hex in bar chart and scatter classes

**Test:** Assert `.bar-fill-*`, `.scatter-dot`, `.priority-*` rules use `var()` references.

**Impl:** Replace hex colors with tokens. Add `--bar-green`, `--bar-yellow`, `--bar-red`, `--bar-blue`, `--bar-teal` tokens (or reuse semantic).

### Task 6: Replace remaining hardcoded hex in DASHBOARD_CSS

**Test:** Full regex scan of DASHBOARD_CSS for `#[0-9a-fA-F]{3,8}` outside of `:root` token definitions. Assert count = 0.

**Impl:** Fix `pre`, `th`, `p code`, `.card:hover`, `.groom-session`, `.group-header:hover`, `.standalone-header`, scrollbar thumb, etc.

### Task 7: Implement near-invisible borders

**Test:** Assert `--border` in dark theme matches `rgba(255,255,255,0.08)`. Assert `--border` in light theme matches `rgba(0,0,0,0.06)`. Add `--border-strong` for intentional dividers.

**Impl:** Update token values. Audit table borders, kanban column dividers — switch to `--border-strong` where separation is intentional.

### Task 8: Remove visible card borders, use surface differentiation

**Test:** Assert `.card` rule does NOT contain `border: 1px solid`. Assert `.kanban-item` uses subtle border or none.

**Impl:** Remove `border` from `.card`. Keep `.kanban-item` border-left for priority indication. Cards differentiate via `background: var(--surface)` on `var(--bg)` parent.

### Task 9: Verify 2-color-per-section maximum

**Test:** For each major page route (home, proposals, backlog, kb), render the HTML and count distinct non-grayscale CSS classes used. Assert <= 2 per section.

**Impl:** Audit rendered output. The accent color (#5e6ad2) counts as 1. Priority border-left colors in kanban are exempt (semantic data encoding). Fix any violations.

### Task 10: Unify fallback accents

**Test:** Assert no `var(--accent, #2563eb)` patterns exist — all fallbacks should be `#5e6ad2` or removed entirely.

**Impl:** Search and replace all `var(--accent, #2563eb)` with `var(--accent)`. The `#2563eb` blue was an older accent; `#5e6ad2` is the unified color.

---

## Color-per-section Audit (expected outcome)

| Page Section | Non-grayscale Colors | Status |
|-------------|---------------------|--------|
| Home / pulse | accent + pulse color (green/amber/red) | OK (2) |
| Home / proposals | accent (links) + gradient dots (data-driven, exempt) | OK (1 + data) |
| Backlog / kanban | accent + priority border-left (semantic, exempt) | OK (1 + semantic) |
| Proposals / cards | accent only | OK (1) |
| KB / research | accent + chart colors (data viz, exempt) | OK (1 + viz) |
| KB / competitors | accent + SWOT semantic colors (4, each in own box) | OK — each box has 1 color |
