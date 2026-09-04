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

The certifying helper launches a clean, disposable Chromium profile for every capture. Prepare a real, privacy-safe seeded application route that establishes the review principal without request mocks, browser-profile reuse, or credentials in the URL. A local-only single-use review-session endpoint is acceptable when it exercises the real application and stores no secret in retained evidence. If the product cannot expose the routed state to a clean profile safely, record a blocked capture; a screenshot from a separately authenticated browser is useful for diagnosis but is not certifying evidence.

## Trusted Web Capture

Route-schema-v2 web product UI uses `scripts/design-critique-capture.js`. It acquires the PNG, Chromium accessibility tree, DOM snapshot, page identity, native hit-test observations, and network ledger from one CDP target/session. It evaluates a closed declarative state assertion against the native browser observations, takes two internal screenshot samples, and publishes only after the observations, decoded pixels, URL, source, browser, and network state remain stable.

The routed subject surface is part of the capture identity. A certifying web surface is `/` or an origin-free absolute path made from slash-separated safe ASCII literal segments (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `-`) and named parameters such as `:id`. Wildcards, query strings, fragments, backslashes, empty segments, dot segments, and trailing slashes are not supported. A named parameter matches exactly one safe decoded segment. The requested, expected, and final URLs must share an origin and match that surface; redirects to a different path fail closed.

Create the assertion at the canonical path for the coverage row:

```json
{
  "schema_version": 2,
  "subject_id": "account-detail",
  "coverage_id": "account-primary-desktop",
  "state": "primary",
  "state_marker": {
    "locator": { "by": "test-id", "value": "account-state" },
    "attribute": "data-pm-state",
    "value": "primary"
  },
  "all": [
    {
      "locator": { "by": "role-name", "value": "button:Save changes" },
      "expect": { "kind": "visible" }
    }
  ]
}
```

`subject_id`, `coverage_id`, and `state` must exactly equal the routed coverage row. `state_marker` is mandatory, uses an `id` or `test-id` locator, and requires `data-pm-state` to equal that exact routed state. Every assertion includes at least one declarative guard. Error and loading assertions also require a visible semantic alert/progress status (or `aria-busy="true"` plus a `visible` guard on the same node for loading); focus and keyboard assertions require `focused` plus `visible` guards on the same node; disabled assertions require `disabled` or `aria-disabled="true"` plus a matching `visible` guard; and modal assertions require a visible dialog or alertdialog. This prevents an empty guard list or a generic assertion such as “the page has a heading” from certifying a materially different semantic state.

Allowed guard locators are `id`, `test-id`, and `role-name` (`role:accessible-name`). Allowed expectations are `exists`, `absent`, `visible`, `focused`, `attribute-equals` for the bounded attribute allowlist, and `accessible-name-equals`. JavaScript expressions and arbitrary CSS selectors are intentionally unsupported. If the state cannot be expressed, treat a manual capture as non-authoritative and block certification rather than weakening the assertion.

For the state marker and every `visible` guard, visible means the node and its ancestors are not hidden, use visible layout, have at least 1% effective multiplied opacity, survive ancestor overflow clipping, and intersect the visual viewport. The helper also asks Chromium to hit-test the center and four inset points; at least one point must hit the asserted node or one of its descendants. Ordinary nested content remains valid. A sibling overlay fails, and one positioned descendant branch covering at least 90% of the marker and winning every sampled point also fails. This sampled hit test is deterministic but is not a complete paint-order proof: irregular or partial occlusion between the five sample points can remain undetected.

### Capture sequence

```bash
node "$PM_PLUGIN_ROOT/scripts/design-critique-capture.js" \
  --root "{absolute-project-root}" \
  --route ".pm/dev-sessions/{slug}/design-critique/route.json" \
  --subject "account-detail" \
  --coverage "account-primary-desktop" \
  --capture "capture-account-primary-desktop-r1" \
  --url "http://127.0.0.1:5173/accounts/seeded-review" \
  --expect-url "http://127.0.0.1:5173/accounts/seeded-review" \
  --state-assertion ".pm/dev-sessions/{slug}/design-critique/state-assertions/account-primary-desktop.json" \
  --width 1440 \
  --height 900 \
  --out-dir ".pm/dev-sessions/{slug}/design-critique/round-1/capture-account-primary-desktop-r1" \
  --json
```

Repeat `--allow-origin "https://api.example.test"` only for origins the real page needs. The requested page origin is always included. Any other HTTP, HTTPS, or WebSocket origin fails the capture. The helper settles the network, keeps interception active through both screenshots and all native observations, performs a final browser barrier, disables interception, drains its handlers, and fails on any late request, overflow, or handler error. It also fails on redirect drift, a false or generic state assertion, a viewport mismatch, iframe content, changed source/browser/route/assertion bytes, a transparent, uniform, or near-blank screenshot, or differing decoded pixels between its two samples. Output paths are exclusive: recapture with a new capture ID instead of overwriting evidence.

Retained URL identities contain only `origin`, `pathname`, booleans indicating whether a query or fragment existed, and a SHA-256 of the full URL. Query and fragment values are never persisted in the manifest, raw page observation, network ledger, CLI output, or error details. Use privacy-safe seed URLs anyway: a digest is an identifier, not a license to put credentials in a URL.

The atomic bundle contains:

- `capture.png` — the only screenshot registered in `captures.json`
- `accessibility-tree-raw.json` — native Chromium AX-derived observations
- `dom-audit-raw.json` — native DOMSnapshot-derived measurements
- `network-ledger.json` — bounded, URL-redacted request records
- `capture.json` — the hash-bound capture observation manifest

Register `capture.json` as the capture row's `observation` binding. Then normalize both raw audits to files outside the immutable bundle directory and register those normalized files in `captures.json.evidence`:

```bash
node "$PM_PLUGIN_ROOT/scripts/design-critique-audit-normalize.js" \
  --root "{absolute-project-root}" \
  --raw ".pm/dev-sessions/{slug}/design-critique/round-1/capture-account-primary-desktop-r1/accessibility-tree-raw.json" \
  --output ".pm/dev-sessions/{slug}/design-critique/round-1/account-primary-desktop-a11y.json"

node "$PM_PLUGIN_ROOT/scripts/design-critique-audit-normalize.js" \
  --root "{absolute-project-root}" \
  --raw ".pm/dev-sessions/{slug}/design-critique/round-1/capture-account-primary-desktop-r1/dom-audit-raw.json" \
  --output ".pm/dev-sessions/{slug}/design-critique/round-1/account-primary-desktop-dom.json"
```

### Viewport sizes

| Label | Target | Accepted decoded PNG width | When to use |
|---|---:|---:|---|
| Desktop | 1440×900 | At least 1024 wide and 600 high | Primary state, always |
| Tablet | 768×1024 | 601–1023 wide and at least 600 high | When layout has a distinct breakpoint |
| Narrow | 375×812 | 320–600 wide and at least 480 high | Primary state, always |

Route schema v2 binds each web viewport label to the PNG's decoded dimensions and canonical decoded-RGBA pixel SHA-256. It requires at least 1% visible pixels plus meaningful decoded-pixel coverage, spatial coverage, color variety, and luminance range. Distinct active states at the same subject and viewport—and resolved product P0/P1 before/after pairs—must also have a material decoded-pixel-grid distance; changing one beacon pixel or re-encoding the same image does not count. A narrow capture of another state does not replace the primary narrow capture. Schema v1 is resume-only for routes that were already frozen—never author or downgrade a route to v1 to bypass these checks.

### Limits

- Max 20 screenshots per capture round; route coverage, not convenience, determines the exact count
- Preserve every cited round so before/after evidence remains verifiable
- The manifest's assurance level is `workflow-attested-non-cryptographic`. Its hashes make local evidence internally checkable; they are not signatures and do not prove who created the files. The checker independently re-hashes the evidence and revalidates the current browser executable plus committed Git HEAD/tree before accepting a local run.
- The helper proves capture-time consistency, not that a generic development server served the current Git commit or build. When that provenance matters, expose an application/build identifier and verify it with an additional declarative guard. This build/server identity is the remaining provenance limitation.
- Iframe documents are not certifiable in this version.

## Mobile Capture (Maestro MCP)

### Capture sequence

```
1. Ensure Expo + simulator running
2. Run seed: cd apps/api && bin/rails design:seed:{feature_slug}
3. Use Maestro MCP tools:
   - launch_app: Start/restart the app with clearState
   - tap_on: Navigate to target screens
   - take_screenshot: Capture each state
4. Copy accepted screenshots to `.pm/dev-sessions/{slug}/design-critique/round-{N}/`
5. Record the files and SHA-256 values in `captures.json`
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

Use the machine-readable `route.json` and `captures.json` contract in `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/evidence-contract.md`. Every screenshot maps to one coverage ID and records path, SHA-256, dimensions, kind, and full-page behavior. Markdown screenshot inventories are not gate evidence.

## Raw Audit Interpretation and Legacy Manual Probes

The trusted web helper already collects the two raw artifacts that give the reviewer hard data instead of visual guesses. Normalize those exact bundle files as shown above. The manual browser scripts later in this section are retained only for diagnosis and route-schema-v1 migration; they cannot produce a certifying schema-v2 web capture because their screenshot, DOM, and accessibility observations are separate operations without the capture manifest.

### Checker-compatible normalized audit envelope

Retain one bounded raw JSON probe for each audit. Generate the registered `accessibility-tree` or `dom-audit` only with `scripts/design-critique-audit-normalize.js`; never type or revise its booleans or findings. The helper derives them from the raw observations and binds the raw path plus SHA-256. `scripts/design-critique-check.js` rereads those bytes, reruns the same normalization, and requires the complete normalized object to match.

```bash
node "$PM_PLUGIN_ROOT/scripts/design-critique-audit-normalize.js" \
  --root "{absolute-project-root}" \
  --raw ".pm/dev-sessions/{slug}/design-critique/round-{N}/{subject}-a11y-raw.json" \
  --output ".pm/dev-sessions/{slug}/design-critique/round-{N}/{subject}-a11y.json"
```

The helper uses a 1 MiB raw-input budget, rejects unrecognized fields and unbounded collections, and writes atomically while re-attesting the raw file. A generated `accessibility-tree` envelope is:

```json
{
  "schema_version": 2,
  "subject_id": "account-detail",
  "commit": "<route.source.commit>",
  "capture_ids": ["capture-account-primary-desktop-r1"],
  "raw": {
    "path": ".pm/.../round-1/account-detail-a11y-raw.json",
    "sha256": "<64-hex>"
  },
  "checks": {
    "landmarks": true,
    "names": true,
    "focus_order": true
  },
  "findings": []
}
```

A generated `dom-audit` envelope is:

```json
{
  "schema_version": 2,
  "subject_id": "account-detail",
  "commit": "<route.source.commit>",
  "capture_ids": ["capture-account-primary-desktop-r1"],
  "raw": {
    "path": ".pm/.../round-1/account-detail-dom-raw.json",
    "sha256": "<64-hex>"
  },
  "checks": {
    "overflow": true,
    "edge_alignment": true,
    "hierarchy": true
  },
  "findings": []
}
```

The raw probe carries the route-bound subject, commit, and exactly one capture ID. The normalizer copies that identity into the audit. `findings` is derived from the measured roles, names, tab indexes, viewport widths, and issue rows; a derived `false` check blocks passing evidence until the UI is corrected and recaptured.

The `captures.json` evidence row contains only the normalized audit's manifest identity (`id`, `subject_id`, `kind`, `path`, and `sha256`). The normalized file binds the mandatory raw probe; do not register the raw file as a second evidence row.

### Accessibility Snapshot

For non-authoritative diagnosis or schema-v1 migration, use a browser accessibility snapshot for reviewer context and this structured probe for measurements. Never register this manually evaluated result as schema-v2 web evidence; use the trusted helper's native Chromium AX output instead. Replace the three identity placeholders before diagnostic execution.

```javascript
(() => {
  const subjectId = "{subject-id}";
  const commit = "{route.source.commit}";
  const captureIds = ["{one-active-capture-id-for-this-exact-state-and-viewport}"];
  const all = [...document.querySelectorAll("*")];
  const index = new Map(all.map((element, position) => [element, position]));

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      !element.closest('[aria-hidden="true"],[inert]')
    );
  }

  function locator(element) {
    if (element.id) return `${element.tagName.toLowerCase()}#${element.id}`.slice(0, 500);
    const testId = element.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`.slice(0, 500);
    return `${element.tagName.toLowerCase()}:nth-of-type(${[
      ...(element.parentElement?.children || []),
    ].filter((sibling) => sibling.tagName === element.tagName).indexOf(element) + 1})`.slice(
      0,
      500
    );
  }

  function textFromIds(value) {
    return (value || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
  }

  function accessibleName(element) {
    const labels = element.labels ? [...element.labels].map((label) => label.textContent) : [];
    return (
      textFromIds(element.getAttribute("aria-labelledby")) ||
      element.getAttribute("aria-label") ||
      labels.join(" ") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      (element.matches('input[type="button"],input[type="submit"]') ? element.value : "") ||
      (element.matches('button,a[href],summary,option') ? element.textContent : "") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);
  }

  function role(element) {
    if (element.getAttribute("role")) return element.getAttribute("role").split(/\s+/)[0];
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") return element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox";
    return ({ header: "banner", nav: "navigation", main: "main", aside: "complementary", footer: "contentinfo", form: "form" })[tag] || "region";
  }

  const landmarks = [...document.querySelectorAll(
    'header,nav,main,aside,footer,form,[role="banner"],[role="navigation"],[role="main"],[role="complementary"],[role="contentinfo"],[role="form"],[role="region"],[role="search"]'
  )]
    .filter(visible)
    .map((element) => ({ role: role(element), name: accessibleName(element), locator: locator(element) }));
  const controls = [...document.querySelectorAll(
    'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[role="spinbutton"],[role="textbox"],[role="combobox"],[tabindex]:not([tabindex="-1"])'
  )]
    .filter(visible)
    .map((element) => ({
      role: role(element),
      name: accessibleName(element),
      locator: locator(element),
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      tab_index: element.tabIndex,
      document_index: index.get(element),
    }));

  return JSON.stringify({
    schema_version: 1,
    kind: "accessibility-tree",
    subject_id: subjectId,
    commit,
    capture_ids: captureIds,
    observations: { landmarks, controls },
  }, null, 2);
})()
```

For schema-v1 migration, run the probe immediately after each active screenshot while that exact state and viewport are still loaded. For schema v2, the trusted helper instead derives roles and accessible names from Chromium's AX tree, including context-sensitive HTML-AAM landmark semantics such as a top-level banner versus a nested generic header.

Concrete data for WCAG findings: missing aria-labels, broken tab order, missing landmarks, elements without accessible names. No guessing from PNGs.

### Visual Consistency Audit

**Purpose:** Detect visual inconsistencies — elements that should look the same but don't. This is NOT token compliance (linters catch hardcoded values). This catches cases where every value is a valid token but the *combination* produces inconsistent results: a card with `container-lg` padding on top and `container-sm` on bottom, sibling sections using different spacing tokens for the same role, headings at the same level styled differently across pages, or stacked components whose left/right edges drift by a few pixels.

**The test:** Group elements by visual role. Within each group, flag variance. Then measure cross-component edge alignment numerically so 1-8px gutter drift is visible to the reviewer.

For non-authoritative diagnosis or schema-v1 migration, run this via `browser_evaluate`. Schema-v2 web certification uses the trusted helper's native DOMSnapshot measurements:

```javascript
(() => {
  const subjectId = "{subject-id}";
  const commit = "{route.source.commit}";
  const captureIds = ["{one-active-capture-id-for-this-exact-state-and-viewport}"];
  const inconsistencies = {};
  const hierarchy = [];
  const asymmetry = [];
  const edgeAlignment = [];
  const EDGE_TOLERANCE_PX = 2;

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

  function rectSummary(el) {
    const r = el.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function visualChildren(parent) {
    return [...parent.children].filter(child => {
      if (!visible(child)) return false;
      const r = child.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8;
    });
  }

  function majorityCoordinate(items, edge) {
    const buckets = [];
    items.forEach(item => {
      const value = item.rect[edge];
      let bucket = buckets.find(candidate => Math.abs(candidate.value - value) < EDGE_TOLERANCE_PX);
      if (!bucket) {
        bucket = { value, count: 0 };
        buckets.push(bucket);
      }
      bucket.count += 1;
    });
    buckets.sort((a, b) => b.count - a.count || Math.abs(a.value) - Math.abs(b.value));
    return buckets[0];
  }

  function checkEdgeGroup({ type, scope, items, edges }) {
    if (items.length < 3) return;
    edges.forEach(edge => {
      const majority = majorityCoordinate(items, edge);
      if (!majority || majority.count < 2) return;
      items.forEach(item => {
        const value = item.rect[edge];
        const delta = Math.abs(value - majority.value);
        if (delta < EDGE_TOLERANCE_PX) return;
        edgeAlignment.push({
          type,
          scope,
          edge,
          element: item.element,
          ...(item.row ? { row: item.row } : {}),
          majority: `${majority.value}px`,
          outlier: `${value}px`,
          delta: `${delta}px`,
          detail: `${edge} edge differs from sibling majority by ${delta}px`,
        });
      });
    });
  }

  function trailingControl(row) {
    const controls = [...row.querySelectorAll(
      'button,input,select,textarea,[role="switch"],[role="checkbox"],[aria-haspopup="menu"]'
    )].filter(visible);
    if (controls.length > 0) return controls[controls.length - 1];
    const children = visualChildren(row);
    return children.length > 0 ? children[children.length - 1] : null;
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

  // --- Edge alignment: stacked siblings in the same column ---
  document.querySelectorAll(
    'main,[role="main"],[class*="panel"],[class*="drawer"],[class*="sheet"],[class*="column"],[class*="body"],[class*="content"],[class*="list"]'
  ).forEach(parent => {
    if (!visible(parent)) return;
    const children = visualChildren(parent).map(child => ({
      element: desc(child),
      rect: rectSummary(child),
    }));
    checkEdgeGroup({
      type: 'stacked-sibling-edge',
      scope: desc(parent),
      items: children,
      edges: ['left', 'right'],
    });
  });

  // --- Edge alignment: trailing controls inside menus/popovers ---
  document.querySelectorAll(
    '[role="menu"],[role="listbox"],[class*="menu"],[class*="popover"],[class*="dropdown"],[class*="select"],[class*="dialog"]'
  ).forEach(parent => {
    if (!visible(parent)) return;
    const controls = visualChildren(parent)
      .map(row => ({ row, control: trailingControl(row) }))
      .filter(({ control }) => control && visible(control))
      .map(({ row, control }) => ({
        element: desc(control),
        row: desc(row),
        rect: rectSummary(control),
      }));
    checkEdgeGroup({
      type: 'inner-row-control-edge',
      scope: desc(parent),
      items: controls,
      edges: ['left', 'right'],
    });
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

  edgeAlignment.sort((a, b) => parseFloat(b.delta) - parseFloat(a.delta));

  const consistencyIssues = Object.entries(inconsistencies).flatMap(([group, variances]) =>
    Object.entries(variances).flatMap(([property, variance]) =>
      variance.outliers.map(outlier => ({
        code: 'visual-variance',
        locator: String(outlier.element).slice(0, 500),
        detail: `${group} ${property}: ${outlier.value} differs from ${outlier.majorityValue}`.slice(0, 1000),
      }))
    )
  ).slice(0, 200);
  const hierarchyIssues = hierarchy.slice(0, 200).map(item => ({
    code: item.issue || 'hierarchy-issue',
    locator: `${item.upper || item.heading || 'heading'}${item.lower ? ` > ${item.lower}` : ''}`.slice(0, 500),
    detail: String(item.detail || JSON.stringify(item)).slice(0, 1000),
  }));
  const edgeIssues = edgeAlignment.slice(0, 20).map(item => ({
    code: item.type || 'edge-drift',
    locator: String(item.element || item.scope).slice(0, 500),
    detail: String(item.detail).slice(0, 1000),
  }));
  const asymmetryIssues = asymmetry.slice(0, 10).map(item => ({
    code: 'asymmetric-padding',
    locator: String(item.element).slice(0, 500),
    detail: `${item.axis}: ${item.values}`.slice(0, 1000),
  }));

  return JSON.stringify({
    schema_version: 1,
    kind: 'dom-audit',
    subject_id: subjectId,
    commit,
    capture_ids: captureIds,
    observations: {
      viewport: {
        inner_width: Math.round(document.defaultView?.innerWidth || document.documentElement.clientWidth),
        client_width: document.documentElement.clientWidth,
        scroll_width: document.documentElement.scrollWidth,
      },
      hierarchy: hierarchyIssues,
      edge_alignment: edgeIssues,
      consistency: consistencyIssues,
      asymmetry: asymmetryIssues,
    },
  }, null, 2);
})()
```

Save the returned JSON as `{subject}-{coverage-id}-dom-raw.json`, run `design-critique-audit-normalize.js`, and register the generated `dom-audit`. Run it separately for every active web capture while the cited state and viewport are loaded; the measured `inner_width` must equal that screenshot's decoded width. The helper derives overflow from `scroll_width > client_width` and derives hierarchy, edge-alignment, consistency, and asymmetry from their measured issue arrays. Every normalized issue kind is a failing check; none may be left as an informational finding in a passing audit. Do not edit the generated output or register the raw object directly.

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

## Edge Alignment

| Type | Scope | Edge | Majority | Outlier | Delta | Element |
|------|-------|------|----------|---------|-------|---------|
| stacked-sibling-edge | main.inbox | right | 1384px | 1388px | 4px | div.inbox-filter-row "Filters" |
| stacked-sibling-edge | main.inbox | left | 16px | 0px | 16px | section.getting-started-banner "Get started" |
| inner-row-control-edge | div.display-popover | right | 272px | 256px | 16px | button.switch "on" |

## Summary
- {N} groups checked, {N} with inconsistencies
- {N} hierarchy issues
- {N} elements with asymmetric padding
- {N} edge-alignment issues
```

If a human-readable projection is useful, save it beside the raw audit; the normalized audit plus its raw path/SHA binding remain authoritative.

Run once per active web capture at that capture's exact viewport and state. A desktop audit never covers narrow, modal, loading, or any other separately captured condition.

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
- A banner edge, filter row edge, or list row edge drifts by >=2px from sibling majority
- Menu or popover trailing controls do not share the same x-position

**What this does NOT catch (leave to the reviewer):**
- Intentional variants (`.btn-sm` vs `.btn-lg` will flag — reviewer uses judgment)
- Cross-page consistency (script runs per page — reviewer compares across pages)
- Semantic appropriateness (script can't know if `text-sm` is right for a label)

### Manifest Update

For a schema-v2 web capture, copy the helper result into `captures.json` without weakening its bindings: the capture row uses the returned screenshot path, byte SHA-256, decoded-pixel SHA-256, dimensions, and capture time, plus `observation` equal to the returned `capture.json` path/SHA binding. Register the two generated normalized audits as the `accessibility-tree` and `dom-audit` evidence rows. Optional Markdown accessibility or consistency projections may sit beside them for reviewer context, but are never checker evidence.

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
