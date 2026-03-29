# DOM Assertions via Playwright MCP

Patterns for verifying UI correctness through DOM queries instead of screenshot judgment.

---

## Principle

**Measure, don't look.** If a property has a value in the DOM, query it. Only fall back to visual judgment for things that can't be measured (layout composition, visual balance, overall feel).

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
→ Verify all items have identical font-size and font-weight
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

```
browser_evaluate: "
  const dates = Array.from(document.querySelectorAll('.row-date'))
    .map(el => new Date(el.textContent.trim()).getTime());
  const isDescending = dates.every((d, i) => i === 0 || d <= dates[i-1]);
  JSON.stringify({ dates: dates.length, isDescending })
"
→ {"dates": 10, "isDescending": true}
```

### Filter verification

```
browser_evaluate: "
  const statuses = Array.from(document.querySelectorAll('.user-row .status'))
    .map(el => el.textContent.trim());
  const allActive = statuses.every(s => s === 'Active');
  JSON.stringify({ count: statuses.length, allActive, unique: [...new Set(statuses)] })
"
→ {"count": 5, "allActive": true, "unique": ["Active"]}
```

### Computed values

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

```
# 1. Capture before state
browser_evaluate: "document.querySelector('.modal') !== null"
→ false

# 2. Perform action
browser_click: selector=".open-modal-btn"

# 3. Verify after state
browser_evaluate: "
  const modal = document.querySelector('.modal');
  JSON.stringify({
    exists: modal !== null,
    visible: modal?.style.display !== 'none',
    title: modal?.querySelector('.modal-title')?.textContent.trim()
  })
"
→ {"exists": true, "visible": true, "title": "Confirm Delete"}
```

### Form submission

```
# Fill form
browser_type: selector="#email", text="test@example.com"
browser_type: selector="#name", text="Test User"
browser_click: selector="button[type='submit']"

# Wait for response
browser_evaluate: "
  await new Promise(r => setTimeout(r, 1000));
  const toast = document.querySelector('.toast-success');
  const form = document.querySelector('form');
  JSON.stringify({
    toastVisible: toast !== null,
    toastText: toast?.textContent.trim(),
    formReset: form?.querySelector('#email')?.value === ''
  })
"
```

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
→ Compare RGB values for WCAG AA contrast ratio (4.5:1 for normal text)
```

### Focus management

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
| Take screenshot to count items | `browser_evaluate` → `querySelectorAll().length` |
| Take screenshot to read text | `browser_evaluate` → `.textContent` |
| Take screenshot to check visibility | `browser_evaluate` → `getComputedStyle().display` |
| "The spacing looks off" | `browser_evaluate` → measure actual padding/margin values |
| "The sort seems wrong" | `browser_evaluate` → read all values, verify order |
