# Plan: PM-104 — Canvas infrastructure and sidebar navigation

## Summary

Generalize the groom companion to a canvas system. Add canvas tab bar on dashboard home, `canvas_update` SSE event, and hot-reload for any skill's canvas.

## Tasks

### Task 1: Generalize handleSessionPage override path

Currently `handleSessionPage()` (server.js:2875) hardcodes `groom-` prefix:
```js
const overridePath = path.join(sessionsDir, 'groom-' + slug, 'current.html');
```

Change to scan `.pm/sessions/` for ANY directory matching `*-{slug}` or just `{slug}`:
- Check `groom-{slug}/current.html`
- Check `dev-{slug}/current.html`  
- Check `epic-{slug}/current.html`
- Check `{slug}/current.html` (generic)

First match wins. This makes the route work for any skill's canvas.

### Task 2: Add canvas discovery function

New function `discoverCanvases(pmDir)` that scans `.pm/sessions/` for directories containing `current.html`. Returns array of `{ slug, type, label, mtime }`.

```js
function discoverCanvases(pmDir) {
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  return fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(sessionsDir, e.name, 'current.html')))
    .map(e => {
      const name = e.name; // e.g. "groom-my-feature"
      const dashIdx = name.indexOf('-');
      const type = dashIdx > 0 ? name.slice(0, dashIdx) : 'session';
      const slug = dashIdx > 0 ? name.slice(dashIdx + 1) : name;
      const mtime = fs.statSync(path.join(sessionsDir, e.name, 'current.html')).mtimeMs;
      return { dirName: name, slug, type, label: humanizeSlug(slug), mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}
```

### Task 3: Render canvas tab bar on home page

In `handleDashboardHome()`, call `discoverCanvases()`. If canvases exist, render a tab bar between the pulse score and stat cards:

```html
<div class="canvas-tabs">
  <a href="/session/{slug}" class="canvas-tab">
    <span class="canvas-tab-type">{type}</span>
    <span class="canvas-tab-label">{label}</span>
  </a>
</div>
```

CSS: horizontal scroll, pills/chips style, type badge + label.

### Task 4: Add `canvas_update` SSE event type

The emit-event.sh script already posts to `/events`. Skills will emit:
```json
{ "type": "canvas_update", "slug": "groom-my-feature", "label": "My Feature" }
```

On the client side, add a listener in the home page EventSource handler:
- If `canvas_update` and currently viewing that canvas → reload content area
- If `canvas_update` and on home page → refresh canvas tab bar

### Task 5: Hot-reload on /session/{slug} page

Add client-side JS to the session page that:
1. Connects to SSE `/events`
2. Listens for `canvas_update` events matching current slug
3. On match, fetches `/session/{slug}` and replaces body content
4. Fade transition (150ms) to avoid flash

### Task 6: CSS for canvas tabs

```css
.canvas-tabs { display:flex; gap:0.5rem; overflow-x:auto; padding:0.5rem 0 1rem; }
.canvas-tab { display:flex; align-items:center; gap:0.375rem; padding:0.375rem 0.75rem;
  background:var(--surface); border:1px solid var(--border); border-radius:999px;
  font-size:0.8125rem; text-decoration:none; color:var(--text); white-space:nowrap; }
.canvas-tab-type { font-size:0.6875rem; font-weight:600; text-transform:uppercase;
  color:var(--text-muted); }
```

### Task 7: Tests

- Test: home page shows canvas tabs when canvases exist
- Test: home page hides canvas tabs when no canvases
- Test: session page serves current.html for non-groom canvases
- Run full suite: no regressions

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js` | discoverCanvases(), canvas tabs in home, generalized session route, SSE hot-reload JS, CSS |
| `tests/server.test.js` | Canvas tab tests |
