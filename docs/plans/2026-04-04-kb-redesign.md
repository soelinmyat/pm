# PM-122: Knowledge Base Page Redesign -- Implementation Plan

## Header

**Goal:** Replace the tabbed Knowledge Base page with a single scrollable hub: strategy banner at top, landscape summary card, 3-column competitor grid (name + category only), research topic rows with source origin and freshness badges, and a customer evidence section with empty-state activation prompt. Remove all tabs.

**Architecture:** Single-file server at `pm_plugin/scripts/server.js`. Rewrites `handleKnowledgeBasePage()`. Reuses existing builder functions (`buildLandscapeContent`, `buildCompetitorsContent`, `buildTopicsContent`) but calls them in a new layout instead of tabs.

**Files modified:**
- `pm_plugin/scripts/server.js` -- `handleKnowledgeBasePage()` rewrite, new CSS, new data helpers
- `pm_plugin/tests/server.test.js` -- updated content assertions

**Done when:**
1. Strategy banner shows headline, 3 priorities inline, freshness dot, "View strategy" and "Slide deck" buttons
2. Landscape card shows title, one-line summary, 3 headline stats -- clickable to full landscape page
3. Competitor grid: 3-column cards with name + category only (no completeness bars), "Feature matrix" link in header
4. Research topics: rows with topic name, source origin badge (External/Customer/Mixed), freshness badge (Fresh/Aging/Stale), date
5. Research shows top 8 topics sorted by freshness, with "View all N" link
6. Competitors show all if 6 or fewer, "View all" if more
7. Customer evidence section shows empty state if no evidence
8. No tabs remain -- single scrollable page
9. All tests pass

**Verification:** `cd pm_plugin && node --test`

---

## Upstream Context (from PM-117 research)

- Single scrollable hub > tabs for discoverability (tabs hide content behind clicks)
- Strategy banner is the anchor -- first thing you see, establishes context
- Landscape card: large clickable area, 3 stat callouts (market size, key metric, player count)
- Competitor grid: clean 3-col, name + category only, no progress bars (too noisy)
- Research topics: rows not cards (more scannable), source origin badge differentiates customer evidence from external research
- Freshness badges: Fresh (green, <7d), Aging (yellow, 7-30d), Stale (red, >30d)

---

## Task Breakdown

### Task 1: TDD -- Write structure tests

**Red:** Add tests asserting:
- Response contains `strategy-banner` class
- Response contains `landscape-card` class
- Response contains `competitor-grid` class
- Response contains `topic-list` class
- Response does NOT contain `class="tab"` or `role="tablist"`
- Response contains `badge-external` or `badge-customer` or `badge-mixed` (origin badges)
- Response contains `badge-fresh` or `badge-aging` or `badge-stale` (freshness badges)

### Task 2: Add new CSS to DASHBOARD_CSS

**File:** `server.js` (DASHBOARD_CSS constant)

```css
/* ===== KB HUB PAGE ===== */

/* Strategy banner */
.strategy-banner {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 24px;
  display: flex; align-items: flex-start; gap: 24px;
  margin-bottom: 48px;
}
.strategy-banner-content { flex: 1; }
.strategy-banner-label {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--accent); margin-bottom: 8px;
}
.strategy-banner-headline {
  font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
  line-height: 1.4; margin-bottom: 12px;
}
.strategy-banner-priorities {
  display: flex; gap: 24px; font-size: 13px; color: var(--text-muted);
}
.strategy-banner-priority { display: flex; align-items: baseline; gap: 6px; }
.strategy-banner-actions {
  display: flex; flex-direction: column; gap: 8px;
  flex-shrink: 0; align-items: flex-end;
}
.strategy-banner-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-dim, var(--text-muted));
}
.btn-sm {
  padding: 5px 12px; font-size: 12px; font-weight: 500;
  border-radius: 5px; text-decoration: none;
  background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent);
  border: none; cursor: pointer; font-family: inherit;
  transition: background 150ms;
}
.btn-sm:hover { background: var(--accent); color: white; }

/* Landscape card */
.landscape-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 20px 24px;
  text-decoration: none; color: var(--text); display: block;
  transition: background 150ms;
}
.landscape-card:hover { background: var(--surface-raised, var(--surface)); }
.landscape-title { font-size: 15px; font-weight: 600; margin-bottom: 8px; }
.landscape-summary {
  font-size: 13px; color: var(--text-muted); line-height: 1.5; margin-bottom: 12px;
}
.landscape-stats { display: flex; gap: 24px; }
.landscape-stat {
  font-size: 20px; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.landscape-stat-label { font-size: 11px; color: var(--text-dim, var(--text-muted)); margin-top: 1px; }

/* Competitor grid */
.competitor-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;
}
.competitor-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 16px 20px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.competitor-card:hover { background: var(--surface-raised, var(--surface)); }
.competitor-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.competitor-category { font-size: 12px; color: var(--text-muted); }

/* Research topic rows */
.topic-list { display: flex; flex-direction: column; gap: 4px; }
.topic-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-radius: 6px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.topic-row:hover { background: var(--surface); }
.topic-name { font-size: 14px; font-weight: 500; flex: 1; }
.topic-badges { display: flex; align-items: center; gap: 8px; }
.topic-date {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Origin badges */
.badge-external { background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent); }
.badge-customer { background: rgba(74,222,128,0.1); color: var(--success, #4ade80); }
.badge-mixed { background: rgba(56,189,248,0.1); color: #38bdf8; }

/* Freshness badges */
.badge-fresh { background: rgba(74,222,128,0.1); color: var(--success, #4ade80); }
.badge-aging { background: rgba(251,146,60,0.1); color: var(--warning, #fb923c); }
.badge-stale { background: rgba(248,113,113,0.1); color: #f87171; }

/* Empty hint */
.empty-hint {
  border: 1px dashed var(--border); border-radius: 8px;
  padding: 24px; text-align: center;
}
.empty-hint-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
.empty-hint-text { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
```

### Task 3: Add data extraction helpers

**File:** `server.js` (new helpers near KB section)

```js
function buildStrategyBanner(pmDir) {
  const snapshot = parseStrategySnapshot(pmDir); // from PM-120 plan
  if (!snapshot) return '';
  const deckExists = fs.existsSync(path.join(pmDir, 'strategy-deck.html'));
  return `<div class="strategy-banner">
  <div class="strategy-banner-content">
    <div class="strategy-banner-label">Strategy</div>
    <div class="strategy-banner-headline">${escHtml(snapshot.focus)}</div>
    <div class="strategy-banner-priorities">
      ${snapshot.priorities.map((p, i) => `<div class="strategy-banner-priority"><span class="priority-num">${i + 1}</span> ${escHtml(p)}</div>`).join('')}
    </div>
  </div>
  <div class="strategy-banner-actions">
    <div class="strategy-banner-meta">
      <span class="staleness-dot ${snapshot.staleness.level}"></span>
      Updated ${escHtml(snapshot.staleness.label)}
    </div>
    <a href="/kb?tab=strategy" class="btn-sm">View strategy</a>
    ${deckExists ? '<a href="/strategy-deck" target="_blank" class="btn-sm">Slide deck</a>' : ''}
  </div>
</div>`;
}

function buildLandscapeCard(pmDir) {
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (!fs.existsSync(landscapePath)) return '';
  const raw = fs.readFileSync(landscapePath, 'utf-8');
  const { body } = parseFrontmatter(raw);
  // Extract title (first H1), first paragraph as summary, and stats
  const titleMatch = body.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : 'Market Landscape';
  const paragraphs = body.split(/\n\n/).filter(p => !p.startsWith('#'));
  const summary = paragraphs[0] ? paragraphs[0].replace(/\n/g, ' ').trim().slice(0, 200) : '';
  const statsData = parseStatsData(body);
  const topStats = statsData.slice(0, 3);
  return `<a href="/kb?tab=landscape" class="landscape-card">
  <div class="landscape-title">${escHtml(title)}</div>
  <div class="landscape-summary">${escHtml(summary)}</div>
  ${topStats.length > 0 ? `<div class="landscape-stats">${topStats.map(s =>
    `<div><div class="landscape-stat">${escHtml(s.value)}</div><div class="landscape-stat-label">${escHtml(s.label)}</div></div>`
  ).join('')}</div>` : ''}
</a>`;
}

function buildCompetitorGrid(pmDir) {
  const compDir = path.join(pmDir, 'competitors');
  if (!fs.existsSync(compDir)) return '';
  const slugs = fs.readdirSync(compDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (slugs.length === 0) return '';
  const displaySlugs = slugs.length > 6 ? slugs.slice(0, 6) : slugs;
  const cards = displaySlugs.map(slug => {
    const profilePath = path.join(compDir, slug, 'profile.md');
    let name = humanizeSlug(slug);
    let category = '';
    if (fs.existsSync(profilePath)) {
      const raw = fs.readFileSync(profilePath, 'utf-8');
      const parsed = parseFrontmatter(raw);
      if (parsed.data.company) name = parsed.data.company;
      const summary = extractProfileSummary(parsed.body);
      if (summary.company) name = summary.company;
      if (summary.category) category = summary.category;
    }
    return `<a href="/competitors/${escHtml(slug)}" class="competitor-card">
  <div class="competitor-name">${escHtml(name)}</div>
  <div class="competitor-category">${escHtml(category)}</div>
</a>`;
  }).join('');
  const viewAll = slugs.length > 6 ? `<a href="/kb?tab=competitors" class="section-link">View all ${slugs.length}</a>` : '';
  return `<div class="competitor-grid">${cards}</div>${viewAll ? `<div style="text-align:center;margin-top:12px">${viewAll}</div>` : ''}`;
}

function buildTopicRows(pmDir, maxTopics) {
  const researchDir = path.join(pmDir, 'research');
  if (!fs.existsSync(researchDir)) return { html: '', total: 0 };
  const topics = fs.readdirSync(researchDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (topics.length === 0) return { html: '', total: 0 };

  // Build topic data with freshness for sorting
  const topicData = topics.map(t => {
    const findingsPath = path.join(researchDir, t, 'findings.md');
    let label = humanizeSlug(t);
    let origin = 'external';
    let stale = null;
    let dateStr = '';
    if (fs.existsSync(findingsPath)) {
      const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
      const meta = buildTopicMeta(t, parsed.data, findingsPath);
      label = meta.label;
      origin = normalizeSourceOrigin(parsed.data.source_origin);
      dateStr = getUpdatedDate(findingsPath) || '';
      stale = stalenessInfo(dateStr);
    }
    return { slug: t, label, origin, stale, dateStr };
  });

  // Sort by freshness (newest first)
  topicData.sort((a, b) => (b.dateStr || '').localeCompare(a.dateStr || ''));
  const display = maxTopics ? topicData.slice(0, maxTopics) : topicData;

  const originLabels = { external: 'External', internal: 'Customer', mixed: 'Mixed' };
  const originBadge = o => `badge-${o === 'internal' ? 'customer' : o}`;
  const freshBadge = s => s ? `<span class="badge badge-${s.level}">${s.level.charAt(0).toUpperCase() + s.level.slice(1)}</span>` : '';

  const rows = display.map(t => `<a href="/research/${escHtml(t.slug)}" class="topic-row">
  <span class="topic-name">${escHtml(t.label)}</span>
  <div class="topic-badges">
    <span class="badge ${originBadge(t.origin)}">${escHtml(originLabels[t.origin] || 'External')}</span>
    ${freshBadge(t.stale)}
    <span class="topic-date">${escHtml(formatRelativeDate(t.dateStr))}</span>
  </div>
</a>`).join('');

  return { html: `<div class="topic-list">${rows}</div>`, total: topicData.length };
}
```

### Task 4: Rewrite `handleKnowledgeBasePage()` (lines 4768-4816)

**File:** `server.js`
**Line range:** 4768-4816

**New implementation:**

```js
function handleKnowledgeBasePage(res, pmDir, tab) {
  // If a specific sub-tab is requested, render the existing detail view
  // (strategy, competitors, landscape remain as sub-pages for deep dives)
  if (tab === 'strategy') {
    // Keep the existing strategy detail rendering
    return handleKbStrategyDetail(res, pmDir);
  }
  if (tab === 'competitors') {
    return handleKbCompetitorsDetail(res, pmDir);
  }
  if (tab === 'landscape') {
    return handleKbLandscapeDetail(res, pmDir);
  }
  if (tab === 'topics') {
    return handleKbTopicsDetail(res, pmDir);
  }

  // Hub page (default) -- single scrollable view
  const strategyBanner = buildStrategyBanner(pmDir);
  const landscapeCard = buildLandscapeCard(pmDir);
  const competitorGrid = buildCompetitorGrid(pmDir);
  const { html: topicRows, total: topicCount } = buildTopicRows(pmDir, 8);

  // Customer evidence section
  const evidenceDir = path.join(pmDir, 'evidence');
  const hasEvidence = fs.existsSync(evidenceDir) &&
    fs.readdirSync(evidenceDir, { withFileTypes: true }).some(e => e.isDirectory() || e.name.endsWith('.md'));
  const evidenceHtml = hasEvidence
    ? '' // TODO: build evidence summary in PM-125
    : `<div class="empty-hint">
  <div class="empty-hint-title">No customer evidence yet</div>
  <div class="empty-hint-text">Import interview notes, support tickets, or feedback to ground decisions in real user signals.</div>
  <code>/pm:ingest path/to/evidence</code>
</div>`;

  const compDir = path.join(pmDir, 'competitors');
  const compCount = fs.existsSync(compDir)
    ? fs.readdirSync(compDir, { withFileTypes: true }).filter(e => e.isDirectory()).length
    : 0;
  const matrixPath = path.join(pmDir, 'competitors', 'matrix.md');
  const matrixLink = fs.existsSync(matrixPath) ? '<a href="/kb?tab=competitors" class="section-link">Feature matrix</a>' : '';

  const body = `
<div class="page-header">
  <h1>Knowledge Base</h1>
  <p class="subtitle">Everything the team knows -- strategy, market, competitors, and research</p>
</div>
${strategyBanner}
${landscapeCard ? `<div class="section">
  <div class="section-header">
    <span class="section-title">Market Landscape</span>
  </div>
  ${landscapeCard}
</div>` : ''}
${compCount > 0 ? `<div class="section">
  <div class="section-header">
    <span class="section-title">Competitors</span>
    ${matrixLink}
  </div>
  ${competitorGrid}
</div>` : ''}
${topicCount > 0 ? `<div class="section">
  <div class="section-header">
    <span class="section-title">Research</span>
    <span style="font-size:12px;color:var(--text-dim,var(--text-muted))">${topicCount} topics</span>
  </div>
  ${topicRows}
  ${topicCount > 8 ? `<div style="text-align:center;margin-top:12px"><a href="/kb?tab=topics" class="section-link">View all ${topicCount} topics</a></div>` : ''}
</div>` : ''}
<div class="section">
  <div class="section-header">
    <span class="section-title">Customer Evidence</span>
  </div>
  ${evidenceHtml}
</div>`;

  const html = dashboardPage('Knowledge Base', '/kb', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

### Task 5: Extract tab detail handlers from old function

Move the existing tab-specific rendering into separate helper functions so the deep-dive URLs (`/kb?tab=strategy`, `/kb?tab=competitors`, etc.) still work:

```js
function handleKbStrategyDetail(res, pmDir) {
  // Lines 4790-4803 from original
  const filePath = path.join(pmDir, 'strategy.md');
  // ... existing strategy rendering ...
  const html = dashboardPage('Strategy', '/kb?tab=strategy', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbCompetitorsDetail(res, pmDir) {
  const body = '<div class="page-header"><h1>Competitors</h1></div>' + buildCompetitorsContent(pmDir);
  const html = dashboardPage('Competitors', '/kb?tab=competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbLandscapeDetail(res, pmDir) {
  const body = '<div class="page-header"><h1>Landscape</h1></div>' + buildLandscapeContent(pmDir);
  const html = dashboardPage('Landscape', '/kb?tab=landscape', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbTopicsDetail(res, pmDir) {
  const body = '<div class="page-header"><h1>Research Topics</h1></div>' + buildTopicsContent(pmDir);
  const html = dashboardPage('Research', '/kb?tab=topics', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

### Task 6: Update `dashboardPage()` nav for KB hub

In `dashboardPage()`, when `activeNav` is `/kb` (without tab param), the nav-secondary bar should NOT render (hub page has no tabs). Only show `nav-secondary` when a specific tab is in the URL. This is controlled by the `activeKbTab` variable at line 1235 -- adjust so `/kb` alone yields empty `activeKbTab`:

**Current (line 1242-1243):**
```js
} else if (activeNav === '/kb') {
  activeKbTab = 'research';
}
```

**New:**
```js
} else if (activeNav === '/kb') {
  activeKbTab = ''; // Hub page, no tab selected
}
```

### Task 7: Run tests and fix regressions

```bash
cd pm_plugin && node --test
```
