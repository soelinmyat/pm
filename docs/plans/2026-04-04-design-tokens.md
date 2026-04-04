# PM-117: Design Tokens Foundation

## Header

**Goal:** Define a complete set of spacing, typography, and color tokens in `:root` and `[data-theme="light"]` so that subsequent issues can migrate raw values to named variables. Zero visual change.

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). All CSS lives in the `DASHBOARD_CSS` template literal (lines 446-1216). Tokens are added to the `:root` block (lines 447-472) and `[data-theme="light"]` block (lines 473-495).

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 447-472 | Add spacing + typography + color tokens to `:root` |
| `scripts/server.js` | 473-495 | Make `[data-theme="light"]` a full token set (not partial override) |
| `scripts/server.js` | 496-499 | Add `font-variant-numeric: tabular-nums` global rule |
| `tests/server.test.js` | append | Token presence tests |

**Done criteria:**
- `:root` contains `--space-1` through `--space-24` on 4px grid
- `:root` contains `--text-xs` through `--text-3xl`
- `--border` uses `rgba()` in both themes (6-8% opacity)
- `--surface-raised` exists in both themes
- `[data-theme="light"]` is a complete block (every variable from `:root` has a light counterpart)
- `font-variant-numeric: tabular-nums` applied to `.stat-card .value`, `.pulse-arc-text`, `.pulse-dim-score`, `.bar-value`, and any element with a numeric display role
- Pages render identically before and after

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Visual: open dashboard, toggle dark/light, confirm no visible difference
```

## Upstream Context

From `pm/research/dashboard-linear-quality/findings.md`:
- **Spacing:** 4px base unit. Scale: 4/8/12/16/24/32/48/64/96px.
- **Typography:** Inter. Scale: 12/13/14/16/20/24/32/48px. Body 14px, line-height 1.5, letter-spacing -0.01em.
- **Color:** Near-invisible borders at 6-8% opacity. 90% grayscale. One accent.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere.

## Task Breakdown

### Task 1: Write token presence tests (RED)

**Test file:** `tests/server.test.js` (append new `describe` block)

Write tests that assert the `DASHBOARD_CSS` string contains:
1. Each spacing token `--space-1` through `--space-24` with correct px values
2. Each typography token `--text-xs` (12px) through `--text-3xl` (32px)
3. `--surface-raised` in both `:root` and `[data-theme="light"]`
4. `--border` uses `rgba(` not a hex value in `:root`
5. `--border` uses `rgba(` in `[data-theme="light"]`
6. `font-variant-numeric: tabular-nums` appears in the CSS
7. Light theme block contains all variables from dark theme (completeness check)

```
Verify: node --test → 7 new tests FAIL (tokens don't exist yet)
```

### Task 2: Add spacing tokens to `:root` (lines 447-472)

Insert after `--transition: 150ms ease-out;` (line 470), before `color-scheme: dark;` (line 471):

```css
/* Spacing scale (4px base) */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-24: 96px;
```

Note: The naming follows `--space-{n}` where n = value/4. Gaps at 7, 9, 11, 13-15, 17-23 are intentional (those multiples aren't in the Linear scale).

### Task 3: Add typography tokens to `:root` (same insertion point)

Insert after spacing tokens:

```css
/* Typography scale */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.8125rem;  /* 13px */
--text-base: 0.875rem; /* 14px */
--text-lg: 1rem;       /* 16px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 2rem;      /* 32px */
```

### Task 4: Change `--border` to rgba in `:root` (line 450)

**Current (line 450):**
```css
--border: #2a2e37;
```

**New:**
```css
--border: rgba(255, 255, 255, 0.08);
```

This is 8% white opacity on dark background — matches Linear's near-invisible border pattern. The visual result is extremely close to `#2a2e37` on `#0d0f12` background.

### Task 5: Add `--surface-raised` to `:root`

Insert alongside existing surface token:

```css
--surface-raised: #1e2128;
```

This is the hover/elevated card color already used as hardcoded `#1e2128` in multiple places (th, .badge, etc.).

### Task 6: Make `[data-theme="light"]` a complete block (lines 473-495)

**Current state:** Light theme only overrides ~20 of ~30 variables. Missing: `--radius`, `--radius-sm`, `--transition`, and all new spacing/typography tokens.

**Action:** Add all missing variables to the light block. Since spacing and typography tokens are theme-independent, they repeat the same values. Theme-dependent additions:

```css
/* Inside [data-theme="light"] */
--border: rgba(0, 0, 0, 0.06);
--surface-raised: #f0f2f5;
--radius: 8px;
--radius-sm: 6px;
--transition: 150ms ease-out;
/* Spacing tokens (same as dark) */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-24: 96px;
/* Typography tokens (same as dark) */
--text-xs: 0.75rem;
--text-sm: 0.8125rem;
--text-base: 0.875rem;
--text-lg: 1rem;
--text-xl: 1.25rem;
--text-2xl: 1.5rem;
--text-3xl: 2rem;
color-scheme: light;
```

Note: `--border` changes from hex `#e2e5ea` to `rgba(0, 0, 0, 0.06)` — 6% black opacity on light background, matching the research finding.

### Task 7: Add `font-variant-numeric: tabular-nums` (after line 499)

Add a global rule targeting numeric display elements:

```css
.stat-card .value,
.pulse-arc-text,
.pulse-dim-score,
.bar-value,
.col-count,
.group-count { font-variant-numeric: tabular-nums; }
```

This does not change any visual appearance (numbers already align in monospaced contexts) but ensures consistent column alignment in data-heavy views.

### Task 8: Run tests (GREEN)

```
Verify: node --test → all tests PASS
```

### Task 9: Visual smoke test

Open dashboard in browser, verify:
- Dark mode: no visible change in borders, colors, spacing
- Light mode: no visible change
- Toggle between themes — no flash or layout shift
- Stat card numbers still align correctly

### Commit

```
feat(dashboard): add design token foundation (PM-117)

Define spacing (--space-1 to --space-24), typography (--text-xs to
--text-3xl), and surface-raised tokens in :root and [data-theme="light"].
Change --border to rgba opacity. Apply tabular-nums to numeric elements.
No visual change — subsequent issues will migrate raw values to tokens.
```

## Risk Notes

- **Border opacity change:** `rgba(255,255,255,0.08)` on `#0d0f12` ≈ `#1f2129`, which is slightly darker than the current `#2a2e37`. If the visual difference is noticeable, bump to `rgba(255,255,255,0.10)`. Verify by screenshot comparison.
- **Light border:** `rgba(0,0,0,0.06)` on `#f8f9fb` ≈ `#e9eaec`, close to current `#e2e5ea`. Same verify approach.
- **No existing rules change:** This issue only ADDS variables. Existing rules still reference `--border`, `--surface`, etc. by their original names, which still resolve correctly.
