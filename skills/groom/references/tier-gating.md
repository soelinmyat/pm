# Groom Tier Gating

`pm:groom` supports three tiers that control which steps execute.

## Tiers

| Tier | Intended use | Steps |
|------|--------------|-------|
| `quick` | Fill in missing structure fast, usually as a handoff to implementation or backlog capture | `intake -> strategy-check -> research -> scope -> draft-proposal -> link` |
| `standard` | Solid product proposal without the full executive review stack | `intake -> strategy-check -> research -> scope -> scope-review -> design -> draft-proposal -> link` |
| `full` | Full PM ceremony with review stack and presentation | `intake -> strategy-check -> research -> scope -> scope-review -> design -> draft-proposal -> team-review -> bar-raiser -> present -> link` |

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
groom_tier: quick | standard | full
```

## Step Loading Rules

Only run steps that are active for the current tier.

- `quick` skips `scope-review`, `design`, `team-review`, `bar-raiser`, and `present`
- `standard` skips `team-review`, `bar-raiser`, and `present`
- `full` runs every step

## Research by Tier

<!-- Tier routing: keep in sync with steps/03-research.md -->

Research depth scales with the tier. The HARD-GATE only applies to standard and full.

- `quick`: inline assessment only. Check existing research, write a 2-3 sentence competitive note in the groom output. Do NOT invoke `pm:research`. If the topic is complex, prompt the user to upgrade to standard tier.
- `standard`: full `pm:research` invocation (HARD-GATE applies)
- `full`: full `pm:research` invocation (HARD-GATE applies)

When `quick` performs an inline assessment without writing new files, `research_location` remains `null`. Log the inline finding as `research_note` in the session state.
