---
type: topic-research
topic: Strategy Slide Deck
created: 2026-03-22
updated: 2026-03-22
source_origin: external
sources:
  - url: https://revealjs.com/
    accessed: 2026-03-22
  - url: https://marp.app/
    accessed: 2026-03-22
  - url: https://autonomee.ai/blog/reveal-presentations-generate-slide-decks-from-claude-code/
    accessed: 2026-03-22
  - url: https://qubit.capital/blog/create-storytelling-deck-with-narrative-arc
    accessed: 2026-03-22
  - url: https://slideworks.io/resources/product-strategy-deck-cheat-sheet
    accessed: 2026-03-22
  - url: https://www.jqueryscript.net/blog/best-html-presentation-framework.html
    accessed: 2026-03-22
  - url: https://productschool.com/blog/product-strategy/product-strategy
    accessed: 2026-03-22
  - url: https://slideworks.io/resources/how-mckinsey-consultants-make-presentations
    accessed: 2026-03-22
  - url: https://www.theanalystacademy.com/powerpoint-storytelling/
    accessed: 2026-03-22
  - url: https://slideworks.io/resources/how-to-use-McKinseys-scr-framework-with-examples
    accessed: 2026-03-22
  - url: https://slidemodel.com/mckinsey-presentation-structure/
    accessed: 2026-03-22
---

# Strategy Slide Deck

## Summary

No PM tool generates strategy as a narrative slide deck — they all produce reference docs or dashboards. The self-contained single-HTML-file approach (pure CSS/JS, no framework dependency) is the simplest path for an editor-native plugin. The McKinsey SCR framework (Situation → Complication → Resolution) is the gold standard for consulting storylines. Combined with the Pyramid Principle (lead with the answer, support with evidence), it maps directly to PM's strategy data sources (landscape, competitors, strategy.md). The deck should pull from all three to tell a complete, high-quality story.

## Findings

1. **No PM tool outputs strategy as a presentation.** Productboard, Amplitude, Jira PD, and editor-native PM tools all produce text documents or dashboards. Standalone AI presentation tools (Gamma, Beautiful.ai, Chronicle) generate decks but have no PM workflow integration. The PM plugin would be unique in generating a narrative strategy deck directly from structured strategy data.

2. **Self-contained HTML is the proven delivery format.** The Reveal Presentations Claude Code plugin already proves the single-HTML-file pattern works: "double-click to open in Chrome, push to GitHub Pages for sharing, or present directly from your laptop." Two approaches exist: (a) load reveal.js from CDN (smaller file, needs internet), (b) embed everything (larger file, works offline). For PM's use case, pure CSS/JS with no framework dependency is simplest — the existing `strategy-canvas.html` template already uses this approach.

3. **The narrative arc framework maps cleanly to strategy sections.** The 4-act structure from pitch deck best practices:
   - **Context** — Market landscape, who you serve (maps to ICP, landscape data)
   - **Conflict** — The problem, what's broken, why now (maps to value prop, competitive gaps)
   - **Character** — Your product as the hero, what you do differently (maps to positioning, differentiation)
   - **Closure** — Priorities, where you're going, what you're not doing (maps to priorities, non-goals, metrics)

4. **The McKinsey SCR framework is the gold standard for consulting storylines.** SCR = Situation → Complication → Resolution. The audience should be able to read only the slide titles (action titles) and understand the full argument. Each slide title is a complete sentence stating the insight — the slide body provides supporting evidence. This is the Pyramid Principle: lead with the answer, then support it.

5. **SCR maps to PM's data sources for a strategy deck.** Recommended slide flow using SCR:
   - **SITUATION** (slides 1-3): Title slide → Market landscape (from `pm/landscape.md`) → Who we serve (ICP from `pm/strategy.md` §2)
   - **COMPLICATION** (slides 4-6): The problem / why now → Competitive landscape (from `pm/competitors/`) → The gap no one fills (positioning from `pm/strategy.md` §4)
   - **RESOLUTION** (slides 7-10): What we do differently (value prop from `pm/strategy.md` §3) → How we win (differentiation + positioning map) → Where we're going (priorities from §6, non-goals from §7) → How we'll know (metrics from §8)

6. **Action titles are the storyline.** Each slide title should read as a standalone narrative when read in sequence. Example: "The AI PM tools market is growing 45% year over year" → "But no tool covers the full lifecycle from research to merge" → "PM fills this gap as the only editor-native product lifecycle tool" → "We focus on three priorities and explicitly exclude four non-goals."

7. **Optimal length is 10-12 slides for this use case.** Investor decks average 15 slides. Internal strategy presentations for small teams should be 10-12. Each slide: one key message, large text, max 3 bullets. The 10/20/30 rule (10 slides, 20 minutes, 30pt font minimum) is a useful constraint.

8. **Keyboard navigation is table stakes.** All HTML presentation frameworks support arrow keys for slide navigation. Full-screen mode (F11 or button) is expected. Progress indicators (dots or slide counter) help orientation. Straightforward to implement in pure CSS/JS.

9. **Existing PM template infrastructure supports this.** The plugin already has `templates/strategy-canvas.html` with placeholder injection (`{{PRODUCT_IDENTITY}}`, `{{POSITIONING_MAP}}`). A new `templates/strategy-deck.html` template could follow the same pattern with slide-specific placeholders, reusing the dark/light mode CSS variables already defined.

10. **Data sources for the deck span three files.** The deck should synthesize from:
    - `pm/strategy.md` — product identity, ICP, value prop, positioning, priorities, non-goals, metrics
    - `pm/landscape.md` — market overview, key players table, positioning map data, market stats
    - `pm/competitors/` — competitor profiles, feature matrix, market gaps

## Strategic Relevance

This feature extends strategy output from reference-only to presentation-ready. It solves a real user pain: "I need to explain my strategy to someone and the current doc isn't suitable." No competitor offers this — it's a differentiator for the PM plugin, especially for technical founders and small-squad builders who don't have time to manually create decks.

## Implications

- The strategy skill needs a new output step: after writing `pm/strategy.md`, offer to generate a narrative slide deck
- A new HTML template (`strategy-deck.html`) is needed with slide structure, keyboard nav, and full-screen support
- The narrative reordering (reference doc → story arc) is the hard design problem — the template is mechanical
- The existing visual companion config (`visual_companion: true`) can gate the offer

## Open Questions

1. Should slides include the positioning map from the canvas, or keep it text-only for simplicity?
2. Should the deck be regenerable on demand (e.g., `/pm:strategy deck`) or only offered after strategy creation/update?
3. How should the skill handle missing data sources (e.g., no landscape.md yet) — skip those slides or show placeholders?

## Source References

- https://revealjs.com/ — accessed 2026-03-22
- https://marp.app/ — accessed 2026-03-22
- https://autonomee.ai/blog/reveal-presentations-generate-slide-decks-from-claude-code/ — accessed 2026-03-22
- https://qubit.capital/blog/create-storytelling-deck-with-narrative-arc — accessed 2026-03-22
- https://slideworks.io/resources/product-strategy-deck-cheat-sheet — accessed 2026-03-22
- https://www.jqueryscript.net/blog/best-html-presentation-framework.html — accessed 2026-03-22
- https://productschool.com/blog/product-strategy/product-strategy — accessed 2026-03-22
- https://slideworks.io/resources/how-mckinsey-consultants-make-presentations — accessed 2026-03-22
- https://www.theanalystacademy.com/powerpoint-storytelling/ — accessed 2026-03-22
- https://slideworks.io/resources/how-to-use-McKinseys-scr-framework-with-examples — accessed 2026-03-22
- https://slidemodel.com/mckinsey-presentation-structure/ — accessed 2026-03-22
