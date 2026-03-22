# PM-065: Strategy Deck Template + Skill Integration

**Parent:** PM-064 (Strategy Narrative Slide Deck)
**Date:** 2026-03-22

## Overview

Create a self-contained HTML slide deck template that presents strategy data as a narrative presentation using the McKinsey SCR framework. Integrate into the strategy skill as a second visual companion offer.

## Files to Create

| File | Purpose |
|---|---|
| `templates/strategy-deck.html` | Slide deck template with placeholder tokens |

## Files to Modify

| File | Change |
|---|---|
| `skills/strategy/SKILL.md` | Add "Slide Deck" section after "Visual Companion" |

## Placeholder Schema (Interface Contract for PM-066)

These are the exact token names that PM-066 will inject content into. Each token maps to a specific slide and strategy.md section.

| Token | Slide | Source Section | Content Type |
|---|---|---|---|
| `{{DECK_PRODUCT_NAME}}` | 1 (Title) | §1 Product Identity | Product name string |
| `{{DECK_PRODUCT_IDENTITY}}` | 1 (Title) | §1 Product Identity | One-line description |
| `{{DECK_ICP_TITLE}}` | 2 (Who We Serve) | §2 ICP | Action title (sentence) |
| `{{DECK_ICP_CONTENT}}` | 2 (Who We Serve) | §2 ICP | ICP description, segments |
| `{{DECK_PROBLEM_TITLE}}` | 3 (Problem) | §3 Core Value Prop | Action title (sentence) |
| `{{DECK_PROBLEM_CONTENT}}` | 3 (Problem) | §3 Core Value Prop | Pain points, current alternatives |
| `{{DECK_DIFFERENTIATION_TITLE}}` | 4 (Differentiation) | §3 Core Value Prop | Action title (sentence) |
| `{{DECK_DIFFERENTIATION_CONTENT}}` | 4 (Differentiation) | §3 Differentiation | What makes this different |
| `{{DECK_POSITIONING_TITLE}}` | 5 (Positioning) | §4 + §5 | Action title (sentence) |
| `{{DECK_POSITIONING_CONTENT}}` | 5 (Positioning) | §4 Competitive + §5 GTM | Positioning and go-to-market |
| `{{DECK_PRIORITIES_TITLE}}` | 6 (Where We're Going) | §6 + §7 | Action title (sentence) |
| `{{DECK_PRIORITIES_CONTENT}}` | 6 (Where We're Going) | §6 Priorities | Top priorities list |
| `{{DECK_NONGOALS_CONTENT}}` | 6 (Where We're Going) | §7 Non-Goals | Non-goals list |
| `{{DECK_METRICS_TITLE}}` | 7 (How We'll Know) | §8 Success Metrics | Action title (sentence) |
| `{{DECK_METRICS_CONTENT}}` | 7 (How We'll Know) | §8 Success Metrics | Leading indicators |

**Action title rule:** Every `*_TITLE` token must be a complete sentence that asserts a specific claim. "Our ICP" fails. "We serve ops managers at mid-market cleaning companies" passes.

## CSS Approach

Reuse the CSS variable system from `scripts/frame-template.html` for dark/light mode (`:root` + `@media (prefers-color-scheme: dark)`). No external dependencies.

**Slide-specific CSS:**
- Each `.slide` uses `width: 100vw; height: 100vh; overflow: hidden` — no scrolling within slides
- Slides stack horizontally; only the active slide is visible via `transform: translateX()`
- Slide content is centered vertically with flexbox
- Typography: large action title (1.8rem+), supporting content below (1rem)
- Progress dots: fixed bottom center, small circles, active dot uses `--accent`
- Slide counter: fixed bottom-right, "3 / 7" format
- Fullscreen button: fixed top-right corner
- Slide 1 (title): larger type, centered product name + identity
- Slide 6 (priorities + non-goals): two-column layout using CSS grid

**Responsive:** Not a priority since this is a presentation format, but text should scale down gracefully on smaller viewports.

## JS Approach

Pure vanilla JS, no dependencies. Three features:

### 1. Keyboard Navigation
- `ArrowRight` / `ArrowDown` / `Space` — next slide
- `ArrowLeft` / `ArrowUp` — previous slide
- Clamp at boundaries (no wrap-around)
- Update active slide by toggling a CSS class or translating the slide container
- Update progress dots and counter on each navigation

### 2. Fullscreen API
- Button in top-right corner triggers `document.documentElement.requestFullscreen()`
- Toggle between enter/exit fullscreen
- Listen for `fullscreenchange` event to update button icon
- Graceful fallback: hide button if `requestFullscreen` is not available

### 3. Progress Dots
- One dot per slide, rendered from JS based on slide count
- Active dot highlighted with `--accent` color
- Dots are clickable (navigate to that slide)
- Slide counter text ("3 / 7") updates alongside dots

## SKILL.md Changes

Add a new "Slide Deck" section after the existing "Visual Companion" section at the end of `skills/strategy/SKILL.md`.

**New section content:**

```markdown
## Slide Deck

If the user has `visual_companion: true` in `.pm/config.json`, after offering the positioning map, also offer:

> "Want a strategy slide deck? I can generate a narrative presentation from your strategy — 7 slides, keyboard-navigable, works offline."

If accepted:
1. Read `pm/strategy.md` and extract data for each slide.
2. For each slide, write an action title — a complete sentence that asserts a specific claim about the product. Titles that merely name a topic ("Our ICP", "Competitive Positioning") fail. Titles that assert a claim pass ("We serve ops managers at mid-market cleaning companies who track jobs on WhatsApp").
3. Fill the template placeholders and write to `pm/strategy-deck.html`.
4. Open the file in the browser automatically.

**On-demand regeneration:** The user can invoke `/pm:strategy deck` at any time.
- If `pm/strategy.md` does not exist, respond: "No strategy doc found. Run /pm:strategy first to create one."
- If `pm/strategy.md` exists, regenerate the deck and open it.

The deck uses only `pm/strategy.md` as its data source (PM-065 scope). Future enhancement (PM-066) will synthesize landscape and competitor data.
```

## Task Breakdown

| # | Task | Files | Est. Lines |
|---|---|---|---|
| 1 | Create `templates/strategy-deck.html` — CSS (theme variables, slide layout, progress dots, typography) | `templates/strategy-deck.html` | ~120 |
| 2 | Create `templates/strategy-deck.html` — HTML (7 slides with placeholder tokens, progress dots container, fullscreen button, counter) | `templates/strategy-deck.html` | ~80 |
| 3 | Create `templates/strategy-deck.html` — JS (keyboard nav, fullscreen API, progress dots, counter update) | `templates/strategy-deck.html` | ~60 |
| 4 | Update `skills/strategy/SKILL.md` — add Slide Deck section | `skills/strategy/SKILL.md` | ~20 |

**Total estimated:** ~280 lines across 2 files (1 new, 1 modified).
