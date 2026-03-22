# PM-066: Knowledge Base Synthesis into Strategy Deck

**Parent:** PM-064 (Strategy Narrative Slide Deck)
**Extends:** PM-065 (Strategy Deck Template + Skill Integration)
**Date:** 2026-03-22

## Overview

Extend the PM-065 strategy deck template to synthesize data from `pm/landscape.md` and `pm/competitors/` alongside `pm/strategy.md`. When these additional sources exist, the deck grows from 7 base slides to up to 10 slides following the McKinsey SCR arc: SITUATION → COMPLICATION → RESOLUTION. When sources are missing, the deck degrades gracefully to the PM-065 baseline.

## Full 10-Slide SCR Structure

The deck conditionally includes slides based on available data sources. The base 7 slides from PM-065 are always present. Three additional slides are inserted when their data sources exist.

| # | Slide | SCR Phase | Source | Conditional? |
|---|---|---|---|---|
| 1 | Title | — | strategy.md §1 | No (base) |
| 2 | Market Stats | SITUATION | landscape.md `<!-- stat: -->` comments | Yes — requires landscape.md with stat comments |
| 3 | Key Players | SITUATION | landscape.md Key Players table | Yes — requires landscape.md Key Players section |
| 4 | Who We Serve (ICP) | SITUATION | strategy.md §2 | No (base) |
| 5 | The Problem | COMPLICATION | strategy.md §3 | No (base) |
| 6 | Competitive Gaps | COMPLICATION | competitors/index.md Market Gaps or competitors/matrix.md | Yes — requires competitors/ directory |
| 7 | Positioning Map | COMPLICATION | landscape.md `<!-- positioning: -->` comments | Yes — requires positioning comments in landscape.md |
| 8 | Differentiation | RESOLUTION | strategy.md §3 | No (base) |
| 9 | Where We're Going | RESOLUTION | strategy.md §6 + §7 | No (base) |
| 10 | How We'll Know | RESOLUTION | strategy.md §8 | No (base) |

**Slide ordering rule:** Conditional slides are inserted at their SCR-appropriate position. When a conditional slide is absent, subsequent slides shift up. The JS-rendered progress dots and counter from PM-065 auto-adjust since they derive from actual slide count.

## New Placeholder Tokens

PM-065 defines 14 tokens for the 7 base slides. PM-066 adds 8 new tokens for the 3 conditional slides:

| Token | Slide | Content Type |
|---|---|---|
| `{{DECK_MARKET_STATS}}` | Market Stats | HTML block: stat cards with value + label pairs |
| `{{DECK_MARKET_STATS_TITLE}}` | Market Stats | Action title referencing a specific number |
| `{{DECK_KEY_PLAYERS}}` | Key Players | HTML table: max 6 rows from landscape.md Key Players |
| `{{DECK_KEY_PLAYERS_TITLE}}` | Key Players | Action title referencing player count or category |
| `{{DECK_COMPETITIVE_GAPS}}` | Competitive Gaps | HTML list: key gaps from competitors/index.md |
| `{{DECK_COMPETITIVE_GAPS_TITLE}}` | Competitive Gaps | Action title referencing a specific gap or count |
| `{{DECK_POSITIONING_MAP}}` | Positioning Map | HTML block: 2x2 CSS plot with positioned dots |
| `{{DECK_POSITIONING_MAP_TITLE}}` | Positioning Map | Action title referencing positioning insight |

Plus one global token for data provenance:

| Token | Scope | Content Type |
|---|---|---|
| `{{DECK_PROVENANCE_FOOTER}}` | Enriched slides only | Source name, artifact count, `updated:` date |

## Template Extension Approach

The template (`templates/strategy-deck.html`) uses conditional HTML blocks wrapped in comment markers. The skill strips blocks whose data sources are missing before writing the final HTML.

```html
<!-- BEGIN:MARKET_STATS -->
<div class="slide" data-provenance="landscape.md">
  <div class="slide-content">
    <h2>{{DECK_MARKET_STATS_TITLE}}</h2>
    <div class="stat-grid">{{DECK_MARKET_STATS}}</div>
    <div class="provenance">{{DECK_PROVENANCE_FOOTER}}</div>
  </div>
</div>
<!-- END:MARKET_STATS -->
```

The skill performs these steps:
1. Read all data sources that exist.
2. For each conditional block, check if the source is available and contains the required data.
3. Strip `<!-- BEGIN:X -->...<!-- END:X -->` blocks for unavailable sources.
4. Replace remaining placeholder tokens with generated content.
5. Write the final HTML to `pm/strategy-deck.html`.

## Data Parsing

### Market Stats (from landscape.md)

Parse `<!-- stat: {value}, {label} -->` comments. Format: two-part, comma-delimited.

```
<!-- stat: 78%, PM teams using AI tools -->
```

Produces stat cards:
```html
<div class="stat-card">
  <div class="stat-value">78%</div>
  <div class="stat-label">PM teams using AI tools</div>
</div>
```

**Edge case:** If `landscape.md` exists but contains no `<!-- stat: -->` comments, skip the Market Stats slide without error (strip the BEGIN/END block).

### Key Players (from landscape.md)

Parse the markdown table under the `## Key Players` heading. Extract the first 6 data rows (excluding header and separator). Each row has: Company, Positioning, Primary Segment, Notable.

Produce an HTML table with the same columns, styled for slide presentation (large text, no link markup — company names as plain text).

### Competitive Gaps (from competitors/)

Read `pm/competitors/index.md` and look for the `## Market Gaps` section. Extract numbered list items. Each gap has a bold title and description. Produce an HTML list:

```html
<div class="gap-item">
  <div class="gap-title">No persistent knowledge base</div>
  <div class="gap-description">PM Skills Marketplace is session-scoped...</div>
</div>
```

**Fallback:** If `index.md` lacks a Market Gaps section, try `pm/competitors/matrix.md` and summarize differentiators where Product Memory has "Yes" and all competitors have "No".

### Positioning Map (from landscape.md)

Parse `<!-- positioning: company, x, y, traffic, segment-color -->` comments. Produce a 2x2 CSS plot reproducing the visual style from `templates/strategy-canvas.html`.

**CSS to reproduce from strategy-canvas.html:**
- `.positioning-map-container` — outer card with border-radius, padding
- `.positioning-map` — relative container, `aspect-ratio: 1/1`, max-width 480px (increased to 560px for slide context)
- `.axis-h`, `.axis-v` — crosshair lines at 50%
- `.axis-label` — positioned labels (top, bottom, left, right)
- `.positioning-dot` — absolute positioned, transform translate(-50%, -50%)
- `.positioning-dot .dot` — circle (12px default, 16px for "our" product)
- `.positioning-dot .dot-label` — small label below dot

**What to strip (interactive behavior):**
- No `cursor: pointer` on dots
- No `data-choice` attributes
- No `.selected` state or `toggleSelect()` JS
- No `.indicator-bar` for selection feedback
- No hover state transitions on dots

**What to keep:**
- All positioning CSS (absolute layout, dot sizes, label styling)
- `.our` class for highlighting Product Memory's dot
- Segment color mapping (enterprise, mid-market, smb, self)
- Axis labels extracted from the text below the positioning comments in landscape.md

**Axis label extraction:** Read the descriptive text after the positioning comments block. Parse "X-axis: ..." and "Y-axis: ..." lines to populate axis labels.

## Data Provenance Footer

Enriched slides (those sourced from landscape.md or competitors/) display a provenance footer:

```html
<div class="provenance">
  Source: landscape.md · 4 stats · Updated 2026-03-13
</div>
```

Format: `Source: {filename} · {count} {items} · Updated {date}`

- `{filename}`: The source file basename (e.g., `landscape.md`, `competitors/index.md`)
- `{count} {items}`: Number of data items extracted (e.g., "4 stats", "6 players", "7 gaps")
- `{date}`: The `updated:` value from the source file's YAML frontmatter

CSS: small text (0.7rem), `--text-tertiary` color, positioned at bottom of slide content area.

## Graceful Degradation

| Scenario | Behavior |
|---|---|
| landscape.md missing | Skip Market Stats, Key Players, and Positioning Map slides. Deck has 7 base slides. |
| landscape.md exists, no stat comments | Skip Market Stats slide only. Key Players and Positioning Map may still appear. |
| landscape.md exists, no positioning comments | Skip Positioning Map slide only. |
| landscape.md exists, no Key Players section | Skip Key Players slide only. |
| competitors/ missing | Skip Competitive Gaps slide. |
| competitors/index.md has no Market Gaps | Try matrix.md. If neither has usable data, skip Competitive Gaps slide. |
| Both landscape.md and competitors/ missing | Full fallback to PM-065 baseline (7 slides from strategy.md only). |

**No error messages.** Missing sources result in fewer slides, never in error states or empty placeholder slides.

## CSS Additions to Template

New CSS classes added to `templates/strategy-deck.html`:

```css
/* Stat cards grid */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
  max-width: 700px;
  margin: 2rem auto 0;
}
.stat-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
  text-align: center;
}
.stat-value {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--accent);
  margin-bottom: 0.5rem;
}
.stat-label {
  font-size: 0.9rem;
  color: var(--text-secondary);
}

/* Key players table */
.players-table {
  width: 100%;
  max-width: 900px;
  margin: 1.5rem auto 0;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.players-table th {
  text-align: left;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  padding: 0.5rem 0.75rem;
  border-bottom: 2px solid var(--border);
}
.players-table td {
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
}

/* Competitive gaps list */
.gap-list {
  max-width: 800px;
  margin: 1.5rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.gap-item {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  padding: 0.75rem 1rem;
}
.gap-title {
  font-weight: 600;
  font-size: 0.95rem;
  margin-bottom: 0.25rem;
}
.gap-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

/* Provenance footer */
.provenance {
  font-size: 0.7rem;
  color: var(--text-tertiary);
  margin-top: auto;
  padding-top: 1rem;
  text-align: center;
}
```

The positioning map CSS is copied from `templates/strategy-canvas.html` with these modifications:
- `.positioning-map` max-width increased from 480px to 560px for better slide readability
- Remove `cursor: pointer` from `.positioning-dot`
- Remove `.selected` state styles and transitions
- Remove `.positioning-dot:hover` effects

## SKILL.md Changes

Update the "Slide Deck" section in `skills/strategy/SKILL.md` to read from multiple sources:

**Current (PM-065):**
> 1. Read `pm/strategy.md` and extract data for each slide.

**Updated (PM-066):**
> 1. Read `pm/strategy.md` and extract data for base slides.
> 2. Check if `pm/landscape.md` exists. If it does:
>    - Parse `<!-- stat: {value}, {label} -->` comments for market stats slide.
>    - Parse Key Players table (first 6 rows) for key players slide.
>    - Parse `<!-- positioning: ... -->` comments for positioning map slide.
> 3. Check if `pm/competitors/` exists. If it does:
>    - Read `pm/competitors/index.md` Market Gaps section for competitive gaps slide.
>    - Fallback: read `pm/competitors/matrix.md` for PM-unique capabilities.
> 4. For each conditional slide, strip the template block if data is unavailable.
> 5. Fill remaining placeholder tokens and write to `pm/strategy-deck.html`.

Also update the offer text:
> "Want a strategy slide deck? I can generate a narrative presentation from your strategy, market landscape, and competitive research — up to 10 slides, keyboard-navigable, works offline."

And update the on-demand regeneration section:
> The deck synthesizes from `pm/strategy.md` (required), `pm/landscape.md` (optional), and `pm/competitors/` (optional). Missing optional sources result in fewer slides, not errors.

## Task Breakdown

| # | Task | Files | Description |
|---|---|---|---|
| 1 | Add conditional slide HTML blocks to template | `templates/strategy-deck.html` | Add 3 conditional slides (Market Stats, Key Players, Competitive Gaps) wrapped in BEGIN/END comment markers, with new placeholder tokens. Add Positioning Map slide. Insert at correct SCR positions between existing base slides. |
| 2 | Add new CSS classes to template | `templates/strategy-deck.html` | Add stat-grid, players-table, gap-list, and provenance footer styles. Copy positioning map CSS from strategy-canvas.html, strip interactive behavior. |
| 3 | Update SKILL.md for multi-source reading | `skills/strategy/SKILL.md` | Update Slide Deck section: multi-source read steps, conditional block stripping logic, updated offer text, provenance footer instructions. |

**Total: 3 tasks across 2 files.**
