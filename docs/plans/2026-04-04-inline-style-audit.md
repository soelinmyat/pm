# PM-129: Inline Style Audit

**Size:** M | **Depends:** PM-117 (tokens), PM-118 (typography/spacing)
**Outcome:** 67 inline `style=` attributes converted to CSS classes or token variables.

---

## Inline Style Inventory

All `style=` attributes found in server.js HTML generation (outside DASHBOARD_CSS/PROGRESSIVE_PROPOSAL_CSS blocks):

### DASHBOARD_CSS inline styles (in HTML generation functions)

| # | Line | Current `style=` | Proposed Action |
|---|------|-------------------|-----------------|
| 1 | 1283 | `style="display:none"` (theme icon moon SVG) | **Keep-dynamic** — toggled by JS theme switcher |
| 2 | 1638 | `style="background:${color}"` (legend dot in positioning map) | **Keep-dynamic** — color computed from data |
| 3 | 1644 | `style="max-width:${W}px"` (positioning map SVG) | **Keep-dynamic** — width computed from data |
| 4 | 1654 | `style="margin-left:1rem;font-style:italic"` (bubble size legend note) | **Convert** to `.scatter-legend-note` class |
| 5 | 3119 | `style="background:${gradient}"` (proposal group gradient dot) | **Keep-dynamic** — gradient from proposal meta |
| 6 | 3157 | `style="display:none"` (done-standalone items, toggled by JS) | **Keep-dynamic** — toggled by JS onclick |
| 7 | 3299 | `style="background:${gradient}"` (proposal card gradient) | **Keep-dynamic** — gradient from proposal meta |
| 8 | 3323 | `style="background:${gradient}"` (legacy proposal card gradient) | **Keep-dynamic** — gradient from proposal meta |
| 9 | 3529 | `style="background:#2563eb"` (groom session dot) | **Convert** to `.groom-session-dot--groom` with `background: var(--info)` |
| 10 | 3538 | `style="background:#16a34a"` (dev session dot) | **Convert** to `.groom-session-dot--dev` with `background: var(--success)` |
| 11 | 3587 | `style="text-align:center;margin:-0.5rem 0 1.5rem;"` (strategy/research status row) | **Convert** to `.control-status-row` class |
| 12 | 3588 | `style="font-size:0.8125rem;color:var(--text-muted);"` (strategy badge wrapper) | **Convert** to `.control-status-label` class |
| 13 | 3589 | `style="font-size:0.8125rem;color:var(--text-muted);margin-left:1rem;"` (research badge wrapper) | **Convert** to `.control-status-label` + spacing token |
| 14 | 3604 | `style="width:${pct}%;background:${pulseColor}"` (pulse dimension fill bar) | **Keep-dynamic** — width% and color from score data |
| 15 | 3609 | `style="cursor:pointer"` (pulse score clickable div) | **Convert** to `.pulse-score` rule (already exists, add `cursor: pointer`) |
| 16 | 3614 | `style="--pulse-target:${arcOffset}"` (SVG arc CSS variable) | **Keep-dynamic** — CSS custom property set from JS |
| 17 | 3618 | `style="color:${pulseColor}"` (pulse label colored span) | **Keep-dynamic** — color from score computation |
| 18 | 3969 | `style="margin-top:2rem;"` (ideas section wrapper) | **Convert** to `.ideas-section` class with `margin-top: var(--space-8)` |
| 19 | 4210 | `style="color:var(--text-muted)"` (empty SWOT placeholder li) | **Convert** to `.swot-empty` class |
| 20 | 4259 | `style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;background:${color};"` (scatter dot position) | **Keep-dynamic** — all values computed from data |
| 21 | 4260 | `style="left:${x}%;top:calc(${y}% + ${offset}px);"` (scatter label position) | **Keep-dynamic** — position computed from data |
| 22 | 4264 | `style="background:${segColors[seg]}"` (scatter legend dot) | **Keep-dynamic** — color from segment data |
| 23 | 4270 | `style="top:-1.25rem;left:0"` (scatter axis label top) | **Convert** — already has `.scatter-axis-label-top` class, move style to CSS |
| 24 | 4271 | `style="bottom:-2.75rem;left:0"` (scatter axis label bottom) | **Convert** — create `.scatter-axis-label-bottom-left` |
| 25 | 4272 | `style="top:50%"` (scatter gridline horizontal) | **Convert** — already has `.scatter-gridline-h`, add `top: 50%` to CSS |
| 26 | 4273 | `style="left:50%"` (scatter gridline vertical) | **Convert** — already has `.scatter-gridline-v`, add `left: 50%` to CSS |
| 27 | 4276 | `style="bottom:-1.25rem;left:0"` (scatter axis label bottom-left) | **Convert** to `.scatter-axis-label-bl` |
| 28 | 4277 | `style="bottom:-1.25rem;right:0"` (scatter axis label bottom-right) | **Convert** to `.scatter-axis-label-br` |
| 29 | 4356 | `style="margin-top:0.5rem;font-size:0.6875rem;color:var(--text-muted);font-style:italic"` (timeline gate text) | **Convert** to `.timeline-phase-gate` class |
| 30 | 4463 | `style="width:${pct}%"` (bar fill width in satisfaction chart) | **Keep-dynamic** — width% from rating data |
| 31 | 4486 | `style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:1rem"` (satisfaction gap description) | **Convert** to `.chart-description` class |
| 32 | 4552 | `style="width:${drPct}%"` (SEO DR bar fill) | **Keep-dynamic** — width% from DR data |
| 33 | 4556 | `style="width:${trafficPct}%"` (SEO traffic bar fill) | **Keep-dynamic** — width% from traffic data |
| 34 | 4564 | `style="font-size:0.6875rem;color:var(--text-muted);margin-top:0.25rem"` (SEO meta line) | **Convert** to `.bar-group-meta` class |
| 35 | 4572 | `style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:1rem"` (SEO chart description) | **Convert** — reuse `.chart-description` from #31 |
| 36 | 4634 | `style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.75rem"` (heatmap legend row) | **Convert** to `.heatmap-legend` class |
| 37 | 4635 | `style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem"` (heatmap Full badge) | **Convert** to `.heatmap-legend-badge` class |
| 38 | 4636 | `style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem"` (heatmap Partial badge) | **Convert** — reuse `.heatmap-legend-badge` |
| 39 | 4637 | `style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem"` (heatmap Missing badge) | **Convert** — reuse `.heatmap-legend-badge` |
| 40 | 4638 | `style="padding:0.15em 0.5em;border-radius:4px"` (heatmap Differentiator badge) | **Convert** — reuse `.heatmap-legend-badge` (no margin-right on last) |
| 41 | 4799 | `style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 1rem;background:var(--accent,#2563eb);color:#fff;border-radius:8px;text-decoration:none;font-size:0.85rem;font-weight:600;"` (strategy deck button) | **Convert** to `.deck-btn` class |
| 42 | 4801 | `style="margin-bottom:1rem;text-align:right"` (deck button wrapper) | **Convert** to `.deck-btn-wrapper` class |
| 43 | 4981 | `style="position:sticky;top:0;z-index:200;background:#fff;border-bottom:1px solid #e5e7eb;padding:0.5rem 1.5rem;display:flex;align-items:center;gap:0.75rem;font-family:...;box-shadow:..."` (detail back bar) | **Convert** to `.detail-back-bar` class (hardcoded #fff must use var(--surface)) |
| 44 | 4981 | `style="font-size:0.85rem;color:#7c3aed;text-decoration:none;font-weight:500;"` (detail back link) | **Convert** to `.detail-back-link` class (hardcoded #7c3aed must use var(--accent)) |
| 45 | 5085 | `style="margin-bottom:1rem;"` (search wrapper div) | **Convert** to `.backlog-search-wrapper` class |
| 46 | 5087 | `style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);..."` (search input) | **Convert** to `.backlog-search-input` class |
| 47 | 5088 | `onfocus="this.style.borderColor='var(--accent)'"` (search focus inline) | **Convert** to CSS `:focus` pseudo-class |
| 48 | 5088 | `onblur="this.style.borderColor='var(--border)'"` (search blur inline) | **Remove** — handled by CSS `:focus` |
| 49 | 5098 | `el.style.display = ...` (JS search filter) | **Keep-dynamic** — JS runtime toggle |
| 50 | 5161 | `style="font-size:1rem;margin-left:0.5rem"` (shipped page count) | **Convert** to `.page-count` class |
| 51 | 5213 | `style="font-size:1rem;margin-left:0.5rem"` (archived page count) | **Convert** — reuse `.page-count` |

### PROGRESSIVE_PROPOSAL_CSS inline styles (in proposal handler)

| # | Line | Current `style=` | Proposed Action |
|---|------|-------------------|-----------------|
| 52 | 2365 | `style="font-size:0.85rem;"` (success metric value) | **Convert** to `.metric-value--small` modifier |
| 53 | 2368 | `style="font-size:0.85rem;color:rgba(255,255,255,0.7);text-decoration:none;display:inline-block;margin-bottom:0.5rem;"` (back link in hero) | **Convert** to `.hero-back-link` class |
| 54 | 2369 | `style="font-size:0.85rem;color:rgba(255,255,255,0.7);..."` (same back link, placeholder hero) | **Convert** — reuse `.hero-back-link` |
| 55 | 2399 | `style="opacity:0.4"` (unfilled TOC link) | **Convert** to `.toc-link--unfilled` class |
| 56 | 2420 | `style="margin-left:auto;"` (verdict badge in strategy section) | **Convert** to `.section-title .verdict-badge` with `margin-left: auto` |
| 57 | 2425 | `style="margin-left:auto;"` (skipped verdict badge) | **Convert** — same rule as #56 |
| 58 | 2425 | `style="color:#999;"` (no strategy check paragraph) | **Convert** to `.section-empty` class |
| 59 | 2457 | `style="color:#7c3aed;font-weight:500;text-decoration:none;"` (research link) | **Convert** to `.section-link` class |
| 60 | 2460 | `style="color:#999;"` (no research paragraph) | **Convert** — reuse `.section-empty` |
| 61 | 2484 | `style="color:#888;"` (JTBD "so that" text) | **Convert** to `.job-so` class (already exists in CSS but not used inline) |
| 62 | 2550 | `style="font-size:0.85rem;font-weight:500;color:#7c3aed;text-decoration:none;margin-left:auto;"` (flows link) | **Convert** to `.flows-link` class |
| 63 | 2558 | `style="margin-bottom:1.5rem;"` (flow item wrapper) | **Convert** to `.flow-item` class |
| 64 | 2558 | `style="font-size:0.85rem;font-weight:600;color:#333;margin-bottom:0.5rem;"` (flow title h4) | **Convert** to `.flow-item-title` class |
| 65 | 2558 | `style="display:inline-flex;...border-radius:50%;background:#7c3aed;color:#fff;..."` (flow number badge) | **Convert** to `.flow-number` class |
| 66 | 2559 | `style="font-size:0.8rem;color:#888;margin-bottom:0.75rem;"` (flow job description) | **Convert** to `.flow-item-job` class |
| 67 | 2562-2563 | `style="margin-top:0.5rem;padding-left:1.25rem;"` + `style="font-size:0.8rem;color:#888;"` (flow edge cases) | **Convert** to `.flow-edges` and `.flow-edge` classes |
| 68 | 2581 | `style="color:#999;"` (no flows paragraph) | **Convert** — reuse `.section-empty` |
| 69 | 2630 | `style="margin-left:auto;"` (wireframes skipped badge) | **Convert** — same as #56 |
| 70 | 2630 | `style="color:#999;"` (no wireframes paragraph) | **Convert** — reuse `.section-empty` |
| 71 | 2729 | `style="font-size:1rem;padding:0.4rem 1rem;"` (verdict badge large) | **Convert** to `.verdict-badge--lg` modifier |

### Summary

- **Total found:** 71 inline style usages (slightly more than 67 due to counting granularity)
- **Convert to CSS class:** 54 instances
- **Keep as dynamic:** 17 instances (data-driven positioning, widths, colors, JS toggles)
- **Target:** <=13 dynamic exceptions. Currently 17 dynamic. Review if 4 can use CSS classes with custom properties.

---

## TDD Task Breakdown

### Task 1: Add new CSS utility classes to DASHBOARD_CSS

**Test:** Snapshot test verifying that DASHBOARD_CSS contains the new class selectors:
- `.control-status-row`, `.control-status-label`
- `.groom-session-dot--groom`, `.groom-session-dot--dev`
- `.chart-description`, `.bar-group-meta`
- `.heatmap-legend`, `.heatmap-legend-badge`
- `.scatter-axis-label-bl`, `.scatter-axis-label-br`
- `.scatter-gridline-h` (with `top: 50%`), `.scatter-gridline-v` (with `left: 50%`)
- `.timeline-phase-gate`
- `.deck-btn`, `.deck-btn-wrapper`
- `.detail-back-bar`, `.detail-back-link`
- `.backlog-search-wrapper`, `.backlog-search-input`
- `.page-count`, `.ideas-section`, `.swot-empty`
- `.scatter-legend-note`

**Impl:** Add ~15 new CSS classes to DASHBOARD_CSS block. Use token variables for all spacing, font-size, and color values.

### Task 2: Add new CSS classes to PROGRESSIVE_PROPOSAL_CSS

**Test:** Snapshot test verifying PROGRESSIVE_PROPOSAL_CSS contains:
- `.hero-back-link`, `.toc-link--unfilled`
- `.section-title .verdict-badge` (margin-left auto)
- `.section-empty`, `.section-link`
- `.flow-item`, `.flow-item-title`, `.flow-number`, `.flow-item-job`, `.flow-edges`, `.flow-edge`
- `.flows-link`, `.metric-value--small`, `.verdict-badge--lg`

**Impl:** Add ~12 new CSS classes to PROGRESSIVE_PROPOSAL_CSS.

### Task 3: Replace dashboard inline styles with classes (batch 1 — simple conversions)

**Test:** For each converted line, assert the HTML output does NOT contain the old `style=` string and DOES contain the new `class=` attribute.

**Impl:** Replace inline styles at lines: 1654, 3529, 3538, 3587-3589, 3609, 3969, 4210, 4270-4273, 4276-4277, 4356, 4486, 4564, 4572, 4634-4638.

### Task 4: Replace dashboard inline styles with classes (batch 2 — complex/multi-property)

**Test:** Same assertion pattern as Task 3.

**Impl:** Replace inline styles at lines: 4799, 4801, 4981 (detail-back-bar), 5085-5088, 5161, 5213.

### Task 5: Replace proposal handler inline styles with classes

**Test:** Assert proposal HTML output uses classes instead of inline styles for lines 2365, 2368-2369, 2399, 2420, 2425, 2457, 2460, 2484, 2550, 2558-2563, 2581, 2630, 2729.

**Impl:** Replace 20 inline style usages in the progressive proposal handler.

### Task 6: Convert inline event handlers to CSS

**Test:** Assert search input HTML does NOT contain `onfocus=` or `onblur=` attributes. Assert `.backlog-search-input:focus` rule exists in CSS.

**Impl:** Remove onfocus/onblur handlers from search input. Add `:focus` pseudo-class to `.backlog-search-input`.

### Task 7: Replace hardcoded hex colors in remaining inline styles with var() references

**Test:** Assert that no `style=` attribute in HTML output (outside dynamic exceptions) contains a raw `#` hex color. Scan all route responses.

**Impl:** Audit the 17 dynamic exceptions. Replace any hardcoded hex colors in them with `var()` references (e.g., `#7c3aed` -> `var(--accent)`, `#fff` -> `var(--surface)`, `#e5e7eb` -> `var(--border)`). The detail-back-bar at line 4981 is the worst offender.

### Task 8: Final audit and count verification

**Test:** Count all `style=` attributes in server.js HTML generation output. Assert count <= 13.

**Impl:** Run a regex scan across all route handlers. Document each remaining dynamic exception with a comment explaining why it cannot be a class.

---

## Dynamic Exceptions (expected to remain)

These `style=` attributes must remain because their values are computed at runtime:

1. `style="display:none"` — theme icon toggle (JS)
2. `style="background:${gradient}"` — proposal gradient dots (x3)
3. `style="display:none"` — done-items collapse (JS)
4. `style="width:${pct}%;background:${color}"` — pulse bar fill
5. `style="--pulse-target:${offset}"` — SVG arc CSS variable
6. `style="color:${color}"` — pulse label color
7. `style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;background:${c}"` — scatter dots
8. `style="left:${x}%;top:calc(...)"` — scatter labels
9. `style="background:${color}"` — scatter legend dots
10. `style="max-width:${W}px"` — positioning SVG
11. `style="width:${pct}%"` — bar fills (x3: satisfaction, DR, traffic)
12. `el.style.display` — JS search filter runtime

**Count: 12-13 dynamic exceptions** (meeting the <=13 target)
