# PM-125: Proposal and Issue Detail Pages

## Header

**Goal:** Redesign `handleProposalDetail()` and `handleBacklogItem()` to share a consistent detail layout: breadcrumb trail, title + ID badge, metadata bar, content sections at 48px spacing, action hints with click-to-copy, all within a 720px max-width reading column.

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). Both handlers generate HTML strings passed to `dashboardPage()`. CSS lives in the `DASHBOARD_CSS` template literal (lines 446-1216). Tests in `tests/server.test.js`.

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 446-1216 | Add `.detail-page`, `.detail-meta-bar`, `.detail-section`, `.click-to-copy` CSS |
| `scripts/server.js` | 3914-3944 | Rewrite `handleProposalDetail()` with consistent detail template |
| `scripts/server.js` | 5221-5299 | Rewrite `handleBacklogItem()` with consistent detail template |
| `scripts/server.js` | 1297-1394 | Add click-to-copy JS helper to `dashboardPage()` shell |
| `tests/server.test.js` | append | Detail page structure tests |

**Done criteria:**
- Both detail pages render inside a `.detail-page` wrapper with `max-width: 720px`
- Breadcrumb trail uses consistent `.detail-breadcrumb` class; proposal links to `/proposals`, issue links to parent proposal via `Proposals / {Parent} / PM-XXX` trail
- Metadata bar (`.detail-meta-bar`) shows: status badge, parent link (issues), priority badge, date, issue count (proposals)
- Content sections separated by `var(--space-12)` (48px)
- Proposal detail shows: outcome, strategy alignment card, research refs, issue list, and "Open full proposal" link
- Issue detail shows: outcome, acceptance criteria (checkbox-style list), wireframe embed, markdown body
- Action hints use click-to-copy with "Copied!" toast: `/dev PM-XXX` for issues, `/pm:groom {slug}` for proposals
- All tests pass: `cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test`

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Visual: open /proposals/{slug} and /backlog/{slug}, verify layout consistency
```

## Upstream Context

From `pm/research/dashboard-linear-quality/findings.md`:
- **Progressive disclosure:** Overview first (card on list page), drill-down for detail (detail page)
- **Reading width:** 720px max for long-form content, centered in main area
- **Section spacing:** 48px (`var(--space-12)`) between major sections
- **Hit targets:** Clickable areas min 44px, visual 24px
- **Cards:** No visible border, subtle bg (`var(--surface-raised)`), hover `scale(1.01)`
- **Typography:** Section titles 13px uppercase, body 14px

## Consistent Detail Page Template Structure

Both `handleProposalDetail()` and `handleBacklogItem()` will emit this HTML skeleton:

```html
<div class="detail-page">
  <!-- Breadcrumb -->
  <nav class="detail-breadcrumb" aria-label="Breadcrumb">
    <a href="/proposals">Proposals</a>
    <!-- For issues with parent: -->
    <span class="breadcrumb-sep">/</span>
    <a href="/backlog/{parent-slug}">{Parent Title}</a>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-current">{Current Title}</span>
  </nav>

  <!-- Title + ID badge -->
  <h1 class="detail-title">
    <span class="detail-id-badge">PM-XXX</span>
    {Title}
  </h1>

  <!-- Metadata bar -->
  <div class="detail-meta-bar">
    <span class="badge badge-{status}">{Status}</span>
    <span class="meta-sep">&middot;</span>
    <span class="meta-item">{Priority|Issue count|Parent link}</span>
    <span class="meta-sep">&middot;</span>
    <span class="meta-item">{Date}</span>
  </div>

  <!-- Content sections (48px spacing each) -->
  <section class="detail-section">
    <h2 class="detail-section-title">Outcome</h2>
    <p>{outcome text}</p>
  </section>

  <section class="detail-section">
    <h2 class="detail-section-title">{Section Name}</h2>
    <div class="markdown-body">{content}</div>
  </section>

  <!-- Action hint with click-to-copy -->
  <div class="detail-action-hint">
    <span class="click-to-copy" data-copy="/dev PM-XXX" tabindex="0" role="button">
      <code>/dev PM-XXX</code>
      <span class="copy-icon" aria-hidden="true">&#x2398;</span>
    </span>
  </div>
</div>
```

## Task Breakdown

### Task 1: Write detail page structure tests (RED)

**Test file:** `tests/server.test.js` (append new `describe` block)

Tests to write:
1. `GET /proposals/{slug}` response contains `.detail-page` wrapper
2. `GET /proposals/{slug}` response contains `.detail-breadcrumb` with link to `/proposals`
3. `GET /proposals/{slug}` response contains `.detail-meta-bar`
4. `GET /proposals/{slug}` response contains `.detail-section` elements
5. `GET /proposals/{slug}` response contains `.click-to-copy` element
6. `GET /backlog/{slug}` response contains `.detail-page` wrapper
7. `GET /backlog/{slug}` response contains `.detail-breadcrumb` with parent trail
8. `GET /backlog/{slug}` response contains `.detail-meta-bar` with status badge
9. `GET /backlog/{slug}` response contains acceptance criteria section when AC present in frontmatter
10. `GET /backlog/{slug}` response contains `.click-to-copy` with `/dev {id}` when status is `drafted`
11. CSS contains `.detail-page` with `max-width` rule
12. CSS contains `.detail-section` with `margin-top: var(--space-12)` (48px spacing)

```
Verify: node --test -> 12 new tests FAIL
```

### Task 2: Add detail page CSS to DASHBOARD_CSS (lines ~755-756, after `.page-header` rules)

**Insert after line 755** (after `.page-header .breadcrumb a:hover`):

```css
/* Detail page layout */
.detail-page { max-width: 720px; margin: 0 auto; }
.detail-breadcrumb { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-3); display: flex; align-items: center; gap: var(--space-1); }
.detail-breadcrumb a { color: var(--text-muted); }
.detail-breadcrumb a:hover { color: var(--accent); }
.breadcrumb-sep { color: var(--text-muted); opacity: 0.5; }
.breadcrumb-current { color: var(--text); }
.detail-title { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -0.02em; margin-bottom: var(--space-3); }
.detail-id-badge { font-size: var(--text-sm); font-weight: 600; color: var(--accent); background: var(--accent-subtle); padding: 0.15em 0.5em; border-radius: 4px; margin-right: var(--space-2); vertical-align: middle; }
.detail-meta-bar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-8); padding-bottom: var(--space-4); border-bottom: 1px solid var(--border); }
.detail-meta-bar .meta-item a { color: var(--accent); }
.detail-section { margin-top: var(--space-12); }
.detail-section-title { font-size: var(--text-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: var(--space-3); }
.detail-action-hint { margin-top: var(--space-12); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); text-align: center; }
.click-to-copy { cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); background: var(--accent-subtle); border-radius: var(--radius-sm); transition: background var(--transition); }
.click-to-copy:hover { background: var(--accent); color: #fff; }
.click-to-copy:hover code { color: #fff; background: transparent; }
.click-to-copy code { font-size: var(--text-base); color: var(--accent); background: transparent; }
.copy-icon { font-size: var(--text-xs); opacity: 0.6; }
.detail-ac-list { list-style: none; padding: 0; }
.detail-ac-list li { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); font-size: var(--text-base); display: flex; align-items: flex-start; gap: var(--space-2); }
.detail-ac-list li:last-child { border-bottom: none; }
.detail-ac-list li::before { content: '\\2610'; color: var(--text-muted); flex-shrink: 0; }
```

### Task 3: Add click-to-copy JS to dashboardPage() shell (line ~1297)

**Insert before the closing `</script>` of the main shell script block** (around line 1393):

```javascript
// Click-to-copy
document.addEventListener('click', function(e) {
  var el = e.target.closest('.click-to-copy');
  if (!el) return;
  var text = el.getAttribute('data-copy');
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() {
    showCopyToast('Copied!');
  });
});
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var el = e.target.closest('.click-to-copy');
  if (!el) return;
  el.click();
});
function showCopyToast(msg) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function() {
    el.classList.add('toast-out');
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }, 1500);
}
```

### Task 4: Rewrite handleProposalDetail() (lines 3914-3944)

**Current:** 30 lines. Shows breadcrumb + title + iframe embed.

**New structure (replace lines 3929-3940):** Keep validation logic (lines 3914-3928). Replace body template:

1. Read the proposal's `.meta.json` file (at `proposals/{slug}.meta.json`) for metadata: outcome, status, issue list, strategy alignment, research refs
2. Build breadcrumb: `Proposals / {Title}`
3. Build metadata bar: status badge, issue count, date
4. Build sections: Outcome, Strategy Alignment (if present), Research References (if present), Issues list, proposal iframe embed
5. Build action hint: click-to-copy `/pm:groom {slug}`

**Key data source:** The `.meta.json` file next to the `.html` proposal contains `{ outcome, status, issues: [...], strategy_alignment, research_refs: [...], created }`. If it doesn't exist, fall back to title + iframe only (graceful degradation).

**Line range:** Replace lines 3929-3943 (the `const body = ...` through `res.end(html)` block).

### Task 5: Rewrite handleBacklogItem() (lines 5221-5299)

**Current:** 78 lines. Shows breadcrumb + title + relations + wireframe + markdown body.

**New structure (replace lines 5288-5298):** Keep data-loading logic (lines 5221-5287). Replace body template:

1. Build 3-level breadcrumb: `Proposals / {Parent Title} / PM-XXX {Title}` (when parent exists) or `Backlog / PM-XXX {Title}` (orphan)
2. Build metadata bar: status badge, priority badge, parent link, date
3. Build sections:
   - **Outcome** (from `data.outcome`)
   - **Acceptance Criteria** (parse `## Acceptance Criteria` from body, render as checkbox-style `<ul class="detail-ac-list">`)
   - **Wireframe** (existing embed, unchanged)
   - **Body** (remaining markdown after AC extraction)
4. Build action hint: click-to-copy `/dev PM-XXX` (when `data.id` exists and status is not `done`)

**Line range:** Replace lines 5288-5298 (the `const html = dashboardPage(...)` through `res.end(html)` block). The body template changes from inline HTML to the detail page skeleton.

### Task 6: Run tests (GREEN)

```
Verify: node --test -> all tests PASS
```

### Task 7: Visual smoke test

Open `/proposals/{slug}` and `/backlog/{slug}` in browser. Verify:
- 720px max-width, centered
- Breadcrumb trail navigable
- Metadata bar shows correct badges
- 48px spacing between sections
- Click-to-copy triggers "Copied!" toast
- Works in both dark and light themes
