# AGENTS.md

Repo guide for AI agents and contributors working in the `pm` plugin repository.

## Purpose

This repository contains the PM plugin itself, not a product that uses the plugin.

Use this file for repo conventions only. Do not treat it as the runtime source of truth for plugin behavior.

## Source Of Truth

Runtime behavior lives in:
- `commands/`
- `skills/`
- `agents/`
- `scripts/`

Public product promise lives in:
- `README.md`
- platform install guides such as `.codex/INSTALL.md` and `GEMINI.md`

Planning notes live in:
- `.planning/`

`.planning/` is committed and reviewable, but it is not runtime behavior.

## Boundaries

- `commands/` defines the user-facing command surface.
- `skills/` defines workflow behavior and output expectations.
- `agents/` defines delegated/subagent behavior.
- `scripts/` implements supporting runtime utilities.
- `tests/` should cover script behavior and important regressions.
- `.planning/` is for specs, plans, and product notes. Keep it small.

## Change Rules

- If command behavior changes, update the corresponding file in `commands/`.
- If workflow behavior changes, update the relevant `skills/` file.
- If delegated agent behavior changes, update the relevant file in `agents/`.
- If code changes affect the published UX, update `README.md` and any affected install docs.
- Keep command names and examples aligned across `README.md`, `commands/`, and `skills/`.

## Data Rules

- Never commit real credentials.
- Never commit private customer evidence or raw exports.
- Private machine/runtime data belongs in `.pm/` in the consuming project, not in this repo.
- Human-facing plugin outputs belong in `pm/` in the consuming project, not in this repo.

## Testing

- When changing `scripts/`, run the relevant tests in `tests/`.
- Prefer adding regression coverage for bugs in parsing, server behavior, security, and CLI contracts.
- If behavior is cross-platform or shell-sensitive, verify both the script contract and the test coverage.

## Planning Notes

- Prefer dated filenames in `.planning/`.
- Delete or archive stale planning notes once implemented.
- Do not confuse `.planning/` files with runtime plugin instructions.

## When Unsure

- Favor the smallest change that keeps runtime files, docs, and tests aligned.
- Prefer clearer structure over adding new top-level concepts unless they materially improve the product.
