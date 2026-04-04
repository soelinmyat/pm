# PM-124: Shipped Page Redesign -- Implementation Plan

## Header

**Goal:** Redesign the Shipped page to show not just what shipped, but why. Each shipped item displays: PM ID, title, outcome statement, labels, ship date, research trail (referenced research topics as tags), strategy alignment (which priority it served), and competitive context (if it addresses a competitor gap). This is the differentiator -- no competitor connects shipped features back to product thinking.

**Architecture:** Single-file server at `pm_plugin/scripts/server.js`. Rewrites `handleShipped()`. Reads additional frontmatter fields (`outcome`, `research_refs`, parent proposal metadata) to build the enriched card layout.

**Files modified:**
- `pm_plugin/scripts/server.js` -- `handleShipped()` rewrite, new CSS, data enrichment logic
- `pm_plugin/tests/server.test.js` -- updated content assertions

**Done when:**
1. Each shipped item shows: PM ID, title, outcome statement ("why we built it"), labels, ship date
2. Items with sub-issues show sub-issue count
3. Full-width layout (no max-width constraint) -- already implemented
4. Items sorted by ship date, newest first
5. Breadcrumb reads "Roadmap" (updated from "Backlog" -- depends on PM-123)
6. Research trail: if `research_refs` in frontmatter, resolve to topic names and display as tags
7. Strategy alignment: show which strategic priority the item served
8. Competitive context: if item/parent references competitor research, show "Addresses gap in {competitor}" tag
9. Each item links to its detail page
10. All tests pass

**Verification:** `cd pm_plugin && node --test`

---

## Upstream Context (from PM-117 research)

- Shipped page is a celebration + accountability view -- show the "why" chain
- Research trail connects features to evidence, which builds confidence in the team's decision-making
- Strategy alignment makes priorities visible and reinforces discipline
- Competitive context shows awareness -- "we built this because competitor X doesn't have it"
- Layout: full-width rows, not cards. Each row is a rich block with primary info (title, outcome) and secondary info (tags for research, strategy, competitive context)

---

## Task Breakdown

### Task 1: TDD -- Write enriched content tests

**Red:** Add tests asserting:
- Shipped page response contains `shipped-item-outcome` class
- Shipped page response contains `shipped-item-research` class
- Shipped page breadcrumb contains `Roadmap` (not `Backlog`)
- If a shipped item has `research_refs`, the research topic name appears as a tag
- Items are sorted newest-first (check first item's date >= second item's date)

### Task 2: Add new CSS to DASHBOARD_CSS

**File:** `server.js` (DASHBOARD_CSS constant)

```css
/* ===== SHIPPED PAGE ===== */
.shipped-items { display: flex; flex-direction: column; gap: 12px; }
.shipped-item-card {
  padding: 20px 24px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
  display: block;
}
.shipped-item-card:hover { background: var(--surface-raised, var(--surface)); }

.shipped-item-header {
  display: flex; align-items: center; gap: 12px; margin-bottom: 8px;
}
.shipped-item-id {
  font-size: 12px; font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.shipped-item-title {
  font-size: 15px; font-weight: 600; letter-spacing: -0.01em; flex: 1;
}
.shipped-item-date {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

.shipped-item-outcome {
  font-size: 13px; color: var(--text-muted); line-height: 1.5;
  margin-bottom: 12px;
}

.shipped-item-tags {
  display: flex; flex-wrap: wrap; gap: 6px;
}
.shipped-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 4px;
  font-size: 11px; font-weight: 500;
}
.shipped-tag-label { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
.shipped-tag-research {
  background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent);
}
.shipped-tag-strategy {
  background: rgba(74,222,128,0.1); color: var(--success, #4ade80);
}
.shipped-tag-competitor {
  background: rgba(251,146,60,0.1); color: var(--warning, #fb923c);
}
.shipped-item-sub {
  font-size: 11px; color: var(--text-dim, var(--text-muted));
}
```

### Task 3: Add data enrichment helpers

**File:** `server.js` (new helper functions)

```js
/**
 * Resolve research_refs to topic labels.
 * research_refs can be paths like "pm/research/dashboard-linear-quality/findings.md"
 * or shorthand topic slugs.
 */
function resolveResearchRefs(refs, pmDir) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const researchDir = path.join(pmDir, 'research');
  return refs.map(ref => {
    // Extract topic slug from path
    const match = String(ref).match(/research\/([^/]+)/);
    const slug = match ? match[1] : String(ref);
    const findingsPath = path.join(researchDir, slug, 'findings.md');
    if (fs.existsSync(findingsPath)) {
      const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
      const topic = parsed.data.topic || humanizeSlug(slug);
      return { slug, label: topic };
    }
    return { slug, label: humanizeSlug(slug) };
  });
}

/**
 * Determine strategy alignment for a shipped item.
 * Check the item's parent proposal for strategy_check field,
 * or look at the item's own labels/scope for priority references.
 */
function resolveStrategyAlignment(item, allItems, pmDir) {
  // Check parent proposal's meta.json for strategy info
  if (item.parent) {
    const metaPath = path.join(pmDir, 'backlog', 'proposals', item.parent + '.meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.strategy_check) return meta.strategy_check;
      } catch {}
    }
  }
  return null;
}

/**
 * Find competitive context for a shipped item.
 * If the item or parent proposal references competitor research,
 * extract the competitor name.
 */
function resolveCompetitiveContext(item, allItems, pmDir) {
  const refs = item.research_refs || [];
  if (item.parent && allItems[item.parent]) {
    const parentRefs = allItems[item.parent].research_refs || [];
    refs.push(...parentRefs);
  }
  const competitors = [];
  const compDir = path.join(pmDir, 'competitors');
  if (fs.existsSync(compDir)) {
    const compSlugs = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    for (const ref of refs) {
      for (const comp of compSlugs) {
        if (String(ref).toLowerCase().includes(comp.toLowerCase())) {
          const profilePath = path.join(compDir, comp, 'profile.md');
          let name = humanizeSlug(comp);
          if (fs.existsSync(profilePath)) {
            const parsed = parseFrontmatter(fs.readFileSync(profilePath, 'utf-8'));
            if (parsed.data.company) name = parsed.data.company;
          }
          if (!competitors.includes(name)) competitors.push(name);
        }
      }
    }
  }
  return competitors;
}
```

### Task 4: Rewrite `handleShipped()` (lines 5113-5167)

**File:** `server.js`
**Line range:** 5113-5167

**New implementation:**

```js
function handleShipped(res, pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const allItems = {};
  const childCount = {};

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      const slug = file.replace('.md', '');
      allItems[slug] = {
        slug,
        title: data.title || slug,
        status: data.status || 'idea',
        id: data.id || null,
        parent: data.parent || null,
        priority: data.priority || 'medium',
        labels: Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [],
        updated: data.updated || data.created || '',
        outcome: data.outcome || '',
        research_refs: Array.isArray(data.research_refs) ? data.research_refs : [],
      };
    }
  }

  // Build child counts
  for (const item of Object.values(allItems)) {
    if (item.parent && item.parent !== 'null' && allItems[item.parent]) {
      childCount[item.parent] = (childCount[item.parent] || 0) + 1;
    }
  }

  // Filter to done root items only
  const roots = Object.values(allItems).filter(i =>
    i.status === 'done' && (!i.parent || i.parent === 'null' || !allItems[i.parent])
  );
  roots.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const rows = roots.map(item => {
    const subCount = childCount[item.slug] || 0;
    const researchTopics = resolveResearchRefs(item.research_refs, pmDir);
    const strategyNote = resolveStrategyAlignment(item, allItems, pmDir);
    const competitorGaps = resolveCompetitiveContext(item, allItems, pmDir);

    // Build tag HTML
    const tags = [];
    for (const topic of researchTopics) {
      tags.push(`<span class="shipped-tag shipped-tag-research">${escHtml(topic.label)}</span>`);
    }
    if (strategyNote) {
      tags.push(`<span class="shipped-tag shipped-tag-strategy">${escHtml(strategyNote)}</span>`);
    }
    for (const comp of competitorGaps) {
      tags.push(`<span class="shipped-tag shipped-tag-competitor">Addresses gap in ${escHtml(comp)}</span>`);
    }
    const labelTags = item.labels.map(l => `<span class="shipped-tag-label kanban-label">${escHtml(l)}</span>`);

    return `<a class="shipped-item-card" href="/roadmap/${escHtml(encodeURIComponent(item.slug))}">
  <div class="shipped-item-header">
    ${item.id ? `<span class="shipped-item-id">${escHtml(item.id)}</span>` : ''}
    <span class="shipped-item-title">${escHtml(item.title)}</span>
    ${subCount > 0 ? `<span class="shipped-item-sub">${subCount} sub-issue${subCount !== 1 ? 's' : ''}</span>` : ''}
    <span class="shipped-item-date">${escHtml(item.updated)}</span>
  </div>
  ${item.outcome ? `<div class="shipped-item-outcome">${escHtml(item.outcome)}</div>` : ''}
  ${tags.length > 0 || labelTags.length > 0 ? `<div class="shipped-item-tags">${[...tags, ...labelTags].join('')}</div>` : ''}
</a>`;
  }).join('');

  const body = `
<p class="breadcrumb"><a href="/roadmap">&larr; Roadmap</a></p>
<div class="page-header"><h1>Shipped</h1>
  <p class="subtitle">${roots.length} item${roots.length !== 1 ? 's' : ''} shipped</p>
</div>
<div class="shipped-items">${rows || '<div class="empty-state"><p>No shipped items yet.</p></div>'}</div>`;

  const html = dashboardPage('Shipped', '/roadmap', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

### Task 5: Extend frontmatter parsing for `outcome` and `research_refs`

Verify that `parseFrontmatter()` already returns these fields when present in YAML frontmatter. The function should already return all YAML fields via `data`, but confirm that arrays (`research_refs`) are handled correctly. If using a custom YAML parser, ensure array values like:

```yaml
research_refs:
  - pm/research/dashboard-linear-quality/findings.md
```

are parsed into `['pm/research/dashboard-linear-quality/findings.md']`.

### Task 6: Handle items without enrichment gracefully

The enrichment helpers (`resolveResearchRefs`, `resolveStrategyAlignment`, `resolveCompetitiveContext`) must return empty arrays/null for items that don't have the relevant data. The template already handles this with conditional rendering. Verify with a test that items without `research_refs` render cleanly (no empty tag containers).

### Task 7: Dependency on PM-123 (Roadmap rename)

This plan uses `/roadmap/` hrefs and "Roadmap" breadcrumbs. If PM-123 is not yet merged when this work starts:
- Use `/backlog/` temporarily and note the references to update
- Or implement PM-123 first (it's Size S, likely faster)

### Task 8: Run tests and fix regressions

```bash
cd pm_plugin && node --test
```
