# Active Session Indicator — Dashboard Home Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user has an active groom session, the dashboard home page displays a prominent banner at the very top of the content area showing the topic name, human-readable phase name, and start date. When no session exists (or the state file is corrupted), no banner is shown and no empty space is left.

**Architecture:** `handleDashboardHome()` calls `readGroomState(pmDir)` which reads from `.pm/groom-sessions/*.md` (new multi-session format) with fallback to `.pm/.groom-state.md` (legacy single file). Each session's frontmatter is parsed and displayed via `groomSessionDisplay()`. Phase names are mapped through `GROOM_PHASE_LABELS` via `groomPhaseLabel()`. The banner HTML is injected between the page header and the proposal gallery.

**Tech Stack:** Node.js (server.js), node:test

**Current state:** All 7 acceptance criteria are already implemented in the codebase. Tests for readGroomState, groomPhaseLabel, and the dashboard banner (present/absent/corrupted) also already exist. This plan documents the existing implementation and confirms full coverage.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/server.js` | No changes needed | All session indicator logic already in place |
| `tests/server.test.js` | No changes needed | All session indicator tests already in place |

---

## Pre-existing Implementation Inventory

The following AC items are **already implemented** in the current codebase and require no code changes:

### AC 1 — `readGroomState()` reads groom state via shared helper

**Status: Done** — `readGroomState()` at `server.js:1159-1191` reads from `path.resolve(pmDir, '..', '.pm', 'groom-sessions')` directory (new multi-session format) with fallback to `path.resolve(pmDir, '..', '.pm', '.groom-state.md')` (legacy format). It parses YAML frontmatter from each `.md` file and returns an array of session objects.

### AC 2 — Banner shows topic, human-readable phase, and start date

**Status: Done** — `handleDashboardHome()` at `server.js:1588-1604` calls `readGroomState(pmDir)` and maps each session through `groomSessionDisplay()` (line 1193), which returns:
- `topic`: the escaped topic name
- `phase`: the human-readable phase via `groomPhaseLabel()` (line 1154)
- `started`: the escaped start date

The banner HTML renders these three fields:
```html
<div class="groom-session">
  <div class="groom-session-dot"></div>
  <div>
    <div class="groom-session-topic">{topic}</div>
    <div class="groom-session-meta">Phase: {phase} · Started {started}</div>
  </div>
</div>
```

### AC 3 — No banner when groom state does not exist

**Status: Done** — When `readGroomState()` returns an empty array (no session files found), `groomBannerHtml` remains an empty string (`''`) at line 1590. The template at line 1628 interpolates `${groomBannerHtml}` which produces no HTML output, leaving no empty space.

### AC 4 — Banner positioned at the top of home content, above proposal gallery

**Status: Done** — The body template at `server.js:1623-1631` places the banner immediately after the page header and before the proposals section:
```javascript
const body = `
<div class="page-header">...</div>
${groomBannerHtml}          // <-- banner here, above proposals
${proposalsHtml}
<div class="card-grid">${sections}</div>
${suggestedHtml}`;
```

### AC 5 — Corrupted/unparseable state silently omitted

**Status: Done** — `readGroomState()` wraps all file reads and frontmatter parsing in try/catch blocks (lines 1166-1177, 1181-1188). If parsing fails or the topic field is missing/empty, the session is skipped. An empty array is returned, resulting in no banner.

### AC 6 — Banner is read-only, no actions/controls/links

**Status: Done** — The banner HTML contains only `<div>` elements with plain text content. No `<a>`, `<button>`, or interactive elements are present in the banner markup (lines 1595-1601).

### AC 7 — Phase name mapping

**Status: Done** — `GROOM_PHASE_LABELS` at `server.js:1141-1152` maps all required phase strings:

| Raw phase | Display label |
|-----------|--------------|
| `intake` | Intake |
| `strategy-check` | Strategy Check |
| `research` | Research |
| `scope` | Scoping |
| `scope-review` | Scope Review |
| `groom` | Drafting Issues |
| `team-review` | Team Review |
| `bar-raiser` | Bar Raiser |
| `present` | Presentation |
| `link` | Linking Issues |

Unmapped phases fall through to `humanizeSlug()` which converts kebab-case to Title Case.

### CSS Styling

**Status: Done** — Active session banner styles at `server.js:709-718`:
- `.groom-session`: Blue background (`#eff6ff`), blue border (`#bfdbfe`), rounded corners, flex layout with gap
- `.groom-session-dot`: 10px pulsing green dot (uses `var(--accent)`) with `@keyframes pulse` animation
- `.groom-session-topic`: Bold (600 weight), 0.9375rem, primary text color
- `.groom-session-meta`: Smaller (0.8125rem), muted text color
- `.groom-session-label`: Uppercase label ("Currently grooming"), small font, muted color

---

## Pre-existing Test Coverage

All test scenarios for this feature already exist in `tests/server.test.js`:

### readGroomState unit tests (lines 1102-1191)
| Test | Line | What it verifies |
|------|------|-----------------|
| Single session from groom-sessions/ | 1105 | Returns array with one session, correct topic/phase/started/slug |
| Multiple sessions | 1121 | Returns array with both sessions |
| No groom state | 1138 | Returns empty array |
| Corrupted state file | 1148 | Returns empty array (no crash) |
| Legacy `.groom-state.md` fallback | 1160 | Falls back to legacy path, no `_slug` field |
| Legacy ignored when new dir has files | 1175 | New format takes precedence |

### Dashboard home integration tests (lines 1212-1275)
| Test | Line | What it verifies |
|------|------|-----------------|
| Banner shown with single session | 1215 | Topic name, human-readable phase ("Scope Review"), start date, "Currently grooming" label |
| Multiple session banners | 1233 | Both topics shown, pluralized label "Currently grooming (2 sessions)" |
| No banner when state absent | 1250 | "Currently grooming" text absent from page |
| No banner when state corrupted | 1263 | Corrupted file does not produce banner |

### groomPhaseLabel unit test (lines 1277-1290)
| Test | Line | What it verifies |
|------|------|-----------------|
| All 10 phase mappings + fallback | 1277 | Each raw phase maps to correct human label; unknown phases use humanizeSlug |

---

## Implementation Tasks

Since all acceptance criteria and tests are already implemented, there are **no code changes required**.

### Task 1: Verify existing tests pass

- [ ] **Step 1: Run the server test suite to confirm all session indicator tests pass**

```bash
node tests/server.test.js
```

Expected: All tests pass, including the 10 session-indicator-related tests documented above.

- [ ] **Step 2: Commit plan**

```
docs: add plan for PM-027 - Active Session Indicator
```

---

## Verification Checklist

| AC | Status | Evidence |
|----|--------|----------|
| 1. `readGroomState()` reads via shared helper from `.pm/groom-sessions/` with legacy fallback | Already done | `server.js:1159-1191` |
| 2. Banner shows topic, human-readable phase, start date | Already done | `server.js:1593-1601` via `groomSessionDisplay()` at line 1193 |
| 3. No banner when state absent — no empty space | Already done | `groomBannerHtml` defaults to `''`, template at line 1628 |
| 4. Banner at top of content, above proposal gallery | Already done | Template order: header → banner → proposals → cards → suggested |
| 5. Corrupted state silently omitted | Already done | try/catch in `readGroomState()` at lines 1166-1177 |
| 6. Banner is read-only — no actions/controls/links | Already done | Only `<div>` elements with text, no interactive elements |
| 7. Phase name mapping matches spec | Already done | `GROOM_PHASE_LABELS` at `server.js:1141-1152` |
