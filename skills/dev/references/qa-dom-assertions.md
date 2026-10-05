# DOM Assertions via Playwright MCP

Patterns for measuring rendered behavior through DOM queries alongside task observation and screenshots. A probe proves only its stated claim.

---

## Tool compatibility

Read `${CLAUDE_PLUGIN_ROOT}/references/browser-evidence-preflight.md` before executing examples. `browser_evaluate`, `browser_snapshot`, and other names below describe Playwright MCP patterns, not guaranteed APIs in every runtime. Inspect the installed tool documentation and use only permitted equivalents. If DOM evaluation or a required action is unavailable, collect supported observations with explicit limits or mark the required claim blocked; do not launch CDP or invent a certifying producer to bypass policy.

## Principle

**Measure the claim and inspect its user effect.** Use DOM measurements for exact values and inspect the rendered journey for readability, grouping, discovery, and context. State where the expected value comes from (approved requirement, domain rule, fixture, or applicable design-system rule); copying a value from the implementation is not an independent oracle. Presence is not visibility, visibility is not operability, and operability is not task completion.

---

## CSS Value Assertions

Check computed styles against design system tokens.

### Single element

```
browser_evaluate: "
  const cs = getComputedStyle(document.querySelector('.card-title'));
  JSON.stringify({
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    color: cs.color
  })
"
→ {"fontSize":"18px","fontWeight":"600","lineHeight":"24px","color":"rgb(17, 24, 39)"}
```

### Consistency check (all elements of same type)

```
browser_evaluate: "
  const els = document.querySelectorAll('.card-title');
  const styles = Array.from(els).map(el => {
    const cs = getComputedStyle(el);
    return { text: el.textContent.trim().slice(0, 20), fontSize: cs.fontSize, fontWeight: cs.fontWeight };
  });
  JSON.stringify(styles)
"
→ Compare elements with the same semantic role and state against the applicable token rule; intentional hierarchy or emphasis may differ.
```

### Common CSS checks

| What | Property | Example expected |
|------|----------|-----------------|
| Font size | `fontSize` | `"16px"`, `"18px"` |
| Font weight | `fontWeight` | `"400"`, `"600"`, `"700"` |
| Line height | `lineHeight` | `"24px"`, `"1.5"` |
| Color | `color` | `"rgb(17, 24, 39)"` |
| Background | `backgroundColor` | `"rgb(255, 255, 255)"` |
| Padding | `paddingTop`, `paddingRight`, etc. | `"16px"`, `"24px"` |
| Margin | `marginBottom`, etc. | `"8px"`, `"16px"` |
| Border | `borderWidth`, `borderColor` | `"1px"`, `"rgb(229, 231, 235)"` |
| Border radius | `borderRadius` | `"8px"`, `"12px"` |
| Gap (flex/grid) | `gap` | `"16px"` |
| Display | `display` | `"flex"`, `"grid"`, `"none"` |
| Visibility | `visibility` | `"visible"`, `"hidden"` |
| Opacity | `opacity` | `"1"`, `"0.5"` |

---

## Element Presence & Content

### Element exists

```
browser_evaluate: "document.querySelector('.empty-state') !== null"
→ true / false
```

### Element count

```
browser_evaluate: "document.querySelectorAll('table tbody tr').length"
→ 5
```

### Text content

```
browser_evaluate: "document.querySelector('.page-title')?.textContent.trim()"
→ "Dashboard"
```

### Multiple element texts

```
browser_evaluate: "
  Array.from(document.querySelectorAll('.nav-item'))
    .map(el => el.textContent.trim())
"
→ ["Home", "Settings", "Profile"]
```

### Element attributes

```
browser_evaluate: "
  const img = document.querySelector('.avatar');
  JSON.stringify({ src: img?.src, alt: img?.alt, loading: img?.loading })
"
→ {"src": "...", "alt": "User avatar", "loading": "lazy"}
```

---

## Data Integrity

### Sort order verification

Seed distinguishable dated records, including ties if supported. Derive the expected IDs from the fixture and the approved tie-break rule, independently of the rendered output. Parse an unambiguous machine timestamp (not a locale-formatted label). A non-empty sort scenario needs at least two unequal dates.

```javascript
function matchesDescendingFixture(rows, expectedIds) {
  return expectedIds.length >= 2 &&
    rows.length === expectedIds.length &&
    new Set(expectedIds).size === expectedIds.length &&
    rows.every((row, i) => row.id === expectedIds[i] &&
      Number.isFinite(row.timestamp) &&
      (i === 0 || row.timestamp <= rows[i - 1].timestamp)) &&
    rows.some((row) => row.timestamp !== rows[0].timestamp);
}
```

In `browser_evaluate`, collect `{ id, timestamp }` for rendered records and apply this function with the independently expected order. An empty or incomplete table fails this scenario rather than passing a vacuous `every` check.

### Filter verification

Seed both included and excluded records. Use fixture IDs, not the page's current rows, as the expected set. This catches a filter that shows nothing, loses records, duplicates rows, or leaves excluded records behind.

```javascript
function matchesActiveFixture(rows, expectedIds) {
  return rows.length === expectedIds.length &&
    new Set(expectedIds).size === expectedIds.length &&
    new Set(rows.map((row) => row.id)).size === rows.length &&
    rows.every((row) => expectedIds.includes(row.id) && row.status === 'Active');
}
```

Collect IDs and statuses for visible rows. Assert `matchesActiveFixture(rows, ['active-a', 'active-b'])` for the non-empty scenario. Test an explicitly empty expected set separately, including the visible empty-state explanation and recovery action.

### Computed values

The example below is only a simple USD fixture. For financial claims use the domain rounding rule and integer minor units or the project decimal type, plus an independently calculated expected amount. Reading subtotal, tax, and total from the same UI checks internal consistency, not whether its tax rule or source data is correct. Locale formatting needs a locale-aware parser.

```
browser_evaluate: "
  const subtotal = parseFloat(document.querySelector('.subtotal')?.textContent.replace('$',''));
  const tax = parseFloat(document.querySelector('.tax')?.textContent.replace('$',''));
  const total = parseFloat(document.querySelector('.total')?.textContent.replace('$',''));
  JSON.stringify({ subtotal, tax, total, correct: Math.abs((subtotal + tax) - total) < 0.01 })
"
→ {"subtotal": 100, "tax": 8.5, "total": 108.5, "correct": true}
```

---

## Interaction State Changes

### Before/after pattern

Use the project's browser test API or the available MCP equivalent. Wait with a bounded condition for the named dialog and inspect its accessible name. Then exercise its primary and cancel actions, focus entry, keyboard behavior, and focus return. A native click must succeed; evaluating `element.click()` can bypass real-user interactability checks.

The following browser-evaluation helper rejects absent nodes, stylesheet-hidden nodes, hidden ancestors, and empty boxes. It is a **rendered-box candidate probe**, not proof that an element is on-screen, unoccluded, keyboard reachable, or usable.

```javascript
function hasRenderedBox(element, styleOf = getComputedStyle) {
  if (!element) return false;
  for (let node = element; node; node = node.parentElement) {
    const style = styleOf(node);
    if (node.hidden || style.display === 'none' ||
        style.visibility === 'hidden' || style.visibility === 'collapse' ||
        Number(style.opacity) === 0) return false;
  }
  return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}
```

Before opening, confirm the dialog is absent or hidden as intended. After the real open action, use the bounded dialog-visible wait and this probe, then inspect the viewport capture for clipping/occlusion. An absent dialog must report `false`; checking `modal?.style.display !== 'none'` incorrectly reports it visible.

### Form submission

Use condition-based waits, with failure timeout and diagnostics, rather than a fixed sleep. Example in a project Playwright test (adapt to the installed API):

```javascript
// Submission completion is an observed server result, not elapsed time.
const saved = page.waitForResponse((response) =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/users' && response.status() === 201,
  { timeout: 10000 });
await page.getByLabel('Email').fill('fixture@example.com');
await page.getByLabel('Name', { exact: true }).fill('Fixture User');
await page.getByRole('button', { name: 'Save', exact: true }).click();
const response = await saved;
const created = await response.json();
await expect(page.getByRole('status')).toHaveText('User created');
await page.reload();
await expect(page.getByTestId(`user-${created.id}`)).toContainText('fixture@example.com');
```

Install the response wait before the action to avoid missing a fast response. Use a fixture-specific request matcher when concurrent requests share the endpoint. Match the domain's actual completion contract (including async jobs if applicable). A success toast or reset form alone does not prove persistence; validate the created record after reload or through an independent read. Exercise rejected and timed-out submissions separately and confirm the user can recover without losing input.

### Toggle state

```
browser_evaluate: "document.querySelector('.toggle')?.getAttribute('aria-checked')"
→ "false"

browser_click: selector=".toggle"

browser_evaluate: "document.querySelector('.toggle')?.getAttribute('aria-checked')"
→ "true"
```

---

## Accessibility Checks

### ARIA labels on interactive elements

This scan finds possible missing labels only. It does not compute accessible names: `aria-labelledby` may refer to absent/empty nodes, labels may be hidden, and input values/types affect naming. Verify the browser accessibility tree or role/name locator, then keyboard navigation and supported assistive-technology behavior for the required journey.

```
browser_evaluate: "
  const interactives = document.querySelectorAll('button, a, input, select, textarea');
  const missing = Array.from(interactives).filter(el => {
    const hasLabel = el.getAttribute('aria-label') ||
                     el.getAttribute('aria-labelledby') ||
                     el.textContent.trim() ||
                     el.getAttribute('title') ||
                     (el.tagName === 'INPUT' && document.querySelector('label[for=\"' + el.id + '\"]'));
    return !hasLabel;
  }).map(el => ({ tag: el.tagName, id: el.id, class: el.className }));
  JSON.stringify({ total: interactives.length, missingLabels: missing.length, elements: missing.slice(0, 5) })
"
```

### Color contrast (approximate)

```
browser_evaluate: "
  const el = document.querySelector('.body-text');
  const cs = getComputedStyle(el);
  JSON.stringify({ color: cs.color, background: cs.backgroundColor })
"
→ Resolve the actual composited foreground/background (including ancestors, transparency, images and states) before calculating the applicable contrast ratio. These two style values alone cannot certify contrast.
```

### Focus management

Observe tab order and a visible, unclipped focus indicator in the rendered viewport. `outlineStyle` alone is not a verdict: an outline can have zero width, be clipped, or be replaced by a valid box-shadow indicator.

```
browser_press_key: key="Tab"
browser_evaluate: "
  const focused = document.activeElement;
  JSON.stringify({
    tag: focused?.tagName,
    id: focused?.id,
    class: focused?.className,
    hasOutline: getComputedStyle(focused).outlineStyle !== 'none'
  })
"
```

---

## Responsive Checks

### Viewport-specific layout assertions

```
# Desktop
browser_resize: width=1440, height=900
browser_evaluate: "
  const sidebar = document.querySelector('.sidebar');
  JSON.stringify({ display: getComputedStyle(sidebar).display, width: sidebar?.offsetWidth })
"
→ {"display": "block", "width": 280}

# Mobile
browser_resize: width=375, height=812
browser_evaluate: "
  const sidebar = document.querySelector('.sidebar');
  JSON.stringify({ display: getComputedStyle(sidebar).display })
"
→ {"display": "none"}  (sidebar hidden on mobile)
```

### Overflow detection

This scan identifies candidate overflow, not absence of clipping. Inspect intentional scroll areas and `overflow: hidden` containers for truncated required content and unreachable actions at supported viewports.

```
browser_evaluate: "
  const els = document.querySelectorAll('*');
  const overflowing = Array.from(els).filter(el =>
    el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
  ).filter(el => {
    const cs = getComputedStyle(el);
    return cs.overflow !== 'auto' && cs.overflow !== 'scroll' && cs.overflow !== 'hidden';
  }).map(el => ({
    tag: el.tagName,
    class: el.className.toString().slice(0, 30),
    scrollW: el.scrollWidth,
    clientW: el.clientWidth
  }));
  JSON.stringify(overflowing.slice(0, 5))
"
```

---

## Anti-Patterns

| Don't | Do instead |
|-------|-----------|
| Take screenshot to check font size | `browser_evaluate` → `getComputedStyle().fontSize` |
| Take screenshot to check color | `browser_evaluate` → `getComputedStyle().color` |
| Count rows without a fixture oracle | Compare visible record IDs/count with independently expected fixture results |
| Take screenshot to read text | `browser_evaluate` → `.textContent` |
| Treat DOM existence or inline display as visibility | Bounded rendered-state wait, computed ancestor checks, viewport capture, and actual action |
| "The spacing looks off" | `browser_evaluate` → measure actual padding/margin values |
| "The sort seems wrong" | `browser_evaluate` → read all values, verify order |
