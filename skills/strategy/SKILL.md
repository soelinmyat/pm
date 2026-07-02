---
name: strategy
description: "Use when creating or maintaining a product strategy document. Covers ICP, value prop, competitive positioning, priorities, non-goals. Triggers on 'strategy,' 'positioning,' 'ICP,' 'non-goals,' 'product direction.'"
---

# pm:strategy

## Purpose

The strategy doc is the alignment filter for all grooming decisions. Every feature idea gets evaluated against it. Without one, grooming drifts.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `strategy`

## Hard rules

- **Never write strategy from thin air.** Strategy must be grounded in explicit answers, existing evidence, or both. If key inputs are missing, surface the gap instead of inventing certainty.
- **Make assumptions explicit and confirmed.** Don't draft positioning from what you assume you already know — even "obvious" strategies hide unexamined assumptions the interview catches.
- **Surface missing market context, don't ignore it.** Optional landscape context is not irrelevant context.
- **Existing docs drift.** Reuse prior strategy selectively, but verify what changed before carrying it forward — a doc unreviewed in 30 days is a historical document, not a strategy.
- **Accept short answers.** They're still inputs. Write clearly from them instead of interrogating the user into verbosity.

## Setup detection

Strategy writes to `{pm_dir}/strategy.md` — without a workspace there's no canonical location. If `{pm_dir}` does not exist:

> "No PM workspace found. Strategy writes to `{pm_dir}/strategy.md` — run `/pm:start` first, then re-invoke `/pm:strategy`."

Stop.

## Workflow

1. **Prerequisite check.** Check whether `{pm_dir}/insights/business/landscape.md` exists. If it does NOT, recommend (don't require) landscape research first: strategy interviews are sharper with the key players and market segments in hand. Ask "Continue with strategy now, or run `/pm:research landscape` first?" and respect the answer — do not block.

2. **Detect existing strategy.** Search for reusable material: `{pm_dir}/strategy.md`, `STRATEGY.md`, `PRODUCT.md`, `PRD.md`, or any `.md` under `docs/product/` or `docs/strategy/`. If found, offer to adopt it into `{pm_dir}/strategy.md` (restructured to the standard format) or start fresh; on adopt, extract answers already given and skip re-asking them.

   **Update flow** — when `{pm_dir}/strategy.md` already exists and the user re-invokes strategy: ask "What changed? (e.g., pivoted ICP, new competitors, revised priorities)", re-interview only the affected sections, and update in place, bumping `updated:`. Surgical updates only, not a full re-interview. Confirm before overwriting when starting fresh.

3. **Interview.** Collect the minimum inputs for a grounded doc without interrogating. Follow the interview guide in `${CLAUDE_PLUGIN_ROOT}/skills/strategy/references/interview-guide.md`.
   - One question at a time — don't front-load. Prefer multiple-choice when there's a natural set of options.
   - Start with Essentials; move to Depth only if answers are expansive. Accept short answers and move on.
   - If `landscape.md` exists, read it first and name real competitors/segments to sharpen questions ("How do you differ from [Competitor A] and [Competitor B]?" beats "Who are your competitors?").
   - If `{pm_dir}/evidence/research/` holds internal or mixed findings from `pm:ingest`, use them to sharpen ICP, segmentation, priorities, and non-goals.
   - After Essentials, ask: "Want to go deeper on any area, or is this enough to write the strategy doc?"

4. **Write strategy.** Write or update `{pm_dir}/strategy.md` in the standard structure below (frontmatter must conform to the `type: strategy` schema in `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md`). Then tell the user next steps: "Strategy complete. Next: run `/pm:research competitors` to profile competitors, then `/pm:ideate` to surface feature ideas. If you have un-ingested customer evidence, run `/pm:ingest <path>` before bigger prioritization calls. What would you like to do next?"

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

## Resume

Before starting, check whether `{pm_dir}/strategy.md` exists. If it does, read it and ask: "Found existing strategy (last updated: {date}). Update it, or start fresh?" Confirm before overwriting when starting fresh.

## When NOT to use

Quick strategic questions ("who's our ICP?") — just read `{pm_dir}/strategy.md`. Feature-level scoping — use `pm:groom`. Market research without strategy framing — use `pm:research`.

## Escalation paths

- **User wants feature scoping, not product direction:** "This sounds like feature discovery rather than strategy. Want to switch to `/pm:groom` instead?"
- **User has no answers yet and wants to think first:** "We can pause strategy writing and use `/pm:think` to pressure-test the core idea before locking positioning."
- **Landscape context is missing and the user wants evidence first:** "Want to run `/pm:research landscape` before we finish the strategy so the positioning answers are grounded in market context?"
