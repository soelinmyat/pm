# Ship Delivery Contract

Use this contract before Ship performs any network mutation. It binds the user's action-specific authority to the exact reviewed Git destination and gives every later step one repository identity to use.

## Goal

Persist and continuously revalidate the authority, remote, repository, head branch, and base branch that Ship is allowed to deliver.

## 1. Record action-specific authority

The canonical authority envelope is `.pm/dev-sessions/{slug}/session.json`. Read `authority.push_feature_branch`, `authority.create_pr`, and `authority.merge` separately. A true value is valid only when its matching `authority_log` entry records the user's request made before the action.

For a standalone Ship invocation, map the user's request narrowly:

| User request | Grant |
|---|---|
| push only | `push_feature_branch` |
| open/create a PR | `push_feature_branch,create_pr` |
| merge, land, or complete the full Ship lifecycle | `push_feature_branch,create_pr,merge` |

`preferences.ship.auto_merge` is a behavior preference, never authority. It cannot grant `merge`. Do not infer merge authority from a request to push or create a PR. If the request is ambiguous, ask one action-specific question and stop before Push; after the answer, persist only the granted actions through the session writer:

```bash
node "$PM_PLUGIN_ROOT/scripts/dev-session.js" authorize \
  --session ".pm/dev-sessions/{slug}/session.json" \
  --grant "push_feature_branch,create_pr" \
  --reason "User requested: {concise faithful excerpt}" \
  --json
```

Never edit `authority` or `authority_log` by hand. Existing authority from a Dev-routed session remains valid only for actions actually requested by the user; workers and preferences cannot broaden it.

If the user grants an additional action after the contract was created (for example, reruns Ship to merge a green PR), run `dev-session authorize` first, revalidate every frozen identity field, then atomically replace only the contract's copied `authorization` booleans and `recorded_at`. This explicit grant path is the sole allowed authority-snapshot update; it never permits a remote, owner/repo, head, or base change.

Before each mutation, enforce its independent boolean:

- `git push` requires `push_feature_branch: true`.
- Creating or externally commenting on a PR requires `create_pr: true`.
- Arming auto-merge or invoking any merge command requires `merge: true`.

If the required boolean is false, stop at the last authorized boundary and name the exact grant required. Read-only PR and CI inspection may continue when useful.

## 2. Freeze the delivery identity for Review

Resolve the delivery remote in Step 03, then read its push URLs with an option-safe command. Require exactly one configured push URL; multiple destinations are ambiguous and block Ship.

```bash
DELIVERY_REMOTE="{persisted source.delivery_remote}"
git remote get-url --push --all -- "$DELIVERY_REMOTE"
```

Normalize only these GitHub URL forms:

- `git@github.com:OWNER/REPO.git`
- `ssh://git@github.com/OWNER/REPO.git`
- `https://github.com/OWNER/REPO.git`

Strip one trailing `.git`, require exactly `OWNER/REPO`, and reject another host, an empty component, extra path segments, or a value that cannot be normalized without guessing. Set:

```text
GH_OWNER=OWNER
GH_REPOSITORY=REPO
GH_REPO=OWNER/REPO
HEAD_BRANCH={current branch}
BASE_BRANCH={session source.default_branch}
```

Hash the exact, unmodified push URL with SHA-256. Atomically write `.pm/dev-sessions/{slug}/ship/delivery-contract.json` by creating a mode-`0600` temporary file in the same directory, validating it, then renaming it. Its exact shape is:

```json
{
  "schema_version": 1,
  "run_id": "{session.run_id}",
  "delivery_remote": "{DELIVERY_REMOTE}",
  "push_url_sha256": "sha256:{64 lowercase hex characters}",
  "github_owner": "{GH_OWNER}",
  "github_repository": "{GH_REPOSITORY}",
  "github_name_with_owner": "{GH_REPO}",
  "head_branch": "{HEAD_BRANCH}",
  "base_branch": "{BASE_BRANCH}",
  "authorization": {
    "push_feature_branch": true,
    "create_pr": true,
    "merge": false
  },
  "recorded_at": "{ISO-8601 timestamp}"
}
```

Copy the three booleans from canonical `session.json`; do not invent them. Validate exact keys and types, `run_id`, the SHA-256 format, `github_name_with_owner == github_owner + "/" + github_repository`, and non-empty branch names before rename. The contract is private runtime state, not a committed product artifact.

## 3. Revalidate before every GitHub or push mutation

Reload the session and delivery contract; do not trust conversation memory or environment variables left by an earlier step. Re-resolve the named remote's sole push URL, hash it, normalize it, and require all of these to match:

- contract `run_id` equals sibling `session.json` `run_id`;
- session `source.delivery_remote` equals contract `delivery_remote`;
- current remote URL hash equals contract `push_url_sha256`;
- normalized current `OWNER/REPO` equals contract `github_name_with_owner`;
- current branch equals contract `head_branch`;
- session default branch equals contract `base_branch`;
- the required canonical session authority is true and the contract snapshot for that action is true.

Any mismatch blocks delivery. Never silently re-resolve, fall back to `origin`, select the first of multiple URLs, or rewrite the contract to accommodate unexpected state. Return to Step 03 and run Review against the new identity after the user confirms the change.

Export `GH_OWNER`, `GH_REPOSITORY`, `GH_REPO`, `HEAD_BRANCH`, and `BASE_BRANCH` only from the freshly validated contract. Every repository-aware `gh pr` and `gh run` command must pass `--repo "$GH_REPO"`. PR discovery and creation must also pass explicit `--head "$HEAD_BRANCH" --base "$BASE_BRANCH"`. For `gh api`, which has no `--repo` option, use an endpoint containing `repos/$GH_OWNER/$GH_REPOSITORY` or GraphQL variables populated from those exact values.

After detecting or creating a PR, fetch its identity from `repos/$GH_OWNER/$GH_REPOSITORY/pulls/$PR_NUMBER` and require:

```text
.head.repo.full_name == GH_REPO
.head.ref            == HEAD_BRANCH
.base.repo.full_name == GH_REPO
.base.ref            == BASE_BRANCH
```

Reject fork PRs and every head/base mismatch. Persist `PR_NUMBER` only after this check passes; every later PR command supplies both `--repo "$GH_REPO"` and that explicit number.

## 4. Recertify after any delivery-loop commit

Any commit created after the final Review invalidates delivery authority, including a pre-push-hook fix, CI fix, review-feedback fix, generated-file update, conflict resolution, rebase, or merge of the base branch. Before retrying `git push`:

1. Run the relevant tests and verification for the changed surface.
2. Invoke `pm:review` against current HEAD and the same validated delivery contract. Publish a new canonical Review JSON/HTML report and retained-render manifest for the current commit.
3. Rerun every routed quality gate whose relevant surface changed. Regenerate its canonical artifact. Use `dev-session recertify` only for a gate whose existing evidence was actually rechecked and remains applicable; never advance `verified_commit` by inspection alone.
4. Confirm `.pm/dev-sessions/{slug}/gates.json` contains current, machine-valid Review and routed-gate evidence.
5. Revalidate the delivery contract, then run `scripts/dev-gate-check.js` with current HEAD, explicit branch, reviewed remote, reviewed base, and `--require-authority push_feature_branch` before retrying a push.
6. Only after the checker exits zero may Ship retry the explicit push to `DELIVERY_REMOTE`.

This is one indivisible **post-mutation recertification protocol**. Green CI for an older commit, a PR label, or a prior report cannot substitute for it.

## Done-when

The action has explicit canonical authority, the delivery contract matches the live reviewed destination and exact head/base, PR identity (when present) matches that contract, and any post-Review commit has regenerated current Review/gate artifacts and passed `dev-gate-check` before push.
