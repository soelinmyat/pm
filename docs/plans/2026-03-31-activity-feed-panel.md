# PM-091: Activity Feed Panel on Dashboard Home

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live-updating activity feed panel to the dashboard home page that shows events from all terminal sessions in real-time via SSE.

**Architecture:** Three changes to `scripts/server.js`: (1) CSS for the feed panel, temporal fade, and responsive hiding, (2) `dashboardPage()` gets a conditional sidebar slot parameter so the Home page renders the feed panel while other pages remain unchanged, (3) EventSource JavaScript in the client connects to `GET /events`, renders events with color-coded dots and relative timestamps, and reconciles on reconnect via `Last-Event-ID`.

**Tech Stack:** Node.js (raw `http` module), server-side HTML rendering, vanilla JavaScript (EventSource API), CSS

---

## Upstream Context

> Injected from research at `pm/research/sse-event-bus/findings.md`.

### Key Findings
- OpenCode (SST) validates SSE event bus with typed events + POST ingestion + multi-client subscription at production scale
- SSE wins over WebSocket for PM's use case: unidirectional server-to-browser, automatic reconnection, simpler
- Linear Pulse is the closest UX precedent — PM's feed is simpler: one chronological list from terminal sessions
- Color-coded dots by event type: success (green), info (blue), warning (orange), accent (purple for lifecycle)

### Design Decisions
- Feed panel is Home page only in v1 — other pages render without sidebar slot
- No filtering, grouping, or read/unread in v1 — temporal fade substitutes for read/unread
- Fade classification re-evaluated on each new event arrival, not on a timer

---

## Current State

What **already exists** (no changes needed):

| Feature | Location |
|---------|----------|
| `dashboardPage(title, activeNav, bodyContent, projectName)` — HTML shell | `server.js:1073-1151` |
| `handleDashboardHome(res, pmDir)` — composes stat cards, sessions, proposals | `server.js:1980-2222` |
| `DASHBOARD_CSS` — all CSS variables and styles | `server.js:428-968` |
| WebSocket client injection (reload on file change) | `server.js:1124-1148` |
| `createDashboardServer(pmDir)` — server factory with `allConnections` | `server.js:3730-3858` |
| POST/GET `/events` + ring buffer (PM-090) | `server.js` — inside `createDashboardServer()` |
| CSS variables: `--bg`, `--surface`, `--border`, `--text`, `--text-muted`, `--success`, `--warning`, `--info`, `--accent` | `server.js:428-465` |
| Responsive breakpoints at 768px, 900px, 600px, 400px | `server.js:911-968, 1059-1068` |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC1, AC6, AC10 | Feed panel CSS: 260px sidebar, darker bg, responsive hide | Task 1 |
| AC2, AC3, AC4, AC5, AC9 | Feed panel HTML + temporal fade + empty state | Task 1 |
| AC11 | `dashboardPage()` sidebar slot parameter, tested on all pages | Task 2 |
| AC7, AC8, AC12 | EventSource client JS: connect, render, reconnect + replay | Task 3 |

---

## Task 1: Feed Panel CSS + Static HTML Structure

**Files:**
- Modify: `scripts/server.js:428-968` (append feed panel CSS to `DASHBOARD_CSS`)
- Modify: `scripts/server.js:1980-2222` (add feed panel HTML to `handleDashboardHome`)
- Test: `tests/server.test.js`

This task adds the CSS and static HTML for the feed panel. The panel renders server-side with an empty state. Real-time updates come in Task 3.

- [ ] **Step 1: Write failing tests for feed panel HTML**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Activity Feed Panel — HTML structure
// ---------------------------------------------------------------------------

test('Dashboard home contains activity feed panel', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('activity-feed'), 'must contain activity-feed panel');
      assert.ok(body.includes('feed-header'), 'must contain feed header');
      assert.ok(body.includes('Activity'), 'must contain Activity label');
      assert.ok(body.includes('feed-status'), 'must contain live/idle indicator');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Dashboard home shows empty state when no events', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('feed-empty'), 'must contain empty state');
      assert.ok(body.includes('No events yet'), 'must show empty message');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Backlog page does NOT contain activity feed panel', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/backlog');
      assert.ok(!body.includes('activity-feed'), 'backlog must not contain feed panel');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('KB page does NOT contain activity feed panel', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/kb');
      assert.ok(!body.includes('activity-feed'), 'kb must not contain feed panel');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/server.test.js`
Expected: New tests FAIL (no `activity-feed` class in dashboard HTML)

- [ ] **Step 3: Add feed panel CSS to DASHBOARD_CSS**

Append the following CSS before the closing backtick of `DASHBOARD_CSS` (before `@media (prefers-reduced-motion: reduce)` around line 904):

```css
/* ========== Activity Feed Panel ========== */
.main-with-feed { display: flex; gap: 0; }
.main-with-feed > .container { flex: 1; min-width: 0; }

.activity-feed {
  width: 260px; flex-shrink: 0;
  background: #12141a; border-left: 1px solid var(--border);
  display: flex; flex-direction: column; height: calc(100vh - 0px);
  position: sticky; top: 0;
}
[data-theme="light"] .activity-feed {
  background: #f0f1f4;
}

.feed-header {
  padding: 0.75rem 1rem; border-bottom: 1px solid var(--border);
  display: flex; justify-content: space-between; align-items: center;
  font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted);
}
.feed-status {
  display: flex; align-items: center; gap: 0.375rem;
  font-size: 0.6875rem; font-weight: 500; text-transform: none;
  letter-spacing: 0; color: var(--text-muted);
}
.feed-status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--success);
}
.feed-status-dot.live {
  animation: feed-pulse 2s ease-in-out infinite;
}
.feed-status-dot.idle {
  background: var(--text-muted);
  animation: none;
}
@keyframes feed-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.feed-body { flex: 1; overflow-y: auto; }

.feed-empty {
  display: flex; align-items: center; justify-content: center;
  height: 100%; padding: 2rem 1rem; text-align: center;
  font-size: 0.75rem; color: var(--text-muted); line-height: 1.5;
}

.feed-event {
  padding: 0.5rem 1rem; border-bottom: 1px solid var(--border);
  display: flex; align-items: flex-start; gap: 0.5rem;
}
.feed-event.muted { opacity: 0.5; }

.feed-event-dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0; margin-top: 5px;
  background: var(--text-muted);
}
.feed-event-dot.success { background: var(--success); }
.feed-event-dot.info { background: var(--info); }
.feed-event-dot.warning { background: var(--warning); }
.feed-event-dot.accent { background: var(--accent); }

.feed-event-content { min-width: 0; }
.feed-event-text {
  font-size: 0.75rem; line-height: 1.4; color: var(--text);
}
.feed-event.muted .feed-event-text { color: var(--text-muted); }
.feed-event-source { font-weight: 500; }
.feed-event-time {
  font-size: 0.625rem; color: var(--text-muted); margin-top: 1px;
}

.feed-time-sep {
  font-size: 0.625rem; color: var(--text-muted); padding: 0.5rem 1rem 0.25rem;
  text-transform: uppercase; letter-spacing: 0.03em;
}

@media (max-width: 1024px) {
  .activity-feed { display: none; }
}
```

- [ ] **Step 4: Modify `dashboardPage()` to accept optional sidebar slot**

Change the function signature at `server.js:1073`:

```javascript
function dashboardPage(title, activeNav, bodyContent, projectName, sidebarSlot) {
```

Then modify the `<main>` section (lines 1118-1122). Replace:

```html
  <main class="main-content">
    <div class="container">
${bodyContent}
    </div>
  </main>
```

With:

```javascript
  <main class="main-content${sidebarSlot ? ' main-with-feed' : ''}">
    <div class="container">
${bodyContent}
    </div>
${sidebarSlot || ''}
  </main>
```

This is a safe change — all existing callers pass 4 args so `sidebarSlot` is `undefined`, which is falsy.

- [ ] **Step 5: Build feed panel HTML in `handleDashboardHome`**

In `handleDashboardHome`, before the `dashboardPage()` call at line 2219, add:

```javascript
  const feedPanelHtml = `
    <aside class="activity-feed" id="activity-feed">
      <div class="feed-header">
        Activity
        <div class="feed-status" id="feed-status">
          <span class="feed-status-dot idle" id="feed-status-dot"></span>
          <span id="feed-status-label">Idle</span>
        </div>
      </div>
      <div class="feed-body" id="feed-body">
        <div class="feed-empty" id="feed-empty">
          No events yet.<br>
          Activity appears here when<br>
          terminal sessions are running.
        </div>
      </div>
    </aside>`;
```

Then change line 2219 from:

```javascript
  const html = dashboardPage('Home', '/', body, projectName);
```

To:

```javascript
  const html = dashboardPage('Home', '/', body, projectName, feedPanelHtml);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All new feed panel tests PASS. All existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat(PM-091): activity feed panel CSS + static HTML structure"
```

---

## Task 2: Verify Layout Regression on Non-Home Pages

**Files:**
- Test: `tests/server.test.js`

This task adds explicit regression tests to verify non-Home pages don't break with the new `sidebarSlot` parameter.

- [ ] **Step 1: Write regression tests**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Activity Feed — layout regression (non-Home pages)
// ---------------------------------------------------------------------------

test('Backlog page does not use main-with-feed class', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/backlog');
      assert.ok(!body.includes('main-with-feed'), 'backlog must not use feed layout');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('KB page does not use main-with-feed class', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/kb');
      assert.ok(!body.includes('main-with-feed'), 'kb must not use feed layout');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});

test('Home page uses main-with-feed class', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('main-with-feed'), 'home page must use feed layout');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: All regression tests PASS — `main-with-feed` only appears on Home.

- [ ] **Step 3: Commit**

```bash
git add tests/server.test.js
git commit -m "test(PM-091): layout regression tests for sidebar slot"
```

---

## Task 3: EventSource Client — Real-Time Feed Updates + Reconnect Replay

**Files:**
- Modify: `scripts/server.js:1124-1148` (add EventSource JavaScript alongside WebSocket client)
- Test: `tests/server.test.js`

This task adds the browser-side EventSource client that connects to `GET /events`, renders events into the feed panel DOM, and reconciles on reconnect.

- [ ] **Step 1: Write failing test for EventSource script injection**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Activity Feed — EventSource client injection
// ---------------------------------------------------------------------------

test('Home page includes EventSource client script', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      assert.ok(body.includes('EventSource'), 'must include EventSource client');
      assert.ok(body.includes('/events'), 'must connect to /events endpoint');
      assert.ok(body.includes('feed-body'), 'must reference feed-body element');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/server.test.js`
Expected: Test FAILS (`EventSource` not in home page HTML)

- [ ] **Step 3: Add EventSource client JavaScript**

In `dashboardPage()`, add the EventSource client script after the WebSocket reload script (after line 1147, inside the `<script>` block or as a new `<script>` block). The script should only run if the `activity-feed` element exists (Home page only).

Insert before `</body>` (before line 1149), after the closing `</script>` of the theme toggle block:

```javascript
<script>
(function() {
  var feedBody = document.getElementById('feed-body');
  if (!feedBody) return; // Not on Home page — skip

  var feedEmpty = document.getElementById('feed-empty');
  var statusDot = document.getElementById('feed-status-dot');
  var statusLabel = document.getElementById('feed-status-label');
  var RECENT_MS = 3 * 60 * 1000; // 3 minutes

  function dotClass(type) {
    if (!type) return '';
    if (type.indexOf('test') !== -1 || type.indexOf('pass') !== -1 || type.indexOf('merge') !== -1) return 'success';
    if (type.indexOf('pr_') !== -1 || type.indexOf('push') !== -1 || type.indexOf('commit') !== -1) return 'info';
    if (type.indexOf('fail') !== -1 || type.indexOf('error') !== -1 || type.indexOf('warn') !== -1) return 'warning';
    return 'accent';
  }

  function relativeTime(ts) {
    var diff = Math.max(0, Date.now() - ts);
    if (diff < 5000) return 'just now';
    if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    return Math.floor(diff / 3600000) + 'h ago';
  }

  function isRecent(ts) {
    return (Date.now() - ts) < RECENT_MS;
  }

  function createEventEl(event) {
    var recent = isRecent(event.timestamp);
    var div = document.createElement('div');
    div.className = 'feed-event' + (recent ? '' : ' muted');
    div.setAttribute('data-event-id', event.id);
    div.setAttribute('data-timestamp', event.timestamp);

    var dot = document.createElement('div');
    dot.className = 'feed-event-dot ' + dotClass(event.type);
    div.appendChild(dot);

    var content = document.createElement('div');
    content.className = 'feed-event-content';

    var text = document.createElement('div');
    text.className = 'feed-event-text';
    var sourceSpan = document.createElement('span');
    sourceSpan.className = 'feed-event-source';
    sourceSpan.textContent = event.source;
    text.appendChild(sourceSpan);
    var desc = event.detail && event.detail.description ? event.detail.description : event.type.replace(/_/g, ' ');
    text.appendChild(document.createTextNode(' ' + desc));
    content.appendChild(text);

    var time = document.createElement('div');
    time.className = 'feed-event-time';
    time.textContent = relativeTime(event.timestamp);
    content.appendChild(time);

    div.appendChild(content);
    return div;
  }

  function refreshFade() {
    var events = feedBody.querySelectorAll('.feed-event');
    var needSep = false;
    var sepInserted = false;
    // Remove existing separators
    var seps = feedBody.querySelectorAll('.feed-time-sep');
    for (var i = 0; i < seps.length; i++) seps[i].remove();

    for (var j = 0; j < events.length; j++) {
      var ts = parseInt(events[j].getAttribute('data-timestamp'), 10);
      var recent = isRecent(ts);
      if (recent) {
        events[j].classList.remove('muted');
      } else {
        events[j].classList.add('muted');
        if (!sepInserted && !needSep) { needSep = true; }
      }
      if (needSep && !sepInserted) {
        var sep = document.createElement('div');
        sep.className = 'feed-time-sep';
        sep.textContent = 'Earlier';
        feedBody.insertBefore(sep, events[j]);
        sepInserted = true;
      }
      // Update relative timestamp text
      var timeEl = events[j].querySelector('.feed-event-time');
      if (timeEl) timeEl.textContent = relativeTime(ts);
    }
  }

  function setConnected(connected) {
    if (connected) {
      statusDot.className = 'feed-status-dot live';
      statusLabel.textContent = 'Live';
    } else {
      statusDot.className = 'feed-status-dot idle';
      statusLabel.textContent = 'Idle';
    }
  }

  var lastEventId = null;
  var es;

  function connect() {
    es = new EventSource('/events');

    es.onopen = function() {
      setConnected(true);
    };

    es.onmessage = function(e) {
      var event;
      try { event = JSON.parse(e.data); } catch(err) { return; }

      lastEventId = e.lastEventId || event.id;

      // Check if event already rendered (replay dedup)
      if (feedBody.querySelector('[data-event-id="' + event.id + '"]')) return;

      // Hide empty state
      if (feedEmpty) feedEmpty.style.display = 'none';

      // Prepend new event (reverse chronological)
      var el = createEventEl(event);
      var firstChild = feedBody.querySelector('.feed-event, .feed-time-sep');
      if (firstChild) {
        feedBody.insertBefore(el, firstChild);
      } else {
        feedBody.appendChild(el);
      }

      // Re-evaluate fade classification
      refreshFade();
    };

    es.onerror = function() {
      setConnected(false);
      // EventSource auto-reconnects. Browser sends Last-Event-ID header automatically.
    };
  }

  connect();

  // On WebSocket reload, the page refreshes and EventSource reconnects with Last-Event-ID,
  // rebuilding the feed from the ring buffer replay (AC12).
})();
</script>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: EventSource injection test PASSES. All existing tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "feat(PM-091): EventSource client for real-time feed updates + reconnect replay"
```

---

## Task 4: End-to-End Validation

**Files:**
- Test: manual browser validation
- Test: `tests/server.test.js`

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/server.test.js`
Expected: ALL tests pass — existing + feed panel + layout regression + EventSource.

- [ ] **Step 2: Write integration test — verify feed panel features in HTML**

Add to `tests/server.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Activity Feed — end-to-end: verify feed panel features
// ---------------------------------------------------------------------------

test('Feed panel includes reconnect and temporal fade logic', async () => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: strategy\n---\n# Strategy\n',
  });
  try {
    const { port, close } = await startDashboardServer(pmDir);
    try {
      const { body } = await httpGet(port, '/');
      // Verify reconnect support
      assert.ok(body.includes('lastEventId'), 'must track lastEventId for reconnect');
      assert.ok(body.includes('data-event-id'), 'must set data-event-id for dedup');
      // Verify temporal fade logic
      assert.ok(body.includes('refreshFade'), 'must include fade refresh function');
      assert.ok(body.includes('Earlier'), 'must include Earlier separator text');
      // Verify responsive CSS
      assert.ok(body.includes('max-width: 1024px'), 'must include 1024px breakpoint');
    } finally {
      await close();
    }
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `node --test tests/server.test.js`
Expected: Integration test PASSES.

- [ ] **Step 4: Manual browser validation**

Start the server and open the dashboard:

```bash
# Terminal 1: Open dashboard
pm:view

# Terminal 2: Post test events
PORT=$(bash scripts/find-dashboard-port.sh "$(pwd)")

# Post a recent event
curl -X POST http://localhost:$PORT/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"tests_passed","source":"terminal-1","timestamp":'$(date +%s000)',"detail":{"description":"tests passed (8/8)"}}'

# Post an older event (5 minutes ago)
curl -X POST http://localhost:$PORT/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"pr_created","source":"terminal-2","timestamp":'$(($(date +%s) - 300))000',"detail":{"description":"PR #47 created"}}'
```

Verify:
- Feed panel appears as 260px right sidebar on Home page
- "Live" indicator pulses green when SSE connected
- Recent event at full contrast, older event faded with "Earlier" separator
- Panel hidden when browser window < 1024px
- Feed panel does NOT appear on Backlog or Research pages
- On page reload, events replay from ring buffer

- [ ] **Step 5: Commit any final adjustments**

```bash
git add scripts/server.js tests/server.test.js
git commit -m "test(PM-091): end-to-end validation for activity feed panel"
```
