# Proposal Detail View — Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `/proposals/{slug}` route renders the proposal HTML inside the dashboard chrome via iframe. The page includes a "Back to Proposals" breadcrumb and an "Open standalone" link. A companion `/proposals/{slug}/raw` endpoint serves the raw HTML with `frame-ancestors 'self'` CSP for secure embedding.

**Architecture:** `routeDashboard()` handles `/proposals/{slug}` and `/proposals/{slug}/raw` sub-routes (lines 1032-1043). The slug is decoded and validated, then dispatched to either `handleProposalDetail()` (iframe in dashboard chrome) or `handleProposalDetailRaw()` (raw HTML for the iframe src). Both functions use two-step path traversal prevention: (a) reject slugs containing `..`, `/`, or `\`, (b) after `path.resolve()`, assert the resolved path starts with `proposalsDir + path.sep`.

**Tech Stack:** Node.js (server.js), node:test

**Current state:** All 8 acceptance criteria are already implemented in the codebase. All tests already exist and pass. This plan documents the existing implementation and confirms full coverage.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | No changes needed | All detail view logic already in place |
| `tests/server.test.js` | No changes needed | All detail view tests already in place |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — New `/proposals/{slug}` route added to `routeDashboard()`

**Status: Done** — `routeDashboard()` at `server.js:961` handles `urlPath.startsWith('/proposals/')` at line 1032. The remainder after `/proposals/` is parsed to determine if it's a `/raw` sub-route (line 1034). The slug is decoded via `decodeURIComponent()` (line 1037), with a try/catch that returns 400 on malformed URIs (line 1038). Dispatch goes to `handleProposalDetailRaw()` for raw requests (line 1040) or `handleProposalDetail()` for framed requests (line 1042).

### AC 2 — Route validates slug with two-step path traversal prevention

**Status: Done** — Both `handleProposalDetail()` (line 1662) and `handleProposalDetailRaw()` (line 1639) perform identical two-step validation:

1. **Step (a):** Reject slugs containing `..`, `/`, or `\` — line 1662: `if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\'))`
2. **Step (b):** After `path.resolve()`, assert resolved path starts with `proposalsDir + path.sep` — line 1669: `if (!htmlPath.startsWith(proposalsDir + path.sep) || !fs.existsSync(htmlPath))`

This matches the AC requirement exactly: character-level rejection first, then resolved-path prefix assertion.

### AC 3 — Proposal HTML rendered in an iframe using the wireframe-embed pattern, labeled "Proposal"

**Status: Done** — `handleProposalDetail()` at lines 1681-1687 renders:
```html
<div class="proposal-embed">
  <div class="proposal-embed-header">
    <span class="wireframe-label">PROPOSAL</span>
    <a href="/proposals/{slug}/raw" target="_blank" class="wireframe-open">Open standalone &nearr;</a>
  </div>
  <iframe src="/proposals/{slug}/raw" class="proposal-iframe"></iframe>
</div>
```
The embed pattern mirrors the wireframe-embed pattern (same CSS class names for label and open link) but uses `proposal-embed` and `proposal-embed-header` as distinct container classes. The header label reads "PROPOSAL" (not "Wireframe").

CSS at lines 764-767:
- `.proposal-embed`: `border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-top: 1rem`
- `.proposal-embed-header`: flex layout with surface background and bottom border
- `.proposal-iframe`: `width: 100%; height: 800px; border: none; background: #fff`

### AC 4 — Iframe height is fixed at 800px

**Status: Done** — CSS at line 767: `.proposal-iframe { width: 100%; height: 800px; border: none; background: #fff; }`. This differs from the wireframe iframe (500px at line 477), matching the AC requirement of 800px for proposals.

### AC 5 — "Back to Proposals" breadcrumb links to `/proposals`

**Status: Done** — `handleProposalDetail()` at line 1678:
```html
<p class="breadcrumb"><a href="/proposals">&larr; Back to Proposals</a></p>
```
The breadcrumb is inside a `.page-header` div (line 1677) above the `<h1>` title (line 1679).

### AC 6 — "Open standalone" link opens the raw HTML in a new tab

**Status: Done** — Line 1684:
```html
<a href="/proposals/${encodedSlug}/raw" target="_blank" class="wireframe-open">Open standalone &nearr;</a>
```
The `target="_blank"` attribute opens in a new tab. The href points to the `/raw` sub-route which serves the unmodified proposal HTML file from `pm/backlog/proposals/{slug}.html`.

The raw endpoint (`handleProposalDetailRaw()` at lines 1638-1658) serves the file with:
- `Content-Type: text/html; charset=utf-8`
- `Content-Security-Policy: frame-ancestors 'self'` — restricts embedding to same-origin only

### AC 7 — Missing proposal shows 404 with link back to `/proposals`

**Status: Done** — `handleProposalDetail()` returns 404 in two cases:

1. **Malicious slug** (line 1662-1665): When slug contains `..`, `/`, or `\`, returns 404 with:
   ```html
   <div class="empty-state"><p>Proposal not found.</p><p><a href="/proposals">&larr; Back to Proposals</a></p></div>
   ```

2. **File not found** (line 1669-1672): When resolved path fails prefix check or `fs.existsSync()` returns false, same 404 response.

Both 404 responses are rendered inside the dashboard chrome via `dashboardPage()` (line 1664, 1671), so the user retains navigation context.

### AC 8 — Proposal's own CSS and mermaid.js render correctly inside the iframe

**Status: Done** — The iframe's `src` points to `/proposals/{slug}/raw`, which serves the complete, unmodified HTML file (line 1650: `fs.readFileSync(htmlPath, 'utf-8')`). Since proposals are self-contained HTML documents (they include their own `<style>` tags and `<script>` tags for mermaid.js), they render correctly within the iframe sandbox. The `frame-ancestors 'self'` CSP header (line 1653) permits embedding from the dashboard origin.

---

## Pre-existing Test Coverage

All test scenarios for this feature already exist in `tests/server.test.js`:

### Integration tests — PM-031 specific (lines 1456-1516)

| Test | Line | What it verifies |
|------|------|-----------------|
| `GET /proposals/{slug}` renders iframe in dashboard chrome | 1459 | Status 200, `proposal-embed` wrapper, `iframe` element, src points to `/raw`, "Back to Proposals" breadcrumb, "Open standalone" link, "PROPOSAL" label |
| `GET /proposals/{slug}/raw` serves raw proposal HTML | 1478 | Status 200, raw HTML content present, no dashboard chrome (`proposal-embed` absent) |
| `GET /proposals/{slug}` returns 404 for missing proposal | 1493 | Status 404, back link to `/proposals` |
| `GET /proposals/{slug}` iframe height is 800px | 1505 | Body includes `800px` |

### Earlier integration tests — PM-028 overlap (lines 1397-1424)

| Test | Line | What it verifies |
|------|------|-----------------|
| `GET /proposals/{slug}` renders dashboard-framed view with iframe | 1397 | Status 200, `proposal-embed`, `iframe` tag |
| `GET /proposals/{slug}` returns 404 for missing and rejects traversal | 1412 | 404 with back link for missing; 400 for malformed URI encoding |

### Related tests — Security and metadata

| Test | Line | What it verifies |
|------|------|-----------------|
| Path traversal via `..` in route slugs blocked | 817 | `..` in various route slugs does not expose parent directory content |
| `readProposalMeta` rejects path traversal slugs | 1089 | `../../../etc/passwd`, `foo/bar`, `..` all return null |

---

## Implementation Tasks

Since all acceptance criteria and tests are already implemented, there are **no code changes required**.

### Task 1: Verify existing tests pass

- [ ] **Step 1: Run the server test suite to confirm all proposal detail tests pass**

```bash
node tests/server.test.js
```

Expected: All tests pass, including the 6 detail-view-related tests documented above (4 PM-031 specific + 2 PM-028 overlap).

- [ ] **Step 2: Commit plan**

```
docs: add plan for PM-031 - Proposal Detail View
```

---

## Verification Checklist

| AC | Status | Evidence |
|----|--------|----------|
| 1. `/proposals/{slug}` route in `routeDashboard()` | Already done | `server.js:1032-1043` |
| 2. Two-step path traversal prevention | Already done | `server.js:1662` (char check) + `1669` (prefix check); same at `1639` + `1645` for raw |
| 3. Iframe with wireframe-embed pattern, label reads "Proposal" | Already done | `server.js:1681-1687`, CSS at lines 764-767 |
| 4. Iframe height fixed at 800px | Already done | CSS `server.js:767` |
| 5. "Back to Proposals" breadcrumb links to `/proposals` | Already done | `server.js:1678` |
| 6. "Open standalone" link opens raw HTML in new tab | Already done | `server.js:1684` with `target="_blank"` |
| 7. Missing proposal shows 404 with back link | Already done | `server.js:1662-1665` and `1669-1672` |
| 8. Proposal CSS and mermaid.js render in iframe | Already done | Raw endpoint at `server.js:1650` serves unmodified HTML |
