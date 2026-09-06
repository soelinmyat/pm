---
name: Merge Loop
order: 7
description: Self-healing merge loop with gate monitoring, auto-merge, cleanup, and Product Memory updates
---

## Phase 2: Merge Loop

<!-- telemetry step: merge-monitor -->

## Goal

Drive the PR through all readiness gates to a confirmed merge, then clean up.

## How

Read and validate `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/release-transaction.md` and `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/delivery-contract.md`. Require verified `push` and `create-pr` effects. Before arming auto-merge or issuing a manual merge, freshly attest the exact live PR body, plan `merge` for the exact PR/prepared commit/base/method/body hash, call `begin`, and require canonical and snapshotted `merge: true`. On the optimized route, reload and require candidate state `merge-ready` before begin and every observe-first recovery; invalidation blocks new mutation and requires cancelling any armed auto-merge before remediation. If the exact PR has already merged, reconcile that irreversible observation instead of leaving the journal ambiguous. If merge was not explicitly requested and persisted before the action, the transaction records `denied` and Ship stops at the green PR boundary. `preferences.ship.auto_merge` alone is never merge authority.

### Pre-merge gate attestation (HARD-GATE)

Before arming auto-merge or invoking `gh pr merge`, re-verify the gate attestation:

1. Reload the delivery contract and revalidate its sole push-URL hash, normalized `GH_REPO`, `HEAD_BRANCH`, `BASE_BRANCH`, and exact PR API identity. Read `{DELIVERY_REMOTE}` from canonical `session.json`, then resolve `remote_tip="$(git rev-parse "{DELIVERY_REMOTE}/{branch}")"` — the reviewed tree that would actually merge. Stop if the persisted remote or any destination/head/base identity has changed.
2. Read canonical `.pm/dev-sessions/{slug}/gates.json`. For each required row, the effective attestation is `commit` when it equals `remote_tip`, otherwise `verified_commit` when it equals `remote_tip`.
3. Compute changed files with `changed_files="$(git diff --name-only "{DELIVERY_REMOTE}/{DEFAULT_BRANCH}...{DELIVERY_REMOTE}/{branch}" | paste -sd, -)"`.
4. Set `PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"`, then run `node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" --manifest .pm/dev-sessions/{slug}/gates.json --commit "$remote_tip" --branch "{branch}" --remote "{DELIVERY_REMOTE}" --base "{DELIVERY_REMOTE}/{DEFAULT_BRANCH}" --review-evidence-mode enforce --require-authority merge --changed-files "$changed_files"`. The checker is the authority for effective attestation and merge authority; do not require every raw `commit` field to equal the remote tip.
5. If every required row is effectively attested and the checker passes: proceed to the merge loop.
6. If any row is missing or neither `commit` nor `verified_commit` matches `remote_tip` — fix commits, rebases, or auto-fixes have landed since the last attestation — run the final recertification pass from `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/08-review.md` through the complete post-mutation recertification protocol in `delivery-contract.md`. Rerun Review and any changed routed gate, regenerate canonical artifacts, pass `dev-gate-check`, and push the recertified commit before retrying this attestation. Only proceed once the sidecar attests the exact remote branch tip.

For an optimized delivery, also verify `delivery-attestation-v1` for `remote_tip`. Its commit/base/merge-base, affected plan, config/tool/preflight/command identities, evidence hashes, outcome, invalidation generation, destination, and ref update must still match. Classify live default-branch drift with `base-drift.js`; preserve feature Review only for provably disjoint drift, and claim optimized latest-base readiness only with a current authenticated merge-result or merge-queue capability. Otherwise run comprehensive base update and recertification without layering a second complete certification on top.

This enforces ship's Iron Law — "NEVER MERGE WITHOUT READING THE DIFF" — structurally. A stale review SHA means code is about to ship that no review ever read.

### Reviewer-handoff body attestation (HARD-GATE)

After all other pre-merge checks and immediately before the Merge `begin`, read
the exact PR again through the contracted repository API. Save a bounded private
observation at
`.pm/dev-sessions/{slug}/ship/observations/pr-body-pre-merge.json` with exactly
the normalized repository, PR number, `OPEN` state, head OID, base, boolean draft
state, raw API `body` string, and `observed_at` captured as
`new Date().toISOString()` immediately when that API response is read. The
timestamp must use the runtime's exact `YYYY-MM-DDTHH:mm:ss.sssZ` form. Example:

```json
{
  "repository": "acme/widget",
  "pr_number": 42,
  "state": "OPEN",
  "head_oid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "base": "main",
  "draft": false,
  "body": "## Summary\n\nCanonical reviewer handoff.\n",
  "observed_at": "2026-09-05T06:12:34.567Z"
}
```

Then run:

```bash
node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" attest-pr-body \
  --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
  --observation-file ".pm/dev-sessions/{slug}/ship/observations/pr-body-pre-merge.json" \
  --json
```

The runtime rejects an observation more than five minutes old or more than 30
seconds in the future, preserves its API-read `observed_at` without re-stamping
it, hashes the observed body itself, and requires it to equal both the
canonical `pr-body.md` bytes and the verified Create PR receipt. It also binds
repository, PR number, prepared head, base, open state, and `draft: false`.
Include that same `body_sha256` in the Merge target. The attestation is valid for
five minutes and one Merge attempt only. If it expires or a definitely absent
attempt becomes retry-safe, re-observe and attest again; never refresh the
timestamp without another API read. An ambiguous `attempting` Merge remains
observe-first because it may already be irreversible.

A mismatched body means the reviewer handoff was externally edited or is stale.
Stop before Merge and restore it only with explicit authority to edit the PR,
then re-observe and attest. Do not treat an earlier verified Create PR receipt as
current proof. After Merge, include the independently observed live
`body_sha256` in the Merge receipt too; a different post-effect body cannot be
reconciled as `matched`.

If a pre-merge check exposes a **pre-existing unrelated default-branch
failure**, require comparison evidence from the same command, toolchain, and
current authoritative default-branch commit. Do not call the gate or Ship
successful, bypass required checks, or expand scope automatically to repair it.
Keep delivery blocked at the PR boundary, preserve both outputs, and ask for
explicit authority to create a separate remediation unit. If remediation changes
either branch, rerun the complete post-mutation recertification path before
another merge attempt. A known baseline failure is context, never a passing
result.

Read and follow `${CLAUDE_PLUGIN_ROOT}/references/merge-loop.md` for the full procedure. Supply its variables only from the validated delivery contract. Every repository-aware `gh pr` / `gh run` call passes `--repo "$GH_REPO"` and the explicit `PR_NUMBER`; API calls use the persisted owner/repository. Wrap every network call with `gh_retry` so a transient 5xx / gateway / timeout does not abort the merge.

After the merge command or auto-merge, independently observe the PR. Reconcile `merge` as matched only when state is `MERGED`, observed head OID equals the prepared commit, the observed body hash still equals the Merge target, and a merge SHA is present. OPEN remains `attempting` while monitoring; CLOSED without merge, a different head, or a different body is `conflict`.

For a versioned transaction, immediately plan `place-main-tag` for the release tag and verified merge SHA. Fetch the authoritative base, observe the remote tag first, and follow the effect protocol. Create and push the tag only when it is absent and `begin` returns `execute`. A matching tag is idempotent success; a tag at any other commit blocks and is never force-moved automatically. Delivery-only transactions skip this effect by schema.

**Ship-specific additions** (on top of the shared merge loop):

1. **Codex review gate:** If `codex_review: true` in CLAUDE.md or AGENTS.md, wait for Codex bot comment before merging. 5-minute cooldown after @codex comment. After 15 min total, ask user: proceed without or keep waiting.
2. **State updates:** Update canonical `.pm/dev-sessions/{slug}/session.json` and its ship sidecars at every gate-check cycle.

### State file during gate monitoring

The canonical session and ship transaction must retain equivalent gate-monitoring state:

```markdown
## Ship
- Stage: gate-monitoring
- PR: #N (URL)
- CI: passed / running / failed
- Review: approved / pending / changes_requested
- Threads: 0 unresolved / N unresolved
- Conflicts: clean / conflicted
- Auto-merge: armed / unavailable
- Fix commits: [list of fix commit SHAs]

## Resume Instructions
- Next action: [single immediate step]
- Context: [PR #, gate status, unresolved thread id/file:line]
```

### Final Report

```
## Shipped

**PR:** #N — [title] ([URL])
**Branch:** [branch name]
**Review:** [N issues found and fixed by review agents]
**CI:** [passed after N rounds]
**Merged to:** {DEFAULT_BRANCH} ([short sha])
**Remote branch:** [branch] — deleted
**Local branch:** [branch] — deleted
**Worktree:** [removed at path / n/a]
```

## Product Memory

### Backlog prs write (after merge, before cleanup)

**Loop worker branch:** If `PM_LOOP_WORKER=1`, skip this backlog write and every Product Memory/card status write in this step. Preserve merge verification and all review/CI gates, then atomically return `merged`, `ready-for-human`, `waiting`, `blocked`, `failed`, or `noop` through `PM_LOOP_RESULT_FILE`. The loop worker verifies the PR and owns the durable transition.

After merge confirmation, if `{pm_dir}/backlog/{slug}.md` exists, update its frontmatter to record the PR number(s):

1. Read the existing frontmatter of `{pm_dir}/backlog/{slug}.md`
2. If `prs` field already exists, append the new PR number to the list. If not, create it.
3. Use quoted YAML format for PR values: `- "#N"` (the `#` is a YAML comment character — quoting is load-bearing)
4. Commit and push to the default branch so the data reaches `main` before the feature branch is deleted

**This write must happen on the default branch after merge lands, before worktree cleanup.**

### Linear-originated work

After merge, check the session state for `linear_id`. If set and `{pm_dir}/backlog/{slug}.md` does not exist, the Status Updates section in Step 08 (ship) handles backlog creation. Ship ensures the PR number is available in the session state for the backlog entry's `prs` field.

Before cleanup, verify the backlog entry was written:
- Check: `test -f {pm_dir}/backlog/{slug}.md`
- If missing and `linear_id` is set: warn the user that product memory was not created.

## Done-when

The exact contracted PR and merge effects are verified, the canonical reviewer-handoff body has a fresh one-use pre-merge attestation plus matching post-merge observation, every delivery-loop fix was advanced and recertified before push, any versioned main-tag effect is verified at the merge SHA, required Product Memory updates are complete, and cleanup is done or intentionally skipped.

Say: "Ship complete. PR merged and cleanup finished. What would you like to work on next?"
