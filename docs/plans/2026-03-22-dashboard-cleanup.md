# PM-062: Dashboard Session Links and Groom Session Cleanup — Implementation Plan

**Issue:** PM-062 (child of groom-visual-companion)
**Date:** 2026-03-22
**Status:** Plan
**Depends on:** PM-060 (session route), PM-061 (per-phase companion screens)

---

## Overview

Make active groom sessions clickable from the dashboard home page so users can jump straight to the visual companion, and add automatic cleanup of the companion screen directory when a groom session completes in Phase 6.

---

## Task 1: Add session link to dashboard groom banner

**File:** `scripts/server.js` — `handleDashboardHome()` (line ~1724-1740)

**What to do:**

1. In the groom session banner template (line ~1729-1737), conditionally wrap the topic text in an anchor tag when a companion session directory exists.

2. Inside the `groomSessions.map()` callback, after calling `groomSessionDisplay(s)`, check whether `.pm/sessions/groom-{slug}/` exists on disk:

```js
const sessionItems = groomSessions.map(s => {
  const d = groomSessionDisplay(s);
  // Check if companion session directory exists
  const companionDir = d.slug
    ? path.resolve(pmDir, '..', '.pm', 'sessions', 'groom-' + d.slug)
    : null;
  const hasCompanion = companionDir && fs.existsSync(companionDir);

  // Wrap topic in link if companion exists
  const topicHtml = hasCompanion
    ? `<a href="/session/${d.slug}" class="groom-session-link">${d.topic}</a>`
    : d.topic;

  return `<div class="groom-session">
  <div class="groom-session-dot"></div>
  <div>
    <div class="groom-session-topic">${topicHtml}</div>
    <div class="groom-session-meta">Phase: ${d.phase} · Started ${d.started}</div>
  </div>
</div>`;
}).join('\n');
```

3. `d.slug` is already HTML-escaped by `groomSessionDisplay()` (line 1300). The `escHtml` call uses entity encoding, so the href and existence check are safe. However, the `fs.existsSync` call uses the raw slug for the filesystem path. We need the unescaped slug for the filesystem check. Update `groomSessionDisplay()` to also return the raw slug:

```js
function groomSessionDisplay(session) {
  const slug = session._slug ? escHtml(session._slug) : '';
  const rawSlug = session._slug || '';
  return {
    topic: escHtml(session.topic),
    phase: escHtml(groomPhaseLabel(session.phase || '')),
    started: escHtml(session.started || ''),
    slug,
    rawSlug,
    resumeHint: slug ? `/pm:groom ${slug}` : '/pm:groom',
  };
}
```

Then use `d.rawSlug` for the `fs.existsSync` check and `d.slug` for the HTML href.

**AC coverage:** AC1 (link appears when directory exists), AC2 (no link when directory absent).

---

## Task 2: Add CSS for session link

**File:** `scripts/server.js` — CSS block (line ~802-811)

**What to do:**

Add a style rule for `.groom-session-link` after the existing `.groom-session-topic` rule:

```css
.groom-session-link { color: var(--accent); text-decoration: none; }
.groom-session-link:hover { text-decoration: underline; }
```

The link inherits the `font-weight: 600` and `font-size: 0.9375rem` from `.groom-session-topic` since it's a child element.

**AC coverage:** AC1 (link is styled and clickable).

---

## Task 3: Add cleanup step to Phase 6

**File:** `skills/groom/phases/phase-6-link.md`

**What to do:**

Add a new step 8.5 between step 8 (clean up groom state file) and the final "Grooming complete" message. This step deletes the companion session directory.

Insert after step 8 ("Clean up. Delete `.pm/groom-sessions/{slug}.md`"):

```markdown
9. **Clean up companion session.** Silently delete the `.pm/sessions/groom-{slug}/` directory and its contents if it exists. Do not prompt the user or display any output about this step. If the directory does not exist, skip silently.

   ```bash
   rm -rf "${CLAUDE_PROJECT_DIR:-$PWD}/.pm/sessions/groom-{slug}"
   ```

   **Important:** Only delete the companion screen directory (`.pm/sessions/groom-{slug}/`). Do NOT delete the groom state file (`.pm/groom-sessions/{slug}.md`) — that is handled by step 8 above, which runs only after the retro and learning extraction are complete.
```

Renumber the final "Grooming complete" say block from step 8's continuation to follow step 9.

**Key decisions:**
- The cleanup is placed after step 8 (state file deletion) because by that point the retro and learning extraction are done — the session is truly complete.
- `rm -rf` is safe here: the directory only contains `current.html` files written by the plugin itself.
- Silent execution: no user prompt, no output. If directory doesn't exist, `rm -rf` on a non-existent path is a no-op (AC4).
- The groom state file (`.pm/groom-sessions/{slug}.md`) is explicitly NOT deleted by this step — it's handled separately by existing step 8 (AC5).

**AC coverage:** AC3 (cleanup after issue creation), AC4 (skip silently if absent), AC5 (state file not deleted by this step).

---

## Task 4: Add test for dashboard session link

**File:** `tests/server.test.js`

**What to do:**

Add test cases following the existing pattern (`withPmDir`, `startDashboardServer`, `httpGet`):

1. **Banner shows link when companion directory exists:**
   - Create temp dir with `.pm/groom-sessions/{slug}.md` (frontmatter with topic, phase).
   - Create `.pm/sessions/groom-{slug}/` directory (mkdir -p).
   - Start dashboard server, hit `/`.
   - Assert 200 + body contains `<a href="/session/{slug}"` and the topic text.

2. **Banner shows plain topic when companion directory absent:**
   - Create temp dir with `.pm/groom-sessions/{slug}.md` (frontmatter with topic, phase).
   - Do NOT create `.pm/sessions/groom-{slug}/`.
   - Start dashboard server, hit `/`.
   - Assert 200 + body contains the topic text but does NOT contain `<a href="/session/{slug}"`.

3. **Banner shows link for one session but not another (mixed state):**
   - Create two groom session state files.
   - Create companion directory for only one of them.
   - Assert the linked session has an `<a>` tag, the other does not.

---

## Task 5: Run tests and verify no regressions

Run `node tests/*.test.js` from repo root. All existing tests plus the new tests from Task 4 must pass.

---

## Implementation Order

1. **Task 2** — CSS rule (small, no dependencies)
2. **Task 1** — Dashboard banner link logic (server.js)
3. **Task 3** — Phase 6 cleanup step (skill markdown)
4. **Task 4** — Tests
5. **Task 5** — Run all tests

Tasks 1 and 2 are both in `server.js` and should be done together. Task 3 is independent (skill markdown). Task 4 depends on Tasks 1+2 being complete.

---

## Files Changed

| File | Change |
|---|---|
| `scripts/server.js` | Add `rawSlug` to `groomSessionDisplay()`, wrap topic in `<a>` when companion dir exists, add `.groom-session-link` CSS |
| `skills/groom/phases/phase-6-link.md` | Add step 9: delete `.pm/sessions/groom-{slug}/` directory silently |
| `tests/server.test.js` | Add 3 test cases for banner link presence/absence |

---

## Risks and Mitigations

- **Filesystem check on every dashboard load.** `fs.existsSync()` is called once per active groom session when rendering the home page. Since groom sessions are few (typically 1-3), this is negligible overhead. No caching needed.
- **Slug escaping mismatch.** The `groomSessionDisplay()` function HTML-escapes the slug. We add `rawSlug` for filesystem operations and use `slug` (escaped) only in HTML output. This prevents any injection via crafted filenames.
- **Phase 6 cleanup ordering.** The cleanup step runs after the retro and learning extraction (steps 6-7), which read the groom state file. The companion directory is independent of those steps, so cleanup order is safe. The groom state file cleanup in step 8 happens before companion cleanup in step 9 — both are independent.
