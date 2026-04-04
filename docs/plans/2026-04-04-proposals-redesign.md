# PM-121: Proposals Page Redesign -- Implementation Plan

## Header

**Goal:** Restructure the Proposals page into two clear sections: Groomed proposals (full cards with outcome text, status badge, issue count, updated date) and Ideas (minimal rows with ID + title only). Replace the current card-grid layout with row-based layout. Add subtitle with counts.

**Architecture:** Single-file server at `pm_plugin/scripts/server.js`. Rewrites `handleProposalsPage()` and updates `buildProposalCards()` to expose raw data.

**Files modified:**
- `pm_plugin/scripts/server.js` -- `handleProposalsPage()` rewrite, new CSS classes, `buildProposalCards()` data extraction
- `pm_plugin/tests/server.test.js` -- updated content assertions

**Done when:**
1. Groomed section shows proposal cards with: P-XX ID, title, truncated outcome, status badge, issue count, updated date
2. Ideas section shows minimal rows: PM-XXX ID + title, no badges, hover reveals subtle bg
3. Subtitle reads "{N} groomed, {N} ideas"
4. Section headers: uppercase 13px with count on the right
5. 8px gap between all cards and rows
6. Empty state still works when no proposals exist
7. All tests pass

**Verification:** `cd pm_plugin && node --test`

---

## Upstream Context (from PM-117 research)

- Two-tier information density: groomed proposals get full cards, ideas get minimal rows
- Outcome text is the key differentiator -- shows "why" not just "what"
- Outcome comes from `.meta.json` sidecar files (field: `outcome` or extracted from proposal HTML)
- Consistent 8px gaps everywhere (not mixing 8/12/16)
- Status badges: Groomed = accent-subtle/accent, In Progress = warning-subtle/warning, Paused = error-subtle/error, Ready = success-subtle/success

---

## Task Breakdown

### Task 1: TDD -- Write structure tests

**Red:** Add tests asserting:
- Response contains `<span class="section-title">Groomed</span>`
- Response contains `<span class="section-title">Ideas</span>`
- Groomed section contains `proposal-card-outcome` class
- Ideas section contains `idea-row` class (not `kanban-item`)
- Subtitle contains "groomed" and "ideas" text
- No `card-grid` class on the proposals page

### Task 2: Add new CSS to DASHBOARD_CSS

**File:** `server.js` (DASHBOARD_CSS constant)

```css
/* ===== PROPOSALS PAGE ===== */
.proposal-grid { display: flex; flex-direction: column; gap: 8px; }

.proposal-card-row {
  display: flex; align-items: center;
  padding: 16px 20px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 8px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
  gap: 16px;
}
.proposal-card-row:hover { background: var(--surface-raised, var(--surface)); }
.proposal-card-body { flex: 1; min-width: 0; }
.proposal-card-title {
  font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
  margin-bottom: 4px;
}
.proposal-card-outcome {
  font-size: 13px; color: var(--text-muted); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.proposal-card-meta {
  display: flex; align-items: center; gap: 12px; flex-shrink: 0;
}
.badge-groomed { background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent); }
.badge-in-progress { background: rgba(251,146,60,0.1); color: var(--warning, #fb923c); }
.badge-paused { background: rgba(248,113,113,0.1); color: #f87171; }
.badge-ready { background: rgba(74,222,128,0.1); color: var(--success, #4ade80); }
.issue-count {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.updated {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Ideas rows */
.idea-list { display: flex; flex-direction: column; gap: 4px; }
.idea-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px; border-radius: 6px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.idea-row:hover { background: var(--surface); }
.idea-id {
  font-size: 12px; font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums; width: 52px; flex-shrink: 0;
}
.idea-title { font-size: 14px; color: var(--text-muted); flex: 1; }

.section-count {
  font-size: 12px; color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums;
}
```

### Task 3: Extract proposal data for row rendering

**File:** `server.js`

Add a new function `buildProposalRows(pmDir)` (or modify `buildProposalCards` to return structured data):

```js
function buildProposalRows(pmDir) {
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const proposals = [];
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of files) {
      const slug = file.replace('.meta.json', '');
      const meta = readProposalMeta(slug, pmDir);
      if (!meta) continue;
      const verdict = (meta.verdict || '').toLowerCase();
      if (verdict === 'shipped') continue;
      proposals.push({
        slug,
        id: meta.id || '',
        title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : humanizeSlug(slug),
        outcome: meta.outcome || '',
        verdict: meta.verdict || '',
        verdictLabel: meta.verdictLabel || '',
        issueCount: meta.issueCount || 0,
        date: meta.date || '',
      });
    }
  }
  proposals.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return proposals;
}
```

### Task 4: Rewrite `handleProposalsPage()` (lines 3946-3998)

**File:** `server.js`
**Line range:** 3946-3998

**New implementation:**

```js
function handleProposalsPage(res, pmDir) {
  const proposals = buildProposalRows(pmDir);

  // Collect ideas (ungroomed backlog items)
  const backlogDir = path.join(pmDir, 'backlog');
  const ideas = [];
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'))) {
      const slug = file.replace('.md', '');
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      if ((data.status || 'idea') === 'idea') {
        ideas.push({ slug, title: data.title || humanizeSlug(slug), id: data.id || null });
      }
    }
  }

  let body;
  if (proposals.length === 0 && ideas.length === 0) {
    body = `<div class="page-header"><h1>Proposals</h1></div>
<div class="empty-state">
  <h2>No proposals yet</h2>
  <p>Run <code>/pm:groom</code> to create your first proposal.</p>
</div>`;
  } else {
    const subtitle = [
      proposals.length > 0 ? `${proposals.length} groomed` : null,
      ideas.length > 0 ? `${ideas.length} idea${ideas.length !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ');

    // Groomed section
    let groomedHtml = '';
    if (proposals.length > 0) {
      const rows = proposals.map(p => {
        const badgeClass = p.verdict === 'in-progress' ? 'badge-in-progress'
          : p.verdict === 'paused' ? 'badge-paused'
          : p.verdict === 'ready' ? 'badge-ready'
          : 'badge-groomed';
        const statusLabel = p.verdictLabel || 'Groomed';
        return `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="proposal-card-row">
  <div class="proposal-card-body">
    <div class="proposal-card-title">${p.id ? `<span class="proposal-id" style="margin-right:8px">${escHtml(p.id)}</span>` : ''}${escHtml(p.title)}</div>
    ${p.outcome ? `<div class="proposal-card-outcome">${escHtml(p.outcome)}</div>` : ''}
  </div>
  <div class="proposal-card-meta">
    <span class="badge ${badgeClass}">${escHtml(statusLabel)}</span>
    ${p.issueCount > 0 ? `<span class="issue-count">${p.issueCount} issue${p.issueCount !== 1 ? 's' : ''}</span>` : ''}
    ${p.date ? `<span class="updated">${escHtml(formatRelativeDate(p.date))}</span>` : ''}
  </div>
</a>`;
      }).join('\n');

      groomedHtml = `
<div class="section">
  <div class="section-header">
    <span class="section-title">Groomed</span>
    <span class="section-count">${proposals.length} proposal${proposals.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="proposal-grid">${rows}</div>
</div>`;
    }

    // Ideas section
    let ideasHtml = '';
    if (ideas.length > 0) {
      const ideaRows = ideas.map(i => {
        const idHtml = i.id ? `<span class="idea-id">${escHtml(i.id)}</span>` : '<span class="idea-id"></span>';
        return `<a class="idea-row" href="/roadmap/${escHtml(encodeURIComponent(i.slug))}">${idHtml}<span class="idea-title">${escHtml(i.title)}</span></a>`;
      }).join('\n');

      ideasHtml = `
<div class="section">
  <div class="section-header">
    <span class="section-title">Ideas</span>
    <span class="section-count">${ideas.length} ungroomed</span>
  </div>
  <div class="idea-list">${ideaRows}</div>
</div>`;
    }

    body = `<div class="page-header"><h1>Proposals</h1>
  <p class="subtitle">${subtitle}</p>
</div>
${groomedHtml}${ideasHtml}`;
  }

  const html = dashboardPage('Proposals', '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

### Task 5: Ensure `readProposalMeta()` returns outcome field

**File:** `server.js`

Check `readProposalMeta()` -- if `outcome` is not already in the returned meta object, add it. The `.meta.json` files likely already have an `outcome` field from groom sessions. If not, try extracting from the proposal HTML `<meta name="description">` or first paragraph.

### Task 6: Run tests and fix regressions

```bash
cd pm_plugin && node --test
```
