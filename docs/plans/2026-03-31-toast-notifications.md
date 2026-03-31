# PM-092: Toast Notifications for Milestone Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface milestone SSE events (tests_passed, pr_created, review_done, merged) as brief, auto-dismissing toast notifications in the dashboard bottom-right corner.

**Architecture:** Two additions to `scripts/server.js`: (1) toast CSS appended to `DASHBOARD_CSS` (position fixed, slide-in keyframes, stacking rules), and (2) toast JavaScript injected into the `dashboardPage()` template's existing `<script>` block — connects to the SSE `/events` endpoint, filters for milestone types, creates/animates/dismisses toast DOM elements, and manages a 3-toast queue. No new files. All self-contained in the existing server module.

**Tech Stack:** Vanilla JavaScript, CSS animations, SSE EventSource API

---

## Upstream Context

> Injected from research at `pm/research/sse-event-bus/findings.md`.

### Key Findings
- Toast for celebrations, not for everything — reserve for milestone events only
- Auto-dismiss without user action, 3-5 seconds, subtle slide-in animation
- No interactive elements in auto-dismissing toasts (WCAG violation per Carbon Design System)
- Neutral styling, respect `prefers-reduced-motion`
- Queue multiple toasts without overlapping, max 3 visible

### Design Decisions
- Shares EventSource with feed panel if present, or creates independent one
- Toast is cosmetic — if it fails, the event still appears in the feed
- No new dependencies; EventSource is native browser API

---

## Current State

What **already exists** (no changes needed):

| Feature | Location |
|---------|----------|
| `DASHBOARD_CSS` — all CSS variables including `--surface`, `--border`, `--shadow-md` | `server.js:428-1069` |
| `dashboardPage()` — HTML shell with `<script>` block for WebSocket + theme toggle | `server.js:1073-1151` |
| `.main-content` — flex: 1 panel right of sidebar, where toasts anchor | `server.js:1049` |
| WebSocket reload client — injected at `server.js:1124-1148` | `server.js:1124-1148` |
| `prefers-reduced-motion` — not yet used, but standard media query | CSS spec |
| PM-090 SSE endpoint — `GET /events` serving `text/event-stream` | Planned in `docs/plans/2026-03-31-sse-event-bus-core.md` |

What **needs building:**

| AC | Gap | Task |
|----|-----|------|
| AC1, AC5, AC6, AC9 | Toast CSS — positioning, animation keyframes, reduced-motion, neutral styling | Task 1 |
| AC2, AC3, AC4, AC7, AC8, AC10 | Toast JavaScript — EventSource listener, milestone filter, DOM creation, dismiss timer, queue | Task 2 |
| All | End-to-end validation with curl POST + browser | Task 3 |

---

## Task 1: Toast CSS

**Files:**
- Modify: `scripts/server.js:1067-1069` (append toast styles before closing backtick of `DASHBOARD_CSS`)

- [ ] **Step 1: Add toast CSS to DASHBOARD_CSS**

Insert the following CSS before the closing `` `; `` on line 1069 of `DASHBOARD_CSS`:

```css

/* Toast notifications */
.toast-container {
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  z-index: 100;
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
  pointer-events: none;
}
.toast {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: 0.625rem 1rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text);
  max-width: 320px;
  opacity: 0;
  transform: translateY(8px);
  animation: toast-in 300ms ease-out forwards;
  pointer-events: auto;
}
.toast-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}
.toast-icon svg {
  width: 16px;
  height: 16px;
}
.toast.toast-out {
  animation: toast-out 200ms ease-in forwards;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(8px); }
}
@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .toast.toast-out {
    animation: none;
    opacity: 0;
  }
}
```

- [ ] **Step 2: Verify CSS renders correctly**

Run: `node --test tests/server.test.js`
Expected: All existing tests PASS (CSS changes are additive, no breakage).

Open the dashboard in a browser and inspect that `.toast-container` styles are present in the rendered `<style>` tag.

- [ ] **Step 3: Commit**

```bash
git add scripts/server.js
git commit -m "feat(PM-092): add toast notification CSS to DASHBOARD_CSS"
```

---

## Task 2: Toast JavaScript — EventSource, Filter, DOM, Queue

**Files:**
- Modify: `scripts/server.js:1122-1148` (extend the HTML template and `<script>` block inside `dashboardPage()`)

The toast JS goes inside the existing IIFE in the `dashboardPage()` template, after the theme toggle code (line 1147) and before the closing `})();`.

- [ ] **Step 1: Add toast container element to the HTML template**

In `dashboardPage()`, insert a toast container `<div>` right before the closing `</div>` of `.app-layout`. Modify line 1122-1123 of `server.js`:

Find:
```javascript
  </main>
</div>
<script>
```

Replace with:
```javascript
  </main>
  <div class="toast-container" id="toast-container" aria-live="polite" aria-atomic="false"></div>
</div>
<script>
```

This places the container as a sibling of `.main-content` inside `.app-layout`, so it's fixed to the viewport bottom-right but visually associated with the main area (not the sidebar).

- [ ] **Step 2: Add toast JavaScript inside the existing script block**

Insert the following code after the theme toggle event listener (line 1146: `btn.addEventListener(...)`) and before the closing `})();` (line 1147):

```javascript
  // ---- Toast Notifications (PM-092) ----
  // Icon SVG strings per milestone type — these are static, trusted templates
  var TOAST_ICONS = {
    tests_passed: '<svg viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    pr_created: '<svg viewBox="0 0 16 16" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v8m0 0a2 2 0 104 0M12 14V6m0 0a2 2 0 10-4 0"/></svg>',
    review_done: '<svg viewBox="0 0 16 16" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8.5l2 2 3.5-4"/></svg>',
    merged: '<svg viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v4a4 4 0 004 4h4M8 10l4-4M8 10l4 4"/></svg>'
  };
  var TOAST_LABELS = {
    tests_passed: 'Tests passed',
    pr_created: 'PR created',
    review_done: 'Review done',
    merged: 'Merged'
  };

  var toastContainer = document.getElementById('toast-container');
  var activeToasts = [];
  var MAX_TOASTS = 3;

  function showToast(eventData) {
    if (!TOAST_ICONS[eventData.type]) return;

    // Build message: use detail.message if provided, otherwise use default label
    var msg = (eventData.detail && eventData.detail.message) || TOAST_LABELS[eventData.type];
    // Enforce max 10 words
    var words = msg.split(/\\s+/).slice(0, 10);
    msg = words.join(' ');

    // Dismiss oldest if at max
    while (activeToasts.length >= MAX_TOASTS) {
      dismissToast(activeToasts[0]);
    }

    // Build toast DOM safely — no innerHTML with user data
    var el = document.createElement('div');
    el.className = 'toast';

    var iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    // Icon SVGs are trusted static strings defined above, not user input
    iconSpan.innerHTML = TOAST_ICONS[eventData.type];

    var textSpan = document.createElement('span');
    textSpan.textContent = msg;

    el.appendChild(iconSpan);
    el.appendChild(textSpan);
    toastContainer.appendChild(el);

    // Calculate dismiss duration: 500ms per word + 1000ms buffer, min 3s, max 5s
    var duration = Math.min(Math.max(words.length * 500 + 1000, 3000), 5000);

    var entry = { el: el, timer: null };
    activeToasts.push(entry);

    entry.timer = setTimeout(function() { dismissToast(entry); }, duration);
  }

  function dismissToast(entry) {
    if (!entry || !entry.el || !entry.el.parentNode) {
      activeToasts = activeToasts.filter(function(t) { return t !== entry; });
      return;
    }
    clearTimeout(entry.timer);
    entry.el.classList.add('toast-out');

    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var removalDelay = reducedMotion ? 0 : 200;

    setTimeout(function() {
      if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
      activeToasts = activeToasts.filter(function(t) { return t !== entry; });
    }, removalDelay);
  }

  // Connect to SSE — independent EventSource, filters for milestone types
  if (typeof EventSource !== 'undefined') {
    var evtSource = new EventSource('/events');
    evtSource.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (TOAST_ICONS[data.type]) {
          showToast(data);
        }
      } catch(err) {}
    };
    evtSource.onerror = function() {
      // SSE auto-reconnects; no action needed
    };
  }
```

**Security note:** The `iconSpan.innerHTML` assignment uses only trusted, static SVG strings defined in the `TOAST_ICONS` object — never user-supplied data. The message text uses `textContent` to prevent XSS.

- [ ] **Step 3: Run tests to verify no breakage**

Run: `node --test tests/server.test.js`
Expected: All existing tests PASS. The JS is template code — it only executes in the browser, not during Node tests.

- [ ] **Step 4: Commit**

```bash
git add scripts/server.js
git commit -m "feat(PM-092): toast notification JS — EventSource listener, queue, dismiss"
```

---

## Task 3: End-to-End Validation

**Files:**
- Test: manual validation via curl + browser
- No code changes expected (fix-forward if issues found)

**Prerequisite:** PM-090 (SSE Event Bus Core) must be implemented first. The `GET /events` SSE endpoint and `POST /events` handler must be live.

- [ ] **Step 1: Start dashboard server**

```bash
cd /Users/soelinmyat/Projects/pm && node scripts/server.js
```

- [ ] **Step 2: Open dashboard in browser**

Navigate to `http://localhost:<port>/` (use port from server output). Open browser DevTools to the Elements panel.

Verify:
- `<div class="toast-container" id="toast-container">` exists in the DOM
- `.toast-container` has `position: fixed; bottom: 1.5rem; right: 1.5rem;`
- No toasts visible yet

- [ ] **Step 3: Post a milestone event via curl**

```bash
PORT=$(bash scripts/find-dashboard-port.sh "$(pwd)")
curl -X POST http://localhost:$PORT/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"tests_passed","source":"terminal-1","timestamp":'"$(date +%s000)"',"detail":{"message":"All 42 tests passed"}}'
```

Expected in browser:
- Toast slides in bottom-right with green checkmark + "All 42 tests passed"
- Auto-dismisses after ~3.5s (4 words * 500ms + 1000ms = 3000ms, clamped to min 3s)

- [ ] **Step 4: Test queue behavior — post 4 events rapidly**

```bash
PORT=$(bash scripts/find-dashboard-port.sh "$(pwd)")
for TYPE in tests_passed pr_created review_done merged; do
  curl -s -X POST http://localhost:$PORT/events \
    -H 'Content-Type: application/json' \
    -d '{"type":"'$TYPE'","source":"terminal-1","timestamp":'"$(date +%s000)"'}' &
done
wait
```

Expected: Max 3 toasts visible. When 4th arrives, oldest is dismissed first.

- [ ] **Step 5: Test reduced-motion**

In browser DevTools, enable "prefers-reduced-motion: reduce" via Rendering tab. Post another event.

Expected: Toast appears instantly (no slide animation).

- [ ] **Step 6: Test non-milestone events are ignored**

```bash
PORT=$(bash scripts/find-dashboard-port.sh "$(pwd)")
curl -X POST http://localhost:$PORT/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"tool_call","source":"terminal-1","timestamp":'"$(date +%s000)"'}'
```

Expected: No toast appears. Feed shows the event (once PM-091 is implemented), but toast filters it out.

- [ ] **Step 7: Commit any fixes**

```bash
git add scripts/server.js
git commit -m "fix(PM-092): toast notification adjustments from E2E validation"
```

(Skip this step if no fixes needed.)
