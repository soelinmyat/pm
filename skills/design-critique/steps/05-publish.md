---
name: Publish
order: 5
description: Publish checked structured and HTML reports and record only the Design Critique gate row through dev-session gate
---

## Goal

Publish the machine report and accessible human report, validate the full evidence chain, and record the current Dev gate outcome.

## How

1. For an interrupted invocation before any finalized report or canonical recovery-history anchor, with no retained partial findings or unresolved decisions, follow `evidence-contract.md` § Interrupted transport before the first report. Blocked Dev attempts are retained attempts, not completed reviewer pairs. Preserve their files and original run ID; after source advancement use fresh current-source captures, both actual reviewers and new attempt paths for the first completed round 1. Do not fabricate a predecessor report or reuse this path for a completed failure.
2. Write `reviews.json` with `recovery_policy: scoped-diagnosis-v1` and exactly one evidence-bound Primary/Fresh Eyes pair for every consecutive round. Preserve every predecessor row unchanged; bind the prior immutable report as `previous_report` on each later round, and include `recovery` after round two (see the evidence contract). Keep each round's route/captures/reviews/report/HTML at immutable round paths; record the final immutable report as the current Design phase review artifact for gate discovery. Bind the exact route/captures, shared context source, per-round capture manifest, perspective instruction hash, canonical input/result, runtime/model, fresh context/invocation, and durable receipt. Record assurance as `workflow-attested-non-cryptographic`; never describe caller-authored identities as proof of separate model execution.
3. Write schema-v2 `report.json` using `evidence-contract.md`. Bind the exact route, captures, and reviews bytes; repeat the honest review assurance; account for coverage; copy the final-round Primary scores exactly; reconcile every source/final finding exactly once; include resolution history, rounds, outcome, and authority when deferred. Derive passing eligibility from source Design blockers as well as final findings. Schema-v1 reports are inspection-only and cannot certify.
4. Render `report.html` from `${CLAUDE_PLUGIN_ROOT}/references/templates/design-critique-report.html`. Replace `{{PLUGIN_VERSION}}` with `version` from `${CLAUDE_PLUGIN_ROOT}/plugin.config.json`; unresolved or stale generator versions fail validation. Show verdict first, coverage and scores next, then both perspective summaries, the visible non-cryptographic assurance, reconciliation, findings, before/after evidence, ownership handoffs, and methods. Its PM artifact metadata source must hash-bind `report.json`; evidence must hash-bind both `captures.json` and `reviews.json`. Each perspective and reconciliation row uses the required visible hash markers.
5. Run `artifact-check.js` against the HTML, then run the full chain checker:

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

6. Pass the final immutable machine report as the phase's absolute `review` evidence artifact. In Dev, return that checked artifact to Dev step 06. The caller records the phase using `dev-session.js record`. It reruns the full checker, writes the passing gate and then advances state under the session lock. The same contract applies when a standalone critique records passing evidence in an active Dev session. An interrupted attempt's report may remain under its original `runs/{run}/round-{N}/attempt-{A}/` path, with its route, captures and HTML in that same attempt. Preserve original receipt, capture and reviewer bindings. For an already recorded passing phase missing its gate, run `dev-session.js gate --session <absolute session.json> --name design-critique` against the recorded artifact. That command revalidates it with the current checker. If the original prompt or other active evidence is stale, retain it and use the supported recertification path. For `failed`, `blocked`, or `deferred`, use `gate --status failed|blocked --reason "<concrete reason>"`; map `deferred` to `blocked`. Never hand-edit `gates.json`.
7. Keep the task-level assessment and accepted tradeoffs visible in the existing perspective summaries; link to the observed journey and comparison evidence. Report entry/return gaps honestly. Coverage and a passing checker certify the evidence contract, not usability by themselves. Outside Dev, run `dev-gate-check.js --require design-critique` only for a passed outcome, after the gate write. Inside Dev, the phase recorder checks the candidate manifest before writing and advancing. Return report paths, coverage, score summary, resolved blockers, remaining P2/P3 findings, and the single next action.

## Done-when

- `route.json`, `captures.json`, `reviews.json`, `report.json`, and `report.html` are saved and mutually hash-bound.
- Every review and reconciliation row is visibly represented in the human report.
- The artifact checker and design-critique checker pass for a `passed` outcome.
- The preserved Dev gate sidecar reflects the exact outcome and current commit; for a passed outcome inside Dev, the phase recorder writes that row.
- The user or calling phase has the report location and next action.

**Advance:** return to the caller. In Dev, continue to QA only when the Design Critique gate is passed; otherwise stop at the recorded outcome.
