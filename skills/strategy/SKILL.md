---
name: pm-strategy
description: "Use when creating or maintaining a product strategy document, or generating a strategy deck/presentation. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction,' 'strategy deck,' 'strategy presentation,' 'generate deck.'"
---

# pm:strategy

## Purpose
The strategy doc is the alignment filter for all grooming decisions.
Every feature idea gets evaluated against it. Without one, grooming drifts.

## Prerequisite Check

Check if `pm/landscape.md` exists.

If it does NOT exist, say:

> "Consider running /pm:research landscape first. Strategy interviews are more
> productive with landscape context — knowing the key players and market segments
> sharpens your positioning answers. This is a recommendation, not a requirement."

Then ask: "Continue with strategy now, or run landscape research first?"
Respect the user's answer. Do not block.

## Existing Strategy Detection

Search for any of the following:
- `pm/strategy.md`
- `STRATEGY.md`
- `PRODUCT.md`
- `PRD.md`
- Any `.md` file inside `docs/product/` or `docs/strategy/`

If found, say:

> "Found existing strategy doc at {path}. Want to adopt it into pm/strategy.md
> (I'll restructure it to the standard format) or start fresh?"

If adopting: extract existing answers and skip re-asking questions already answered.
If starting fresh: proceed with the full interview.

## Update Flow

When `pm/strategy.md` already exists and the user invokes `$pm-strategy` again:

1. Ask: "What changed? (e.g., pivoted ICP, new competitors, revised priorities)"
2. Re-interview only the affected sections.
3. Update `pm/strategy.md` in place. Bump `updated:` in frontmatter.

Not a full re-interview. Surgical updates only.


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Interview Process

Follow the interview guide in `interview-guide.md` (same directory).

Rules:
- One question at a time. Do not front-load multiple questions.
- Prefer multiple-choice when there is a natural set of options.
- Start with Essentials. Move to Depth only if the user's answers are expansive.
- If the user gives a short answer, accept it and move on — do not interrogate.
- If `pm/landscape.md` exists, read it first. Use named competitors and market
  segments from it to make questions more specific (e.g., "How do you differ
  from [Competitor A] and [Competitor B]?" instead of "Who are your competitors?").
- If `pm/research/` contains internal or mixed topic findings from `$pm-ingest`,
  use them to sharpen ICP, segmentation, priorities, and non-goals. Customer
  evidence should influence strategy when available.
- After Essentials are complete, ask: "Want to go deeper on any area, or is
  this enough to write the strategy doc?"

## Strategy Document

Write to `pm/strategy.md` with this structure:

```markdown
---
type: strategy
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

# Product Strategy

## 1. Product Identity
What it is, who it's for, and why it exists.

## 2. ICP and Segmentation
Ideal customer profile: industry, company size, role, pain level.
Secondary segments (if applicable) and why they are secondary.

## 3. Core Value Prop and Differentiation
The one-sentence value prop.
What makes this meaningfully different from alternatives.

## 4. Competitive Positioning
Where this product sits relative to key players.
How we win (and where we intentionally don't compete).

## 5. Go-to-Market
Geographic focus and reasoning.
Acquisition motion: product-led, sales-led, partnership-led, or a combination.
Initial beachhead market and expansion path.

## 6. Current Phase and Priorities
Stage of the product (0-to-1, growth, optimization, etc.).
Top 3 priorities for this phase and the reasoning behind each.

## 7. Explicit Non-Goals
What this product is NOT doing, and why.
At least 3 items. These are decisions, not omissions.

## 8. Success Metrics
How we know the strategy is working.
Leading indicators preferred over lagging.
```

After writing, say:

> "Strategy doc written to pm/strategy.md. Recommended next steps:
> /pm:research competitors -> /pm:ideate -> /pm:groom [feature idea]
> If you have un-ingested customer evidence, run /pm:ingest <path> before making bigger prioritization calls."

## Visual Companion

If the user has `visual_companion: true` in `.pm/config.json`, offer:

> "Want a positioning map? I can plot key competitors on two axes you choose
> (e.g., price vs. breadth, SMB vs. enterprise)."

Generate using the positioning-map template if accepted.

## Slide Deck

Always generate the strategy deck after writing or updating `pm/strategy.md`. The deck is a persistent artifact viewable from the dashboard — no config gate needed.

Say: "Generating strategy deck..."

**IMPORTANT:** Do NOT use the pptx skill or any external presentation tool. The deck is generated by reading the HTML template and replacing placeholder tokens.

1. **Read the template** from `${CLAUDE_PLUGIN_ROOT}/templates/strategy-deck.html`. This is a self-contained HTML file with placeholder tokens (`{{DECK_PRODUCT_NAME}}`, `{{DECK_ICP_TITLE}}`, etc.).
2. **Read `pm/strategy.md`** and extract data for the 7 base slides. Map strategy sections to tokens:
   - §1 Product Identity → `{{DECK_PRODUCT_NAME}}`, `{{DECK_PRODUCT_IDENTITY}}`
   - §2 ICP → `{{DECK_ICP_TITLE}}`, `{{DECK_ICP_CONTENT}}`
   - §3 Core Value Prop → `{{DECK_PROBLEM_TITLE}}`, `{{DECK_PROBLEM_CONTENT}}`, `{{DECK_DIFFERENTIATION_TITLE}}`, `{{DECK_DIFFERENTIATION_CONTENT}}`
   - §4 Positioning + §5 GTM → `{{DECK_POSITIONING_TITLE}}`, `{{DECK_POSITIONING_CONTENT}}`
   - §6 Priorities + §7 Non-Goals → `{{DECK_PRIORITIES_TITLE}}`, `{{DECK_PRIORITIES_CONTENT}}`, `{{DECK_NONGOALS_CONTENT}}`
   - §8 Metrics → `{{DECK_METRICS_TITLE}}`, `{{DECK_METRICS_CONTENT}}`
3. **Write action titles** for each `*_TITLE` token — a complete sentence asserting a specific claim. "Our ICP" fails. "We serve product engineers who own both product decisions and implementation" passes.

**Slide content rules (critical for readability):**
- **Max 3 bullets per slide.** If the source has more, distill to the 3 most important.
- **Each bullet: max 15 words.** One line, no wrapping. Cut ruthlessly.
- **No paragraphs.** Bullets only. The action title carries the message — bullets are supporting evidence.
- **Numbers over prose.** Prefer "80% use no software" over "The majority of operators do not use any booking software."
- **Competitive gaps: max 4 items.** Pick the sharpest ones.
- **Positioning slide: bullets only, no sub-explanations.** The positioning map speaks for itself.
- **Title slide subtitle: max 20 words.**
- Think investor pitch, not reference doc. If you can say it shorter, say it shorter.
4. **Check optional sources** and populate conditional slide tokens:
   - If `pm/landscape.md` exists: parse `<!-- stat: {value}, {label} -->` for `{{DECK_MARKET_STATS}}` + `{{DECK_MARKET_STATS_TITLE}}`; parse Key Players table (first 6 rows) for `{{DECK_KEY_PLAYERS}}` + `{{DECK_KEY_PLAYERS_TITLE}}`; parse `<!-- positioning: ... -->` for `{{DECK_POSITIONING_MAP}}`.
   - If `pm/competitors/` exists: read Market Gaps from `index.md` or `matrix.md` for `{{DECK_COMPETITIVE_GAPS}}` + `{{DECK_COMPETITIVE_GAPS_TITLE}}`.
   - Generate per-slide provenance footers for enriched slides (`{{DECK_PROVENANCE_*}}`).
5. **Strip conditional blocks** — remove `<!-- BEGIN:X -->...<!-- END:X -->` blocks for unavailable data sources.
6. **Replace all `{{...}}` tokens** in the template with generated content.
7. **Write** the final HTML to `pm/strategy-deck.html` and open in the browser.

The deck synthesizes from `pm/strategy.md` (required), `pm/landscape.md` (optional), and `pm/competitors/` (optional). Missing optional sources result in fewer slides, not errors.

**On-demand regeneration:** The user can invoke `/pm:strategy deck` at any time.
- If `pm/strategy.md` does not exist, respond: "No strategy doc found. Run /pm:strategy first to create one."
- If `pm/strategy.md` exists, regenerate the deck and open it.
