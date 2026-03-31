# PM-060: Session Route + Dashboard-First Groom Output

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/session/{slug}` support `current.html` overrides, watch `.pm/sessions/` for live-reload, and auto-open the dashboard after Phase 1 by default.

**Architecture:** The `/session/{slug}` route already exists in `handleSessionPage()` (server.js:2220). We extend it with a `current.html` override check, add a file watcher for `.pm/sessions/`, and rewrite the Phase 1 visual companion step from a manual prompt to opt-out (dashboard-first default).

**Tech Stack:** Node.js (http, fs.watch), Markdown (skill phases)

---

## Current State

What **already works** (no changes needed):

| AC | Feature | Location |
|----|---------|----------|
| AC1 | `/session/{slug}` route in `routeDashboard()` | server.js:1374-1380 |
| AC1 | `handleSessionPage()` renders groom state as HTML | server.js:2220-2403 |
| AC3 | "Session not found" 404 page with home link | server.js:2245-2252 |
| AC8 | Multiple concurrent sessions (slug-based lookup) | server.js:2230-2243 |
| AC9 | Server binds `127.0.0.1` only | server.js:79 (`HOST`) |
| AC7 | `.pm/sessions/` gitignored (covered by `.pm/` rule) | .gitignore:5 |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC2 | `current.html` override not checked | Task 1 |
| AC4 | `.pm/sessions/` not watched for file changes | Task 2 |
| AC4 | `.pm/sessions/` watchers not cleaned up in `server.close` | Task 2 |
| AC5 | Phase 1 prompts manually instead of defaulting to auto-open | Task 4 |
| AC6 | Phase 1 does not start server or open browser URL | Task 4 |

---

## Task 1: Add `current.html` Override to Session Route

**Files:**
- Modify: `scripts/server.js:2220-2253` (`handleSessionPage`)
- Test: `tests/server.test.js`

The override check goes at the top of `handleSessionPage()`, before any groom/dev state lookup. If `.pm/sessions/groom-{slug}/current.html` exists, serve it directly. This lets PM-061 write per-phase HTML that takes over the view.

- [ ] **Step 1: Write failing tests for current.html override**

Add to `tests/server.test.js`:

```js
test('GET /session/{slug} serves current.html override when present', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
    '.pm/groom-sessions/my-feature.md': '---\ntopic: "My Feature"\nphase: research\nstarted: 2026-03-20\n---\n',
    '.pm/sessions/groom-my-feature/current.html': '<html><body>OVERRIDE CONTENT</body></html>',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/my-feature');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('OVERRIDE CONTENT'), 'must serve current.html content');
    assert.ok(!res.body.includes('Phase:'), 'must not render state view when override exists');
  } finally { await close(); cleanup(); }
});

test('GET /session/{slug} falls through to state view when no current.html', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
    '.pm/groom-sessions/my-feature.md': '---\ntopic: "My Feature"\nphase: research\nstarted: 2026-03-20\n---\n',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/my-feature');
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes('My Feature'), 'must render state view with topic');
  } finally { await close(); cleanup(); }
});

test('GET /session/{slug} current.html path traversal blocked', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
  });
  const { port, close } = await startDashboardServer(pmDir);
  try {
    const res = await httpGet(port, '/session/../../etc/passwd');
    assert.equal(res.statusCode, 404);
  } finally { await close(); cleanup(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/server.test.js`
Expected: The override test fails (current.html not served). The fallthrough test passes (existing behavior). The traversal test passes (existing guard at line 1376).

- [ ] **Step 3: Add current.html override check to handleSessionPage**

In `scripts/server.js`, insert at the top of `handleSessionPage()` (after `const pmRoot` on line 2223), before the groom/dev state lookup:

```js
// AC2: Check for current.html override (enables PM-061 per-phase HTML)
const sessionsDir = path.resolve(pmRoot, 'sessions');
const overridePath = path.join(sessionsDir, 'groom-' + slug, 'current.html');
// Path traversal guard
if (overridePath.startsWith(sessionsDir + path.sep) && fs.existsSync(overridePath)) {
  const html = fs.readFileSync(overridePath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
  return;
}
```

This goes before the groom/dev session lookup (line 2230) so the override takes priority.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All three new tests PASS. All existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: current.html override in session route (PM-060 AC2)"
```

---

## Task 2: Watch `.pm/sessions/` for Live-Reload

**Files:**
- Modify: `scripts/server.js:3818-3836` (`createDashboardServer` — watcher setup + close)
- Test: `tests/server.test.js`

The dashboard server already watches `pmDir` (the `pm/` directory) via `watchDirectoryTree()`. We add a second watch root for `.pm/sessions/` so changes to `current.html` files trigger WebSocket reload. On `server.close`, we clean up these watchers too.

- [ ] **Step 1: Write failing test for sessions watcher cleanup**

```js
test('Server close cleans up sessions directory watchers', async () => {
  const { root, pmDir, cleanup } = withPmDir({
    'pm/backlog/placeholder.md': '---\ntype: backlog-issue\nid: PM-TEST\ntitle: test\noutcome: test\nstatus: idea\npriority: low\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n',
  });
  // Create .pm/sessions/ so the watcher has something to watch
  fs.mkdirSync(path.join(root, '.pm', 'sessions', 'groom-test'), { recursive: true });
  const { port, close } = await startDashboardServer(pmDir);
  // Close should not throw and should clean up watchers
  await close();
  cleanup();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server.test.js`
Expected: Test may pass trivially (close already works) — that's fine if it does. The real assertion is no error/hang.

- [ ] **Step 3: Add sessions watcher to createDashboardServer**

In `scripts/server.js`, after the existing `watchDirectoryTree(pmDir)` block (line 3818-3821):

```js
// Watch .pm/sessions/ for companion HTML changes (AC4)
const sessionsWatchDir = path.resolve(pmDir, '..', '.pm', 'sessions');
fs.mkdirSync(sessionsWatchDir, { recursive: true });
watchDirectoryTree(sessionsWatchDir);
```

And update `server.close` (line 3825-3836) to also clean up sessions watchers:

```js
server.close = function(cb) {
  watcherActive = false;
  closeWatchersUnder(pmDir);
  closeWatchersUnder(sessionsWatchDir);  // <-- add this
  for (const sock of allConnections) {
    try { sock.destroy(); } catch (e) {}
  }
  allConnections.clear();
  dashClients.clear();
  origClose(cb);
};
```

The `sessionsWatchDir` variable must be declared outside `server.close` (in the `createDashboardServer` function scope) so the closure can reference it. The `fs.mkdirSync` with `recursive: true` is safe if the dir already exists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All tests PASS. No hanging processes or leaked watchers.

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat: watch .pm/sessions/ for live-reload (PM-060 AC4)"
```

---

## Task 3: Verify `.gitignore` Coverage

**File:** `.gitignore`

`.gitignore` already has `.pm/` on line 5, which covers `.pm/sessions/` transitively. The only exception is `!.pm/dev-sessions/` — no exception exists for `.pm/sessions/`. No change needed.

- [ ] **Step 1: Verify .gitignore coverage**

```bash
cd /path/to/project && mkdir -p .pm/sessions/groom-test && touch .pm/sessions/groom-test/current.html
git status --porcelain .pm/sessions/
```

Expected: No output (file is ignored). If it shows up, add `!.pm/sessions/` negation is NOT needed — `.pm/` already covers it.

- [ ] **Step 2: Clean up test file**

```bash
rm -rf .pm/sessions/groom-test
```

No commit needed — this is verification only.

---

## Task 4: Rewrite Phase 1 Visual Companion to Auto-Open

**File:** `skills/groom/phases/phase-1-intake.md`

The current step 2.5 asks the user "Open the dashboard?" and waits for a yes/no answer. The new behavior: dashboard opens automatically unless `.pm/config.json` has `visual_companion: false`. No prompt needed — dashboard-first is the default.

- [ ] **Step 1: Replace step 2.5 in phase-1-intake.md**

Replace the current step 2.5 ("Visual companion offer") with:

```markdown
2.5. **Visual companion (auto-open).**

   <HARD-GATE>
   You MUST execute this step. Do not skip it. Do not proceed to Phase 2 until this step completes.
   </HARD-GATE>

   After capturing the idea and deriving the slug:

   1. Read `.pm/config.json` (already loaded by the bootstrap above).
   2. Check `preferences.visual_companion`:
      - If `false`: skip silently. Proceed to step 3.
      - If `true`, unset, or file missing: open the dashboard (step 3 below).
   3. Start the dashboard server (idempotent — skips if already running):
      ```bash
      bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
      ```
      Parse the JSON output to get the `url` field.
   4. Open `{url}/session/{slug}` in the default browser:
      ```bash
      open "{url}/session/{slug}"  # macOS
      ```
   5. Tell the user:
      > "Session view open in browser. It'll update as we go."

   This is a session-level decision. If visual companion is active, use the browser for all visual content throughout the session. The user can disable future auto-open by setting `visual_companion: false` in `.pm/config.json`.
```

Key changes from the old step 2.5:
- **No prompt.** Dashboard opens automatically (AC5: "default on, no prompt needed").
- **Only `false` disables.** Unset/missing/`true` all result in auto-open.
- **Happens after slug is derived** (step 5), so the URL includes the slug.
- **Still a HARD-GATE** so it can't be skipped by the LLM.

- [ ] **Step 2: Reorder step so it runs after slug derivation**

Move the visual companion step to run after step 6 (state file creation) instead of after step 2. The slug must exist before we can open `/session/{slug}`. Renumber it as step 7:

The new flow becomes:
1. Ask "What's the idea?"
2. Clarify follow-ups
3. Check research
3.5. Memory injection
4. Codebase scan
5. Derive slug
6. Write state file
**7. Visual companion auto-open** (moved from 2.5)

- [ ] **Step 3: Commit**

```bash
git add skills/groom/phases/phase-1-intake.md
git commit -m "feat: auto-open dashboard after Phase 1 (PM-060 AC5+AC6)"
```

---

## Implementation Order

1. **Task 1** — `current.html` override (server.js + tests)
2. **Task 2** — `.pm/sessions/` watcher (server.js + tests)
3. **Task 3** — `.gitignore` verification (no code change)
4. **Task 4** — Phase 1 auto-open rewrite (skill markdown)

Tasks 1 and 2 both modify server.js but different sections (route handler vs watcher setup). Task 3 is verification only. Task 4 is independent markdown.

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js:2220` | Add `current.html` override check at top of `handleSessionPage()` |
| `scripts/server.js:3818` | Add `watchDirectoryTree()` call for `.pm/sessions/` |
| `scripts/server.js:3825` | Add `closeWatchersUnder(sessionsWatchDir)` to `server.close` |
| `tests/server.test.js` | Add 4 tests: override served, fallthrough to state, path traversal, watcher cleanup |
| `skills/groom/phases/phase-1-intake.md` | Replace manual prompt with auto-open, move to step 7 |
| `.gitignore` | No change (already covered) |

---

## Risks

- **WebSocket broadcast is global.** A change to session A's `current.html` reloads all connected tabs (including session B). Acceptable for v1 per the issue's architectural note.
- **`current.html` served unsanitized.** Written by the plugin (PM-061), not user input. Local-only file in `.pm/sessions/`.
- **Eager `mkdirSync` for `.pm/sessions/`.** Creates the directory at server start even if no groom session is active. Harmless — the dir is gitignored and empty dirs have negligible cost.
