# Proposal Metadata Sidecar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `phase-5.8` generates a proposal HTML file at `pm/backlog/proposals/{slug}.html`, it also writes a `{slug}.meta.json` sidecar alongside it. The dashboard server reads this JSON to populate proposal cards without parsing freeform HTML. This decouples card rendering from HTML template structure.

**Architecture:** Phase 5.8 writes the sidecar as an additive step. `server.js` exposes `readProposalMeta(slug, pmDir)` and `readGroomState(pmDir)` as shared helpers consumed by PM-027, PM-028, PM-030. Gradient assignment uses a deterministic djb2 hash of the slug to select from a predefined 8-gradient palette. Missing sidecars (legacy proposals) degrade gracefully — title from filename, no verdict badge, neutral gray gradient. Draft proposals render from groom state fields only (no sidecar).

**Tech Stack:** Node.js (server.js), node:test

**Current state:** The majority of PM-026 is already implemented in the codebase. This plan documents what exists, identifies gaps, and covers the remaining work.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `skills/groom/phases/phase-5.8-present.md` | Already done | Sidecar write step with JSON schema, verdict-to-label mapping |
| `scripts/server.js` | Modify (minor) | Gap: `buildProposalCards` does not handle legacy proposals (HTML-only, no `.meta.json`) — needs fallback card rendering |
| `tests/server.test.js` | Modify | Add tests for sidecar read, graceful degradation, gradient determinism |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — Phase 5.8 writes `{slug}.meta.json` alongside `{slug}.html`
**Status: Done** — `skills/groom/phases/phase-5.8-present.md` (lines 13–28) already instructs the agent to "Write the metadata sidecar" with the full JSON schema and verdict-to-label mapping.

### AC 2 — JSON schema
**Status: Done** — Phase 5.8 specifies: `title`, `date`, `verdict`, `verdictLabel`, `phase`, `issueCount`, `gradient`, `labels`. All fields match the AC.

### AC 3 — Existing HTML generation not broken
**Status: Done** — The sidecar step is additive in phase-5.8. HTML generation is unchanged.

### AC 4 — `server.js` can `JSON.parse()` the sidecar
**Status: Done** — `readProposalMeta(slug, pmDir)` at `server.js:1126` reads and parses `{slug}.meta.json`, validates it's a non-null object, returns `null` on failure.

### AC 6 — Draft proposals render from groom state only
**Status: Done** — `buildProposalCards()` at `server.js:1378` reads groom sessions via `readGroomState()` and renders draft cards using `topic` → title, `phase` → badge label (human-readable via `groomPhaseLabel()`), `started` → date. No sidecar involved.

### AC 7 — Shared helper functions
**Status: Done** — Both helpers are exported from `server.js`:
- `readProposalMeta(slug, pmDir)` — line 1126. Validates slug (no `..`, `/`, `\`), path traversal check, parses JSON, returns null on any failure.
- `readGroomState(pmDir)` — line 1159. Reads from `groom-sessions/` directory (multi-session) with legacy single-file fallback at `.pm/.groom-state.md`. Parses YAML frontmatter, returns array of session objects.

### AC 8 — Gradient assignment with deterministic hash
**Status: Done** — `proposalGradient(slug)` at `server.js:1117` uses djb2 hash (`hash = ((hash << 5) + hash + charCode) >>> 0`) to select from `PROPOSAL_GRADIENTS` (8 gradients defined at line 1106–1115).

---

## Remaining Gap: AC 5 — Legacy Proposal Graceful Degradation

**Status: NOT implemented.**

Currently, `buildProposalCards()` only discovers proposals by scanning for `.meta.json` files (line 1382). If a legacy proposal has only a `.html` file and no `.meta.json`, it is invisible in the gallery.

AC 5 requires: "If the sidecar is missing (legacy proposals), the gallery degrades gracefully — shows the proposal with title derived from filename (kebab-case → title case), no verdict badge, no gradient (use neutral gray)."

---

## Task 1: Add legacy proposal fallback to `buildProposalCards`

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test for legacy proposal (HTML-only, no sidecar)**

```javascript
test('buildProposalCards shows legacy proposal (HTML only, no meta.json)', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legacy-feature.html': '<html><body>Legacy</body></html>',
  });
  try {
    const mod = loadServer();
    const { cardsHtml, totalCount } = mod.buildProposalCards(pmDir, null, []);
    assert.equal(totalCount, 1, 'must count the legacy proposal');
    assert.ok(cardsHtml.includes('Legacy Feature'), 'must derive title from slug (kebab → title case)');
    assert.ok(cardsHtml.includes('proposal-card'), 'must render as a proposal card');
    assert.ok(cardsHtml.includes('#e5e7eb'), 'must use neutral gray gradient');
    assert.ok(!cardsHtml.includes('badge-ready'), 'must not show verdict badge');
  } finally { cleanup(); }
});

test('buildProposalCards does not double-count proposal with both meta.json and html', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/feat-z.meta.json': JSON.stringify({
      title: 'Feature Z', date: '2026-03-18', verdict: 'ready',
      verdictLabel: 'Ready', phase: 'completed', issueCount: 3,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      labels: ['mvp'],
    }),
    'pm/backlog/proposals/feat-z.html': '<html><body>Feature Z</body></html>',
  });
  try {
    const mod = loadServer();
    const { totalCount } = mod.buildProposalCards(pmDir, null, []);
    assert.equal(totalCount, 1, 'must not double-count');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests — verify fail**

```bash
node tests/server.test.js
```

The first test should fail because `buildProposalCards` only scans `.meta.json` files and never discovers `.html`-only proposals.

- [ ] **Step 3: Implement legacy fallback in `buildProposalCards`**

In `buildProposalCards()`, after the existing `.meta.json` scan loop (line 1407), add a second scan for `.html` files that lack a corresponding `.meta.json`:

```javascript
// After the meta.json loop, scan for legacy HTML-only proposals
if (fs.existsSync(proposalsDir)) {
  const metaSlugs = new Set(
    fs.readdirSync(proposalsDir)
      .filter(f => f.endsWith('.meta.json'))
      .map(f => f.replace('.meta.json', ''))
  );
  const htmlFiles = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const slug = file.replace('.html', '');
    if (metaSlugs.has(slug)) continue; // already handled by meta.json path
    const title = humanizeSlug(slug);
    entries.push({
      date: '0000-00-00', // unknown date — sort to end
      isDraft: false,
      html: `<a href="/proposals/${escHtml(encodeURIComponent(slug))}" class="card proposal-card">
  <div class="card-gradient" style="background: #e5e7eb"></div>
  <h3>${escHtml(title)}</h3>
  <p class="meta">Legacy proposal</p>
  <div class="card-footer"><div></div><span class="view-link">View →</span></div>
</a>`
    });
  }
}
```

Key design decisions:
- `#e5e7eb` (neutral gray) matches the fallback in `sanitizeGradient()`.
- Title uses `humanizeSlug()` (kebab-case → Title Case), which is the existing utility at line 1100.
- No verdict badge, no issue count — data is unavailable without the sidecar.
- `date: '0000-00-00'` sorts legacy proposals to the bottom.
- `metaSlugs` set prevents double-counting proposals that have both `.meta.json` and `.html`.

- [ ] **Step 4: Run tests — verify pass**

```bash
node tests/server.test.js
```

- [ ] **Step 5: Commit**

```
feat(PM-026): add legacy proposal fallback to buildProposalCards
```

---

## Task 2: Add legacy fallback to `buildBacklogGrouped`

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/server.test.js`

The `buildBacklogGrouped()` function (consumed by PM-030) also discovers proposals by scanning `.meta.json` files to build the `proposalSlugs` set. Legacy HTML-only proposals should also appear as proposal groups.

- [ ] **Step 1: Write failing test**

```javascript
test('buildBacklogGrouped discovers legacy HTML-only proposals', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/legacy-proj.html': '<html><body>Legacy</body></html>',
    'pm/backlog/legacy-proj.md': '---\ntitle: "Legacy Project"\nstatus: drafted\nparent: null\nid: "PM-100"\n---\n',
    'pm/backlog/child-task.md': '---\ntitle: "Child Task"\nstatus: idea\nparent: "legacy-proj"\nid: "PM-101"\n---\n',
  });
  try {
    const mod = loadServer();
    const html = mod.buildBacklogGrouped(pmDir);
    assert.ok(html.includes('Legacy Proj'), 'must show legacy proposal as group header');
    assert.ok(html.includes('Child Task'), 'must show child under legacy proposal group');
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run tests — verify fail**

- [ ] **Step 3: Extend proposalSlugs discovery in `buildBacklogGrouped`**

In `buildBacklogGrouped()`, after the `.meta.json` scan that populates `proposalSlugs`, add:

```javascript
// Also discover HTML-only proposals (legacy, no sidecar)
if (fs.existsSync(proposalsDir)) {
  for (const f of fs.readdirSync(proposalsDir).filter(f => f.endsWith('.html'))) {
    proposalSlugs.add(f.replace('.html', ''));
  }
}
```

This ensures that parent chain walks can resolve legacy proposals as ancestors.

- [ ] **Step 4: Run tests — verify pass**

- [ ] **Step 5: Commit**

```
feat(PM-026): discover legacy HTML proposals in buildBacklogGrouped
```

---

## Task 3: Tests for existing helper functions (regression coverage)

**Files:**
- Test: `tests/server.test.js`

These tests cover existing functionality (already passing) to lock in behavior for consuming issues PM-027, PM-028, PM-030.

- [ ] **Step 1: Add regression tests**

```javascript
// --- readProposalMeta ---

test('readProposalMeta returns parsed JSON for valid sidecar', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/valid.meta.json': JSON.stringify({
      title: 'Valid', date: '2026-03-18', verdict: 'ready',
      verdictLabel: 'Ready', phase: 'completed', issueCount: 5,
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      labels: ['mvp'],
    }),
  });
  try {
    const mod = loadServer();
    const meta = mod.readProposalMeta('valid', pmDir);
    assert.equal(meta.title, 'Valid');
    assert.equal(meta.verdict, 'ready');
    assert.equal(meta.issueCount, 5);
    assert.deepEqual(meta.labels, ['mvp']);
  } finally { cleanup(); }
});

test('readProposalMeta returns null for missing sidecar', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    assert.equal(mod.readProposalMeta('nonexistent', pmDir), null);
  } finally { cleanup(); }
});

test('readProposalMeta rejects path traversal slugs', () => {
  const mod = loadServer();
  assert.equal(mod.readProposalMeta('../etc/passwd', '/tmp'), null);
  assert.equal(mod.readProposalMeta('foo/bar', '/tmp'), null);
  assert.equal(mod.readProposalMeta('foo\\bar', '/tmp'), null);
});

test('readProposalMeta returns null for corrupted JSON', () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/proposals/bad.meta.json': '{ not valid json',
  });
  try {
    const mod = loadServer();
    assert.equal(mod.readProposalMeta('bad', pmDir), null);
  } finally { cleanup(); }
});

// --- readGroomState ---

test('readGroomState reads multi-session directory', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/groom-sessions/session-a.md': '---\ntopic: "Feature A"\nphase: scope\nstarted: "2026-03-01"\n---\n',
    '.pm/groom-sessions/session-b.md': '---\ntopic: "Feature B"\nphase: bar-raiser\nstarted: "2026-03-10"\n---\n',
  });
  try {
    const mod = loadServer();
    const sessions = mod.readGroomState(pmDir);
    assert.equal(sessions.length, 2);
    const topics = sessions.map(s => s.topic).sort();
    assert.deepEqual(topics, ['Feature A', 'Feature B']);
  } finally { cleanup(); }
});

test('readGroomState falls back to legacy single file', () => {
  const { pmDir, cleanup } = withPmDir({
    '.pm/.groom-state.md': '---\ntopic: "Legacy Topic"\nphase: intake\nstarted: "2026-02-15"\n---\n',
  });
  try {
    const mod = loadServer();
    const sessions = mod.readGroomState(pmDir);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].topic, 'Legacy Topic');
  } finally { cleanup(); }
});

test('readGroomState returns empty array when no state exists', () => {
  const { pmDir, cleanup } = withPmDir({});
  try {
    const mod = loadServer();
    const sessions = mod.readGroomState(pmDir);
    assert.deepEqual(sessions, []);
  } finally { cleanup(); }
});

// --- proposalGradient ---

test('proposalGradient is deterministic for same slug', () => {
  const mod = loadServer();
  const a = mod.proposalGradient('my-feature');
  const b = mod.proposalGradient('my-feature');
  assert.equal(a, b, 'same slug must produce same gradient');
});

test('proposalGradient produces different gradients for different slugs', () => {
  const mod = loadServer();
  const results = new Set();
  const slugs = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta'];
  for (const s of slugs) results.add(mod.proposalGradient(s));
  assert.ok(results.size >= 3, 'different slugs should spread across palette');
});

test('proposalGradient returns valid gradient from 8-item palette', () => {
  const mod = loadServer();
  const gradient = mod.proposalGradient('test-slug');
  assert.ok(gradient.startsWith('linear-gradient('), 'must be a CSS linear-gradient');
});

// --- sanitizeGradient ---

test('sanitizeGradient passes valid gradients through', () => {
  const mod = loadServer();
  const valid = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
  assert.equal(mod.sanitizeGradient(valid), valid);
});

test('sanitizeGradient rejects unsafe values', () => {
  const mod = loadServer();
  assert.equal(mod.sanitizeGradient('url(evil)'), '#e5e7eb');
  assert.equal(mod.sanitizeGradient('red; background: url(evil)'), '#e5e7eb');
  assert.equal(mod.sanitizeGradient(''), '#e5e7eb');
  assert.equal(mod.sanitizeGradient(null), '#e5e7eb');
});
```

- [ ] **Step 2: Run tests — verify all pass**

These tests should pass immediately since they cover existing behavior.

```bash
node tests/server.test.js
```

- [ ] **Step 3: Commit**

```
test(PM-026): add regression tests for proposal metadata helpers
```

---

## Verification Checklist

| AC | Status | Evidence |
|----|--------|----------|
| 1. Phase 5.8 writes `.meta.json` | Already done | `phase-5.8-present.md` lines 13–28 |
| 2. JSON schema fields | Already done | Schema in phase-5.8 matches all required fields |
| 3. HTML generation not broken | Already done | Sidecar is additive step in phase 5.8 |
| 4. `server.js` can parse sidecar | Already done | `readProposalMeta()` at server.js:1126 |
| 5. Legacy fallback | **Task 1** | `buildProposalCards` legacy scan |
| 6. Draft proposals from groom state | Already done | `buildProposalCards()` groom session path |
| 7a. `readProposalMeta()` helper | Already done | Exported from server.js |
| 7b. `readGroomState()` helper | Already done | Exported from server.js, multi-session + legacy |
| 8. Gradient palette + hash | Already done | `proposalGradient()` with djb2 hash, 8 gradients |
