# PM-060: Session Route and Opt-in Prompt — Implementation Plan

**Issue:** PM-060 (child of groom-visual-companion)
**Date:** 2026-03-22
**Status:** Plan

---

## Overview

Add a `/session/{slug}` route to the dashboard server that renders groom session state as a live HTML page, extend the file watcher to cover `.pm/sessions/`, and add an opt-in step to Phase 1 that starts the dashboard and opens the session page in the browser.

---

## Task 1: Add `/session/{slug}` route to `routeDashboard()`

**File:** `scripts/server.js` — `routeDashboard()` (line ~1067)

**What to do:**

1. Add a new `else if` branch in `routeDashboard()` before the final `else` 404 block (line ~1150):

```js
} else if (urlPath.startsWith('/session/')) {
  const slug = urlPath.slice('/session/'.length).replace(/\/$/, '');
  if (slug && !slug.includes('/') && !slug.includes('..')) {
    handleGroomSession(res, pmDir, slug);
  } else {
    res.writeHead(404); res.end('Not found');
  }
}
```

2. Create `handleGroomSession(res, pmDir, slug)` function (near the other `handle*` functions):

```
function handleGroomSession(res, pmDir, slug) {
  // AC2: Check for current.html override first
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
  const overridePath = path.join(sessionsDir, 'groom-' + slug, 'current.html');

  // Path traversal guard: resolved path must start with sessionsDir
  if (!overridePath.startsWith(sessionsDir + path.sep)) {
    res.writeHead(404); res.end('Not found');
    return;
  }

  if (fs.existsSync(overridePath)) {
    // Serve the override HTML directly
    const html = fs.readFileSync(overridePath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // AC1: Read groom session state file
  const groomSessionsDir = path.resolve(pmDir, '..', '.pm', 'groom-sessions');
  const stateFile = path.join(groomSessionsDir, slug + '.md');

  if (!stateFile.startsWith(groomSessionsDir + path.sep)) {
    res.writeHead(404); res.end('Not found');
    return;
  }

  if (!fs.existsSync(stateFile)) {
    // AC3: Session not found
    const html = dashboardPage('Session Not Found', '/', `
      <div class="empty-state">
        <h2>Session not found</h2>
        <p>No groom session with slug <code>${escHtml(slug)}</code> was found.</p>
        <p><a href="/">&larr; Back to Dashboard</a></p>
      </div>`);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Parse state and render
  const raw = fs.readFileSync(stateFile, 'utf-8');
  const { data, body } = parseFrontmatter(raw);

  const topic = escHtml(data.topic || slug);
  const phase = groomPhaseLabel(data.phase || '');
  const started = escHtml(data.started || '');
  const codebaseCtx = escHtml(data.codebase_context || '');

  // Build scope section if present
  let scopeHtml = '';
  if (data.scope) {
    // render in_scope and out_of_scope lists
    ...
  }

  // Build verdict sections if present
  let verdictHtml = '';
  if (data.strategy_verdict || data.bar_raiser_verdict) {
    ...
  }

  // Render body markdown if any
  const bodyHtml = body.trim() ? renderMarkdown(body) : '';

  const html = dashboardPage(topic + ' — Session', '/', `
    <div class="page-header">
      <p class="breadcrumb"><a href="/">&larr; Dashboard</a></p>
      <h1>${topic}</h1>
      <div class="session-meta">
        <span class="groom-session-dot"></span>
        <span>Phase: <strong>${escHtml(phase)}</strong></span>
        ${started ? `<span>Started: ${started}</span>` : ''}
        ${codebaseCtx ? `<span>Codebase: ${codebaseCtx}</span>` : ''}
      </div>
    </div>
    ${scopeHtml}
    ${verdictHtml}
    ${bodyHtml ? '<div class="markdown-body">' + bodyHtml + '</div>' : ''}`);

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}
```

**Key decisions:**
- Path traversal protection using `startsWith(dir + path.sep)` — matches existing patterns (e.g., `readProposalMeta` at line 1236).
- `current.html` override check comes first (AC2), falling through to rendered state view (AC1).
- Session not found returns 404 with a styled page (AC3), not a raw text response.
- Reuses `dashboardPage()`, `parseFrontmatter()`, `groomPhaseLabel()`, `renderMarkdown()`, `escHtml()` — all existing.
- The CSS classes `.groom-session-dot`, `.session-meta` already exist in the dashboard styles (line ~774).

**AC coverage:** AC1 (route + render), AC2 (current.html override), AC3 (not found page), AC8 (multiple sessions — each slug is independent), AC9 (already 127.0.0.1).

---

## Task 2: Extend file watcher to `.pm/sessions/`

**File:** `scripts/server.js` — `createDashboardServer()` (line ~3153)

**What to do:**

1. After the existing `watchDirectoryTree(pmDir)` call (line ~3257), add a second watcher for the sessions directory:

```js
// Watch .pm/sessions/ for companion updates (groom session HTML)
const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
if (fs.existsSync(sessionsDir)) {
  watchDirectoryTree(sessionsDir);
} else {
  // Watch for the directory to be created
  const pmPrivateDir = path.resolve(pmDir, '..', '.pm');
  if (fs.existsSync(pmPrivateDir)) {
    // The .pm dir exists but sessions/ doesn't yet — the existing watcher
    // on .pm/ (if pmDir watchers cover it) won't help because .pm/ is
    // outside pmDir. We need to explicitly watch .pm/ for the creation
    // of sessions/.
    // Alternative: create sessions/ eagerly (mkdir -p).
  }
}
```

**Decision:** The simplest approach is to eagerly create `.pm/sessions/` at server start if it doesn't exist, then watch it. This avoids complexity of watching for directory creation.

```js
const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
watchDirectoryTree(sessionsDir);
```

2. Update `server.close` override (line ~3262) to also clean up sessions watchers:

```js
server.close = function(cb) {
  watcherActive = false;
  closeWatchersUnder(pmDir);
  closeWatchersUnder(sessionsDir);  // <-- add this line
  // ... rest unchanged
};
```

The `closeWatchersUnder()` function already handles recursive cleanup of all watchers under a given path prefix. Since `sessionsDir` is outside `pmDir`, it needs its own cleanup call. No leaked watchers on shutdown (AC4).

**AC coverage:** AC4 (watcher + cleanup).

---

## Task 3: Add opt-in step to Phase 1

**File:** `skills/groom/phases/phase-1-intake.md`

**What to do:**

Add a new step after step 6 (state file creation). This step runs after the groom session state file is written, so the slug is known.

```markdown
7. **Visual companion opt-in.** After writing the state file:

   a. Read `.pm/config.json`. If it does not exist, create it with the default config
      (this should already be handled by the config bootstrap at the top of Phase 1).
   b. Check `preferences.visual_companion`:
      - If `true`: proceed to start dashboard (step 7d).
      - If `false`: skip visual companion silently. Proceed to Phase 2.
      - If the key does not exist (not set): ask the user:
        > "Want a visual companion in the browser? I'll show each phase as a
        > clean web page. (yes/no)"
        - "yes" or "y" → write `visual_companion: true` to `.pm/config.json`
          under `preferences`. Proceed to step 7d.
        - Any other response → write `visual_companion: false`. Proceed to Phase 2.
   c. When writing to `.pm/config.json`, read the existing file, parse it, update
      only the `preferences.visual_companion` key, and write back. Do not overwrite
      other config keys.
   d. Start the dashboard server using the existing shell script:
      ```bash
      bash {plugin_dir}/scripts/start-server.sh --mode dashboard --project-dir "{project_root}"
      ```
      Parse the JSON output to get the `url` field.
   e. Open `{url}/session/{slug}` in the default browser.
```

**Important note on the config bootstrap:** Phase 1 already has a config bootstrap (lines 1-27) that creates `.pm/config.json` with `"visual_companion": true` as default if it doesn't exist. This means:
- **New users** (no config): bootstrap creates config with `visual_companion: true`. Step 7b reads `true`, skips the question, starts companion automatically.
- **Existing users who haven't been asked**: config exists but `visual_companion` might not be in `preferences`. Step 7b sees unset, asks the question.
- **Users who already answered**: config has `true` or `false`. Step 7b uses stored value silently.

**Wait — the AC says "If unset, asks"** but the bootstrap already sets it to `true`. This means first-time users get the companion without being asked. The AC also says "If `.pm/config.json` does not exist, it is created." Let me reconcile:

The bootstrap at the top of Phase 1 creates the full default config including `visual_companion: true`. The opt-in step (AC5) only triggers its question when the key is literally absent. For brand-new users, the bootstrap runs first and sets it to `true`, so the opt-in question is skipped — they get the companion by default. This matches the AC's intent: the question is a fallback for configs created before the visual companion feature existed (where `visual_companion` is absent).

**AC coverage:** AC5 (opt-in prompt + config write), AC6 (start server + open browser).

---

## Task 4: Add `.pm/sessions/` to `.gitignore`

**File:** `.gitignore`

**What to do:**

The `.gitignore` already has `.pm/` which covers `.pm/sessions/` transitively. However, it also has `!.pm/dev-sessions/` which creates an exception. We should verify that `.pm/sessions/` is properly ignored.

Since `.pm/` is already in `.gitignore` (line 5), `.pm/sessions/` is already covered. No change needed unless we want to be explicit. Since the AC says "add to .gitignore if not already present" and it IS already covered by `.pm/`, this is a no-op.

**AC coverage:** AC7 (already covered by `.pm/` gitignore rule).

---

## Task 5: Add tests for the session route

**File:** `tests/server.test.js`

**What to do:**

Add test cases following the existing pattern (`withPmDir`, `startDashboardServer`, `httpGet`):

1. **Session route renders groom state:** Create a temp dir with `.pm/groom-sessions/{slug}.md` containing frontmatter (topic, phase). Hit `/session/{slug}`. Assert 200 + body contains topic and phase label.

2. **Session route serves current.html override:** Create `.pm/sessions/groom-{slug}/current.html` with custom HTML. Hit `/session/{slug}`. Assert 200 + body is the custom HTML content (not the rendered state).

3. **Session not found returns 404:** Hit `/session/nonexistent`. Assert 404 + body contains "Session not found".

4. **Path traversal blocked:** Hit `/session/../../etc/passwd`. Assert 404.

5. **Multiple concurrent sessions:** Create two session state files. Hit both `/session/{slug1}` and `/session/{slug2}`. Assert both return 200 with their respective topics.

---

## Task 6: Verify no regressions

Run `node tests/*.test.js` from repo root. All existing tests plus new tests must pass.

---

## Implementation Order

1. **Task 1** — `handleGroomSession()` + route in `routeDashboard()` (server.js)
2. **Task 2** — Sessions directory watcher + cleanup (server.js)
3. **Task 5** — Tests for the new route (server.test.js)
4. **Task 6** — Run tests, verify no regressions
5. **Task 3** — Opt-in step in phase-1-intake.md (skill change)
6. **Task 4** — .gitignore verification (likely no-op)

Tasks 1 and 2 are both in server.js and can be done together. Task 5 should follow immediately to verify. Task 3 is independent (skill markdown, no code). Task 4 is verification only.

---

## Files Changed

| File | Change |
|---|---|
| `scripts/server.js` | Add `handleGroomSession()`, add `/session/{slug}` route branch, add `.pm/sessions/` watcher + cleanup |
| `skills/groom/phases/phase-1-intake.md` | Add step 7: visual companion opt-in, config check, server start, browser open |
| `tests/server.test.js` | Add 5 test cases for session route |
| `.gitignore` | No change needed (already covered by `.pm/`) |

---

## Risks and Mitigations

- **WebSocket broadcast is global:** All connected dashboard/session tabs reload when any file changes. Acceptable for v1 per the backlog item's architectural note.
- **`current.html` served raw:** No sanitization of the override HTML. Acceptable because it's written by the plugin itself (PM-061), not user input. The file lives in `.pm/sessions/` which is local-only.
- **Slug validation:** Uses the same `!slug.includes('/') && !slug.includes('..')` pattern as existing routes. Plus path traversal guard with `startsWith()`.
