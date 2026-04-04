# PM-128: Basic Keyboard Navigation and Semantic HTML

## Header

**Goal:** Make the dashboard keyboard-navigable and screen-reader-parseable. Tab order follows visual layout, focus rings are visible on all interactive elements, semantic HTML tags replace generic `<div>`s, and `prefers-reduced-motion` disables all hover transitions and animations.

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). The HTML shell is `dashboardPage()` (line 1220). Every page handler emits body content injected into this shell. CSS lives in `DASHBOARD_CSS` (lines 446-1216).

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 446-1216 | Add focus ring CSS, `prefers-reduced-motion` rule, semantic element styles |
| `scripts/server.js` | 1220-1296 | Convert `dashboardPage()` shell to semantic HTML |
| `scripts/server.js` | 3914-3944 | Update `handleProposalDetail()` HTML tags |
| `scripts/server.js` | 4819-4886 | Update `handleCompetitorDetail()` HTML tags |
| `scripts/server.js` | 4888-4911 | Update `handleResearchTopic()` HTML tags |
| `scripts/server.js` | 5221-5299 | Update `handleBacklogItem()` HTML tags |
| `scripts/server.js` | 3398-3672 | Update `handleDashboardHome()` HTML tags |
| `scripts/server.js` | 3946-3998 | Update `handleProposalsPage()` HTML tags |
| `scripts/server.js` | 4768-4817 | Update `handleKnowledgeBasePage()` HTML tags |
| `scripts/server.js` | 5080-5111 | Update `handleBacklog()` HTML tags |
| `scripts/server.js` | 1297-1394 | Add keyboard shortcut JS to shell |
| `tests/server.test.js` | append | Semantic HTML and keyboard a11y tests |

**Done criteria:**
- `dashboardPage()` shell uses `<nav>` for sidebar, `<main>` for content area
- Heading hierarchy: single `<h1>` per page, no skipped levels (h1 -> h2 -> h3)
- Cards wrapped in `<article>` elements
- Page sections wrapped in `<section>` elements
- All interactive elements (links, buttons, click-to-copy) have visible focus ring on `:focus-visible`
- Tab order: sidebar nav items -> main content interactive elements (top to bottom)
- Click-to-copy operable via Enter key (provided by PM-125)
- Filter inputs do NOT use `autofocus` attribute
- All decorative icons/SVGs have `aria-hidden="true"`
- `prefers-reduced-motion: reduce` media query disables all `transition`, `animation`, and `transform` hover effects
- All tests pass: `cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test`

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Manual: Tab through every page, verify focus ring visibility and order
# Manual: Use keyboard-only navigation to reach every link and action
```

## Upstream Context

From `pm/research/dashboard-linear-quality/findings.md`:
- **Focus:** 2px accent outline, 2px offset
- **Semantic HTML:** `<nav>`, `<main>`, `<article>`, `<section>`, heading hierarchy
- **Respect `prefers-reduced-motion`**
- **Hit targets:** Visual 24px, clickable 44px min

## Complete Semantic HTML Changes

### dashboardPage() shell (line 1220-1296)

| Current | New | Line |
|---------|-----|------|
| `<div class="app-layout">` | `<div class="app-layout">` (unchanged, layout wrapper) | 1274 |
| `<aside class="sidebar">` | `<aside class="sidebar" role="complementary">` | 1275 |
| `<nav>` (inside sidebar) | `<nav aria-label="Main navigation">` | 1277 |
| `<main class="main-content">` | `<main class="main-content" role="main" id="main-content">` | 1288 |
| `<div class="container">` | `<div class="container">` (unchanged) | 1289 |
| KB secondary nav: `<nav class="nav-secondary">` | `<nav class="nav-secondary" aria-label="Knowledge Base sections">` | 1290 |

### Page handlers -- section wrapping

Each page handler's body content needs `<section>` wrapping for major blocks:

| Handler | Current | New |
|---------|---------|-----|
| `handleDashboardHome` | `<div class="content-section">` | `<section class="content-section">` |
| `handleProposalsPage` | `<div class="card-grid">` | `<section class="card-grid" aria-label="Proposals">` |
| `handleKnowledgeBasePage` | `<div class="content-section">` | `<section class="content-section">` |
| `handleBacklog` | kanban groups in `<div>` | `<section>` per status group |
| All detail pages (PM-125/130) | `.detail-section` as `<div>` | `.detail-section` as `<section>` (already planned in PM-125) |

### Card elements -> article

All card-generating code needs `<article>` wrapping:

| Current | New |
|---------|-----|
| `<div class="card">` (proposals, competitors, topics) | `<article class="card">` |
| `<a class="kanban-item">` (backlog) | `<article class="kanban-item"><a ...>` (or keep `<a>` as block, add `role="article"`) |

Since kanban items are already `<a>` tags (block links), the cleanest approach is to add `role="article"` to the existing `<a class="kanban-item">` elements rather than wrapping in `<article>`.

### Heading hierarchy audit

| Page | Current h1 | Sub-headings | Fix needed |
|------|-----------|--------------|------------|
| Home | Project name | h2 (proposals, KB) | OK |
| Proposals | "Proposals" | h2 (status groups) | OK |
| KB | "Research" | h2 (sections) | OK |
| Backlog | "Backlog" | None (groups use `.group-title`) | Change `.group-title` from `<div>` to `<h2>` |
| Detail pages | Title | h2 (sections) | OK (PM-125 uses `.detail-section-title` as `<h2>`) |

### Decorative icons -> aria-hidden

All SVG icons in the shell (theme toggle sun/moon, toast icons) need `aria-hidden="true"`. Check current state:
- Theme toggle SVGs (lines 1282-1283): already have IDs but no `aria-hidden` -- add it
- Toast icon SVGs (line 1323-1327): injected via JS innerHTML -- add `aria-hidden="true"` to each SVG string

## Complete Keyboard Shortcut List

| Key | Action | Scope |
|-----|--------|-------|
| `Tab` | Move focus to next interactive element | Global (browser default) |
| `Shift+Tab` | Move focus to previous interactive element | Global (browser default) |
| `Enter` | Activate focused link/button/click-to-copy | Global (PM-125 handles click-to-copy) |
| `ArrowLeft`/`ArrowRight` | Switch tabs in competitor detail | Already implemented (line 4869) |
| `/` | Focus search input (if present on page) | Backlog page only |

Note: Arrow key navigation between sidebar items is explicitly marked "optional" in AC. Not implementing in this issue.

## Task Breakdown

### Task 1: Write semantic HTML and keyboard tests (RED)

**Test file:** `tests/server.test.js` (append)

Tests to write:
1. `dashboardPage()` output contains `<nav aria-label="Main navigation">`
2. `dashboardPage()` output contains `<main` tag (not `<div class="main-content">` without `<main>`)
3. `dashboardPage()` output contains `role="main"` or `<main>` element
4. Home page response has exactly one `<h1>` tag
5. Proposals page response has exactly one `<h1>` tag
6. Backlog page response has exactly one `<h1>` tag
7. Card elements use `<article` tag (or `role="article"`)
8. CSS contains `focus-visible` rule with `outline` or `box-shadow` for interactive elements
9. CSS contains `prefers-reduced-motion: reduce` media query that targets `transition` and `animation`
10. Theme toggle SVGs contain `aria-hidden="true"`
11. Backlog search input does NOT contain `autofocus` attribute
12. KB secondary nav contains `aria-label`

```
Verify: node --test -> 12 new tests FAIL
```

### Task 2: Add global focus ring and reduced-motion CSS (DASHBOARD_CSS, lines 500-502)

**Current focus styles (line 502):**
```css
a:focus-visible { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); outline: none; border-radius: 4px; }
```

This only covers `<a>` tags. Extend to all interactive elements.

**Add after line 502:**
```css
button:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible,
input:focus-visible, select:focus-visible, textarea:focus-visible {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  outline: none;
  border-radius: 4px;
}
```

**Add comprehensive reduced-motion rule.** Currently there are 3 separate `prefers-reduced-motion` blocks (lines 695, 706, 984). Consolidate into one master block.

**Add after the focus rules:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

This one rule replaces the need for the existing per-element reduced-motion blocks. The existing blocks at lines 695, 706, 984 can be left in place (they become no-ops under the universal rule) or removed for cleanliness.

### Task 3: Convert dashboardPage() shell to semantic HTML (lines 1274-1295)

**Changes to the template literal:**

| Line | Current | New |
|------|---------|-----|
| 1275 | `<aside class="sidebar">` | `<aside class="sidebar" role="complementary" aria-label="Sidebar">` |
| 1277 | `<nav>` | `<nav aria-label="Main navigation">` |
| 1282 | `<svg id="theme-icon-sun" viewBox=...>` | `<svg id="theme-icon-sun" aria-hidden="true" viewBox=...>` |
| 1283 | `<svg id="theme-icon-moon" viewBox=...>` | `<svg id="theme-icon-moon" aria-hidden="true" viewBox=...>` |
| 1288 | `<main class="main-content...">` | `<main class="main-content..." role="main" id="main-content">` |
| 1290 | `<nav class="nav-secondary">` | `<nav class="nav-secondary" aria-label="Knowledge Base sections">` |

### Task 4: Add aria-hidden to toast icon SVGs (lines 1323-1327)

**Current:**
```javascript
var TOAST_ICONS = {
  tests_passed: '<svg viewBox="0 0 16 16" ...',
  pr_created: '<svg viewBox="0 0 16 16" ...',
  ...
};
```

**New:** Add `aria-hidden="true"` to each SVG opening tag:
```javascript
tests_passed: '<svg aria-hidden="true" viewBox="0 0 16 16" ...',
```

### Task 5: Convert cards to article elements

**Search and replace across all card-generating code:**

1. `buildProposalCards` (find with grep): `<div class="card">` -> `<article class="card">`; corresponding `</div>` -> `</article>`
2. `buildCompetitorsContent` (line 4043): `<div class="card">` -> `<article class="card">`; `</div>` -> `</article>`
3. `buildTopicsContent` (line 4105): `<div class="card">` -> `<article class="card">`; `</div>` -> `</article>`
4. Kanban items: add `role="article"` to `<a class="kanban-item"` elements

### Task 6: Convert content sections to section elements

**Search and replace across page handlers:**

1. `<div class="content-section">` -> `<section class="content-section">` with matching `</div>` -> `</section>`
2. Backlog group titles: change `<div class="group-title">` to `<h2 class="group-title">` with matching `</div>` -> `</h2>`

CSS impact: `.group-title` styling already uses `font-size`, `font-weight`, etc. Adding `h2` tag requires resetting default `h2` margin within `.group-header`: add `.group-header h2 { margin: 0; font-size: inherit; }`.

### Task 7: Remove autofocus from search inputs

**Check line 5087** (backlog search input):
```html
<input type="text" id="backlog-search" placeholder="Filter backlog..."
```
Currently does NOT have `autofocus` -- confirm no `autofocus` exists anywhere.

**Grep for `autofocus` in server.js.** If found, remove it.

### Task 8: Add "/" keyboard shortcut for search focus (backlog page)

**Add to the backlog search script block (lines 5091-5101):**

```javascript
document.addEventListener('keydown', function(e) {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    var input = document.getElementById('backlog-search');
    if (input) input.focus();
  }
});
```

### Task 9: Run tests (GREEN)

```
Verify: node --test -> all tests PASS
```

### Task 10: Manual keyboard smoke test

Test with keyboard only (no mouse):
1. Tab from page load -- focus should start at first sidebar nav link
2. Tab through sidebar links -- each shows visible focus ring (accent outline)
3. Enter on a nav link -- navigates to that page
4. Tab into main content -- focus moves to first interactive element
5. On backlog page, press `/` -- search input receives focus
6. Tab to a click-to-copy element, press Enter -- "Copied!" toast appears
7. On competitor detail (if tabs still exist post PM-130): ArrowLeft/ArrowRight switches tabs
8. Enable `prefers-reduced-motion: reduce` in browser DevTools -- verify no animations play
9. Run screen reader (VoiceOver on macOS): verify nav landmarks announced, heading hierarchy correct
