---
title: "Dev risk routing"
created: 2026-07-11
updated: 2026-07-11
---

# Dev risk routing

## Purpose

Size estimates effort. Risk selects safeguards. `scripts/lib/dev-risk.js` is the executable source of truth for dev phase and gate routing; this reference explains its inputs and decisions.

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
- UI impact adds design critique and QA.
- Review and verification are always retained; low-risk XS/S work uses the code-scan review mode.

## Done-when

Routing is complete when the decision record contains a risk tier, review mode, ordered phases, ordered gates, and readable reasons. Consumers persist that record rather than recomputing it from prose.

**Advance:** proceed to the phase returned by the session runner.
