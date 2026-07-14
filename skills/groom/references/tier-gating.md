# Groom Tier Gating

Tiers change decision depth, not source integrity, artifact validation, or explicit approval.

## Eligibility

| KB condition | Maximum default tier |
|---|---|
| No strategy, active insights, or competitor profiles | `quick` |
| Strategy or active insights exist | `standard` |
| Strategy, active insights, and competitor profiles exist | `full` |

An explicitly requested lower tier is allowed. If the requested tier exceeds current evidence, offer the maximum eligible tier or the prerequisite skill; do not silently downgrade.

`agent` is a provider-neutral full flow with stricter evidence gates:

- strategy updated within 90 days;
- at least three active hot insights;
- at least two competitor profiles;
- every consequential derived decision carries a project-bounded citation or explicit assumption.

If an agent gate fails, offer `standard` or the relevant `pm:strategy` / `pm:research` prerequisite. Do not infer capability from a model/provider name; record actual runtime capability probes and downgrade execution mechanics only when needed.

## Routed phases

| Tier | Phases |
|---|---|
| `quick` | intake → research → scope → draft → approval → handoff → retro |
| `standard` | intake → research → scope → synthesis → design → draft → review → approval → handoff → retro |
| `full` | intake → research → scope → synthesis → design → draft → review → presentation → approval → handoff → retro |
| `agent` | full phases plus strict freshness and citation review |

## Research depth

- `quick`: bounded inline evidence assessment; absence is recorded, never hidden.
- `standard` / `full`: consume current research or invoke `pm:research` before downstream decisions.
- `agent`: research must already satisfy the strict freshness gate; stop with a recovery route when it does not.

## Review depth

- `quick`: schema, handoff, and approval integrity only.
- `standard`: core independent questions in `review-questions.md`.
- `full`: core plus alternatives, strategy/competition, measurement, and adversarial assumption questions.
- `agent`: full plus sampled citation integrity.

Question coverage is authoritative. Worker count and persona names are execution details.
