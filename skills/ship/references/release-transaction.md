# Ship Release Transaction

The release transaction is Ship's executable journal. It is private runtime state, not Product Memory and not a substitute for the reviewed source diff.

## Canonical paths

```text
.pm/dev-sessions/{slug}/session.json
.pm/dev-sessions/{slug}/gates.json
.pm/dev-sessions/{slug}/ship/delivery-contract.json
.pm/dev-sessions/{slug}/ship/release-transaction.json
.pm/dev-sessions/{slug}/ship/pr-body.md
.pm/dev-sessions/{slug}/ship/targets/*.json
.pm/dev-sessions/{slug}/ship/observations/*.json
.pm/dev-sessions/{slug}/ship/receipts/*.json
```

Use project-relative paths in the journal and gate sidecars. Create private state with mode `0600` and directories with mode `0700`. Never commit `.pm/`.

## Modes

### Versioned

Use when repository instructions or the task require a version mutation. Preparation must happen before the final Review target:

```bash
npm run prepare-release -- patch \
  --session ".pm/dev-sessions/{slug}/session.json"
```

Use `minor`, `major`, or an explicit `x.y.z` only when the user or repository release policy requires it. `prepare-release` requires a clean feature branch, updates the canonical version and generated manifests, commits `Prepare release vX.Y.Z`, creates no tag, and initializes the transaction at that prepared commit.

If the command returns `already-prepared` or `reconciled`, verify its prepared commit equals `git rev-parse HEAD`. Never run the legacy `bump-version.js` inside the new Ship path.

### Delivery-only

Use when the repository has no required version mutation:

```bash
node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" initialize \
  --session ".pm/dev-sessions/{slug}/session.json" \
  --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
  --json
```

This freezes the current feature commit without inventing a version or tag.

## Final evidence binding

After Design Critique (when routed), QA, Review, and verification pass at the prepared commit, bind the canonical current evidence. Hash the exact artifact bytes and run one command per required kind:

```bash
node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" bind-evidence \
  --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
  --kind review \
  --commit "$(git rev-parse HEAD)" \
  --artifact ".pm/dev-sessions/{slug}/review/report.json" \
  --sha256 "sha256:{64 lowercase hex}" \
  --json
```

Bind `qa` to the canonical QA phase result and `verification` to the canonical gate/check artifact. Every evidence commit must equal the prepared commit. Then run:

```bash
node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" status \
  --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
  --json
```

`ready` must be true before planning Push.

## Effect protocol

The ordered effects are:

```text
push → create-pr → ready-pr (optimized draft only) → merge → place-main-tag
                                                     ↘ tracker-update
```

`place-main-tag` exists only in a versioned transaction. Tracker update remains optional and requires its own configured target and `tracker_updates` authority.

For every effect:

1. Build and save the exact target JSON beneath `ship/targets/`.
2. Plan it:
   ```bash
   node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" plan \
     --transaction "$TRANSACTION" --effect "$EFFECT" --target-file "$TARGET" --json
   ```
3. Begin it using current canonical authority:
   ```bash
   node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" begin \
     --transaction "$TRANSACTION" --effect "$EFFECT" \
     --session ".pm/dev-sessions/{slug}/session.json" --actor root --json
   ```
4. Branch on the returned decision:
   - `denied` — stop at the authority boundary. Do not call the network and do not label it an environment failure.
   - `observe-first` — an earlier call may have completed. An `attempting` effect must Observe first: inspect the exact target before any retry.
   - `already-verified` — revalidate the saved observation, then do not replay.
   - `execute` — the attempt is durably `attempting`; perform the one authorized mutation.
5. Observe independently after the call, even when the command exited zero.
6. Save observation and receipt JSON, then reconcile with `matched`, `absent`, `conflict`, or `failed`:
   ```bash
   node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" reconcile \
     --transaction "$TRANSACTION" --effect "$EFFECT" --outcome matched \
     --observation-file "$OBSERVATION" --receipt-file "$RECEIPT" --json
   ```

A matched observation has this binding shape:

```json
{
  "target": { "the": "exact planned target object" },
  "receipt": { "the": "exact independently observed receipt object" }
}
```

The separate receipt file must contain the same receipt object. The runtime rejects target or receipt drift.

### Observation decisions

| Outcome | Use only when | Runtime decision |
|---|---|---|
| `matched` | Exact target exists and independently observed receipt matches | `verified`; never replay |
| `absent` | Authoritative observation proves the effect did not occur and retry is safe | `retry-safe`; begin a new numbered attempt |
| `conflict` | A branch, PR, merge, tag, or tracker object exists at a different identity | `blocked`; never overwrite or force-move |
| `failed` | The mutation definitely failed without occurring | `failed`; apply bounded retry policy |

Timeout, lost terminal output, connection reset, and process interruption are not definite failures. Leave the attempt as `attempting` and resume through `observe-first`.

## Canonical targets and observations

The runtime validates these canonical field names and refuses a target or matched receipt whose identity does not equal the transaction and its verified upstream receipts.

### Push

Target fields: `remote`, `repository`, `branch`, `commit`. The receipt field `remote_tip` must equal `commit`. Observe with `git ls-remote` against the contracted remote. Missing ref is `absent`; any other tip is `conflict`.

### Create PR

Target fields: `repository`, `head`, `base`, `commit`, `draft`, and `body_sha256`. Every new plan must provide the boolean and SHA-256 explicitly. The CLI independently hashes the exact sibling `pr-body.md` bytes and rejects a missing or different hash. The runtime requires `draft: true` exactly when current candidate evidence selects optimized publication and `draft: false` for the comprehensive route. Observe through the exact GitHub owner/repository and require zero or one matching PR. The independently observed receipt records `pr_number`, URL, `state: OPEN`, `head_oid`, exact planned `draft`, and `body_sha256` computed from the exact UTF-8 API body string; the head OID must equal `commit` and the body hash must equal the target. Multiple matches, a fork, wrong base, wrong draft state, wrong head OID, or different body is `conflict`.

Legacy schema-v1 journals may predate `draft` or `body_sha256`. The canonical read boundary retains the existing safe draft migration: a formerly verified pre-Merge effect is reopened only for observe-first recovery and cannot become verified again until the live PR proves `draft: false`. For a missing body binding, restore the intended canonical `pr-body.md`, run `release-transaction.js migrate-pr-body`, then re-observe and reconcile the reopened Create PR attempt with a body-bound receipt. This command never mutates GitHub. Reopening Create PR discards a merely planned Merge because its upstream verification is no longer valid; plan Merge again after the body-bound Create PR receipt is verified. An attempting Merge must be reconciled first because it may already be irreversible. A denied, failed, or blocked Merge retains audit evidence and requires advancement to a fresh transaction generation before migration. A verified Merge may complete its remaining idempotent tag work without replay. A terminal transaction with required Merge and main tag already verified remains byte-for-byte immutable so an existing delivery receipt cannot be invalidated. `status` names the exact pending migration and `validate` blocks until the safe rebind is complete.

### Ready PR

Optimized draft delivery only. Target fields: `repository`, verified `pr_number`, and `commit`. It depends on verified `create-pr`, can begin only while the canonical candidate is `merge-ready`, and uses the existing canonical `create_pr` authority; it never inherits merge authority. Observe through the exact GitHub owner/repository. The receipt records the same `pr_number`, `state: OPEN`, `head_oid` equal to `commit`, and `draft: false`. When `ready-pr` is planned, Merge cannot begin until this effect is verified. Comprehensive non-draft PRs do not plan this effect.

### Merge

Target fields: `repository`, verified `pr_number`, `head_commit`, `base`, `method`, and the verified Create PR `body_sha256`. Immediately before `begin`, save a fresh normalized API observation containing the raw live body and run `release-transaction.js attest-pr-body`. The runtime computes the body hash itself, requires the exact repository/PR/head/base/open/non-draft identity, and consumes that attestation for one Merge attempt within five minutes. A retry-safe new attempt requires another observation and attestation. An ambiguous attempting Merge remains observe-first; do not replace its consumed attestation because the effect may already be irreversible. Optimized Merge begin and observe-first recovery also reload the canonical session and require candidate state to remain `merge-ready`; invalidation revokes the retained readiness receipt and requires cancellation of any armed auto-merge before remediation. If the exact PR irreversibly merged before cancellation, reconciliation must still journal that independently observed result even though the candidate is now invalidated. Receipt records the same `pr_number`, `state: MERGED`, `merge_sha`, merged time, `head_oid`, and independently observed `body_sha256`; head and body must equal the target. An OPEN PR is not an absent merge and must remain in monitoring; CLOSED without merge or a changed body is `conflict`.

### Place main tag

Target fields: `remote`, `tag`, verified `merge_sha`, and authoritative `base`. Before attempting, fetch the base and require the merge SHA to be the authoritative base tip or an allowed ancestor under repository policy. Observe the remote tag with peeling. The receipt's `tag` and `peeled_sha` must match the target. No tag is `absent`; any other SHA is `conflict`. Never force-move a conflicting tag automatically.

### Tracker update

Target fields: `provider`, `issue_id`, `terminal_state`, and `comment_identity`. Receipt fields `provider`, `issue_id`, `state`, and `comment_identity` must match. Missing authority is `denied`; unavailable provider is `failed`/environment; mismatched issue identity is `conflict`.

## Post-preparation commits

Any fix, conflict resolution, generated-file update, or rebase after preparation changes the frozen tree. Before recertifying, advance the transaction:

```bash
node "$PM_PLUGIN_ROOT/scripts/release-transaction.js" advance \
  --transaction ".pm/dev-sessions/{slug}/ship/release-transaction.json" \
  --commit "$(git rev-parse HEAD)" \
  --reason "{specific mutation reason}" \
  --json
```

Advance archives the prior generation, including its receipts, then clears current evidence and effect plans. It is forbidden after merge verification. Re-run all affected gates, bind fresh evidence, and plan new push/PR effects for the new prepared commit. A pre-existing PR is reconciled as the `create-pr` receipt after its remote head advances.

## Completion

Ship is complete only when:

- push, create-pr, and merge are `verified`;
- versioned transactions also have `place-main-tag: verified` at the merge SHA;
- configured tracker updates are `verified` or explicitly absent from the authorized scope;
- the Dev delivery receipt matches the verified PR and merge receipt;
- remote state is observed, Product Memory updates are complete, and cleanup is verified.

The transaction is archived with the completed Dev session. Never delete it as transient scratch data.
