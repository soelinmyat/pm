---
title: "Dev risk routing"
created: 2026-07-11
updated: 2026-08-09
---

# Dev risk routing

## Purpose

Size estimates effort. Risk selects safeguards. `scripts/lib/dev-risk.js` is the executable source of truth for phase and gate routing. The pure `classifyDeliveryCandidate` function in `scripts/lib/dev-session-schema.js` separately decides whether the optional review-candidate route is proven safe.

## Dimensions

Score each dimension from `0` (none) to `3` (major):

| Dimension | Measures |
|---|---|
| `behavioral` | Runtime or user-observable behavior change. |
| `security` | Trust boundaries, secrets, or security controls. |
| `auth` | Authentication or authorization behavior. |
| `data` | Persistence, migration, deletion, or data integrity. |
| `external_contract` | Public APIs, schemas, events, or compatibility promises. |
| `operational` | Deployment, availability, monitoring, or rollback impact. |
| `ui` | User-visible layout, interaction, or accessibility impact. |
| `reversibility` | Cost or impossibility of undoing the change. |
| `cross_module` | Number and coupling of affected modules. |

Set `destructive_data: true` separately when the data operation deletes or irreversibly rewrites data.

## Bright-line rules

- Security score `2+`, any authorization change, destructive data change, or reversibility score `3` is at least high risk.
- A score of `3` in any dimension or an aggregate score of `6+` is high risk.
- High and critical risk always require full review and verification. `kind: task` or `kind: bug` cannot remove those gates.
- M/L/XL proposals require groom/RFC readiness. Tasks and bugs may use their supplied context, but risk still controls review depth.
- Behavioral changes require TDD. A non-behavioral change may skip TDD only with a concrete recorded reason.
- UI impact always adds current browser QA. Explicitly assessed XS/S work with `ui: 1`, `behavioral: 0` or `1`, every other dimension `0`, and `destructive_data: false` combines visual/accessibility review into QA instead of a separate design-critique phase. Missing assessments, complex interactions (`ui: 2+`), or any consequential boundary retain standalone critique. Never lower risk to escape a failed check.
- Review and verification are always retained; low-risk XS/S work uses the code-scan review mode.

Focused UI QA includes desktop and narrow visual inspection plus native keyboard focus/navigation. Retain actual screenshots and executed browser assertions in the existing QA report; do not create a second design report or require a percentage pixel change for focus. Evidence remains workflow-attested, not cryptographic proof of browser execution.

Existing sessions keep their recorded route after an update. To adopt changed policy, preserve the prior session and failed evidence, then start a successor intake with the same scope and freshly assessed risks. Record the predecessor path and reason in intake evidence. Never rewrite a blocked phase as passed or copy prior gate verdicts; certify current source again.

## Delivery candidate routing

Comprehensive delivery is the default. Review-candidate routing is selected only when one structured fact set proves all of the following:

- Size is `XS` or `S`.
- Every changed path is inside one normalized, repository-relative app root.
- Dependency scope is exactly `app-local`.
- Discovered configuration has a SHA-256 identity.
- Every risk fact is explicitly known and false: auth, data, migration, external contract, shared surface, operational behavior, configuration, lockfile, and ambiguity.

Missing, malformed, extra, or contradictory facts select `comprehensive`. The classifier returns every reason so the runner can explain the fallback. A task kind, prose claim, empty risk object, or mechanical hook escape hatch never proves eligibility.

Candidate eligibility is not external-effect authority. In `review-candidate`, the candidate authority ceiling allows only `push_feature_branch` and `create_draft_pr`. It keeps certification, ready-for-review, auto-merge, and merge false, and it does not change the session's user-granted authority.

## Done-when

Routing is complete when the decision record contains a risk tier, review mode, ordered phases, ordered gates, candidate route, and readable reasons. Consumers persist that record rather than recomputing it from prose.

**Advance:** proceed to the phase returned by the session runner.
