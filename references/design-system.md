# Design System Reference

Read this file before generating any HTML page. It defines the shared visual tokens, typography, hero pattern, and rules that make all PM-generated pages feel like one product.

## Font Loading

Every self-contained HTML page must include these in `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

## CSS Variables

Paste this `:root` block into every page's `<style>`. Do not modify token values — only add page-specific overrides below it.

```css
:root {
  /* Typography */
  --font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --mono: 'JetBrains Mono', 'SF Mono', monospace;

  /* Surfaces */
  --bg: #F6F6F4;
  --bg-surface: #FFFFFF;
  --bg-inset: #F0F0EE;
  --bg-muted: #EEEEED;

  /* Text */
  --ink: #1A1A19;
  --ink-secondary: #4A4A48;
  --ink-tertiary: #8A8A87;
  --ink-faint: #B5B5B1;

  /* Borders */
  --rule: #E0E0DC;
  --rule-subtle: #EBEBEA;

  /* Accent */
  --accent: #5B5BD6;
  --accent-soft: #E8E8FD;
  --accent-text: #3E3EA8;

  /* Semantic */
  --positive: #2B8A3E;
  --positive-soft: #E6F5EA;
  --negative: #C92A2A;
  --negative-soft: #FFF0F0;
  --warning: #E67700;
  --warning-soft: #FFF4E6;
  --info: #1971C2;
  --info-soft: #E7F5FF;

  /* Depth */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03);
  --shadow-card: 0 1px 3px rgba(0,0,0,0.03), 0 6px 16px rgba(0,0,0,0.04);
  --shadow-float: 0 4px 12px rgba(0,0,0,0.06), 0 20px 48px rgba(0,0,0,0.08);

  /* Radii */
  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;
  --r-pill: 999px;

  /* Motion */
  --ease: cubic-bezier(0.22, 1, 0.36, 1);

  /* Layout */
  --content-w: 860px;
}
```

## Typography Scale

| Element | Size | Weight | Tracking | Color |
|---------|------|--------|----------|-------|
| Page title (hero h1) | 1.875rem | 800 | -0.035em | #fff |
| Section title (h2) | 1.05-1.25rem | 700 | -0.015em | var(--ink) |
| Section eyebrow | 0.68rem | 700 | 0.08em uppercase | var(--accent-text) |
| Body text | 0.9rem | 400 | normal | var(--ink-secondary) |
| Small labels | 0.65-0.72rem | 600-700 | 0.06em uppercase | var(--ink-faint) |
| Code / mono | 0.78-0.82rem | 400-500 | normal | varies |
| Pills / badges | 0.65-0.68rem | 600-700 | 0.04em uppercase | varies |

Body line-height: 1.6-1.7. Max prose width: 65ch. Content column max-width: 860px (920px for landscape pages, 1080px for two-column issue pages).

## Hero Pattern

Every page has a dark hero header. The structure is always:

```css
.hero {
  background: #1C1C1E;
  color: #fff;
  padding: 2.5rem 2rem 2rem;
  position: relative;
  overflow: hidden;
}

/* Dot grid texture */
.hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px);
  background-size: 24px 24px;
  pointer-events: none;
}

/* Colored glow — varies by page type */
.hero::after {
  content: '';
  position: absolute;
  top: -80px;
  right: -30px;
  width: 350px;
  height: 350px;
  background: radial-gradient(circle, <GLOW_COLOR> 0%, transparent 65%);
  pointer-events: none;
}
```

### Hero Glow Colors by Page Type

| Page Type | Glow Color | Rationale |
|-----------|------------|-----------|
| Proposal (PRD) | `rgba(91,91,214,0.2)` (indigo) | Product — matches accent |
| RFC / Engineering Plan | `rgba(43,138,62,0.18)` (green) | Engineering — build signal |
| Strategy | `rgba(91,91,214,0.2)` (indigo) | Product — matches accent |
| Competitor Profile | `rgba(192,38,38,0.15)` (red) | Threat / intelligence |
| Market Landscape | `rgba(25,113,194,0.18)` (blue) | Research / analytical |
| Topic Research | `rgba(25,113,194,0.18)` (blue) | Research / analytical |
| Issue Detail | No hero — uses page layout instead | Work item, not document |

**Critical alignment rule:** `.hero-inner`, `.toc-inner`, and `.content` must ALL use `padding: 0 2rem` so text left-edges align across the hero, TOC, and body. Without this, hero text appears narrower than body content.

### Hero Content Structure

```
Breadcrumb (0.78rem, 35% white opacity)
Pill badges (status, type)
Title (h1, 1.875rem, weight 800)
Summary (0.95rem, 50% white opacity, max-width 620px)
─── border-top 1px rgba(255,255,255,0.08) ───
Meta row: author avatar, team, date, approval avatars (0.78rem, 40% white opacity)
```

## Sticky TOC

Every document page (not issue detail) has a sticky horizontal TOC:

```css
.toc {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(246,246,244,0.85);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border-bottom: 1px solid var(--rule);
}
```

Active link: `color: var(--accent-text); border-bottom: 2px solid var(--accent);`

Include scroll-spy JavaScript at the bottom of the page:

```javascript
(function() {
  const sections = document.querySelectorAll('.section[id]');
  const tocLinks = document.querySelectorAll('.toc a');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
      }
    });
  }, { rootMargin: '-20% 0px -75% 0px' });
  sections.forEach(s => observer.observe(s));
})();
```

## Section Headers

Two patterns depending on page type:

### Pattern A: Icon + Title + Hairline (PRD, RFC, Issue)

```html
<div class="section-header">
  <div class="section-icon icon-{type}">
    <svg>...</svg>
  </div>
  <h2>Section Title</h2>
</div>
```

The `::after` pseudo-element on `.section-header` adds a flex-grow hairline rule.

### Pattern B: Eyebrow + Action Title (Strategy, Research, Competitor, Landscape)

```html
<div class="section-eyebrow">Category Label</div>
<h2 class="section-title">Complete sentence asserting a claim — not a topic label</h2>
```

Action titles are complete sentences: "No tool covers the full lifecycle" not "Competitive Analysis." This is critical for strategy and research pages.

## Pills and Badges

### On dark backgrounds (hero)

```css
.pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; border-radius: var(--r-pill);
  font-size: 0.68rem; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
}

/* Examples */
.pill-review-dark { background: rgba(91,91,214,0.25); color: rgba(200,200,255,0.9); border: 1px solid rgba(91,91,214,0.3); }
.pill-approved-dark { background: rgba(43,138,62,0.2); color: rgba(150,255,170,0.9); border: 1px solid rgba(43,138,62,0.25); }
```

### On light backgrounds

Use semantic color soft backgrounds: `background: var(--positive-soft); color: var(--positive);`

## Responsive Breakpoints

```css
@media (max-width: 700px) {
  .hero { padding: 2rem 1.25rem 1.5rem; }
  .hero h1 { font-size: 1.5rem; }
  .content { padding: 1.5rem 1.25rem 1rem; }
  /* Collapse grids to single column */
}
```

## Print

```css
@media print {
  .toc { display: none; }
  .hero { background: #333; }
  .section { break-inside: avoid; }
}
```

## Rules

1. Every page is **self-contained** — inline `<style>`, no external CSS files except Google Fonts CDN
2. Use the `:root` variables above — never hardcode hex colors in component CSS
3. Mermaid diagrams: include CDN script and initialize after fonts load:
   ```html
   <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
   <script>document.fonts.ready.then(() => mermaid.initialize({ startOnLoad: true, theme: 'neutral', fontFamily: 'Inter' }));</script>
   ```
4. `html { scroll-behavior: smooth; scroll-padding-top: 3.75rem; }` — offset for sticky TOC
5. All pages get `-webkit-font-smoothing: antialiased` on body
