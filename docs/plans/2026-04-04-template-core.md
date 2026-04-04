# PM-138: Core Template Engine + Detail Template

## Header

**Goal:** Extract the repeated detail-page HTML assembly pattern into a single `renderTemplate('detail', data)` function, then refactor `handleResearchTopic`, `handleBacklogItem`, and `handleSessionPage` to use it. Output HTML must be byte-identical (modulo whitespace normalization) so existing tests pass without modification.

**Architecture:** All three handlers currently build the same structure by hand: `<div class="detail-page">` wrapping a breadcrumb nav, h1 title, meta bar, sections array, and optional action hint. The template function formalizes this into a data-driven renderer.

**Files in scope:**
| File | Change |
|------|--------|
| `scripts/server.js` | Add `renderTemplate()` function + `renderDetailTemplate()` helper |
| `scripts/server.js` | Refactor `handleResearchTopic` to extract data, call `renderTemplate('detail', data)` |
| `scripts/server.js` | Refactor `handleBacklogItem` to extract data, call `renderTemplate('detail', data)` |
| `scripts/server.js` | Refactor `handleSessionPage` to extract data, call `renderTemplate('detail', data)` |
| `scripts/server.js` | Export `renderTemplate` in `module.exports` |
| `tests/server.test.js` | Add unit tests for `renderTemplate('detail', data)` |

**Files out of scope:**
- `handleProposalDetail` — uses same pattern but not in AC scope; candidate for follow-up
- `handleCompetitorDetail` — same, not in AC scope
- CSS — no changes needed, template reuses existing class names exactly

**Done criteria:**
- `renderTemplate('detail', data)` exists and is exported
- Data schema: `{ breadcrumb: [{label, href}], title, subtitle?, metaBadges: [{html}], actionHint?, sections: [{title, html}] }`
- All 3 handlers refactored to build a data object and call `renderTemplate`
- All 189 existing tests pass: `node --test tests/server.test.js`
- New unit tests verify template output structure

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test tests/server.test.js
```

## Template Schema

```js
// renderTemplate('detail', data) accepts:
{
  breadcrumb: [
    { label: 'Knowledge Base', href: '/kb?tab=research' },
    // last item has no href — rendered as breadcrumb-current
    { label: 'Topic Name' }
  ],
  title: 'Topic Name',          // required — goes inside <h1 class="detail-title">
  titlePrefix: '',               // optional — raw HTML prepended inside h1 (e.g. id badge span)
  subtitle: '',                  // optional — rendered as <p class="subtitle">
  metaBadges: [                  // each entry is raw HTML, joined with meta-sep middots
    { html: '<span class="badge badge-drafted">drafted</span>' },
    { html: '<span class="meta-item">high priority</span>' }
  ],
  sections: [                    // ordered array of content sections
    { title: 'Findings', html: '<div class="markdown-body">...</div>' },
    { title: null, html: '...' } // title-less section (just the html)
  ],
  actionHint: '/pm:research topic'  // optional — passed to renderClickToCopy
}
```

**Breadcrumb rendering rules:**
- Items with `href` render as `<a href="...">label</a>`
- The last item renders as `<span class="breadcrumb-current">label</span>`
- Separators `<span class="breadcrumb-sep">/</span>` between each item
- Wrapped in `<nav class="detail-breadcrumb" aria-label="Breadcrumb">`

**Meta bar rendering rules:**
- Each badge's `html` is emitted as-is (already escaped by caller)
- Between badges: `<span class="meta-sep">&middot;</span>`
- Wrapped in `<div class="detail-meta-bar">`

**Section rendering rules:**
- Each section wrapped in `<section class="detail-section">`
- If `title` is truthy: `<h2 class="detail-section-title">{title}</h2>` precedes the html
- The `html` is emitted as-is (caller responsible for escaping)

## Tasks

### Task 1: Add `renderDetailTemplate(data)` and `renderTemplate(type, data)`

**Files:** `scripts/server.js`
**Changes:**
- Add `renderDetailTemplate(data)` function that accepts the schema above and returns an HTML string matching the exact `<div class="detail-page">...</div>` structure
- Add `renderTemplate(type, data)` dispatcher that switches on type and calls the right renderer (only `'detail'` for now)
- Place both functions near the existing `renderClickToCopy` / `renderEmptyState` helpers (around line 1390)
- Add `renderTemplate` to `module.exports`

**Tests:**
- `renderTemplate('detail', {...})` with full data returns HTML containing `.detail-page`, `.detail-breadcrumb`, `.detail-title`, `.detail-meta-bar`, `.detail-section`, `.detail-section-title`
- Breadcrumb with 2 items: first is link, second is `breadcrumb-current`
- Breadcrumb with 3 items: first two are links with separators, third is current
- `titlePrefix` appears inside h1 before escaped title text
- `subtitle` renders `<p class="subtitle">` when present, omitted when falsy
- `metaBadges` joined with `meta-sep` middot separators
- Empty `metaBadges` array still renders the meta-bar div (empty)
- Sections with `title` render h2; sections with `title: null` skip h2
- `actionHint` renders `<div class="detail-action-hint">` with click-to-copy; omitted when falsy
- Unknown template type throws an error

**Depends on:** none

### Task 2: Refactor `handleResearchTopic` to use `renderTemplate`

**Files:** `scripts/server.js`
**Changes:**
- Keep all data extraction logic (reading files, building `meta`, splitting sources) unchanged
- Build a data object matching the schema:
  - `breadcrumb`: `[{label: 'Knowledge Base', href: '/kb?tab=research'}, {label: meta.label}]`
  - `title`: `meta.label`
  - `subtitle`: `meta.subtitle`
  - `metaBadges`: `[{html: meta.badgesHtml}]` (single entry — already contains internal separators from `buildTopicMeta`)
  - `sections`: findings section + optional sources section
  - `actionHint`: `'/pm:research ' + topic`
- Replace the hand-built `pageBody` template literal with `const pageBody = renderTemplate('detail', data)`
- The `dashboardPage()` call and response writing stay the same

**Key detail:** `meta.badgesHtml` is already a pre-built HTML string with its own middot separators inside. It becomes a single `metaBadges` entry to avoid double-separating. The template must handle this correctly — a single-entry `metaBadges` array should not add separators around it.

**Tests:** All existing `PM-130` and research topic tests pass without modification. This is verified by running the full suite.

**Depends on:** Task 1

### Task 3: Refactor `handleBacklogItem` to use `renderTemplate`

**Files:** `scripts/server.js`
**Changes:**
- Keep all data extraction logic (file reading, slug lookup, parent resolution, AC parsing, children, wireframe, remaining body) unchanged
- Build a data object:
  - `breadcrumb`: conditional — with parent: `[{Proposals, /proposals}, {parentTitle, /roadmap/{parentSlug}}, {current}]`; without parent: `[{Roadmap, /roadmap}, {current}]`
  - `title`: `title`
  - `titlePrefix`: `idBadge` HTML string (the `<span class="detail-id-badge">` or empty)
  - `metaBadges`: built from `metaParts` array — each part becomes `{html: part}`
  - `sections`: outcome, AC, children, wireframe, remaining body (same logic, just pushed into data array)
  - `actionHint`: conditional based on `itemId` and `status`
- Replace hand-built `pageBody` with `renderTemplate('detail', data)`

**Important nuance:** The current `metaParts` array interleaves content items with `meta-sep` separator spans. The template adds separators automatically. The refactored code must build `metaBadges` with only the content items (badge, priority, parent link, date), NOT the separator spans. The template inserts separators between entries.

**Tests:** All existing `PM-125` backlog detail tests pass without modification.

**Depends on:** Task 1

### Task 4: Refactor `handleSessionPage` to use `renderTemplate`

**Files:** `scripts/server.js`
**Changes:**
- Keep all data extraction logic (session loading, type detection, phase, etc.) unchanged
- Build a data object:
  - `breadcrumb`: `[{label: 'Dashboard', href: '/'}, {label: topic}]`
  - `title`: `topic`
  - `metaBadges`: type label + optional started + phase — each as `{html: '<span class="meta-item">...</span>'}`
  - `sections`: `[{title: 'Resume', html: '<div class="markdown-body">...</div>'}]`
  - No `actionHint`
- Replace inline template literal with `renderTemplate('detail', data)`

**Whitespace alignment:** The current handler indents HTML with 2 extra spaces inside the detail-page div. The template will produce consistent indentation (matching `handleResearchTopic` / `handleBacklogItem` style with newline-separated blocks). This whitespace difference is invisible in rendered HTML and does not affect any test assertions (tests check for class name presence and content, not exact whitespace).

**Tests:** No existing session page detail tests exist. The session page tests that do exist (GET / session brief) are unaffected since they test the home dashboard, not the session detail page.

**Depends on:** Task 1

## Indentation / Whitespace Strategy

The three handlers currently produce slightly different whitespace:
- `handleResearchTopic` and `handleBacklogItem`: no extra indent inside `<div class="detail-page">`
- `handleSessionPage`: 2-space indent inside the div

The template will use the `handleResearchTopic` / `handleBacklogItem` convention (no extra indent). This changes whitespace in `handleSessionPage` output but is invisible in rendered HTML. All existing tests assert on class names, content strings, and structural elements — none assert on exact whitespace.

## Risk Assessment

**Low risk.** This is a pure refactor — the template function produces the same HTML structure with the same CSS classes. All 189 existing tests serve as regression guards. The main risk is a subtle HTML difference causing a test to fail; mitigation is to run the full test suite after each task.
