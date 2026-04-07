# Capability Gates

Shared classification for optional tools, skills, and runtime features used by PM workflows.

## Meanings

| Class | Meaning |
|-------|---------|
| `required` | Stop if unavailable. The workflow cannot continue credibly without it. |
| `preferred` | Use when available. If unavailable, log the downgrade and continue. |
| `optional` | Nice to have. Never block or warn loudly. |
| `runtime-specific` | Only relevant in some runtimes. Ignore elsewhere. |

## Shared Gates

| Capability | Class | Notes |
|------------|-------|-------|
| `delegation` | `runtime-specific` | Required only when a workflow explicitly chooses delegated execution. Inline execution must remain available in Codex. |
| `persistent_workers` | `runtime-specific` | Required only for resumable delegated worker flows. Claude normally has this. Codex only has it when delegation is enabled. |
| `gh` for PR creation/merge | `required` when the chosen path creates or merges a PR | Detect early and stop only on PR-required paths. |
| Code Review (Agent 1 in `pm:review`) | built-in | Routes by runtime: Anthropic `code-review:code-review` in Claude Code, built-in `pm:code-reviewer` elsewhere. No availability check needed. |
| `pm:simplify` | built-in | Always available. In Claude Code, delegates to Anthropic's official simplify internally. No availability check needed. |
| `design-critique` | `preferred` unless the project explicitly treats it as mandatory | If unavailable, log the downgrade and continue to the next gate. |
| `Playwright MCP` | `preferred` for QA and design critique on web | If absent, QA may degrade or block depending on whether browser testing is central to the task. |
| `Maestro MCP` | `preferred` for mobile QA/design critique | Same rule as Playwright, but mobile-specific. |
| `dashboard session view` | `optional` | Artifact viewer only by default. Never block on it. |
| `dashboard input` | `runtime-specific` | Off by default. Only use if the dashboard is explicitly configured as interactive. |

## Usage Rules

1. Check required capabilities before entering the stage that depends on them.
2. Check preferred capabilities once, log the result, and avoid repeating the same warning.
3. Do not upgrade a preferred capability into a blocker in one flow while treating it as optional in another.
4. In Codex, lack of delegation must never block the workflow if inline execution is still possible.
