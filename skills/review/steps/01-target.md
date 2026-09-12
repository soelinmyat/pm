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

1. Resolve the session slug with the shared `deriveSessionSlug` helper from `scripts/lib/session-slug.js`. For example, `codex/pm-dev-workflow-proposal` resolves to `pm-dev-workflow-proposal`. Choose a stable kebab-case run ID only when no unfinished lineage exists for the bound Dev run and decision version. Store evidence under `.pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/`; never reuse a prior run or round directory, and never change `RUN_ID` to reset the remediation cap.
2. Refuse uncommitted implementation changes. Resolve the authoritative remote default; do not trust a stale local base ref. Use three-dot diff semantics and retain the merge base for deleted-file evidence; do not reject an otherwise valid feature branch merely because the remote default advanced after it branched.
3. Choose `full` from Dev's recorded route or for standalone review. Use `code-scan` only when the canonical Dev route says so. Preserve the bound Dev `security_review_required` decision; when true, the generated target must make the distinct `security` lens applicable regardless of physical reviewer count. Without a Dev session, let the target generator conservatively activate that lens when changed paths indicate authentication, authorization, credentials, cryptography, permissions, security, or dependency/supply-chain exposure; do not treat missing Dev context as evidence of low risk.
4. Resolve the profile from `skills/dev/references/model-profiles.json`: an explicit profile wins, otherwise retain a continuing Review lineage's target profile, then apply a workflow-specific Review policy, the bound Dev execution, a saved default, or the legacy default in that order. Resolve policy for the bound execution provider; do not silently switch providers. Omit `--profile` to let the target builder perform that resolution; do not substitute a default model manually. Use the observed safe reviewer capacity, capped at six. Do not encode model names in prompts.
5. Generate the target:

```bash
node "$PM_PLUGIN_ROOT/scripts/review-target.js" \
  --root "$PWD" \
  --out ".pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/target.json" \
  --run-id "{RUN_ID}" \
  --dev-session ".pm/dev-sessions/{slug}/session.json" \
  --mode "{full|code-scan}" \
  --remote "{DELIVERY_REMOTE, default origin}" \
  --max-workers "{CAPACITY}"
```

Resolve the delivery remote before target creation. Use `origin` for ordinary Dev Review. When Ship selected another named remote, pass that exact name with `--remote`; the target and delivery checker must resolve the same authoritative remote HEAD.

For Dev-routed work and Review invoked by Ship, `--dev-session` is mandatory and binds the stable run, slug, review mode, decision version, and acceptance-criteria digest. Ship bootstraps the canonical session before invoking Review when necessary. Omit it only for a genuinely advisory standalone Review that will not write a delivery-authoritative gate row. Add `--acceptance`, `--design-critique`, or `--prior-report` when those current artifacts exist. For rounds 2–3, keep the same run ID, increment `--round`, and bind the immediately prior immutable `round-{N-1}/report.json`. `review-target.js` rejects a different run ID while that Dev decision version has an unfinished lineage. A new run is allowed only after the latest lineage passes or explicit direction advances the Dev decision version.
The target command copies supplied Design Critique bytes into immutable `round-{N}/upstream/design-critique.json` before publishing the target. Later canonical design reports can advance without changing that binding.

For an older target that bound a mutable canonical design report, retain the original target and reports. If the exact original design JSON was archived, record its recovery with:

```bash
node "$PM_PLUGIN_ROOT/scripts/review-upstream.js" recover \
  --root "$PWD" \
  --target ".pm/dev-sessions/{slug}/review/runs/{OLD_RUN_ID}/round-{N}/target.json" \
  --archive "{preserved-original-design-report.json}"
```

Recovery requires the original SHA-256, commit, and outcome. It preserves an immutable snapshot and a separate recovery record; it does not rewrite historical evidence. Only historical lineage validation consumes recovery, while current Review freshness stays strict. Keep the archive as evidence. Missing or changed original bytes cannot be recovered by substituting a current report or resetting the Dev decision version. Retry the normal target command after successful recovery.

6. Read the generated allocation. Treat its physical workers, logical lenses, runtime snapshot, and applicability decisions as authoritative for this round.

## Done-when

- `target.json` binds current HEAD, remote base commit, binary diff, changed-file bytes, route, ownership, logical lenses, and allocation.
- Every applicable lens is assigned exactly once; every non-applicable lens has a concrete route reason. A routed `security_review_required` decision has exactly one `security` assignment.
- Round and prior-report bindings follow the three-round contract.
- The Dev decision version has no other unfinished review lineage.

**Advance:** proceed to Step 2 (Dispatch reviewers).
