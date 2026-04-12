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

After all screenshots for a page are captured, collect two additional artifacts that give the reviewer hard data instead of visual guesses.

### Accessibility Snapshot

Use Playwright MCP's `browser_snapshot` tool on each page after the screenshot is taken. This returns the accessibility tree: element roles, accessible names, states, tab order, ARIA attributes.

```
# After browser_screenshot for each page:
browser_snapshot  # returns full accessibility tree
```

Save the output to `/tmp/design-review/{feature}/a11y-snapshot-{page-slug}.md`.

Concrete data for WCAG findings: missing aria-labels, broken tab order, missing landmarks, elements without accessible names. No guessing from PNGs.

### Visual Consistency Audit

**Purpose:** Detect visual inconsistencies — elements that should look the same but don't. This is NOT token compliance (linters catch hardcoded values). This catches cases where every value is a valid token but the *combination* produces inconsistent results: a card with `container-lg` padding on top and `container-sm` on bottom, sibling sections using different spacing tokens for the same role, headings at the same level styled differently across pages.

**The test:** Group elements by visual role. Within each group, flag variance.

For each page, run this via `browser_evaluate`:

```javascript
(() => {
  const inconsistencies = {};
  const hierarchy = [];
  const asymmetry = [];

  function desc(el) {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className?.toString() || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const text = (el.textContent || '').trim().slice(0, 30);
    return `${tag}${cls ? '.' + cls : ''}${text ? ' "' + text + '"' : ''}`;
  }

  function borderShorthand(cs) {
    const w = cs.borderTopWidth;
    return w === '0px' ? 'none' : `${w} ${cs.borderTopStyle} ${cs.borderTopColor}`;
  }

  function getStyles(el, type) {
    const cs = getComputedStyle(el);
    const base = { _el: desc(el) };
    const shared = { opacity: cs.opacity };
    if (type === 'typography') {
      return { ...base, ...shared,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight, color: cs.color,
        letterSpacing: cs.letterSpacing,
        textTransform: cs.textTransform, textDecoration: cs.textDecorationLine,
      };
    }
    if (type === 'interactive') {
      return { ...base, ...shared,
        height: `${Math.round(el.getBoundingClientRect().height)}px`,
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        borderRadius: cs.borderRadius, border: borderShorthand(cs),
        backgroundColor: cs.backgroundColor,
        textTransform: cs.textTransform, textDecoration: cs.textDecorationLine,
      };
    }
    // container
    return { ...base, ...shared,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      borderRadius: cs.borderRadius, border: borderShorthand(cs),
      gap: cs.gap, overflow: cs.overflow,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow === 'none' ? '' : cs.boxShadow,
    };
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // --- Group 1: Headings by level (typography consistency) ---
  // Collect ALL heading data for hierarchy check, even single instances
  const headingData = {};
  ['h1','h2','h3','h4','h5','h6'].forEach(tag => {
    const els = [...document.querySelectorAll(tag)].filter(visible);
    if (els.length === 0) return;
    const styles = els.map(el => getStyles(el, 'typography'));
    headingData[tag] = styles;
    // Within-level consistency (needs 2+)
    if (els.length >= 2) checkGroup(tag, styles);
  });

  // --- Typography hierarchy check (cross-level) ---
  const levels = Object.keys(headingData).sort(); // h1, h2, h3...
  for (let i = 0; i < levels.length - 1; i++) {
    const upper = levels[i];   // e.g. h1
    const lower = levels[i+1]; // e.g. h2
    // Use the majority (most common) fontSize for each level
    const upperSize = majorityValue(headingData[upper], 'fontSize');
    const lowerSize = majorityValue(headingData[lower], 'fontSize');
    const upperPx = parseFloat(upperSize);
    const lowerPx = parseFloat(lowerSize);
    if (lowerPx > upperPx) {
      hierarchy.push({ issue: 'inverted', upper, lower, property: 'fontSize',
        upperValue: upperSize, lowerValue: lowerSize,
        detail: `${lower} (${lowerSize}) is larger than ${upper} (${upperSize})` });
    } else if (upperPx === lowerPx) {
      hierarchy.push({ issue: 'collapsed', upper, lower, property: 'fontSize',
        value: upperSize,
        detail: `${upper} and ${lower} are both ${upperSize}` });
    }
    // Weight: upper should be >= lower (or at least not dramatically less)
    const upperWeight = parseInt(majorityValue(headingData[upper], 'fontWeight'));
    const lowerWeight = parseInt(majorityValue(headingData[lower], 'fontWeight'));
    if (lowerWeight > upperWeight && lowerWeight - upperWeight >= 200) {
      hierarchy.push({ issue: 'weight-inverted', upper, lower, property: 'fontWeight',
        upperValue: String(upperWeight), lowerValue: String(lowerWeight),
        detail: `${lower} (${lowerWeight}) is bolder than ${upper} (${upperWeight})` });
    }
  }
  // Body vs smallest heading
  const bodyEls = [...document.querySelectorAll('p')].filter(visible);
  if (bodyEls.length > 0 && levels.length > 0) {
    const bodySize = parseFloat(getComputedStyle(bodyEls[0]).fontSize);
    const smallest = levels[levels.length - 1];
    const smallestSize = parseFloat(majorityValue(headingData[smallest], 'fontSize'));
    if (bodySize >= smallestSize) {
      hierarchy.push({ issue: 'body-exceeds-heading', property: 'fontSize',
        bodyValue: `${bodySize}px`, heading: smallest, headingValue: `${smallestSize}px`,
        detail: `Body text (${bodySize}px) is >= ${smallest} (${smallestSize}px)` });
    }
  }

  function majorityValue(styles, prop) {
    const counts = {};
    styles.forEach(s => { counts[s[prop]] = (counts[s[prop]] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // --- Group 2: Interactive elements (buttons, inputs) ---
  ['button','input','select','textarea'].forEach(tag => {
    const els = [...document.querySelectorAll(tag)].filter(visible);
    if (els.length < 2) return;
    checkGroup(tag, els.map(el => getStyles(el, 'interactive')));
  });

  // --- Group 3: Links styled as actions ---
  const linkEls = [...document.querySelectorAll('a')].filter(el => {
    if (!visible(el)) return false;
    const cs = getComputedStyle(el);
    // Only links that look like buttons or nav items (have padding or background)
    return parseFloat(cs.paddingTop) > 2 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
  });
  if (linkEls.length >= 2) {
    checkGroup('link-actions', linkEls.map(el => getStyles(el, 'interactive')));
  }

  // --- Group 4: Component patterns (cards, badges, panels) ---
  const componentGroups = [
    { name: 'card', sel: '[class*="card"]:not([class*="discard"])' },
    { name: 'badge', sel: '[class*="badge"],[class*="chip"],[class*="tag"]:not(meta):not(link)' },
    { name: 'panel', sel: '[class*="panel"],[class*="sheet"]' },
    { name: 'alert', sel: '[class*="alert"],[class*="banner"],[class*="toast"]' },
  ];
  componentGroups.forEach(({ name, sel }) => {
    try {
      const els = [...document.querySelectorAll(sel)].filter(visible);
      if (els.length < 2) return;
      checkGroup(`component:${name}`, els.map(el => getStyles(el, 'container')));
    } catch(e) { /* invalid selector, skip */ }
  });

  // --- Group 5: Sibling rhythm (children of flex/grid parents) ---
  document.querySelectorAll('*').forEach(parent => {
    const cs = getComputedStyle(parent);
    if (cs.display !== 'flex' && cs.display !== 'grid') return;
    if (!visible(parent)) return;
    const byTag = {};
    [...parent.children].filter(visible).forEach(child => {
      const tag = child.tagName.toLowerCase();
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(child);
    });
    for (const [tag, els] of Object.entries(byTag)) {
      if (els.length < 3) continue;
      const styles = els.map(el => {
        const s = getComputedStyle(el);
        return {
          _el: desc(el),
          opacity: s.opacity,
          height: `${Math.round(el.getBoundingClientRect().height)}px`,
          padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
          marginBottom: s.marginBottom, border: borderShorthand(s),
        };
      });
      checkGroup(`siblings:${desc(parent)}>${tag}`, styles);
    }
  });

  // --- Asymmetry check: containers with unbalanced padding ---
  document.querySelectorAll('div,section,article,aside,main,header,footer').forEach(el => {
    if (!visible(el)) return;
    const cs = getComputedStyle(el);
    const pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
    const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
    if (pt > 4 && pb > 4 && Math.abs(pt - pb) > 4) {
      asymmetry.push({ element: desc(el), axis: 'vertical',
        values: `top=${cs.paddingTop} bottom=${cs.paddingBottom}` });
    }
    if (pl > 4 && pr > 4 && Math.abs(pl - pr) > 4) {
      asymmetry.push({ element: desc(el), axis: 'horizontal',
        values: `left=${cs.paddingLeft} right=${cs.paddingRight}` });
    }
  });

  // --- Variance detection ---
  function checkGroup(name, members) {
    const props = Object.keys(members[0]).filter(k => k !== '_el');
    const variances = {};
    props.forEach(prop => {
      const counts = {};
      members.forEach(m => { counts[m[prop]] = (counts[m[prop]] || 0) + 1; });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted.length <= 1) return;
      variances[prop] = {
        majority: { value: sorted[0][0], count: sorted[0][1] },
        outliers: sorted.slice(1).flatMap(([value, count]) =>
          members.filter(m => m[prop] === value).map(m => ({
            element: m._el, value, majorityValue: sorted[0][0]
          }))
        ),
      };
    });
    if (Object.keys(variances).length > 0) {
      inconsistencies[name] = variances;
    }
  }

  // Cap asymmetry at 10 most significant
  asymmetry.sort((a, b) => {
    const diffA = Math.abs(parseFloat(a.values.split(' ')[0].split('=')[1]) -
                           parseFloat(a.values.split(' ')[1].split('=')[1]));
    const diffB = Math.abs(parseFloat(b.values.split(' ')[0].split('=')[1]) -
                           parseFloat(b.values.split(' ')[1].split('=')[1]));
    return diffB - diffA;
  });

  return JSON.stringify({
    inconsistencies,
    hierarchy,
    asymmetry: asymmetry.slice(0, 10),
    _meta: {
      groups_checked: Object.keys(inconsistencies).length,
      groups_with_variance: Object.values(inconsistencies).filter(v => Object.keys(v).length > 0).length,
      hierarchy_issues: hierarchy.length,
      asymmetric_elements: asymmetry.length,
    }
  }, null, 2);
})()
```

Save the raw JSON output to `/tmp/design-review/{feature}/consistency-{page-slug}.json`.

Then write a human-readable report:

```markdown
# Visual Consistency Audit

**Page:** {page}
**Viewport:** 1440px

## Typography Hierarchy

| Issue | Levels | Property | Detail |
|-------|--------|----------|--------|
| Inverted | h2 vs h3 | font-size | h3 (24px) is larger than h2 (20px) |
| Collapsed | h3 vs h4 | font-size | both 16px — no visual distinction |
| Body exceeds heading | p vs h4 | font-size | body (18px) >= h4 (16px) |
| Weight inverted | h2 vs h3 | font-weight | h3 (700) is bolder than h2 (400) |

## Group Inconsistencies

### {group name} ({N} instances)
| Property | Majority ({N}) | Outlier | Element |
|----------|---------------|---------|---------|
| font-size | 24px | 20px | h2.sidebar-title "Settings" |
| opacity | 1 | 0.8 | h2.muted-title "Archive" |
| textTransform | none | uppercase | h2.section-label "FILTERS" |

### component:card ({N} instances)
| Property | Majority ({N}) | Outlier | Element |
|----------|---------------|---------|---------|
| border | none | 1px solid rgb(...) | div.card.featured |
| overflow | visible | hidden | div.card.compact |

### siblings:div.list>li ({N} instances)
| Property | Majority ({N}) | Outlier | Element |
|----------|---------------|---------|---------|
| height | 48px | 64px | li.list-item "Long title..." |

## Asymmetric Padding

| Element | Axis | Values |
|---------|------|--------|
| div.hero-section | vertical | top=48px bottom=24px |
| section.card-body | horizontal | left=24px right=16px |

## Summary
- {N} groups checked, {N} with inconsistencies
- {N} hierarchy issues
- {N} elements with asymmetric padding
```

Save to `/tmp/design-review/{feature}/consistency-{page-slug}.md`.

Run at desktop viewport (1440px). One audit per page is sufficient.

**What this catches that linting can't:**
- h3 is visually larger than h2 — both use valid tokens, hierarchy is broken
- All h2s use valid tokens, but one section uses `text-xl` while others use `text-2xl`
- One card has `opacity: 0.8`, siblings are `1` — valid CSS, inconsistent visual weight
- Cards all use token spacing, but one uses `p-4` and another uses `p-6`
- One card has a border, sibling cards don't — inconsistent component treatment
- One container clips overflow, identical sibling scrolls
- Links styled as buttons have inconsistent text-decoration or text-transform
- List items in a flex container have inconsistent heights
- A section has `pt-8 pb-4` — valid tokens, unbalanced result
- Body text is the same size as the smallest heading — no visual distinction

**What this does NOT catch (leave to the reviewer):**
- Intentional variants (`.btn-sm` vs `.btn-lg` will flag — reviewer uses judgment)
- Cross-page consistency (script runs per page — reviewer compares across pages)
- Semantic appropriateness (script can't know if `text-sm` is right for a label)

### Manifest Update

Add enriched artifacts to the manifest:

```markdown
## Enriched Artifacts

| File | Type | Description |
|------|------|-------------|
| a11y-snapshot-{page}.md | Accessibility tree | Element roles, names, states, tab order |
| consistency-{page}.json | Raw consistency data | Full variance detection output |
| consistency-{page}.md | Consistency report | Typography hierarchy, group inconsistencies, asymmetric padding |
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
