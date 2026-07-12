---
name: Freeze review target
order: 1
description: Bind the exact Git diff, route logical lenses, and plan adaptive reviewer allocation
requires:
  - ../references/evidence-contract.md
---

## Goal

Create immutable `target.json` for the current committed diff and a reviewer plan that covers every applicable logical lens exactly once.

## How

1. Resolve the session slug with the shared `deriveSessionSlug` helper from `scripts/lib/session-slug.js`. For example, `codex/pm-dev-workflow-proposal` resolves to `pm-dev-workflow-proposal`. Choose a stable kebab-case run ID. Store evidence under `.pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/`; never reuse a prior run or round directory.
2. Refuse uncommitted implementation changes. Fetch the authoritative remote default; do not trust a stale local base ref.
3. Choose `full` from Dev's recorded route or for standalone review. Use `code-scan` only when the canonical Dev route says so.
4. Choose the configured profile from `skills/dev/references/model-profiles.json`. Use the observed safe reviewer capacity, capped at six. Do not encode model names in prompts.
5. Generate the target:

```bash
node "$PM_PLUGIN_ROOT/scripts/review-target.js" \
  --root "$PWD" \
  --out ".pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/target.json" \
  --run-id "{RUN_ID}" \
  --dev-session ".pm/dev-sessions/{slug}/session.json" \
  --mode "{full|code-scan}" \
  --profile "{PROFILE}" \
  --max-workers "{CAPACITY}"
```

For Dev-routed work, `--dev-session` is mandatory and binds the stable run, slug, review mode, decision version, and acceptance-criteria digest. Omit it only for a genuinely standalone Review. Add `--acceptance`, `--design-critique`, or `--prior-report` when those current artifacts exist. For rounds 2–3, keep the same run ID, increment `--round`, and bind the immediately prior immutable `round-{N-1}/report.json`.
6. Read the generated allocation. Treat its physical workers, logical lenses, runtime snapshot, and applicability decisions as authoritative for this round.

## Done-when

- `target.json` binds current HEAD, remote base commit, binary diff, changed-file bytes, route, ownership, logical lenses, and allocation.
- Every applicable lens is assigned exactly once; every non-applicable lens has a concrete route reason.
- Round and prior-report bindings follow the three-round contract.

**Advance:** proceed to Step 2 (Dispatch reviewers).
