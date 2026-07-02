---
name: ideate
description: "Use when the user wants to discover what to build next, generate feature ideas from the knowledge base, or mine gaps and opportunities. Use when the user says 'what should we build', 'generate ideas', 'what's missing', 'find opportunities', 'brainstorm features', or wants evidence-backed feature candidates ranked by strategic fit."
---

# pm:ideate

## Purpose

Surface what to build next from the existing knowledge base. `pm:ideate` mines strategy, landscape, competitor gaps, customer evidence, and existing backlog to generate ranked feature ideas grounded in evidence rather than intuition.

Ideas are early-stage backlog items. They live in `{pm_dir}/backlog/` with `status: idea` and get promoted to `drafted` when groomed via `pm:groom`.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `ideate`

## Hard rules

- **Every idea cites at least one signal source with a file path.** No signal, no idea — unsourced ideas are opinions dressed as features.
- **Audit existing capabilities before generating.** Read strategy, feature matrix, and codebase every time — don't skip because "I know the product." Without the audit, ideation produces duplicates.
- **Apply all 5 filters to every candidate.** Show the filtered-out list with a rejection reason for each — the user can override, but you never silently drop or skip filters.
- **Quality over quantity.** 5 well-sourced ideas beat 15 thin ones. Cut the weakest to a defensible 5-10.
- **Ideate shapes ideas, it doesn't scope them.** For depth on one idea, hand off to `pm:think` or `pm:groom`.

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

4. **Shape.** For each surviving idea, capture a comparable idea card (don't over-scope). Target 5-10; if more survive, cut the weakest.

   - **Name** — short and descriptive (3-5 words)
   - **One-liner** — what it does for the user (outcome, not implementation)
   - **Signal sources** — which source(s) support it, with file paths
   - **Strategic fit** — which priority it advances
   - **Competitor gap** — `unique` / `partial` / `parity`
   - **Dependencies** — other unbuilt features required, or `none`
   - **Scope signal** — `small` (< 1 day) / `medium` (1-3 days) / `large` (1+ week)
   - **Evidence strength** — `strong` (3+ signals) / `moderate` (1-2) / `hypothesis`

5. **Rank.** Sort by, in order: strategic alignment → evidence strength → competitor gap → dependency count → scope efficiency. When two ideas are close, prefer fewer dependencies and stronger evidence.

6. **Present.** Show a ranked table (# / Idea / One-liner / Supports / Gap / Evidence / Deps / Scope), a count of how many were filtered out with brief reasons, and quick-wins vs big-bets callouts. Then ask how to proceed: (a) groom one now, (b) add their own ideas, (c) go deeper on one, (d) save all to backlog.

7. **Write.** Only when the user confirms they want ideas saved. Write each approved idea to `{pm_dir}/backlog/{idea-slug}.md`. **ID rule:** use the Linear identifier as `id` if an issue was created; otherwise fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for the highest `id`, increment by 1). Then tell the user the count, path, and that `/pm:groom {slug}` promotes any idea to a scoped proposal.

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
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   ---

   ## Outcome
   {What the user can do after this ships.}

   ## Signal Sources
   - {source path}: {what it revealed}

   ## Competitor Context
   {Who has this, who doesn't, how ours would differ.}

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
