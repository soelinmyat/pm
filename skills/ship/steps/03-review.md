---
name: Prepare Release and Review Gate
order: 3
description: Freeze the prepared delivery tree, bind final evidence, and run Review before pushing
---

## Prepare Release and Review

<!-- telemetry step: review -->

## Goal

Prepare the exact tree that will be delivered, then run the required pre-push review and bind all current gate evidence to that same commit.

## How

Read `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/review-candidate-contract.md`, `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/repository-delivery-adapter.md`, `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md`, and `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md` before this step.

### Select the delivery route before publication

Before release preparation or any external effect, validate the canonical Dev session and current repository delivery plan. Use `selectPublicationRoute` from `scripts/review-convergence.js`. The optimized route requires all three current facts: the Dev classifier selected `review-candidate`, protected machine-readable policy explicitly grants candidate-publication permission for the exact skipped-command set, and the repository adapter proves exact coverage for commands, hook inputs, destination, refs, tool/environment, and configuration identity.

If any fact is absent, candidate-authored, ambiguous, or stale, select **existing comprehensive Ship before candidate publication**. Do not open an early draft and do not add a later second certification. Continue with the comprehensive path below unchanged and report the unavailable optimization.

For the capability-proven candidate route:

1. Resolve and freeze the exact delivery remote and authority as described below, but do not prepare a version release or claim final certification.
2. Run `pm:review` in branch mode against the current exact head. A current local diff review is mandatory even when prior evidence exists.
3. Re-run the repository environment preflight, then execute the current delivery plan in `targeted` mode through `repository-gate-runner.js`. Require `status: passed`; `comprehensive`, blocked, failed, or stale results select the legacy comprehensive path before publication.
4. Revalidate protected candidate-publication permission and exact adapter coverage after the targeted run. Transition the canonical candidate to `review-candidate`; require draft-only candidate authority and the separate canonical user grants for push and PR creation.
5. Advance to Push without binding final certification evidence. The draft review surface exists to collect feedback before that expensive boundary.

After candidate condition 5 succeeds, do not execute the comprehensive preparation sections in this step; advance directly to Step 04. The remainder of this step is the preserved comprehensive path. It also remains the path for standalone Ship and every capability fallback. This step owns preparation of the final release transaction and creation of the run-scoped delivery contract; later steps validate them but must not silently replace either identity.

If no canonical `session.json` exists (standalone Ship invocation), create it before Review:

```bash
node "$PM_PLUGIN_ROOT/scripts/dev-session.js" init \
  --slug "{slug from deriveSessionSlug(current branch)}" \
  --source-dir "$PWD" \
  --task "standalone-ship-review" \
  --json
```

Read the created session and confirm `routing.review_mode` is `full`, its recorded branch equals the current branch, and its slug equals the canonical artifact namespace. Then invoke `pm:review` with that `session.json`. This session bootstrap is mandatory: a sessionless Review is useful as an advisory standalone report but cannot authorize delivery. Do not skip review for standalone invocations.

The initializer's route is only a safe placeholder. Before Review, write bounded routing facts for the frozen diff and persist them with `dev-session route`. Standalone Ship must conservatively route the complete delivery gate set, including Design Critique and QA; a non-UI diff satisfies those two gates through their documented policy skips rather than by omitting them from `routing.required_gates`:

```json
{"kind":"task","size":"M","risk":{"behavioral":1,"ui":1},"acceptance_criteria":[],"work_units":[]}
```

Save that object beside the session as `ship/standalone-routing-facts.json`, run `node "$PM_PLUGIN_ROOT/scripts/dev-session.js" route --session ".pm/dev-sessions/{slug}/session.json" --facts ".pm/dev-sessions/{slug}/ship/standalone-routing-facts.json" --json`, and require `routing.required_gates` to equal `tdd, design-critique, qa, review, verification` before continuing. Do not advance with the initializer's placeholder route.

Before advancing to Push, execute every gate in the bootstrapped session's `routing.required_gates`, not only Review. Use the same Dev gate procedures for TDD, Design Critique, QA, and verification, recording a valid passed or policy-allowed skipped row for each routed gate. Standalone Ship is not a reduced-quality route; discovering missing rows at `git push` is a recovery path, not the normal workflow.

Resolve the exact named delivery remote using, in order, `branch.<branch>.pushRemote`, `remote.pushDefault`, `branch.<branch>.remote`, then `origin`. Confirm the name appears exactly in `git remote` and `git config --get "remote.${name}.url"` succeeds; this also supports valid dash-prefixed remote names that option-style commands mishandle. Pass that name to Review target creation as `--remote`; do not review against `origin` and later push to a different remote.

Persist that exact name as `source.delivery_remote` in canonical `session.json`, update `updated_at`, and validate the session with `node "$PM_PLUGIN_ROOT/scripts/dev-session.js" validate --session ".pm/dev-sessions/{slug}/session.json" --json`. Every later Ship step must read this value; never re-resolve or silently fall back after Review binds the destination.

For standalone Ship, persist action-specific user authority through `dev-session authorize` before any external action. `push_feature_branch`, `create_pr`, and `merge` are independent grants; record only what the user requested. A saved `preferences.ship.auto_merge` value cannot grant merge. If the request did not make the delivery boundary clear, ask once now and do not advance to Push until the answer is recorded in `authority_log` and copied into the delivery contract.

After authority is settled, resolve the remote's sole push URL, normalize its exact GitHub `OWNER/REPO`, and persist its SHA-256, current head/default-base identity, and canonical authority snapshot in `.pm/dev-sessions/{slug}/ship/delivery-contract.json` exactly as specified by `delivery-contract.md`. Multiple push URLs, a non-GitHub destination, or an unparseable owner/repo blocks Ship.

### Prepare the final tree before Review

With session bootstrap, routing, authority, delivery-remote resolution, and the delivery contract complete, select exactly one transaction mode:

- **Versioned:** when AGENTS.md, the task, or repository scripts require a version bump, run the documented `npm run prepare-release -- {patch|minor|major|x.y.z} --session ...`. This commits the mutation and creates no tag.
- **Delivery-only:** when no version mutation is required, run `release-transaction.js initialize` for current HEAD.

Do not infer a bump level. Repository policy or explicit user scope chooses it. If a version mutation is required but the level is absent, stop before Review for that release decision. Never use legacy `bump-version.js` inside this workflow.

Read the transaction back and require its prepared commit to equal `git rev-parse HEAD`, its branch/remote/base to equal the canonical session, and `tag_created: false`. The prepared commit is the only commit Review may freeze.

The review gate is the last quality check before code leaves your machine. Bugs caught here cost minutes to fix; bugs caught in production cost hours. A report from before `prepare-release` is stale even when implementation files are unchanged.

### Skip check

**Verify review ran (standalone invocation guard):** Resolve the branch sidecar and its `review` row. The row must be `passed` and bind the prepared commit — either directly, or through `verified_commit`/`verified_at` written by `dev-session recertify` — and point to project-relative `.pm/dev-sessions/{slug}/review/report.html`. Read sibling `review/report.json`, then run `node "$PM_PLUGIN_ROOT/scripts/review-check.js" --root "$PWD" --report "{REPORT_PATH}" --from-report`. When the frozen report's commit is not the prepared commit, first fetch `{DELIVERY_REMOTE}` so its remote-tracking ref is current, then additionally run `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" check --root "$PWD" --review-dir ".pm/dev-sessions/{slug}/review" --base "$(git rev-parse --verify "refs/remotes/{DELIVERY_REMOTE}/{DEFAULT_BRANCH}^{commit}")"` — where `{DELIVERY_REMOTE}` is the session's persisted `source.delivery_remote`, never a hardcoded `origin` — and require exit 0. `--verify` is required: bare `git rev-parse` echoes the ref name on stdout when the ref is missing, which would silently pass a non-SHA as the base. If it fails, the authoritative base is unknown — do NOT run the skip check; re-run Review. The `--base` live authoritative base is required — without it a rebase onto an advanced base cannot authenticate (delivery-contract § 4). A passing check authenticates the prepared commit against the frozen certification by content identity or a valid delta-supplement chain (see `${CLAUDE_PLUGIN_ROOT}/skills/review/references/delta-supplement.md`). Only these passing current checks may skip a new review. Log: "Review gate already passed with current checked evidence — skipping."

If the row, report, any bound result, prepared-SHA freshness check, remote base, diff, or browser-checked HTML fails, the state is stale — do NOT skip. Re-run Review so what ships is what was reviewed.

### Run the review

Invoke `pm:review` in branch mode (no PR number argument):

```
Invoke pm:review (no arguments — it will diff current branch against the default branch)
```

This freezes the target, plans six logical lenses across available reviewers, validates structured evidence, preserves disagreement, runs bounded fix rounds, and publishes checked JSON plus HTML.

For the full workflow, see `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md`.

If `pm:review` reports "No changes to review", stop — there's nothing to push.

`pm:review` writes a current checked report and points the sidecar `review` row to its HTML artifact. The report binds target, commit, remote base, binary diff, reviewer results, decisions, findings, and human projection. Any later commit, rebase, merge-loop fix, or evidence mutation invalidates the check and requires a new round.

Confirm the report checker and sidecar row pass before proceeding. A Markdown line alone is never review evidence.

### Bind canonical evidence into the transaction

Run every routed gate at the prepared commit. Bind canonical Review, QA, and verification artifacts with `release-transaction.js bind-evidence` following `release-transaction.md`. Design Critique remains enforced through the canonical gate sidecar and Dev evidence; Review's target carries the upstream critique binding when UI applies.

Run `release-transaction.js status` and require `ready: true`. Then run `dev-gate-check.js` at current HEAD with the exact delivery remote, base, and `--require-authority push_feature_branch,create_pr`. A passing prose summary, prior review report, or CI status cannot replace either executable check.

### What "passing" means

Review passes only with complete current logical-lens coverage, no unresolved Review-owned high/critical finding, and no unresolved reviewer disagreement or decision-required item. The bar by route:

| Size | Review bar |
|------|-----------|
| XS/S via `pm:dev` | Checked `code-scan` report with bug, edge, reuse, quality, and efficiency coverage |
| Standalone `pm:ship` | Run `pm:review` unless a current `review` gate already exists |
| M | Checked full report; safe mechanical fixes may run automatically; disputes require decisions. |
| L/XL | Same machine gate; every handoff, advisory, decision, and fix round remains in the report. |

**Critical findings** are bugs, security issues, data loss risks, or behavioral regressions. These block push — always fix before proceeding.

**Advisory findings** are style suggestions, alternative approaches, or minor improvements. These don't block push but should be consciously evaluated, not silently ignored.

### When review finds issues

1. **Auto-fixable findings:** Review auto-fixes and commits them. Verify the fixes are correct — don't blindly trust auto-fix on complex logic.
2. **Manual-fix findings:** Fix them, run tests, commit. Then re-run `pm:review` to confirm the fix didn't introduce new issues.
3. **Disagreement with a finding:** Record an explicit approver, action, and rationale in `decisions.json`. A PR-description note cannot override the machine gate.

### PR description quality

Before creating the PR in the next step, the review step should ensure you have enough context to write a good PR description. A good PR description:

- Summarizes **why** the change exists, not just what files changed
- Lists any decisions made during implementation that reviewers should know about
- Notes testing approach — what was tested, what edge cases were considered
- Calls out anything unusual — workarounds, known limitations, deferred improvements

For handling review feedback after PR creation, see `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md`.

## Done-when

On the optimized route, the exact current head has passed local diff Review and targeted native checks, protected candidate-publication permission plus exact adapter coverage remain current, draft-only candidate state is recorded, and canonical push/PR authority is persisted. On the comprehensive route, the required version mutation (if any) is committed without a feature tag, the correct review path has run against that prepared commit and frozen remote, all routed gates are current, Review/QA/verification evidence is bound into a ready transaction, the delivery contract validates, and explicit authority for the next action is persisted.

**Advance:** proceed to Step 04 (Push).
