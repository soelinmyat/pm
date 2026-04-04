# PM-130: Competitor and Research Detail Pages

## Header

**Goal:** Align `handleCompetitorDetail()` and `handleResearchTopic()` with the consistent detail page pattern established by PM-125. Same breadcrumb, metadata bar, section spacing, and action hints -- just different data.

**Architecture:** Single-file dashboard (`scripts/server.js`, ~5,656 lines). Both handlers already render the correct data; this issue adds the PM-125 structural wrapper and consistent styling. CSS added by PM-125 is reused; no new CSS classes needed.

**Upstream dependency:** PM-125 must land first (provides `.detail-page`, `.detail-meta-bar`, `.detail-section`, `.click-to-copy` CSS and JS).

**Files in scope:**
| File | Lines | Change |
|------|-------|--------|
| `scripts/server.js` | 4819-4886 | Rewrite `handleCompetitorDetail()` body template |
| `scripts/server.js` | 4888-4911 | Rewrite `handleResearchTopic()` body template |
| `tests/server.test.js` | append | KB detail page structure tests |

**Done criteria:**
- Competitor detail renders inside `.detail-page` with `max-width: 720px`
- Breadcrumb links to `/kb?tab=competitors` (not raw `/competitors`)
- Company name as `<h1>`, category as subtitle in metadata bar
- Profile sections (profile, features, api, seo, sentiment) rendered as `.detail-section` blocks with 13px uppercase titles, 48px spacing -- tabs removed
- Freshness badge in metadata bar from file mtime
- Action hint: click-to-copy `/pm:research competitors`
- Research topic detail renders inside `.detail-page` with `max-width: 720px`
- Breadcrumb links to `/kb?tab=research`
- Source origin badge (External/Customer/Mixed) and freshness badge in metadata bar
- Findings markdown as content section
- Action hint: click-to-copy `/pm:research {topic}`
- All tests pass: `cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test`

**Verification commands:**
```bash
cd /Users/soelinmyat/Projects/pm/pm_plugin && node --test
# Visual: open /competitors/{slug} and /research/{slug}, verify layout matches PM-125 pattern
```

## Upstream Context

From PM-125 (detail page pattern):
- All detail pages share: `.detail-page` > `.detail-breadcrumb` > `h1.detail-title` > `.detail-meta-bar` > `.detail-section`* > `.detail-action-hint`
- Section title class: `.detail-section-title` (13px uppercase)
- Section spacing: `margin-top: var(--space-12)` (48px)
- Click-to-copy: `<span class="click-to-copy" data-copy="..." tabindex="0" role="button">`

## Task Breakdown

### Task 1: Write KB detail page structure tests (RED)

**Test file:** `tests/server.test.js` (append)

Tests to write:
1. `GET /competitors/{slug}` response contains `.detail-page` wrapper
2. `GET /competitors/{slug}` response contains `.detail-breadcrumb` with link to `/kb?tab=competitors`
3. `GET /competitors/{slug}` response contains `.detail-meta-bar`
4. `GET /competitors/{slug}` response contains `.detail-section` for each available section (profile, features, etc.)
5. `GET /competitors/{slug}` does NOT contain `.tabs` or `role="tablist"` (tabs replaced by sections)
6. `GET /competitors/{slug}` response contains `.click-to-copy` with `/pm:research competitors`
7. `GET /research/{topic}` response contains `.detail-page` wrapper
8. `GET /research/{topic}` response contains `.detail-breadcrumb` with link to `/kb?tab=research`
9. `GET /research/{topic}` response contains `.detail-meta-bar` with origin badge
10. `GET /research/{topic}` response contains `.click-to-copy` with `/pm:research {topic}`

```
Verify: node --test -> 10 new tests FAIL
```

### Task 2: Rewrite handleCompetitorDetail() (lines 4819-4886)

**Current:** 67 lines. Uses tab UI (`role="tablist"`) to show profile/features/api/seo/sentiment sections.

**New structure:** Replace tabs with flat `.detail-section` blocks.

Keep validation logic (lines 4819-4825). Replace body template (lines 4848-4881):

1. **Breadcrumb:** `<nav class="detail-breadcrumb"><a href="/kb?tab=competitors">Knowledge Base</a> <span class="breadcrumb-sep">/</span> <span class="breadcrumb-current">{name}</span></nav>`
2. **Title:** Company name from profile data
3. **Metadata bar:** Category subtitle (from `extractProfileSummary()`), sections count badge (`3/5 sections`), freshness badge
4. **Sections:** Loop through `['profile', 'features', 'api', 'seo', 'sentiment']`. For each existing `.md` file, render as:
   ```html
   <section class="detail-section">
     <h2 class="detail-section-title">{Label}</h2>
     <div class="markdown-body">{rendered content}</div>
   </section>
   ```
   Profile section still uses `renderProfileWithSwot()`.
5. **Action hint:** `<span class="click-to-copy" data-copy="/pm:research competitors" tabindex="0" role="button"><code>/pm:research competitors</code></span>`

**Key difference from PM-125:** No outcome section (competitors don't have outcomes). No issue list. Tabs are flattened into sequential sections.

**Line range:** Replace lines 4827-4881 (from `const sections = ...` through the closing `</script>` of tab JS).

### Task 3: Rewrite handleResearchTopic() (lines 4888-4911)

**Current:** 23 lines. Shows breadcrumb, title, subtitle, badges, and markdown body.

**New structure:** Wrap in `.detail-page`, add metadata bar and action hint.

Keep validation logic (lines 4888-4896). Replace body template (lines 4901-4908):

1. **Breadcrumb:** `<nav class="detail-breadcrumb"><a href="/kb?tab=research">Knowledge Base</a> <span class="breadcrumb-sep">/</span> <span class="breadcrumb-current">{label}</span></nav>`
2. **Title:** Topic name (from `buildTopicMeta()`)
3. **Metadata bar:** Source origin badge, evidence count badge (if internal/mixed), freshness badge -- all already computed by `buildTopicMeta()`, just move into `.detail-meta-bar` wrapper
4. **Content section:** Findings markdown in a `.detail-section`
5. **Source references:** If findings contain `## Sources` or `## References`, extract and render as a separate section with linkified URLs
6. **Action hint:** `<span class="click-to-copy" data-copy="/pm:research {topic}" tabindex="0" role="button"><code>/pm:research {topic}</code></span>`

**Line range:** Replace lines 4901-4910 (the `const html = dashboardPage(...)` block).

### Task 4: Run tests (GREEN)

```
Verify: node --test -> all tests PASS
```

### Task 5: Visual smoke test

Open `/competitors/{slug}` and `/research/{topic}` in browser. Verify:
- 720px max-width
- Breadcrumb links to KB, not old routes
- Metadata bar consistent with proposal/issue detail pages
- Competitor: sections flow vertically (no tabs), profile SWOT renders
- Research: origin/freshness badges in metadata bar, findings readable
- Click-to-copy triggers "Copied!" toast
- Dark and light themes both work
