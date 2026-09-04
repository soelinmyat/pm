# Groom Tier Gating

Tiers change decision depth, not source integrity, experience design, adversarial review, artifact validation, or explicit approval. Thin product knowledge lowers confidence and increases assumption scrutiny; it never disables the design and review phases.

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
| `quick` | intake → research → scope → design → draft → review → approval → handoff → retro |
| `standard` | intake → research → scope → synthesis → design → draft → review → approval → handoff → retro |
| `full` | intake → research → scope → synthesis → design → draft → review → presentation → approval → handoff → retro |
| `agent` | full phases plus strict freshness and citation review |

## Research depth

- `quick`: bounded inline evidence assessment; absence is recorded, never hidden.
- `standard` / `full`: consume current research or invoke `pm:research` before downstream decisions.
- `agent`: research must already satisfy the strict freshness gate; stop with a recovery route when it does not.

## Review depth

- `quick`: bounded assumption-risk and experience-completeness questions; use explicit assumptions where evidence is thin.
- `standard`: core independent questions in `review-questions.md`.
- `full`: the `standard` questions plus the required reversal question; deeper strategy, measurement, and adversarial analysis may be captured as advisory enrichment.
- `agent`: the same required question IDs as `full`, with stricter freshness and citation integrity inside the required answers.

Question coverage is authoritative: use the canonical ordered IDs in `review-questions.md`. Worker count and persona names are execution details. Adding another required ID needs a coordinated session-schema/runtime migration.
