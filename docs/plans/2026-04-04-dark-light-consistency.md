# PM-127: Dark/Light Mode Consistency

**Size:** M | **Depends:** PM-117 (tokens), PM-119 (color/border restraint)
**Outcome:** Both themes equally polished — switching feels like preference, not downgrade.

---

## Current State Analysis

### Problem 1: Light theme is a partial override, not a co-equal definition

The light `[data-theme="light"]` block (lines 473-494) defines only 18 tokens. The dark `:root, [data-theme="dark"]` block (lines 447-472) defines 23 tokens. Missing from light:

| Token | Dark Value | Light Value (missing) | Proposed Light Value |
|-------|-----------|----------------------|---------------------|
| `--radius` | `8px` | (inherited from :root) | `8px` (explicit) |
| `--radius-sm` | `6px` | (inherited) | `6px` (explicit) |
| `--transition` | `150ms ease-out` | (inherited) | `150ms ease-out` (explicit) |
| `color-scheme` | `dark` | `light` (defined) | Already defined |

After PM-117 adds spacing/typography tokens, the light block must also define ALL of them explicitly.

### Problem 2: 58 scattered `[data-theme="light"]` overrides (lines 1060-1117)

These exist because the base CSS uses hardcoded dark-mode hex colors instead of tokens. Once PM-119 replaces all hardcoded hex with `var()` references, most of these overrides become unnecessary — the token swap handles theming automatically.

### Problem 3: PROGRESSIVE_PROPOSAL_CSS has zero dark mode support

The entire proposal CSS (lines 2082-2260) is hardcoded for light mode:
- `body { color: #1a1a1a; background: #f8f9fa; }` — no dark equivalent
- `#fff`, `#e5e7eb`, `#f8f9fa`, `#111`, `#333`, `#444`, `#555`, `#777`, `#888`, `#999`, `#bbb`, `#d1d5db` — ~50 hardcoded colors
- Purple accent `#7c3aed` / `#8b5cf6` — should unify to `var(--accent)` (`#5e6ad2`)

---

## Diff: What Moves From Scattered Overrides Into Main Light Block

After PM-119 converts hardcoded hex to `var()`, these scattered overrides at lines 1060-1117 will be **eliminated** (not moved) because the base rules already use tokens:

```css
/* BEFORE: scattered overrides needed because base rules use hardcoded dark hex */
[data-theme="light"] pre { background: #f0f2f5; color: #1e2128; }
[data-theme="light"] p code, [data-theme="light"] li code { background: #eef0f4; }
[data-theme="light"] th { background: #f0f2f5; }

/* AFTER: base rules use tokens, no override needed */
pre { background: var(--surface-raised); color: var(--text); }
p code, li code { background: var(--surface-raised); }
th { background: var(--surface-raised); }
```

However, some overrides contain **unique light-mode values** that must migrate into the main `[data-theme="light"]` token block as new semantic tokens:

### Overrides that become new tokens in the light block

| Override Line | Current Rule | New Token | Light Value | Dark Value |
|-------------|-------------|-----------|-------------|------------|
| 1060 | `pre { background: #f0f2f5 }` | `--surface-raised` | `#f0f2f5` | `#1e2128` |
| 1065 | `.badge { background: #eef0f4 }` | `--badge-neutral-bg` | `#eef0f4` | `#222630` |
| 1066 | `.badge-ready/fresh { bg: #dcfce7; color: #166534 }` | `--badge-success-bg`, `--badge-success-text` | `#dcfce7`, `#166534` | `#132b1a`, `#4ade80` |
| 1067 | `.badge-empty { bg: #f3f4f6; color: #9ca3af }` | already `--badge-neutral-bg/text` | `#f3f4f6`, `#9ca3af` | `#222630`, `#8b8f96` |
| 1068 | `.badge-aging { bg: #fef3c7; color: #92400e }` | `--badge-warning-bg`, `--badge-warning-text` | `#fef3c7`, `#92400e` | `#2e2810`, `#fbbf24` |
| 1069 | `.badge-stale { bg: #fee2e2; color: #991b1b }` | `--badge-error-bg`, `--badge-error-text` | `#fee2e2`, `#991b1b` | `#2e1a1a`, `#f87171` |
| 1070 | `.badge-in-progress { bg: #ede9fe; color: #5b21b6 }` | `--badge-info-bg`, `--badge-info-text` | `#ede9fe`, `#5b21b6` | `#1a2040`, `#818cf8` |
| 1076 | `.badge-evidence { bg: #e0f2fe; color: #0c4a6e }` | `--badge-info-bg` (reuse) | `#e0f2fe`, `#0c4a6e` | `#0d2530`, `#38bdf8` |
| 1078-1080 | `.speaker-*` | `--speaker-interviewer-bg/text`, etc. | light values | dark values |
| 1081 | `.transcript-highlight` | `--highlight-bg` | `rgba(251,191,36,0.35)` | `rgba(251,191,36,0.25)` |
| 1085-1087 | `.scope-small/medium/large` | reuse badge tokens | light values | dark values |
| 1088 | `.kanban-label` | `--badge-neutral-bg/text` | `#f1f5f9`, `#475569` | `#1e2128`, `#8b8f96` |
| 1089-1096 | `.swot-*` | `--swot-strengths-bg`, etc. | light values | dark values |
| 1097-1100 | `.quadrant-*` | reuse badge semantic tokens | light values | dark values |
| 1101-1104 | `.heatmap-*` | `--heatmap-full-bg/text`, etc. | light values | dark values |
| 1105-1108 | `.groom-session`, `.group-header:hover`, `.standalone-header` | `--surface-hover` | `#f0f2f5` light / `#222630` dark |
| 1109 | `.proposal-card.draft { border-color }` | `--border-accent` | `#c4b5fd` | `var(--border)` |
| 1110 | `.card:hover` | `--surface-hover-subtle` | `rgba(0,0,0,0.02)` | `rgba(255,255,255,0.03)` |
| 1114 | `.suggested-next` | use `var(--surface)` | `#f8f9fb` = `var(--bg)` | `var(--surface)` |
| 1115-1116 | scrollbar thumb | `--scrollbar-thumb`, `--scrollbar-thumb-hover` | `#d1d5db`, `#9ca3af` | `var(--border)`, `#3a3f4a` |
| 1117 | `::selection` | `--selection-bg` | `rgba(94,106,210,0.2)` | `rgba(94,106,210,0.3)` |

### Overrides that are eliminated entirely (base rule uses token)

These 12 lines disappear because the base `.badge-*` rules now use `var(--badge-*-bg/text)`:
- Lines 1066-1077 (badge overrides) — handled by semantic tokens
- Lines 1082-1084 (badge-groom/dev/draft) — handled by `--badge-info-bg`
- Lines 1085-1087 (scope-*) — handled by badge tokens
- Lines 1088 (kanban-label) — handled by `--badge-neutral-bg`
- Lines 1097-1104 (quadrant/heatmap) — handled by semantic tokens
- Lines 1111-1113 (nav-item) — these already use `var(--sidebar-*)` tokens, redundant

**Net result: 58 scattered overrides -> 0 scattered overrides. ~20 new tokens in both theme blocks.**

---

## PROGRESSIVE_PROPOSAL_CSS Dark Mode Plan

### Strategy: Embed proposal pages in dashboard theme context

When proposals are viewed via `/proposals/:slug` they are rendered inside the dashboard shell which provides `data-theme`. The PROGRESSIVE_PROPOSAL_CSS must read from the same token vocabulary.

### Conversion table for proposal CSS hardcoded colors

| Current Hardcoded | Semantic Token | Dark Value | Light Value |
|-------------------|---------------|------------|-------------|
| `#1a1a1a` (body text) | `var(--text)` | `#e8eaed` | `#1e2128` |
| `#f8f9fa` (body bg) | `var(--bg)` | `#0d0f12` | `#f8f9fb` |
| `#fff` (card bg, scope bg) | `var(--surface)` | `#1a1d23` | `#ffffff` |
| `#e5e7eb` (borders) | `var(--border)` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` |
| `#111` (headings, strong) | `var(--text)` | `#e8eaed` | `#1e2128` |
| `#333` (flow title) | `var(--text)` | — | — |
| `#444` (section text) | `var(--text-secondary)` | `#a0a4ab` | `#444` |
| `#555` (issue outcome, AC) | `var(--text-secondary)` | — | — |
| `#777` (toc links) | `var(--text-muted)` | `#8b8f96` | `#6b7280` |
| `#888` (flow job, meta) | `var(--text-muted)` | — | — |
| `#999` (pp-status, empty) | `var(--text-muted)` | — | — |
| `#bbb` (review header) | `var(--text-muted)` | — | — |
| `#d1d5db` (placeholder) | `var(--text-faint)` | `#4a4f57` | `#d1d5db` |
| `#7c3aed` (purple accent) | `var(--accent)` | `#5e6ad2` | `#5e6ad2` |
| `#8b5cf6` (purple lighter) | `var(--accent-hover)` | `#7c85e0` | `#4f5bc4` |
| `#2e1065` (hero gradient dark) | `var(--hero-gradient-start)` | `#1a1d35` | `#2e1065` |
| `#5b21b6` (callout text) | `var(--accent)` | — | — |
| `#4c1d95` (callout strong) | `var(--accent)` | — | — |
| `#f5f3ff` (icon bg, callout bg) | `var(--accent-subtle)` | `#1e1f35` | `#eef0ff` |
| `#f3f4f6` (scope li border, label bg) | `var(--border)` | — | — |
| `#f9fafb` (wireframe chrome bg) | `var(--surface)` | — | — |
| `#f0fdf4` (priority-low bg) | `var(--badge-success-bg)` | `#132b1a` | `#dcfce7` |
| `#fef2f2` (priority-critical bg) | `var(--badge-error-bg)` | `#2e1a1a` | `#fee2e2` |
| `#fff7ed` (priority-high bg) | `var(--badge-warning-bg)` | `#2e2810` | `#fef3c7` |
| `#fefce8` (priority-medium bg) | new `--badge-caution-bg` | `#2e2810` | `#fefce8` |
| `#dcfce7` (verdict ready bg) | `var(--badge-success-bg)` | — | — |
| `#fef3c7` (verdict caution bg) | `var(--badge-warning-bg)` | — | — |
| `#fee2e2` (verdict blocked bg) | `var(--badge-error-bg)` | — | — |
| `#fffbeb` (advisory card bg) | `var(--badge-warning-bg)` | — | — |
| `#fde68a` (advisory border) | `var(--warning)` | — | — |
| `#78350f` (advisory text) | `var(--warning)` | — | — |

### New tokens needed for proposals

| Token | Dark | Light |
|-------|------|-------|
| `--text-secondary` | `#a0a4ab` | `#555` |
| `--hero-gradient-start` | `#1a1d35` | `#2e1065` |
| `--hero-gradient-mid` | `var(--accent)` | `#7c3aed` |
| `--hero-gradient-end` | `var(--accent-hover)` | `#8b5cf6` |

---

## Accent Color Unification

### Current state
- DASHBOARD_CSS: `--accent: #5e6ad2` (both themes) -- correct
- PROGRESSIVE_PROPOSAL_CSS: `#7c3aed` everywhere -- incorrect
- Inline styles: `#2563eb` in some fallbacks -- incorrect
- Fallback patterns: `var(--accent, #2563eb)` -- stale

### After
- All purple/blue accents unified to `#5e6ad2` via `var(--accent)`
- Hero gradient uses accent-derived values (not separate purple)
- No `var(--accent, #2563eb)` fallback patterns remain

---

## TDD Task Breakdown

### Task 1: Make light theme block define ALL tokens explicitly

**Test:** Parse the `[data-theme="light"]` CSS block. Assert it defines every token that `:root` defines (same set of `--` custom properties). Count should match.

**Impl:** Add missing tokens to light block: `--radius`, `--radius-sm`, `--transition`. After PM-117, also add all `--space-*` and `--text-*` tokens. Add new tokens: `--text-secondary`, `--text-faint`, `--surface-raised`, `--surface-hover`, `--surface-hover-subtle`, `--selection-bg`, `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--highlight-bg`, `--border-strong`.

### Task 2: Add badge semantic tokens to both theme blocks

**Test:** Assert both `:root` and `[data-theme="light"]` contain `--badge-success-bg`, `--badge-success-text`, `--badge-warning-bg`, `--badge-warning-text`, `--badge-error-bg`, `--badge-error-text`, `--badge-info-bg`, `--badge-info-text`, `--badge-neutral-bg`, `--badge-neutral-text`.

**Impl:** Add 10 badge tokens to each block with theme-appropriate values from the override migration table above.

### Task 3: Add SWOT, heatmap, speaker tokens to both blocks

**Test:** Assert both blocks contain `--swot-strengths-bg`, `--heatmap-full-bg`, `--speaker-customer-bg`, etc.

**Impl:** Add ~12 component-specific tokens. These exist because SWOT/heatmap cells need distinct bg+text pairs per theme.

### Task 4: Migrate scattered overrides into token-based rules

**Test:** Assert the DASHBOARD_CSS string does NOT contain any `[data-theme="light"]` selectors outside the main token block (lines 473-494). All theming happens through tokens.

**Impl:** Delete lines 1059-1117 (58 scattered overrides). Update the base CSS rules that referenced hardcoded hex to use the new tokens. This is the highest-risk task — run full visual comparison before/after.

### Task 5: Add dark mode support to PROGRESSIVE_PROPOSAL_CSS

**Test:** Render a proposal page with `data-theme="dark"`. Assert body background is NOT `#f8f9fa`. Assert text color is NOT `#1a1a1a`. Assert all `.section-title`, `.issue-card`, `.callout` elements use appropriate dark colors.

**Impl:** Replace all ~50 hardcoded color values in PROGRESSIVE_PROPOSAL_CSS with `var()` references. Add a `[data-theme="dark"]` section at the end of PROGRESSIVE_PROPOSAL_CSS ONLY for the hero gradient override (all other theming handled by tokens).

### Task 6: Unify accent color in PROGRESSIVE_PROPOSAL_CSS

**Test:** Assert PROGRESSIVE_PROPOSAL_CSS contains zero instances of `#7c3aed` or `#8b5cf6`. All should be `var(--accent)` or `var(--accent-hover)`.

**Impl:** Replace all `#7c3aed` with `var(--accent)` and `#8b5cf6` with `var(--accent-hover)`. Update hero gradient to use `var(--hero-gradient-start)`, `var(--accent)`, `var(--accent-hover)`.

### Task 7: Add proposal-specific dark tokens

**Test:** Assert both theme blocks contain `--hero-gradient-start`, `--hero-gradient-mid`, `--hero-gradient-end`, `--text-secondary`.

**Impl:** Add 4 new tokens to both blocks.

### Task 8: Theme-specific visual verification test

**Test:** For each major route (`/`, `/proposals`, `/proposals/:slug`, `/backlog`, `/kb`), render with both `data-theme="dark"` and `data-theme="light"`. Assert:
1. No raw `#fff` or `#000` text visible (should be token-derived)
2. Background colors match expected token values
3. Accent color is `#5e6ad2` in both themes
4. No unstyled/broken elements (check for `undefined` or missing CSS)

**Impl:** Create a test helper that renders each route and parses the CSS custom property values from the HTML. Verify token coverage.

### Task 9: Clean up `color-scheme` and meta theme-color

**Test:** Assert `color-scheme: dark` in dark block, `color-scheme: light` in light block. Assert the HTML `<meta name="theme-color">` uses `var(--bg)`.

**Impl:** Already correct for `color-scheme`. Add `<meta name="theme-color" content="${theme === 'light' ? '#f8f9fb' : '#0d0f12'}">` to the HTML shell if not present.

---

## Background Color Verification

| Token | Dark (AC4) | Light (AC4) | Status |
|-------|-----------|-------------|--------|
| `--bg` | `#0d0f12` | `#f8f9fb` | Already correct |
| `--surface` | `#1a1d23` | `#ffffff` | Already correct |
| `--dark` | `#111318` | `#1a1a2e` | Already correct |
| `--sidebar-bg` | `#111318` | `#f0f1f4` | Already correct |

Note: AC4 specifies `--bg: #0d0f12` for dark, which matches current. No change needed.
