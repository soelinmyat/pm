---
name: ideate
description: "Use when the user wants to discover what to build next, generate feature ideas from the knowledge base, or mine gaps and opportunities. Use when the user says 'what should we build', 'generate ideas', 'what's missing', 'find opportunities', 'brainstorm features', or wants evidence-backed feature candidates ranked by strategic fit."
---

# pm:ideate

## Purpose

Surface what to build next from the existing knowledge base. `pm:ideate` mines strategy, landscape, competitor gaps, customer evidence, and existing backlog to generate ranked feature ideas grounded in evidence rather than intuition.

Ideas are early-stage backlog items. They live in `{pm_dir}/backlog/` with `status: idea` and get promoted to `drafted` when groomed via `pm:groom`.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `ideate` | **Telemetry steps:** `audit`, `mine-signals`, `filter`, `shape`, `rank`, `present`, `write`

## Iron Law

**NEVER SAVE AN UNSOURCED IDEA.**

## Hard rules

- **Every idea cites at least one signal source with a file path.** No signal, no idea — unsourced ideas are opinions dressed as features.
- **Audit existing capabilities before generating.** Read strategy, feature matrix, and codebase every time — don't skip because "I know the product." Without the audit, ideation produces duplicates.
- **Apply all 5 filters to every candidate.** Show the filtered-out list with a rejection reason for each — the user can override, but you never silently drop or skip filters.
- **Quality over quantity.** 5 well-sourced ideas beat 15 thin ones. Cut the weakest to a defensible 5-10.
- **Ideate shapes ideas, it doesn't scope them.** For depth on one idea, hand off to `pm:think` or `pm:groom`.
- **Ranking is computed, not improvised.** Models supply bounded judgment inputs; the shared ranker owns ordering and strategy-conflict output.

## Red Flags — Self-Check

- **"This idea is too good to need a citation."** Stop and trace it to a durable signal or drop it.
- **"I already know what the product does."** Check the feature inventory and codebase before generating.
- **"The rejected ideas do not matter."** Include each filtered candidate with its rejection reason.
- **"Ten ideas looks more valuable than five."** Keep only candidates that survive all filters and remain comparable.
- **"The top idea is ready to build."** Route to `pm:think` or `pm:groom`; ideation does not establish scope.

## Setup detection

Ideate mines the KB — without one, there's nothing to mine. If `{pm_dir}` does not exist:

> "No PM workspace found. Ideate needs a knowledge base to mine — run `/pm:start` first, then re-invoke `/pm:ideate` once you have strategy or research in place."

Stop.

## Workflow

1. **Audit.** Prerequisite check: if `{pm_dir}/strategy.md` is missing, offer `/pm:strategy` first ("Ideation without strategy is just brainstorming") but don't block if the user insists. Note whether `{pm_dir}/insights/business/landscape.md` and `{pm_dir}/evidence/competitors/index.md` exist. Then audit existing capabilities — read strategy (identity, ICP, in/out of scope), the feature matrix (what the product already does), and scan the project codebase if one exists. Before mining, state the top 3 priorities, the 3 most relevant competitive gaps, and 1 customer-evidence signal if available.

2. **Mine signals.** Read every available source below before generating ideas; each idea must trace to at least one. Extract **gaps** (should exist but don't), **pains** (problems users or competitors have), **trends** (macro forces creating demand), and **evidence** (customer signals of unmet need), keeping the file path for each.

   | Source | Path | What to extract |
   |---|---|---|
   | Strategy priorities | `{pm_dir}/strategy.md` § 6 | Top 3 priorities — ideas should advance these |
   | Strategy non-goals | `{pm_dir}/strategy.md` § 7 | Filter out ideas that conflict |
   | Market gaps | `{pm_dir}/evidence/competitors/index.md` § Market Gaps | Capabilities absent across competitors |
   | Feature matrix | `{pm_dir}/evidence/competitors/index.md` | Cells where the product shows "No" or "Planned" |
   | Competitor weaknesses | `{pm_dir}/evidence/competitors/*/profile.md` § Weaknesses | Problems competitors have that we could solve better |
   | Landscape observations | `{pm_dir}/insights/business/landscape.md` § Initial Observations | Whitespace and macro trends |
   | Keyword opportunities | `{pm_dir}/insights/business/landscape.md` § Keyword Landscape | Low-competition, high-intent keywords |
   | Customer evidence | `{pm_dir}/evidence/research/index.md` | Internal/mixed topics with high evidence counts |
   | Topic research | `{pm_dir}/evidence/research/*.md` | Open questions and implications |
   | Existing backlog | `{pm_dir}/backlog/*.md` | Avoid duplicating what's already there |

3. **Filter.** Convert signals into candidate ideas, then apply all five filters to every candidate. Keep a short filtered-out list with the rejection reason for each dropped candidate.

   - **Filter 1 — Already built?** Check against the Step 1 audit. Drop if the capability already exists.
   - **Filter 2 — Is this a discrete, groomable feature?** Each idea must be specific and shippable. Drop vague themes, process changes, and ongoing efforts. Test: can you write acceptance criteria? If not, it is not a feature.
   - **Filter 3 — Are dependencies met?** Flag ideas requiring unbuilt features. Deprioritize those with 2+ unbuilt dependencies.
   - **Filter 4 — Is this needed now?** Drop ideas solving hypothetical future problems or optimizing non-bottlenecks.
   - **Filter 5 — Non-goal conflict?** Check against `{pm_dir}/strategy.md` § 7. Flag conflicts explicitly — do not silently drop them.

4. **Shape.** Read and follow `${CLAUDE_PLUGIN_ROOT}/references/product-reasoning.md`. For each surviving idea, capture a comparable idea card plus a v1 idea decision brief (don't over-scope). Target 5-10; if more survive, cut the weakest.

   - **Name** — short and descriptive (3-5 words)
   - **One-liner** — what it does for the user (outcome, not implementation)
   - **Signal sources** — which source(s) support it, with file paths
   - **Strategic fit** — which priority it advances
   - **Competitor gap** — `unique` / `partial` / `parity`
   - **Dependencies** — other unbuilt features required, or `none`
   - **Scope signal** — `small` (< 1 day) / `medium` (1-3 days) / `large` (1+ week)
   - **Evidence strength** — `strong` (3+ independent, claim-fit signals, including a direct or primary source when available) / `moderate` (1-2 credible evidence chains with explicit limits) / `hypothesis` (a sourced signal whose implication remains unverified). Derivative copies of one upstream claim are one chain.
   - **Customer impact** — `low` (minor convenience) / `medium` (meaningful friction or outcome improvement) / `high` (removes a critical pain or unlocks the core job)
   - **Reach** — `narrow` (edge segment) / `segment` (meaningful ICP segment) / `broad` (most of the ICP); this is a bounded category, not an invented user count
   - **Urgency** — `later` (no time pressure) / `soon` (cost grows within the planning horizon) / `now` (current blocker, churn, safety, or expiring opportunity)
   - **Expected outcome** — `incremental` / `meaningful` / `step-change`, judged on the user or business result if the idea works, not implementation volume
   - **Learning value** — `low` / `medium` / `high`, based on how much the smallest release resolves a consequential uncertainty
   - **Value basis** — one short, cited rationale for each of the five value inputs above. Use the signal paths already attached to the idea; do not invent market sizes, user counts, or outcome probabilities.

5. **Rank.** Run the shared `rank-ideas` command over the exact candidate briefs. When Strategy exists, pass `{pm_dir}` as the root and its canonical `strategy.decision.json`; the command authenticates that companion against current Strategy Markdown before ranking. Without one, state that token-level strategy verification is unavailable. Use the runtime ordering and show its score components. Unknown priority or non-goal tokens require correction; confirmed non-goal conflicts block saving until the user drops/reshapes the idea or explicitly updates Strategy.

   The ranker converts each bounded category to `0` / `1` / `2` and computes one documented `weighted_total`:

   | Input | Maximum weight | What the category represents |
   |---|---:|---|
   | Customer impact | 20 | Depth of improvement for an affected customer |
   | Reach | 12 | Breadth across the stated ICP |
   | Urgency | 10 | Cost of waiting |
   | Expected outcome | 14 | Size of the result if the idea works |
   | Learning value | 10 | Consequential uncertainty retired |
   | Strategic alignment | 14 | Fit to authenticated priority tokens |
   | Competitor gap | 8 | Differentiation opportunity |
   | Dependency efficiency | 6 | Readiness without unbuilt prerequisites |
   | Scope efficiency | 6 | Smaller path to a useful result |

   The first five inputs form `customer_value` (maximum 66). Evidence strength adjusts that subtotal to `confidence_adjusted_value` using a bounded factor (`hypothesis` 0.75, `moderate` 0.9, `strong` 1.0); strategy and delivery inputs then complete `weighted_total`. The weights are comparison policy, not forecast precision. No direct ordinal contributes more than 20 points, so strategic alignment or any other single judgment cannot dominate every other dimension. Existing v1 briefs without the five customer-value fields remain valid and receive neutral defaults; flag `value_inputs_legacy_defaulted` and collect explicit inputs before a new save.

6. **Present.** Show a ranked table (# / Idea / One-liner / Weighted total / Customer value / Confidence / Supports / Deps / Scope), a count of how many were filtered out with brief reasons, and quick-wins vs big-bets callouts. Keep the ordinal inputs and their cited value basis visible on request; a total never replaces judgment. Then ask how to proceed: (a) groom one now, (b) add their own ideas, (c) go deeper on one, (d) save all to backlog.

7. **Write.** Only when the user confirms they want ideas saved. Immediately before writing, rebuild the exact final candidate briefs after every user addition or reshape, require the current Strategy companion to be authenticated, and rerun `rank-ideas`. Do not save while any unknown token or confirmed non-goal conflict remains unresolved. Then write each approved idea to `{pm_dir}/backlog/{idea-slug}.md`, hash it, and write `{pm_dir}/backlog/{idea-slug}.decision.json`. Before treating that new companion as saved, run `scripts/product-reasoning.js validate-idea-save --root "{pm_dir}" --input "{pm_dir}/backlog/{idea-slug}.decision.json"`; a normal legacy-readable `validate` is not the new-save gate. Fix every missing customer-value field, basis, or binding before continuing. **ID rule:** use the Linear identifier as `id` if an issue was created; otherwise fall back to the local `PM-{NNN}` sequence. Preserve the decision ID across ranking and wording changes. Then tell the user the count, paths, and that `/pm:groom {slug}` consumes this lineage and atomically marks it promoted only after approved Groom artifacts exist.

   ```markdown
   ---
   type: backlog
   id: "{linear_id or PM-NNN}"
   title: "{Idea Name}"
   outcome: "{One-liner}"
   status: idea
   parent: null
   labels:
     - "ideate"
   priority: {critical|high|medium|low}
   evidence_strength: {strong|moderate|hypothesis}
   scope_signal: {small|medium|large}
   strategic_fit: "{which priority}"
   competitor_gap: {unique|partial|parity}
   dependencies: [] | ["{dependency}"]
   reasoning_version: 2
   decision_brief: "backlog/{idea-slug}.decision.json"
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   ---

   ## Outcome
   {What the user can do after this ships.}

   ## Signal Sources
   - {source path}: {what it revealed}

   ## Competitor Context
   {Who has this, who doesn't, how ours would differ.}

   ## Value Hypothesis
   Customer impact: {category} — {cited basis}
   Reach: {category} — {cited basis}
   Urgency: {category} — {cited basis}
   Expected outcome: {category} — {cited basis}
   Learning value: {category} — {cited basis}

   ## Dependencies
   {What needs to exist first, or "None."}

   ## Open Questions
   {What to validate before building.}
   ```

## When NOT to use

When the user already knows what to build and wants to scope it — use `pm:groom`. When they want to explore a single idea — use `pm:think`. Ideate is for discovery across the full KB, not deep-diving one idea.

## Escalation paths

- **KB too thin to generate ideas:** "Not enough data to mine. Run `/pm:research` and `/pm:strategy` first to build the knowledge base."
- **User wants to deep-dive one idea:** "Want to explore '{idea}' further? I can run `/pm:think` to challenge the framing, or `/pm:groom` to scope it into a proposal."
- **User wants to groom an idea immediately:** Invoke `pm:groom` with the idea context pre-loaded. Groom intake recognizes `status: idea` backlog items and pre-fills from them.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "A plausible idea can be marked hypothesis." | Hypothesis describes evidence strength; it does not replace a source signal. |
| "Silent filtering keeps the output concise." | Visible rejection reasons make ranking auditable and user-overridable. |

## Before Marking Done

- [ ] User-approved Markdown and decision companions are saved with stable IDs, Evidence/source refs, deterministic weighted ranks, customer-impact and confidence-adjusted value inputs, and comparable fields; unapproved ideas remain unwritten.
- [ ] The user confirmed which ideas to save and whether to think, groom, or stop.
- [ ] Capability audit, signal provenance, five-filter, ranking, deduplication, and write validation gates passed.
