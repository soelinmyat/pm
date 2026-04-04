# PM-139: Detail-tabs and Detail-toc Templates

## Summary

Add two template variants (`detail-tabs` and `detail-toc`) that extend the base `detail` template from PM-138. `detail-tabs` renders a tab bar with keyboard navigation and panel switching (used by `handleCompetitorDetail`). `detail-toc` renders a section nav bar with anchor links (used by `handleKbLandscapeDetail`). Both reuse the shared `.tabs` CSS class for the nav bar, and inject scoped JS with auto-generated unique prefixes to avoid conflicts when multiple tab/toc instances coexist on a page.

## Dependencies

**PM-138 must land first.** It creates `renderTemplate('detail', data)` and establishes the base detail template contract: breadcrumb, title, meta bar, sections, action hint, all inside `.detail-page`. PM-139 extends that function to accept `'detail-tabs'` and `'detail-toc'` type strings.

## Architecture

`renderTemplate` (created by PM-138) accepts a type string and a data object. PM-139 adds two new type branches:

```
renderTemplate('detail-tabs', {
  breadcrumb: [...],
  title: '...',
  metaBar: '...',
  tabs: [{ id: 'profile', label: 'Profile', html: '...' }, ...],
  actionHint: '...',
})
```

```
renderTemplate('detail-toc', {
  breadcrumb: [...],
  title: '...',
  metaBar: '...',
  toc: [{ text: 'Market Overview', slug: 'market-overview' }, ...],
  bodyHtml: '...',
  actionHint: '...',
})
```

Both types reuse the base detail template's header (breadcrumb, title, meta bar) and vary only the content area between the meta bar and action hint.

### detail-tabs content area

```html
<div class="tabs" role="tablist">
  <div class="tab active" role="tab" tabindex="0" aria-selected="true"
       data-tab="{prefix}-{id}" onclick="{prefix}Switch(this,'{prefix}-{id}')"
       onkeydown="{prefix}Key(event,this,'{prefix}-{id}')">{label}</div>
  ...
</div>
<div id="{prefix}-{id}" class="tab-panel active" role="tabpanel">{html}</div>
<div id="{prefix}-{id}" class="tab-panel" role="tabpanel">{html}</div>
<script>
function {prefix}Switch(el, panelId) { ... }
function {prefix}Key(e, el, panelId) { ... }
(function() { /* hash restore */ })();
</script>
```

The `{prefix}` is auto-generated from the first tab's `id` (e.g., `comp` from `compProfile`) or passed explicitly. This avoids collisions with other tab instances on the page (e.g., the KB research page tabs).

### detail-toc content area

```html
<nav class="tabs" role="navigation" aria-label="Sections">
  <a class="tab" href="#{slug}">{text}</a>
  ...
</nav>
<div class="markdown-body">{bodyHtml}</div>
<script>
(function() {
  /* highlight active TOC link on scroll */
  var sections = document.querySelectorAll('[id]');
  var tocLinks = document.querySelectorAll('.tabs .tab');
  ...
})();
</script>
```

The TOC bar uses `.tabs` + `.tab` CSS (shared with tab bars) but renders `<a>` anchor links instead of `<div>` tab buttons. No `role="tablist"` since these are navigation links, not tabs.

## Tasks

### Task 1: Write failing tests for detail-tabs template (RED)

- **Files:** `tests/server.test.js` (append)
- **Tests:**
  1. `GET /competitors/{slug}` response contains `.tabs` class with `role="tablist"`
  2. `GET /competitors/{slug}` response contains `.tab-panel` elements for each section
  3. `GET /competitors/{slug}` tab JS uses a unique function name prefix (not the global `switchTab`)
  4. `GET /competitors/{slug}` still contains `.detail-page`, `.detail-breadcrumb`, `.detail-meta-bar`
  5. `GET /competitors/{slug}` tab count matches available section files
- **Changes:** Update existing test at line 2863 (`PM-130: does NOT contain tabs`) -- this test must be removed or inverted since PM-139 reintroduces tabs
- **Depends on:** none

### Task 2: Write failing tests for detail-toc template (RED)

- **Files:** `tests/server.test.js` (append)
- **Tests:**
  1. `GET /kb?tab=landscape` response contains `.tabs` nav element with anchor links
  2. `GET /kb?tab=landscape` TOC links use `href="#slug"` format
  3. `GET /kb?tab=landscape` still contains `.detail-page` wrapper (once PM-138 applies it)
  4. `GET /kb?tab=landscape` TOC bar does NOT contain `role="tablist"` (navigation, not tabs)
- **Depends on:** none

### Task 3: Add `detail-tabs` branch to `renderTemplate`

- **Files:** `scripts/server.js`
- **Changes:**
  - Inside `renderTemplate` (created by PM-138), add a case for type `'detail-tabs'`
  - Accepts `data.tabs: [{id, label, html}]` array
  - Generates a unique prefix from a counter or from the data (e.g., `'t' + templateCounter++`)
  - Renders the `.tabs[role="tablist"]` bar with `.tab` buttons
  - Renders `.tab-panel` divs, first one active
  - Injects `<script>` block with prefixed `Switch`/`Key` functions and hash restore
  - Wraps everything in the base detail header (breadcrumb, title, meta bar) + `.detail-page`
- **Depends on:** PM-138 (renderTemplate exists)

### Task 4: Add `detail-toc` branch to `renderTemplate`

- **Files:** `scripts/server.js`
- **Changes:**
  - Inside `renderTemplate`, add a case for type `'detail-toc'`
  - Accepts `data.toc: [{text, slug}]` and `data.bodyHtml: string`
  - Renders a `.tabs` `<nav>` with `<a class="tab" href="#slug">` links
  - Renders the body HTML below the nav
  - Injects `<script>` for scroll-based active link highlighting
  - Wraps everything in the base detail header + `.detail-page`
- **Depends on:** PM-138 (renderTemplate exists)

### Task 5: Refactor `handleCompetitorDetail` to use `renderTemplate('detail-tabs', ...)`

- **Files:** `scripts/server.js` (line ~3511)
- **Changes:**
  - Keep data-loading logic (lines 3511-3546): read section files, extract name/category/date
  - Replace the manual HTML assembly (breadcrumb, title, metaBar, sectionBlocks, actionHint) with:
    ```js
    const body = renderTemplate('detail-tabs', {
      breadcrumb: [{ href: '/kb?tab=competitors', label: 'Knowledge Base' }],
      title: name,
      metaParts: metaParts,
      tabs: sectionBlocks.map(s => ({ id: s.key, label: s.label, html: s.rendered })),
      actionHint: '/pm:research competitors',
    });
    ```
  - The `sectionBlocks` array changes from HTML strings to `{key, label, rendered}` objects
  - The breadcrumb, title, and meta bar are now generated by `renderTemplate`
- **Depends on:** Task 3

### Task 6: Refactor `handleKbLandscapeDetail` to use `renderTemplate('detail-toc', ...)`

- **Files:** `scripts/server.js` (line ~3446)
- **Changes:**
  - Keep data-loading logic: read landscape.md, parse stats, render with viz
  - Extract H2 headings from the rendered markdown to build the TOC array
  - Replace the manual HTML assembly with:
    ```js
    const body = renderTemplate('detail-toc', {
      breadcrumb: [{ href: '/kb', label: 'Knowledge Base' }],
      title: 'Market Landscape',
      toc: tocEntries,
      bodyHtml: rendered,
      actionHint: '/pm:research landscape',
    });
    ```
  - The `tocEntries` are extracted by scanning the markdown body for `## ` headings and slugifying them
- **Depends on:** Task 4

### Task 7: Update/remove conflicting tests, run full suite (GREEN)

- **Files:** `tests/server.test.js`
- **Changes:**
  - Remove or update test at line 2863 (`PM-130: does NOT contain tabs or role=tablist`) -- PM-139 reintroduces tabs for competitor detail
  - Update test at line 289 (`GET /competitors/acme returns tabbed detail HTML`) -- strengthen assertions now that tabs are real
  - Verify that KB landscape tests (line 2218) still pass with new TOC structure
  - Run full suite: `node --test`
- **Depends on:** Tasks 1-6

## File Structure

No new files created. All changes are in:
- `scripts/server.js` (template branches + handler refactors)
- `tests/server.test.js` (new tests + updated assertions)

## Contract

**Files in scope:**
| File | Change |
|------|--------|
| `scripts/server.js` | Add `detail-tabs` and `detail-toc` branches in `renderTemplate`; refactor `handleCompetitorDetail` (~3511-3586) and `handleKbLandscapeDetail` (~3446-3465) |
| `tests/server.test.js` | Add ~9 new tests; update 2 existing tests |

**Files out of scope:**
- CSS (`DASHBOARD_CSS`) -- both templates reuse existing `.tabs`, `.tab`, `.tab-panel` classes (lines 675-682)
- `handleResearchTopic`, `handleBacklogItem`, `handleSessionPage` -- these are PM-138's scope (base detail template)
- The KB research page tab JS (lines 2597-2618) -- this is a separate page-level tab instance, not part of the template system
- `dashboardPage()` shell -- no changes needed
