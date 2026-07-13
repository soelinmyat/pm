---
name: Publish
order: 5
description: Publish checked structured and HTML reports and update only the Design Critique gate row
---

## Goal

Publish the machine report and accessible human report, validate the full evidence chain, and record the current Dev gate outcome.

## How

1. Write `report.json` using `evidence-contract.md`. Bind the exact route and captures bytes, account for coverage, include mode-specific scores, findings, resolution history, rounds, outcome, and authority when deferred.
2. Render `report.html` from `${CLAUDE_PLUGIN_ROOT}/references/templates/design-critique-report.html`. Replace `{{PLUGIN_VERSION}}` with `version` from `${CLAUDE_PLUGIN_ROOT}/plugin.config.json`; unresolved or stale generator versions fail validation. Show verdict first, coverage and scores next, then findings, before/after evidence, ownership handoffs, and methods. Its PM artifact metadata source must hash-bind `report.json`; evidence must hash-bind `captures.json`.
3. Run `artifact-check.js` against the HTML, then run the full chain checker:

```bash
node "$PM_PLUGIN_ROOT/scripts/design-critique-check.js" \
  --root "$PWD" \
  --route ".pm/dev-sessions/{slug}/design-critique/route.json" \
  --captures ".pm/dev-sessions/{slug}/design-critique/captures.json" \
  --report ".pm/dev-sessions/{slug}/design-critique/report.json" \
  --commit "$(git rev-parse HEAD)" \
  --base "origin/{DEFAULT_BRANCH}" \
  --base-commit "{BASE_COMMIT_FROM_ROUTE}"
```

The checker resolves Chromium automatically. If the project uses a nonstandard browser binary, add `--browser "{CHROMIUM_PATH}"` or set `PM_ARTIFACT_BROWSER`. Remote-base verification is noninteractive and bounded; a timeout is a blocked gate, not permission to trust a stale local ref.

4. For `passed`, update only the `design-critique` row in canonical `.pm/dev-sessions/{slug}/gates.json` with current commit and project-relative `.pm/dev-sessions/{slug}/design-critique/report.html` as the artifact. Preserve `tdd`, legacy `simplify`, `qa`, `review`, and `verification` rows; never write the flat legacy sidecar when the canonical session directory exists. For `failed`, `blocked`, or `deferred`, record a non-passing gate with the concrete reason; map `deferred` to `blocked` because the Dev schema has no deferred status.
5. Run `dev-gate-check.js --require design-critique` only for a passed outcome. Return report paths, coverage, score summary, resolved blockers, remaining P2/P3 findings, and the single next action.

## Done-when

- `route.json`, `captures.json`, `report.json`, and `report.html` are saved and mutually hash-bound.
- The artifact checker and design-critique checker pass for a `passed` outcome.
- The preserved Dev gate sidecar reflects the exact outcome and current commit.
- The user or calling phase has the report location and next action.

**Advance:** return to the caller. In Dev, continue to QA only when the Design Critique gate is passed; otherwise stop at the recorded outcome.
