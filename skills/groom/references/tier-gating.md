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
| `strategy.md` `updated:` age | < 90 days | Stale strategy → wrong inferences. Same threshold as `pm:refresh` for topic research. |
| `insights/.hot.md` active hot insights | ≥ 3 | Synthesis needs at least 3 distinct insight signals to triangulate. |
| `evidence/competitors/*/profile.md` count | ≥ 2 | Competitive context requires at least 2 profiles for meaningful positioning. |

Refusal points the user at `/pm:strategy`, `/pm:research`, or `/pm:ingest` for filling the gaps. **Agent tier never silently degrades to standard tier.** That would hide the gap.

**Runtime gating — claude-only for alpha.** Codex inline-execution is explicitly out of scope:

> "Agent tier currently runs under Claude only. Use `--tier standard` for Codex."

Refusal logic lives in Step `01a-intake-agent.md`. Codex runtime = refuse with the directive above.

**Step coverage.** Agent tier runs a different sub-set of steps than co-pilot tiers — realised through dedicated `*-agent.md` step files, not inline conditionals:

| Agent step file | Replaces co-pilot step | Notes |
|---|---|---|
| `01a-intake-agent.md` | `01-intake.md` | Tier gate, brief-exchange decision rule, KB freshness check |
| `04a-synthesis.md` | `02-strategy-check + 03-research + 04-scope` | Synthesizer reads strategy + research + memory, derives scope, runs Iron Law gate |
| `05a-scope-review-agent.md` | `05-scope-review.md` | Cap=2 iterations, anti-collusion framing, adversarial reviewer |
| `08a-team-review-agent.md` | `08-team-review.md` | Cap=2 iterations, anti-collusion framing, adversarial reviewer |

`07-draft-proposal.md` and `11-link.md` are shared with co-pilot tiers (`applies_to:` includes all four tiers). Step 7 has a clearly-bounded "agent-only citation render" subsection.

Steps NOT in the agent path: `02-strategy-check.md`, `03-research.md`, `04-scope.md`, `06-design.md`, `09-bar-raiser.md`, `10-present.md`. Their `applies_to:` excludes `agent`.

**Iter-cap mechanism.** Cap value is **literal** in the agent-variant files:

- `05-scope-review.md` body says "Maximum 3 iterations" (unchanged) — `applies_to: [quick, standard, full]`
- `05a-scope-review-agent.md` body says "Maximum 2 iterations" — `applies_to: [agent]`
- Same pattern for `08-team-review.md` (cap 3) vs `08a-team-review-agent.md` (cap 2)

No `if groom_tier == "agent"` conditionals inside step bodies. The runtime's `applies_to` dispatcher selects the right file per tier.

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
