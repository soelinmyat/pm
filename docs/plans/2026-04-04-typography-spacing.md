# PM-118: Typography and Spacing Sweep

## Header

**Goal:** Replace every raw `font-size`, `padding`, `margin`, and `gap` value in DASHBOARD_CSS with `--text-*` and `--space-*` tokens from PM-117. Visual rendering stays identical (values match existing or snap to nearest 4px grid point).

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). All CSS lives in the `DASHBOARD_CSS` template literal (lines 446-1216). PM-117 must land first (defines the tokens).

**Depends on:** PM-117 (design tokens foundation)

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 496-1216 | Replace raw values with token references throughout DASHBOARD_CSS |
| `tests/server.test.js` | append | Token usage tests |

**Scope boundary:** This issue covers the CSS CONSTANT only (lines 446-1216). Inline `style=` attributes in HTML template strings are covered by PM-129.

**Done criteria:**
1. Zero raw `font-size` declarations with px/rem values in DASHBOARD_CSS (all use `var(--text-*)`)
2. All `padding`, `margin`, `gap` values use `var(--space-*)` tokens (except reset `0`, `auto`, `-1px`/`-2px` offsets, `1px` structural borders, and `em`-based inline spacing)
3. Body font-size is `var(--text-base)` (14px)
4. Page titles (h1) use `var(--text-2xl)` with `font-weight: 600`, `letter-spacing: -0.02em`
5. Section headers (h2) use `var(--text-lg)`
6. Metadata/labels use `var(--text-xs)` or `var(--text-sm)`
7. `.container` padding: `var(--space-8)` horizontal, `var(--space-6)` top
8. Card padding: `var(--space-4)` to `var(--space-6)`
9. Card gap: `var(--space-3)` to `var(--space-4)`
10. Section gaps: `var(--space-8)` to `var(--space-12)`
11. Visual rendering stays the same

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Visual: open dashboard, compare before/after screenshots
```

## Upstream Context

From `pm/research/dashboard-linear-quality/findings.md`:
- Body: 14px (0.875rem), line-height 1.5, letter-spacing -0.01em
- Labels/metadata: 12-13px, font-weight 500
- Headings: 20-24px, font-weight 600, letter-spacing -0.02 to -0.04em
- Card padding: 16-24px. Card gap: 12-16px
- Section spacing: 32-48px between major blocks
- Page padding: 24-32px desktop, 16px mobile

## Token Reference

```
--text-xs:   0.75rem    (12px)
--text-sm:   0.8125rem  (13px)
--text-base: 0.875rem   (14px)
--text-lg:   1rem       (16px)
--text-xl:   1.25rem    (20px)
--text-2xl:  1.5rem     (24px)
--text-3xl:  2rem       (32px)

--space-1:  4px    --space-6:  24px
--space-2:  8px    --space-8:  32px
--space-3:  12px   --space-10: 40px
--space-4:  16px   --space-12: 48px
--space-5:  20px   --space-16: 64px
                   --space-24: 96px
```

## Font-Size Mapping Table

Every `font-size` in DASHBOARD_CSS and its token replacement. "Snap" column shows when the token value differs from the original.

| Line | Selector | Current | Token | Snap? |
|------|----------|---------|-------|-------|
| 506 | `nav .brand` | 0.9375rem (15px) | `var(--text-base)` (14px) | 15→14px |
| 508 | `nav a` | 0.8125rem (13px) | `var(--text-sm)` | exact |
| 515 | `.kb-sub-tab` | 0.8125rem | `var(--text-sm)` | exact |
| 524 | `h1` | 1.625rem (26px) | `var(--text-2xl)` (24px) | 26→24px |
| 525 | `h2` | 1.1875rem (19px) | `var(--text-lg)` (16px) | 19→16px |
| 526 | `h3` | 0.9375rem (15px) | `var(--text-base)` (14px) | 15→14px |
| 531 | `pre` | 0.8125rem | `var(--text-sm)` | exact |
| 532 | `code` | 0.85em | `0.85em` | SKIP (em-relative) |
| 534 | `table` | 0.875rem | `var(--text-base)` | exact |
| 536 | `th` | 0.8125rem | `var(--text-sm)` | exact |
| 544 | `.stat-card .value` | 1.5rem (24px) | `var(--text-2xl)` | exact |
| 545 | `.stat-card .label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 551 | `.backlog-section-title` | 1rem (16px) | `var(--text-lg)` | exact |
| 561 | `.card h3` | 0.875rem | `var(--text-base)` | exact |
| 562 | `.card .meta` | 0.75rem (12px) | `var(--text-xs)` | exact |
| 564 | `.card-footer .view-link` | 0.75rem | `var(--text-xs)` | exact |
| 572 | `.kanban-col .col-header` | 0.8125rem | `var(--text-sm)` | exact |
| 573 | `.col-count` | 0.75rem | `var(--text-xs)` | exact |
| 577 | `.status-badge` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 582 | `.kanban-item` | 0.875rem | `var(--text-base)` | exact |
| 592 | `.done-toggle` | 0.75rem | `var(--text-xs)` | exact |
| 598 | `.kanban-id` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 599 | `.kanban-sub-count` | 0.625rem (10px) | `var(--text-xs)` (12px) | 10→12px |
| 600 | `.kanban-parent` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 602 | `.backlog-item-id` | 0.75em | `0.75em` | SKIP (em-relative) |
| 604 | `.issue-relation` | 0.875rem | `var(--text-base)` | exact |
| 613 | `.wireframe-label` | 0.8125rem | `var(--text-sm)` | exact |
| 614 | `.wireframe-open` | 0.75rem | `var(--text-xs)` | exact |
| 620 | `.kanban-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 621 | `.kanban-scope` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 626 | `.legend-item` | 0.75rem | `var(--text-xs)` | exact |
| 633 | `.kanban-view-all` | 0.8125rem | `var(--text-sm)` | exact |
| 635 | `.col-count` (dup) | 0.75rem | `var(--text-xs)` | exact |
| 637 | `.shipped-date` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 642 | `.tab` | 0.8125rem | `var(--text-sm)` | exact |
| 650 | `.badge` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 666 | `.transcript-meta` | 0.85rem (~13.6px) | `var(--text-sm)` (13px) | ~14→13px |
| 669 | `.speaker-badge` | 0.75rem | `var(--text-xs)` | exact |
| 680 | `.action-hint` | 0.75rem | `var(--text-xs)` | exact |
| 681 | `.action-hint code` | 0.75rem | `var(--text-xs)` | exact |
| 682 | `.action-code` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 683 | `.col-hint` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 684 | `.col-hint code` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 685 | `.kanban-item-hint` | 0.625rem (10px) | `var(--text-xs)` (12px) | 10→12px |
| 690 | `.canvas-tab` | 0.8125rem | `var(--text-sm)` | exact |
| 697 | `.canvas-tab-check` | 0.75rem | `var(--text-xs)` | exact |
| 698 | `.canvas-tab-sep` | 0.75rem | `var(--text-xs)` | exact |
| 699 | `.canvas-tab-type` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 703 | `.pulse-arc-text` | 2rem (32px) | `var(--text-3xl)` | exact |
| 707 | `.pulse-score-label` | 0.8125rem | `var(--text-sm)` | exact |
| 712 | `.pulse-dim-name` | 0.75rem | `var(--text-xs)` | exact |
| 713 | `.pulse-dim-score` | 1.125rem (18px) | `var(--text-lg)` (16px) | 18→16px |
| 716 | `.pulse-dim-detail` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 717 | `@media .pulse-arc-text` | 1.5rem | `var(--text-2xl)` | exact |
| 720 | `.suggested-next-label` | 0.75rem | `var(--text-xs)` | exact |
| 721 | `.suggested-next code` | 0.8125rem | `var(--text-sm)` | exact |
| 728 | `.empty-state code` | 0.85rem (~13.6px) | `var(--text-sm)` (13px) | ~14→13px |
| 732 | `.empty-state-cta h2` | 1.5rem (24px) | `var(--text-2xl)` | exact |
| 735 | `.empty-state-cta code` | 1.125rem (18px) | `var(--text-lg)` (16px) | 18→16px |
| 740 | `.kb-reference summary` | 0.875rem | `var(--text-base)` | exact |
| 745 | `.kb-ref-item` | 0.875rem | `var(--text-base)` | exact |
| 748 | `.kb-ref-desc` | 0.8125rem | `var(--text-sm)` | exact |
| 752 | `.page-header .subtitle` | 0.9375rem (15px) | `var(--text-base)` (14px) | 15→14px |
| 753 | `.page-header .breadcrumb` | 0.8125rem | `var(--text-sm)` | exact |
| 760 | `.markdown-body h1` | 1.5rem | `var(--text-2xl)` | exact |
| 761 | `.markdown-body h2` | 1.25rem (20px) | `var(--text-xl)` | exact |
| 762 | `.markdown-body h3` | 1rem | `var(--text-lg)` | exact |
| 766 | `.markdown-body table` | 0.8125rem | `var(--text-sm)` | exact |
| 773 | `.swot-box h4` | 0.8125rem | `var(--text-sm)` | exact |
| 774 | `.swot-box ul` | 0.875rem | `var(--text-base)` | exact |
| 794 | `.scatter-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 796 | `.scatter-axis-*` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 800 | `.scatter-axis-label` | 0.625rem (10px) | `var(--text-xs)` (12px) | 10→12px |
| 808 | `.scatter-legend` | 0.75rem | `var(--text-xs)` | exact |
| 818 | `.quadrant-cell-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 820 | `.quadrant-item` | 0.75rem | `var(--text-xs)` | exact |
| 827 | `.quadrant-axis-x` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 830 | `.quadrant-axis-y` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 833 | `.heatmap-table` | 0.8125rem | `var(--text-sm)` | exact |
| 835 | `.heatmap-table th` | 0.75rem | `var(--text-xs)` | exact |
| 838 | `.heatmap-pillar` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 848 | `.bar-group-label` | 0.875rem | `var(--text-base)` | exact |
| 850 | `.bar-row-label` | 0.75rem | `var(--text-xs)` | exact |
| 853 | `.bar-fill` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 859 | `.bar-value` | 0.75rem | `var(--text-xs)` | exact |
| 869 | `.timeline-phase-name` | 0.8125rem | `var(--text-sm)` | exact |
| 870 | `.timeline-phase-focus` | 0.75rem | `var(--text-xs)` | exact |
| 878 | `.timeline-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 886 | `.positioning-map h3` | 0.9375rem (15px) | `var(--text-base)` (14px) | 15→14px |
| 889 | `.positioning-map .map-legend` | 0.75rem | `var(--text-xs)` | exact |
| 893 | `.positioning-map .map-axes` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 894 | `.positioning-map .map-y-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 906 | `.groom-session-topic` | 0.9375rem (15px) | `var(--text-base)` (14px) | 15→14px |
| 907 | `.groom-session-meta` | 0.8125rem | `var(--text-sm)` | exact |
| 908 | `.groom-session-label` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 915 | `.session-status-row` | 0.875rem | `var(--text-base)` | exact |
| 919 | `.session-artifact h3` | 1rem | `var(--text-lg)` | exact |
| 922 | `.session-issue` | 0.875rem | `var(--text-base)` | exact |
| 924 | `.verdicts-table` | 0.8125rem | `var(--text-sm)` | exact |
| 926 | `.back-link` | 0.8125rem | `var(--text-sm)` | exact |
| 934 | `.kb-tab` | 0.8125rem | `var(--text-sm)` | exact |
| 945 | `.proposal-id` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 951 | `.proposals-view-all` | 0.8125rem | `var(--text-sm)` | exact |
| 957 | `.toggle-btn` | 0.75rem | `var(--text-xs)` | exact |
| 970 | `.group-title` | 0.875rem | `var(--text-base)` | exact |
| 971 | `.group-count` | 0.75rem | `var(--text-xs)` | exact |
| 1005 | `@media .heatmap-table` | 0.75rem | `var(--text-xs)` | exact |
| 1015 | `@media h1` | 1.25rem (20px) | `var(--text-xl)` | exact |
| 1016 | `@media h2` | 1rem | `var(--text-lg)` | exact |
| 1019 | `@media nav a` | 0.75rem | `var(--text-xs)` | exact |
| 1030 | `@media .scatter-label` | 0.5625rem (9px) | `var(--text-xs)` (12px) | 9→12px — KEEP RAW (too small for token) |
| 1046 | `@media nav a (400px)` | 0.6875rem (11px) | `var(--text-xs)` (12px) | 11→12px |
| 1047 | `@media .stat-card .value` | 1.5rem | `var(--text-2xl)` | exact |
| 1123 | `.sidebar-brand` | 0.875rem | `var(--text-base)` | exact |
| 1139 | `.theme-toggle` | 0.75rem | `var(--text-xs)` | exact |
| 1149 | `@media .nav-item` | 0.75rem | `var(--text-xs)` | exact |
| 1175 | `.toast` | 0.8125rem | `var(--text-sm)` | exact |

**Summary:** ~100 font-size declarations. ~70 are exact matches. ~25 snap from 0.6875rem (11px) up to 12px. ~5 snap from 15px down to 14px or 19px down to 16px. 2 kept raw (em-relative, sub-10px responsive override).

## Key Spacing Conversions

| Current value | Token | Notes |
|---------------|-------|-------|
| `0.25rem` (4px) | `var(--space-1)` | |
| `0.375rem` (6px) | `var(--space-2)` (8px) | 6→8px snap, or keep raw if tight fit needed |
| `0.5rem` (8px) | `var(--space-2)` | exact |
| `0.625rem` (10px) | `var(--space-3)` (12px) | 10→12px snap |
| `0.75rem` (12px) | `var(--space-3)` | exact |
| `0.875rem` (14px) | `var(--space-4)` (16px) | 14→16px snap |
| `1rem` (16px) | `var(--space-4)` | exact |
| `1.25rem` (20px) | `var(--space-5)` | exact |
| `1.5rem` (24px) | `var(--space-6)` | exact |
| `1.75rem` (28px) | `var(--space-8)` (32px) | 28→32px snap |
| `2rem` (32px) | `var(--space-8)` | exact |
| `2.5rem` (40px) | `var(--space-10)` | exact |
| `3rem` (48px) | `var(--space-12)` | exact |
| `4rem` (64px) | `var(--space-16)` | exact |

**Exclusions (keep raw):**
- `margin: 0`, `padding: 0`, `gap: 0` — reset values
- `margin-bottom: -1px`, `margin-bottom: -2px` — structural offsets for tab alignment
- `em`-based padding (e.g., `0.15em 0.5em` on badges) — relative to font-size, not layout
- `1px` values in gaps (structural separator, not spacing)
- Percentage/auto values (`margin: 0 auto`)

## Task Breakdown

### Task 1: Write sweep verification tests (RED)

**Test file:** `tests/server.test.js` (append new `describe` block)

Tests that assert:
1. No raw `font-size: 0.` or `font-size: 1.` or `font-size: 2` patterns remain in DASHBOARD_CSS (except `0.85em`, `0.75em` em-relative, and `0.5625rem` responsive exception)
2. Body rule uses `var(--text-base)` (not a raw value)
3. `h1` uses `var(--text-2xl)`
4. `h2` uses `var(--text-lg)`
5. `.container` padding includes `var(--space-` tokens
6. Spot-check: `.stat-card` padding uses `var(--space-` tokens
7. Spot-check: `.card` padding uses `var(--space-` tokens
8. Count of remaining raw rem/px values in padding/margin/gap is below threshold (allow some for exclusions)

```
Verify: node --test → new tests FAIL
```

### Task 2: Typography sweep — body and headings (lines 497-538)

Replace font sizes in the typography foundation section.

| Line | Current | New |
|------|---------|-----|
| 497-499 | body `line-height: 1.6` | body add `font-size: var(--text-base);` and change `line-height: 1.5` |
| 524 | `h1 { font-size: 1.625rem; font-weight: 700;` | `h1 { font-size: var(--text-2xl); font-weight: 600;` |
| 525 | `h2 { font-size: 1.1875rem; font-weight: 600;` | `h2 { font-size: var(--text-lg); font-weight: 600;` |
| 526 | `h3 { font-size: 0.9375rem; font-weight: 600;` | `h3 { font-size: var(--text-base); font-weight: 600;` |
| 531 | `pre ... font-size: 0.8125rem` | `font-size: var(--text-sm)` |
| 534 | `table ... font-size: 0.875rem` | `font-size: var(--text-base)` |
| 536 | `th ... font-size: 0.8125rem` | `font-size: var(--text-sm)` |

### Task 3: Typography sweep — components (lines 540-980)

Work through the mapping table above, replacing each `font-size` declaration with the corresponding `var(--text-*)` token. Group changes by CSS section:
- Stat cards (540-550)
- Card grid (554-637)
- Kanban (566-634)
- Tabs (640-647)
- Badges (650-662)
- Transcript (664-673)
- Action hints (680-700)
- Canvas tabs (686-700)
- Pulse score (701-720)
- Suggested next (718-721)
- Empty states (723-736)
- KB reference (737-748)
- Page header (750-756)
- Markdown body (758-768)
- SWOT (770-784)
- Scatter/Quadrant/Heatmap (786-843)
- Bar chart (845-859)
- Timeline (861-879)
- Positioning map (884-896)
- Sessions (898-938)
- Proposals (940-980)

### Task 4: Typography sweep — sidebar, toast, responsive (lines 1119-1214)

- Sidebar brand (1123): `0.875rem` → `var(--text-base)`
- Theme toggle (1139): `0.75rem` → `var(--text-xs)`
- Toast (1175): `0.8125rem` → `var(--text-sm)`
- Responsive overrides (1015-1047): replace font sizes with tokens
- Exception: line 1030 `.scatter-label` at `0.5625rem` — keep raw (sub-token minimum for mobile)

### Task 5: Spacing sweep — layout and containers (lines 496-538)

| Line | Selector | Property | Current | New |
|------|----------|----------|---------|-----|
| 505 | `nav` | `padding` | `0 1.5rem` | `0 var(--space-6)` |
| 507 | `nav .brand` | `margin-right` | `1.5rem` | `var(--space-6)` |
| 508 | `nav a` | `padding` | `0 0.875rem` | `0 var(--space-3)` (14→12px snap) |
| 514 | `.kb-sub-tabs` | `margin-bottom` | `1.5rem` | `var(--space-6)` |
| 515 | `.kb-sub-tab` | `padding` | `0.625rem 1rem` | `var(--space-3) var(--space-4)` (10→12, 16=16) |
| 521 | `.container` | `padding` | `2rem 1.5rem` | `var(--space-6) var(--space-8)` (32v, 32h — was 32v, 24h → snap h to 32) |
| 524 | `h1` | `margin-bottom` | `0.25rem` | `var(--space-1)` |
| 525 | `h2` | `margin` | `1.75rem 0 0.75rem` | `var(--space-8) 0 var(--space-3)` (28→32, 12=12) |
| 526 | `h3` | `margin` | `1rem 0 0.5rem` | `var(--space-4) 0 var(--space-2)` |
| 527 | `p` | `margin-bottom` | `0.75rem` | `var(--space-3)` |
| 528 | `ul` | `margin` | `0.5rem 0 0.75rem 1.5rem` | `var(--space-2) 0 var(--space-3) var(--space-6)` |
| 529 | `li` | `margin-bottom` | `0.25rem` | `var(--space-1)` |
| 530 | `pre` | `padding` | `1rem` | `var(--space-4)` |
| 531 | `pre` | `margin` | `0.75rem 0` | `var(--space-3) 0` |
| 535 | `th, td` | `padding` | `0.5rem 0.75rem` | `var(--space-2) var(--space-3)` |
| 538 | `hr` | `margin` | `1.5rem 0` | `var(--space-6) 0` |

### Task 6: Spacing sweep — stat cards and card grid (lines 540-637)

| Line | Selector | Property | Current | New |
|------|----------|----------|---------|-----|
| 541 | `.stat-grid` | `gap` | `0.75rem` | `var(--space-3)` |
| 541 | `.stat-grid` | `margin` | `1.25rem 0` | `var(--space-4) 0` (20→16px snap) |
| 543 | `.stat-card` | `padding` | `1rem 1.25rem` | `var(--space-4) var(--space-5)` |
| 545 | `.stat-card .label` | `margin-top` | `0.25rem` | `var(--space-1)` |
| 550 | `.backlog-stats` | `gap` | `0.75rem` | `var(--space-3)` |
| 550 | `.backlog-stats` | `margin-bottom` | `1.5rem` | `var(--space-6)` |
| 551 | `.backlog-section-title` | `margin` | `0 0 0.75rem` | `0 0 var(--space-3)` |
| 551 | `.backlog-section-title` | `gap` | `0.5rem` | `var(--space-2)` |
| 552 | `.backlog-list` | `gap` | `0.5rem` | `var(--space-2)` |
| 555 | `.card-grid` | `margin` | `1.5rem 0` | `var(--space-6) 0` |
| 558 | `.card` | `padding` | `0.75rem 1rem` | `var(--space-3) var(--space-4)` |
| 558 | `.card` | `gap` | `1rem` | `var(--space-4)` |
| 563 | `.card-footer` | `gap` | `0.5rem` | `var(--space-2)` |

### Task 7: Spacing sweep — kanban (lines 567-637)

| Line | Selector | Property | Current | New |
|------|----------|----------|---------|-----|
| 567 | `.kanban` | `margin` | `1.5rem 0` | `var(--space-6) 0` |
| 571 | `.col-header` | `padding` | `0.5rem 1rem 0.75rem` | `var(--space-2) var(--space-4) var(--space-3)` |
| 571 | `.col-header` | `gap` | `0.5rem` | `var(--space-2)` |
| 574 | `.col-body` | `padding` | `0.5rem 0.75rem` | `var(--space-2) var(--space-3)` |
| 574 | `.col-body` | `gap` | `0.5rem` | `var(--space-2)` |
| 577 | `.status-badge` | `padding` | `0.125rem 0.5rem` | keep raw (em-adjacent tiny badge) |
| 577 | `.status-badge` | `margin-left` | `0.5rem` | `var(--space-2)` |
| 581 | `.kanban-item` | `padding` | `0.75rem` | `var(--space-3)` |
| 591 | `.done-toggle` | `padding` | `0.375rem 0.75rem` | `var(--space-2) var(--space-3)` (6→8px snap) |
| 591 | `.done-toggle` | `gap` | `0.375rem` | `var(--space-2)` (6→8px snap) |
| 597 | `.done-items` | `gap` | `0.375rem` | `var(--space-2)` (6→8px) |
| 597 | `.done-items` | `margin-top` | `0.375rem` | `var(--space-2)` (6→8px) |
| 603 | `.issue-relations` | `margin-top` | `0.75rem` | `var(--space-3)` |
| 603 | `.issue-relations` | `padding` | `0.75rem 1rem` | `var(--space-3) var(--space-4)` |
| 611 | `.wireframe-embed` | `margin` | `1.5rem 0` | `var(--space-6) 0` |
| 612 | `.wireframe-header` | `padding` | `0.5rem 1rem` | `var(--space-2) var(--space-4)` |
| 617 | `.kanban-item-ids` | `gap` | `0.5rem` | `var(--space-2)` |
| 617 | `.kanban-item-ids` | `margin-bottom` | `0.25rem` | `var(--space-1)` |
| 619 | `.kanban-item-meta` | `gap` | `0.375rem` | `var(--space-2)` (6→8px) |
| 619 | `.kanban-item-meta` | `margin-top` | `0.375rem` | `var(--space-2)` (6→8px) |
| 625 | `.backlog-legend` | `gap` | `1rem` | `var(--space-4)` |
| 625 | `.backlog-legend` | `margin-top` | `0.5rem` | `var(--space-2)` |
| 626 | `.legend-item` | `gap` | `0.375rem` | `var(--space-2)` (6→8px) |

### Task 8: Spacing sweep — remaining components (lines 640-980)

Apply the same pattern through tabs, badges, transcript, action hints, canvas tabs, pulse score, suggested next, empty states, KB reference, page header, markdown body, SWOT, scatter, quadrant, heatmap, bar chart, timeline, positioning map, sessions, proposals, and view toggle sections. Use the spacing conversion table above. Key conversions:

- All `gap: 0.5rem` → `var(--space-2)`
- All `gap: 0.75rem` → `var(--space-3)`
- All `gap: 1rem` → `var(--space-4)`
- All `margin: 1.5rem 0` → `var(--space-6) 0`
- All `margin: 2rem 0` → `var(--space-8) 0`
- All `padding: 1rem` → `var(--space-4)`
- All `padding: 1.25rem` → `var(--space-5)`
- All `padding: 1.5rem` → `var(--space-6)`
- All `padding: 2rem` → `var(--space-8)`
- All `padding: 4rem 2rem` → `var(--space-16) var(--space-8)`

### Task 9: Spacing sweep — sidebar, toast, responsive (lines 988-1214)

Responsive overrides keep the same token approach:
- `@media (max-width: 900px)` `.container` padding: `1.5rem 1rem` → `var(--space-6) var(--space-4)`
- `@media (max-width: 600px)` `.container` padding: `1rem 0.75rem` → `var(--space-4) var(--space-3)`
- Sidebar padding values → tokens
- Toast padding → tokens

### Task 10: Run tests (GREEN)

```
Verify: node --test → all tests PASS
```

### Task 11: Visual regression check

Open dashboard in browser. Check every page:
- Home (pulse score, stat cards, suggested next)
- Backlog (kanban, proposal groups)
- KB (card grid, markdown body)
- Research (scatter, SWOT, heatmap)
- Sessions (session cards, verdicts table)

Confirm spacing feels consistent on 4px grid. Minor snaps (6→8px, 11→12px) should look tighter/more uniform, not broken.

### Commit

```
feat(dashboard): replace raw values with design tokens (PM-118)

Migrate all font-size declarations to --text-* tokens and all
padding/margin/gap values to --space-* tokens in DASHBOARD_CSS.
Standardizes the 771-line CSS block onto a 4px spacing grid and
7-step type scale. Minor grid-snaps (11→12px, 6→8px) tighten
consistency. Inline styles (67 occurrences) deferred to PM-129.
```

## Risk Notes

- **Grid snapping:** ~25 font sizes snap from 11px to 12px (smallest token). This is a 1px increase on tiny labels/badges. Visually negligible but worth checking badges don't overflow.
- **6→8px spacing snap:** 0.375rem (6px) has no exact token. Snapping to `var(--space-2)` (8px) adds 2px to small gaps. Most visible in kanban item meta and done-items. Verify these don't feel too loose.
- **h2 snap (19→16px):** The largest visual change. Section headers shrink by 3px. This is intentional — aligns with Linear's tighter heading scale — but verify information hierarchy still reads well.
- **Container horizontal padding (24→32px):** `.container` horizontal padding increases from 24px to 32px. This narrows content area by 16px total. The max-width is 1120px so impact is minimal on desktop, but check tablet breakpoint.
- **Responsive `.scatter-label` kept raw:** 0.5625rem (9px) is below the token floor. Stays raw as a mobile-specific exception.
