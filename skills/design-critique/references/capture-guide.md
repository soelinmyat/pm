# Capture Guide

Reference for capturing screenshots from real running applications.

## Platform Detection

```
Check: does {APP_PATH}/app.config.ts or {APP_PATH}/app.json exist?
  YES -> PLATFORM = "rn" (React Native / Expo)
  NO  -> Check: does package.json contain "expo" or "react-native"?
    YES -> PLATFORM = "rn"
    NO  -> PLATFORM = "web"
```

## Server Lifecycle

### Web (Rails API + Vite Dev Server)

```bash
# Start API (if not already running)
pgrep -f 'rails.*server' > /dev/null || (cd apps/api && bin/rails s -p 3000 &)

# Start Vite dev server (if not already running)
pgrep -f 'vite' > /dev/null || (cd apps/web-client && pnpm dev --port 5173 &)

# Health check (wait up to 30 seconds)
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/healthz > /dev/null 2>&1 && break
  sleep 1
done
curl -sf http://localhost:5173 > /dev/null 2>&1 || echo "Vite not ready"
```

### Mobile (Expo Dev Server)

```bash
# Start Expo (if not already running)
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)

# Wait for Metro bundler
sleep 5
```

### Simulator/Emulator

For mobile, verify a device is available:

```bash
# iOS
xcrun simctl list devices booted | grep -q "Booted" || echo "No iOS simulator booted"

# Android
adb devices | grep -q "device$" || echo "No Android device connected"
```

## Authentication (Web)

Playwright MCP logs in via the real login flow using the seed user credentials. No mock tokens.

```
# Using Playwright MCP tools:
1. browser_navigate to http://localhost:5173/login
2. browser_type email field with "design-review@example.com"
3. browser_type password field with "password123"
4. browser_click submit button
5. browser_navigate to authenticated route — verify not redirected to login
```

The session persists across all subsequent interactions in the same browser context. No need to re-authenticate between pages.

## Web Capture (Playwright MCP)

### Capture sequence

```
1. Ensure servers running (health check)
2. Run seed: cd apps/api && bin/rails design:seed:{feature_slug}
3. Open browser, log in as seed user
4. For each target page:
   a. browser_navigate to URL
   b. browser_screenshot at desktop width (1440px)
   c. browser_resize to 768px → browser_screenshot (if responsive matters)
   d. browser_resize to 375px → browser_screenshot (if responsive matters)
   e. Capture interactive states (browser_click to open modals, expand sections)
5. Save all screenshots to /tmp/design-review/{feature}/
6. Write manifest
```

### Viewport sizes

| Name    | Width  | When to use                              |
|---------|--------|------------------------------------------|
| Desktop | 1440px | Always                                   |
| Tablet  | 768px  | When layout has responsive breakpoints   |
| Mobile  | 375px  | When layout has responsive breakpoints   |

### Limits

- Max 10 screenshots per capture round
- Overwritten each round (designers always see latest)

## Mobile Capture (Maestro MCP)

### Capture sequence

```
1. Ensure Expo + simulator running
2. Run seed: cd apps/api && bin/rails design:seed:{feature_slug}
3. Use Maestro MCP tools:
   - launch_app: Start/restart the app with clearState
   - tap_on: Navigate to target screens
   - take_screenshot: Capture each state
4. Save screenshots to /tmp/design-review/{feature}/
5. Write manifest
```

### Maestro MCP tools reference

| Tool                    | Purpose                           |
|-------------------------|-----------------------------------|
| `launch_app`            | Start app, optionally clear state |
| `tap_on`                | Tap a UI element by text or ID    |
| `input_text`            | Type into a field                 |
| `take_screenshot`       | Capture current screen            |
| `inspect_view_hierarchy`| Debug: see all elements           |
| `back`                  | Press back button                 |

### Screenshot naming

```
01-{screen}-default.png
02-{screen}-scrolled.png
03-{screen}-{state}.png
```

## Manifest Format

After capture, write a manifest file listing what each screenshot shows:

```markdown
# Design Review Manifest

**Feature:** {feature_slug}
**Platform:** {web | mobile}
**Captured:** {timestamp}
**Seed task:** design:seed:{feature_slug}

## Screenshots

| File | Page/Screen | Viewport | State | Description |
|------|-------------|----------|-------|-------------|
| 01-work-orders-desktop.png | /work-orders | 1440px | Default | Work order list with all SLA states |
| 02-work-orders-tablet.png | /work-orders | 768px | Default | Tablet responsive layout |
| 03-work-orders-red-detail.png | /work-orders/123 | 1440px | Red SLA | Detail view of breached task |
| ... | ... | ... | ... | ... |
```

## Enriched Capture (after screenshots)

After all screenshots for a page are captured, collect two additional artifacts that give designer agents hard data instead of visual guesses.

### Accessibility Snapshot (for Designer B)

Use Playwright MCP's `browser_snapshot` tool on each page after the screenshot is taken. This returns the accessibility tree: element roles, accessible names, states, tab order, ARIA attributes.

```
# After browser_screenshot for each page:
browser_snapshot  # returns full accessibility tree
```

Save the output to `/tmp/design-review/{feature}/a11y-snapshot-{page-slug}.md`.

This gives Designer B concrete data for WCAG findings: missing aria-labels, broken tab order, missing landmarks, elements without accessible names. No more guessing from PNGs.

### DOM Measurement Audit (for Designer C)

After screenshots, run a measurement script via `browser_evaluate` that walks visible elements and compares computed styles against the project's design tokens.

**Step 1:** Read the project's token file (`tokens.ts`, `tailwind.config.ts`, `theme.ts`, or CSS variables) and extract the token scales (spacing, typography, color, border-radius, shadow).

**Step 2:** For each page, run this measurement via `browser_evaluate`:

```javascript
(() => {
  const elements = document.querySelectorAll(
    'h1,h2,h3,h4,h5,h6,p,span,a,button,input,select,textarea,label,' +
    '[class*="card"],[class*="modal"],[class*="drawer"],[class*="dialog"],' +
    '[class*="badge"],[class*="chip"],[class*="tag"],' +
    '[role="button"],[role="link"],[role="heading"]'
  );
  const results = [];
  elements.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // skip invisible
    const cs = getComputedStyle(el);
    results.push({
      tag: el.tagName.toLowerCase(),
      className: el.className?.toString().slice(0, 120) || '',
      text: (el.textContent || '').trim().slice(0, 60),
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
      gap: cs.gap,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
      width: `${Math.round(rect.width)}px`,
      height: `${Math.round(rect.height)}px`,
    });
  });
  return JSON.stringify(results, null, 2);
})()
```

**Step 3:** Compare measurements against the token scales from Step 1. Write a structured report:

```markdown
# DOM Measurement Audit

**Page:** {page}
**Viewport:** {viewport}
**Token source:** {token file path}

## Token Mismatches

| Element | Property | Actual | Nearest Token | Token Value | Match |
|---------|----------|--------|---------------|-------------|-------|
| h2.card-title | font-size | 14px | --text-base | 16px | MISMATCH |
| div.form-group | gap | 8px | --gap-field | 16px | MISMATCH |
| ... | ... | ... | ... | ... | OK |

## Hardcoded Values (no matching token)

| Element | Property | Value |
|---------|----------|-------|
| span.badge | background-color | #3b82f6 |
| ... | ... | ... |

## Summary
- {N} elements measured
- {N} token mismatches
- {N} hardcoded values with no matching token
```

Save to `/tmp/design-review/{feature}/dom-audit-{page-slug}.md`.

Run the measurement at desktop viewport (1440px). One audit per page is sufficient since token compliance is viewport-independent.

### Component Pattern Inventory (for Designer C)

After all pages are captured, scan the rendered DOM for repeated component patterns:

```javascript
(() => {
  const patterns = {};
  const selectors = [
    '[class*="drawer"]', '[class*="modal"]', '[class*="dialog"]',
    '[class*="card"]', '[class*="panel"]', '[class*="sheet"]',
    '[class*="dropdown"]', '[class*="popover"]', '[class*="tooltip"]',
    '[role="dialog"]', '[role="alertdialog"]'
  ];
  selectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    els.forEach(el => {
      const cs = getComputedStyle(el);
      const key = sel.replace(/[^a-z]/g, '');
      if (!patterns[key]) patterns[key] = [];
      patterns[key].push({
        className: el.className?.toString().slice(0, 120) || '',
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
        backgroundColor: cs.backgroundColor,
        width: `${Math.round(el.getBoundingClientRect().width)}px`,
      });
    });
  });
  // Only return patterns with 2+ instances
  const dupes = {};
  for (const [k, v] of Object.entries(patterns)) {
    if (v.length >= 2) dupes[k] = v;
  }
  return JSON.stringify(dupes, null, 2);
})()
```

If duplicates are found, save to `/tmp/design-review/{feature}/pattern-inventory.md` with a comparison table showing how instances differ.

### Manifest Update

Add these enriched artifacts to the manifest:

```markdown
## Enriched Artifacts

| File | Type | Description |
|------|------|-------------|
| a11y-snapshot-{page}.md | Accessibility tree | Element roles, names, states, tab order |
| dom-audit-{page}.md | DOM measurement | Computed styles vs token values |
| pattern-inventory.md | Pattern scan | Repeated component patterns (if duplicates found) |
```

## Cleanup

Servers started by the agent are killed when the session ends:

```bash
# Kill by port (more reliable than PID)
lsof -ti :3000 | xargs kill 2>/dev/null || true   # Rails
lsof -ti :5173 | xargs kill 2>/dev/null || true   # Vite
lsof -ti :8081 | xargs kill 2>/dev/null || true   # Metro

# Kill orphaned processes
pkill -f 'node.*vitest' 2>/dev/null || true
pkill -f 'node.*jest' 2>/dev/null || true
```

Cleanup happens at session end, not between phases. Servers stay running for the duration of the critique.
