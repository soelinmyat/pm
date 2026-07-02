# Groom Tier Gating — Detailed Routing

The tier matrix (which steps run per tier) lives in `skills/groom/SKILL.md` under "Tier Gating" — that is the source of truth. This file covers the deeper selection logic, KB-maturity cap, and research routing nuances.

## Tier Selection

Use this priority:

1. Explicit tier from the caller or user request
2. Tier requested by `pm:dev`
3. Default to the max tier allowed by KB maturity (detected in Step 1 intake)

**KB maturity cap:** Step 1 runs a KB maturity check and records the max available tier in the session state as `kb_maturity_tier`. The effective tier is `min(requested_or_default_tier, kb_maturity_tier)` unless the user explicitly overrides after being informed of the constraint.

If no maturity check has run yet (first invocation, before Step 1 completes), treat the default as `quick` to avoid launching full ceremony on an unknown KB.

> Note: Step 1 intake may adjust the effective tier based on KB maturity detection. The `groom_tier` in state after Step 1 is authoritative.

Write the selected tier to the state file:

```yaml
groom_tier: quick | standard | full | agent
```

## Agent tier — additional gating

Agent tier is the autonomous variant introduced in PM-233. It runs synthesis, scope-setting, drafting, and review autonomously between two interactive checkpoints (scope-lock + proposal-ready), with mandatory source citations to the user's repo-committed KB.

**Stricter freshness gate.** Agent tier requires more than just KB presence. It refuses unless:

| Signal | Threshold | Rationale |
|---|---|---|
| `strategy.md` `updated:` age | < 90 days | Stale strategy → wrong inferences. Aligned with `pm:refresh`'s 90-day threshold for topic research; the synthesizer's persona/JTBD derivations all anchor on strategy ICP, so freshness here is load-bearing. |
| `insights/.hot.md` active hot insights | ≥ 3 | Single signal can be misleading; two can split. Three+ lets `@persona-jtbd-deriver` triangulate which JTBD is actually current vs. residual. Below 3, the synthesis tends to over-weight whichever insight was most recent. |
| `evidence/competitors/*/profile.md` count | ≥ 2 | "We differentiate on X" requires comparing against at least one alternative. Below 2 profiles, `@scope-deriver`'s 10x filter result becomes ungrounded — every claim is self-referential. Two profiles forces a real positioning judgment. |

**Promotion gate (alpha → beta → GA).** Agent tier ships as alpha (opt-in) and is gated for promotion based on dogfood metrics. The thresholds align with the success metrics in the proposal:

| Stage | Promotion criteria | Decided by |
|---|---|---|
| **Alpha** | Ships opt-in. No criteria — anyone with a mature KB can opt in via `--tier agent`. | (default at ship) |
| **Beta** | Maintainer reviews ≥30 self-run agent-tier sessions completed without abandonment. | Maintainer eyeballing session-state files. No central telemetry server exists; promotion is a single-user judgment call until shared dashboards land. |
| **GA** | Headline metrics hold across the beta sample: questions_asked ≤ 2 in ≥80% of sessions; citation_validity_sampled ≥ 85% across the sample; ≥80% completion rate; positive qualitative feedback dominant. | Maintainer judgment, recorded in `pm/memory.md` as a learning entry. |

The gate is intentionally simple because the plugin's free + local nature means there's no team to escrow the decision to. The maintainer dogfooding their own KB IS the alpha.

Refusal points the user at `/pm:strategy`, `/pm:research`, or `/pm:ingest` for filling the gaps. **Agent tier never silently degrades to standard tier.** That would hide the gap.

**Runtime gating — claude-only for alpha.** Codex inline-execution is explicitly out of scope:

> "Agent tier currently runs under Claude only. Use `--tier standard` for Codex."

Refusal logic lives in Step `01a-intake-agent.md`. Codex runtime = refuse with the directive above.

**Step coverage.** Agent tier runs a different sub-set of steps than co-pilot tiers — intake and synthesis have dedicated `*-agent.md` variant files (01a, 04a), while the review gates (05, 08) are shared steps whose in-body agent-tier parameter blocks tighten caps and add the adversarial reviewer:

| Agent step file | Replaces co-pilot step | Notes |
|---|---|---|
| `01a-intake-agent.md` | `01-intake.md` | Tier gate, brief-exchange decision rule, KB freshness check |
| `04a-synthesis.md` | `02-strategy-check + 03-research + 04-scope` | Synthesizer reads strategy + research + memory, derives scope, runs Iron Law gate |
| `05-scope-review.md` § Agent tier | (same file — parameter block) | Cap=2 iterations, anti-collusion framing, adversarial reviewer |
| `08-team-review.md` § Agent tier | (same file — parameter block) | Cap=2 iterations, anti-collusion framing, adversarial reviewer |

`07-draft-proposal.md` and `11-link.md` are shared with co-pilot tiers (`applies_to:` includes all four tiers). Step 7 has a clearly-bounded "agent-only citation render" subsection.

Steps NOT in the agent path: `02-strategy-check.md`, `03-research.md`, `04-scope.md`, `06-design.md`, `10-present.md`. Their `applies_to:` excludes `agent`. (The review steps 05 and 08 ARE in the agent path — their agent-tier parameter blocks tighten the caps and add the adversarial reviewer; since v1.9 the bar raiser runs concurrently inside step 08.)

**Iter-cap mechanism.** Cap value is **literal** in the agent-variant files:

- `05-scope-review.md` and `08-team-review.md` declare cap 3 with an agent-tier parameter block dropping it to 2 — `applies_to: [standard, full, agent]` / `[full, agent]`

## Agent-tier review escalation

When a review gate hits its agent-tier iteration cap with blocking issues remaining, escalate to the user (this is an exceptional checkpoint, allowed beyond the two standing ones):

> "{Gate name} didn't converge after 2 iterations. Blocking issues remaining:
>
> {list of blocking issues, each tagged with reviewer role}
>
> Options:
> (a) Approve as-is — proceed with these as known limitations
> (b) Redirect — go back to the prior checkpoint with the reviewer feedback as guidance
> (c) Abort — stop the session"

Append the outcome to `checkpoints[]` with `name: scope-review-escalation` or `name: team-review-escalation` and the user's choice.

The runtime's `applies_to` dispatcher selects steps per tier. Intake/synthesis variants are separate files; the review gates carry an explicit agent-tier parameter block in-body (the one sanctioned form of tier branching, since the gate loop itself is shared).

## Step Loading Rules

Each step file declares `applies_to: [...]` in frontmatter. The loader uses that metadata to include or exclude steps for the selected tier; individual step bodies may still self-skip within an included tier when they need to explain why a gate is lightweight or deferred. Keep `applies_to:` values in sync with the tier matrix in `skills/groom/SKILL.md`.

For example, `strategy-check` is intentionally present in `quick` tier so the prompt can record the lightweight inline check and any skip rationale, even though the deeper strategy gate only applies to `standard` and `full`.

## Research by Tier

<!-- Tier routing: keep in sync with steps/03-research.md -->

Research depth scales with the tier. The HARD-GATE only applies to standard and full.

- `quick`: inline assessment only. Check existing research, write a 2-3 sentence competitive note in the groom output. Do NOT invoke `pm:research`. If the topic is complex, prompt the user to upgrade to standard tier.
- `standard`: full `pm:research` invocation (HARD-GATE applies)
- `full`: full `pm:research` invocation (HARD-GATE applies)

When `quick` performs an inline assessment without writing new files, `research_location` remains `null`. Log the inline finding as `research_note` in the session state.
