# Phase Labels

Canonical source of truth for display labels across every `(kind, phase)` tuple produced by PM session state files.

Both `/pm:list` (terminal) and any future dashboard consumer import labels from here via `scripts/phase-labels.js` — so the two surfaces never drift.

## Contract

- Keyed by the `(kind, phase)` tuple. Same `phase` string can resolve to different labels under different kinds (e.g. `groom/active` vs `think/active`).
- `phase: "active"` is the implicit default when a state file omits the phase/stage field. It is never written explicitly to disk, but the label must still be defined so rows render a sensible badge.
- Unknown `(kind, phase)` pairs are not errors. The loader falls back to a title-cased rendering of the raw phase (`"mystery-phase"` → `"Mystery phase"`). An empty/nullish phase renders `"(no phase)"`.

## Labels

| Kind | Phase | Label |
|---|---|---|
| `groom` | `active` | In progress |
| `groom` | `intake` | Intake |
| `groom` | `strategy-check` | Strategy check |
| `groom` | `research` | Research |
| `groom` | `scope` | Scoping |
| `groom` | `scope-review` | Scope review |
| `groom` | `design` | Design |
| `groom` | `draft-proposal` | Draft proposal |
| `groom` | `team-review` | Team review |
| `groom` | `bar-raiser` | Bar raiser |
| `groom` | `present` | Present |
| `groom` | `link` | Link |
| `rfc` | `active` | In progress |
| `rfc` | `intake` | Intake |
| `rfc` | `rfc-generation` | RFC generation |
| `rfc` | `rfc-review` | RFC review |
| `rfc` | `approved` | Approved |
| `dev` | `active` | In progress |
| `dev` | `intake` | Intake |
| `dev` | `workspace` | Workspace |
| `dev` | `rfc-check` | RFC check |
| `dev` | `implement` | Implementation |
| `dev` | `simplify` | Simplify |
| `dev` | `design-critique` | Design critique |
| `dev` | `qa` | QA |
| `dev` | `review` | Review |
| `dev` | `ship` | Ship |
| `dev` | `retro` | Retro |
| `think` | `active` | Thinking |

## Consumers

- `scripts/phase-labels.js` — exports `phaseLabel(kind, phase)` and `allPhases()`. Loaded by `scripts/start-status.js` when emitting the `--format list-rows` payload.
- Future: dashboard phase badges (PM-027) will adopt this mapping when they ship.
