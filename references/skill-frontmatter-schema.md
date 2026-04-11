# Skill Frontmatter Schema

Every SKILL.md file includes a YAML frontmatter block between `---` fences. This document defines the `runtime:` block schema that declares each skill's runtime capabilities.

## Schema

```yaml
---
name: skill-name
description: "Skill description"
runtime:
  requires: []            # capabilities needed from the runtime
  agents: 0               # independent agents dispatched (typical count)
  guarantee: "..."        # human-readable output contract
  degradation: none       # fallback when delegation unavailable
---
```

## Field Definitions

### `runtime.requires`

- **Type:** array of strings
- **Allowed values:** `["delegation"]` (extensible — unknown values fail build)
- **Default:** `[]`
- **Purpose:** Declares which runtime capabilities the skill needs beyond inline execution. An empty array means the skill runs identically on all runtimes.

Capabilities referenced here are defined in `capability-gates.md`.

### `runtime.agents`

- **Type:** non-negative integer
- **Purpose:** Number of independent agents the skill typically dispatches. Skills with variable agent counts use the typical count and document variability in the `guarantee` string.
- **Rules:** Must be `0` when `requires` is empty. Must be `>= 1` when `requires` includes `delegation`. No string values — always an integer.

### `runtime.guarantee`

- **Type:** non-empty string
- **Purpose:** Human-readable contract describing what the skill produces. This is the behavioral promise regardless of runtime.

### `runtime.degradation`

- **Type:** enum string
- **Allowed values:** `"inline"` | `"none"`
- **Purpose:** Fallback strategy when required capabilities are unavailable.
  - `"inline"` — the skill runs sequentially in the main context, producing structurally equivalent output
  - `"none"` — the skill has no degradation path (either because it has no requirements, or because degradation is not applicable)

## Examples

### Delegation-heavy skill (review)

```yaml
---
name: review
description: "Multi-perspective code review"
runtime:
  requires: [delegation]
  agents: 3
  guarantee: "3 independent review perspectives with verdicts"
  degradation: inline
---
```

### Pure-inline skill (tdd)

```yaml
---
name: tdd
description: "Use when implementing any feature or bugfix"
runtime:
  requires: []
  agents: 0
  guarantee: "red-green-refactor cycle per requirement"
  degradation: none
---
```

### Optional delegation skill (subagent-dev)

```yaml
---
name: subagent-dev
description: "Use when executing implementation plans with independent tasks"
runtime:
  requires: [delegation]
  agents: 3
  guarantee: "one agent per plan task with spec + code review (typical 3 tasks)"
  degradation: inline
---
```

## Skill Contract Reference

| Skill | requires | agents | degradation |
|---|---|---|---|
| dev | [delegation] | 2 | inline |
| review | [delegation] | 3 | inline |
| simplify | [delegation] | 3 | inline |
| design-critique | [delegation] | 2 | inline |
| groom | [delegation] | 3 | inline |
| qa | [delegation] | 1 | inline |
| ship | [] | 0 | inline |
| research | [delegation] | 3 | inline |
| refresh | [delegation] | 3 | inline |
| subagent-dev | [delegation] | 3 | inline |
| start | [] | 0 | none |
| debugging | [] | 0 | none |
| tdd | [] | 0 | none |
| think | [] | 0 | none |
| note | [] | 0 | none |
| ingest | [] | 0 | none |
| strategy | [] | 0 | none |
| setup | [] | 0 | none |
| sync | [] | 0 | none |
| using-pm | [] | 0 | none |

## Validation

Build-time validation in `generate-platform-files.js` enforces this schema. See Issue 5 of the runtime parity RFC for implementation details.
