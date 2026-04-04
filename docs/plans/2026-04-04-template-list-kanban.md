# PM-140: List and Kanban Templates

## Header

**Goal:** Create `renderListTemplate()` and `renderKanbanTemplate()` functions in `scripts/server.js`, then refactor six existing handlers to use them. Templates own layout chrome (page-header, breadcrumb, sections, columns, empty states). Handlers keep card/row HTML rendering.

**Architecture:** Single-file dashboard (`scripts/server.js`, 4561 lines). All handlers generate HTML strings passed to `dashboardPage()`. CSS lives in `DASHBOARD_CSS` (lines 344-1100+). Tests in `tests/server.test.js` (192 tests, `node --test`).

**Dependency:** PM-138 (core `renderTemplate()` + detail template) has not been implemented yet. This plan is self-contained: it adds `renderListTemplate()` and `renderKanbanTemplate()` as standalone functions. If PM-138 lands first, these functions can be wired into its dispatcher as additional template types. If PM-140 lands first, PM-138 can wrap them.

**Files in scope:**
| File | Change |
|------|--------|
| `scripts/server.js` ~344-1100 | Add `.list-template`, `.kanban-template` CSS blocks |
| `scripts/server.js` (new function) | Add `renderListTemplate(opts)` |
| `scripts/server.js` (new function) | Add `renderKanbanTemplate(opts)` |
| `scripts/server.js` ~1973-2059 | Refactor `handleProposalsPage` to use `renderListTemplate` |
| `scripts/server.js` ~3403-3419 | Refactor `handleKbStrategyDetail` to use `detail` pattern (breadcrumb + markdown-body in `.detail-page` wrapper) |
| `scripts/server.js` ~3421-3443 | Refactor `handleKbCompetitorsDetail` to use `renderListTemplate` |
| `scripts/server.js` ~3467-3509 | Refactor `handleKbTopicsDetail` to use `renderListTemplate` |
| `scripts/server.js` ~3682-3778 | Refactor `handleBacklog` to use `renderKanbanTemplate` |
| `scripts/server.js` ~3780-3860 | Refactor `handleShipped` to use `renderListTemplate` |
| `tests/server.test.js` (append) | Template unit tests + regression tests for refactored pages |

**Done criteria:**
- `renderListTemplate` accepts a schema and returns HTML
- `renderKanbanTemplate` accepts a schema and returns HTML
- All six handlers refactored; output HTML is structurally equivalent (same CSS classes on cards/rows)
- Card/row rendering stays in handlers (templates only define layout)
- All 192 existing tests still pass
- New tests verify template schemas produce correct structural HTML

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
```

---

## Schemas

### List Template Schema

```js
renderListTemplate({
  breadcrumb: '<a href="/kb">&larr; Knowledge Base</a>',  // optional raw HTML
  title: 'Proposals',
  subtitle: '3 groomed, 2 ideas',                          // optional
  sections: [
    {
      title: 'Groomed',                                     // optional section heading
      count: '3 proposals',                                 // optional, shown in section-count
      items: ['<a class="proposal-card-row">...</a>'],      // array of raw HTML strings
      layout: 'cards',                                      // 'cards' = card-grid, 'rows' = stacked list
      itemsClass: 'proposal-grid',                          // optional override for the items container class
    },
    {
      title: 'Ideas',
      count: '2 ungroomed',
      items: ['<a class="idea-row">...</a>'],
      layout: 'rows',
      itemsClass: 'idea-list',
    },
  ],
  emptyState: renderEmptyState(...),                        // optional: shown when all sections are empty
  contentBefore: '<div class="markdown-body">...</div>',    // optional: raw HTML before sections (for topics page landscape)
})
```

The function returns the full `bodyContent` string ready for `dashboardPage()`.

### Kanban Template Schema

```js
renderKanbanTemplate({
  title: 'Roadmap',
  subtitle: "What's coming, what's in progress, and what just shipped",
  legend: '<div class="backlog-legend">...</div>',           // optional raw HTML between header and board
  columns: [
    {
      label: 'Idea',
      status: 'idea',                                        // used for CSS class and data attribute
      items: ['<a class="kanban-item">...</a>'],             // raw HTML strings
      totalCount: 15,                                        // total before capping
      displayCount: 10,                                      // items shown (after cap)
      viewAllHref: '/roadmap?col=idea',                      // optional link when capped
      viewAllLabel: 'ideas',                                 // e.g. "View all 15 ideas"
      hint: 'Run <code>/pm:groom &lt;slug&gt;</code>...',   // optional column hint HTML
      cssClass: '',                                          // optional extra class (e.g. 'shipped')
    },
  ],
  emptyState: renderEmptyState(...),                          // optional: shown when no items at all
})
```

---

## Tasks

### Task 1: Add `renderListTemplate(opts)` function

**Files:** `scripts/server.js` (insert before `handleProposalsPage` at ~line 1973)
**Changes:**
- New function `renderListTemplate(opts)` that:
  1. Builds page-header div with optional breadcrumb, title, subtitle
  2. If `opts.emptyState` is set and all sections have 0 items and no `contentBefore`, returns page-header + emptyState
  3. Renders optional `opts.contentBefore` raw HTML
  4. Iterates `opts.sections`, for each: renders `.section` with optional `.section-header` (title + count), then items container with class based on `layout` (`cards` -> `card-grid`, `rows` -> vertical list) or `itemsClass` override
  5. Returns assembled HTML string
- Reuses existing CSS classes: `.page-header`, `.section`, `.section-header`, `.section-title`, `.section-count`, `.card-grid`, `.breadcrumb`
**Tests:**
- `renderListTemplate returns page-header with title`
- `renderListTemplate returns empty state when all sections empty`
- `renderListTemplate renders multiple sections`
- `renderListTemplate includes contentBefore when provided`
- `renderListTemplate uses itemsClass override when provided`
**Depends on:** none

### Task 2: Add `renderKanbanTemplate(opts)` function

**Files:** `scripts/server.js` (insert after `renderListTemplate`)
**Changes:**
- New function `renderKanbanTemplate(opts)` that:
  1. Builds page-header div with title, subtitle
  2. Renders optional legend HTML
  3. If `opts.emptyState` is set and all columns have 0 items, returns header + emptyState
  4. Iterates `opts.columns`, for each: renders `.kanban-col` with `.col-header` (label + count badge if capped), optional `.col-hint`, `.col-body` with items and optional view-all link
  5. Wraps columns in `.kanban` container
  6. Returns assembled HTML string
- Reuses existing CSS: `.kanban`, `.kanban-col`, `.col-header`, `.col-body`, `.col-hint`, `.kanban-view-all`, `.col-empty`, `.col-count`
**Tests:**
- `renderKanbanTemplate returns page-header with title and subtitle`
- `renderKanbanTemplate returns empty state when no items`
- `renderKanbanTemplate renders columns with items`
- `renderKanbanTemplate adds view-all link when capped`
- `renderKanbanTemplate applies cssClass to column`
**Depends on:** none

### Task 3: Add CSS for template wrappers

**Files:** `scripts/server.js` CSS section (~line 1095)
**Changes:**
- Add `.list-template` class: no-op currently (semantic wrapper, zero added styles — existing `.page-header`, `.section`, `.card-grid` classes already handle layout)
- Add `.kanban-template` class: no-op currently (`.kanban` already handles the grid)
- These wrappers exist for future template-system integration (PM-138) and test selectors
**Tests:** Covered by template function tests (check for wrapper classes in output)
**Depends on:** none

### Task 4: Refactor `handleProposalsPage` to use `renderListTemplate`

**Files:** `scripts/server.js` ~1973-2059
**Changes:**
- Keep data-fetching logic (buildProposalRows, ideas collection) unchanged
- Keep card HTML rendering unchanged (the `.proposal-card-row` and `.idea-row` markup stays in handler)
- Replace the manual page-header + section assembly with:
  ```js
  const body = renderListTemplate({
    title: 'Proposals',
    subtitle: subtitle,
    sections: [
      { title: 'Groomed', count: `${proposals.length} proposal${...}`, items: groomedItems, layout: 'rows', itemsClass: 'proposal-grid' },
      { title: 'Ideas', count: `${ideas.length} ungroomed`, items: ideaItems, layout: 'rows', itemsClass: 'idea-list' },
    ],
    emptyState: renderEmptyState('No proposals yet', ...),
  });
  ```
- The handler still builds each card's HTML string; only the outer chrome moves to the template
**Tests:**
- Existing proposal tests (lines ~1985-2120 in test file) must still pass — they check for specific CSS classes, text content, empty state
- No new tests needed: existing coverage validates structural equivalence
**Depends on:** Task 1

### Task 5: Refactor `handleKbCompetitorsDetail` to use `renderListTemplate`

**Files:** `scripts/server.js` ~3421-3443
**Changes:**
- Keep competitor card HTML rendering unchanged (the `.card` article markup stays)
- Replace manual breadcrumb + page-header + card-grid assembly with:
  ```js
  const body = renderListTemplate({
    breadcrumb: '<a href="/kb">&larr; Knowledge Base</a>',
    title: 'Competitors',
    sections: [{ items: cardItems, layout: 'cards' }],
    emptyState: renderEmptyState('No competitor profiles', ...),
  });
  ```
**Tests:**
- Existing KB competitors tests must pass
- No new tests needed
**Depends on:** Task 1

### Task 6: Refactor `handleKbTopicsDetail` to use `renderListTemplate`

**Files:** `scripts/server.js` ~3467-3509
**Changes:**
- Keep landscape rendering + topic card rendering unchanged
- Replace manual assembly with:
  ```js
  const body = renderListTemplate({
    breadcrumb: '<a href="/kb">&larr; Knowledge Base</a>',
    title: 'Research',
    contentBefore: landscapeHtml,
    sections: [{ title: 'Topics', items: topicCards, layout: 'cards' }],
    emptyState: landscapeHtml ? null : renderEmptyState(...),  // only show empty if no landscape AND no topics
  });
  ```
- The `contentBefore` field handles the landscape markdown that precedes the topic cards
**Tests:**
- Existing KB topics tests must pass
- No new tests needed
**Depends on:** Task 1

### Task 7: Refactor `handleKbStrategyDetail` to use detail pattern

**Files:** `scripts/server.js` ~3403-3419
**Changes:**
- Currently uses older `<div class="page-header"><p class="breadcrumb">...` pattern
- Refactor to use `.detail-page` wrapper with `.detail-breadcrumb` nav (matches PM-125 detail page pattern already in codebase from `handleProposalDetail` / `handleCompetitorDetail`)
- Structure:
  ```html
  <div class="detail-page">
    <nav class="detail-breadcrumb"><a href="/kb">Knowledge Base</a></nav>
    <h1>Strategy</h1>
    <div class="markdown-body">{rendered}</div>
  </div>
  ```
  or empty state if no file
- This is a migration to the existing detail pattern, not a new template
**Tests:**
- `handleKbStrategyDetail uses .detail-page wrapper`
- `handleKbStrategyDetail uses .detail-breadcrumb nav`
- Existing strategy tests must pass
**Depends on:** none

### Task 8: Refactor `handleShipped` to use `renderListTemplate`

**Files:** `scripts/server.js` ~3780-3860
**Changes:**
- Keep shipped card HTML rendering unchanged (`.shipped-item-card` markup stays)
- Replace manual breadcrumb + page-header + shipped-items div with:
  ```js
  const body = renderListTemplate({
    breadcrumb: '<a href="/roadmap">&larr; Roadmap</a>',
    title: 'Shipped',
    subtitle: `${roots.length} item${roots.length !== 1 ? 's' : ''} shipped`,
    sections: [{ items: cardItems, layout: 'rows', itemsClass: 'shipped-items' }],
    emptyState: renderEmptyState('Nothing shipped yet', ...),
  });
  ```
**Tests:**
- Existing shipped tests must pass
- No new tests needed
**Depends on:** Task 1

### Task 9: Refactor `handleBacklog` to use `renderKanbanTemplate`

**Files:** `scripts/server.js` ~3682-3778
**Changes:**
- Keep all data-fetching, STATUS_MAP, renderItem logic, legend, COL_HINTS unchanged
- Replace the manual column assembly + body HTML with:
  ```js
  const body = renderKanbanTemplate({
    title: 'Roadmap',
    subtitle: "What's coming, what's in progress, and what just shipped",
    legend: legend,
    columns: allStatuses.map(status => ({
      label: status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      status: status,
      items: displayItems.map(item => renderItem(item, status)),
      totalCount: totalCount,
      displayCount: displayItems.length,
      viewAllHref: isShipped ? '/roadmap/shipped' : `/roadmap?col=${status}`,
      viewAllLabel: VIEW_ALL_LABELS[status] || status,
      hint: COL_HINTS[status] && allItems.length > 0 ? COL_HINTS[status] : null,
      cssClass: isShipped ? 'shipped' : '',
    })),
    emptyState: renderEmptyState('No backlog items', ...),
  });
  ```
**Tests:**
- Existing kanban tests must pass (column labels, shipped column cap, view-all link, priority classes, etc.)
- No new tests needed
**Depends on:** Task 2

### Task 10: Export template functions + final test run

**Files:** `scripts/server.js` ~4553 (module.exports)
**Changes:**
- Add `renderListTemplate` and `renderKanbanTemplate` to `module.exports`
**Tests:**
- Run full suite: `node --test tests/server.test.js`
- All 192+ existing tests pass
- All new template unit tests pass
**Depends on:** Tasks 1-9

---

## File Structure

No new files created. All changes are in:
- `scripts/server.js` (template functions, CSS, handler refactors, exports)
- `tests/server.test.js` (new test blocks appended)

## Contract

**Files in scope:**
- `scripts/server.js`
- `tests/server.test.js`

**Files out of scope:**
- All other files in the repo
- No changes to routing, `dashboardPage()`, `renderEmptyState()`, or any detail page handlers besides `handleKbStrategyDetail`
