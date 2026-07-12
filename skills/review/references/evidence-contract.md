# Review Evidence Contract

## Files

Store the chain under `.pm/dev-sessions/{slug}/review/`:

```text
runs/{run-id}/
  round-1/
    target.json
    results/{worker-id}.json
    decisions.json        # only when decisions exist
    draft-report.json     # mutable synthesis before decisions
    draft-report.html
    report.json           # retained when the round does not pass
    report.html
  round-2/                 # created only after source mutation
  round-3/                 # hard cap
report.json              # canonical passing projection only
report.html              # canonical passing human artifact only
renders/
  manifest.json          # hash-binds canonical viewports, full pages, metrics, and print
```

Each fresh Review invocation gets a new kebab-case run directory. Synthesis may overwrite only `runs/{run-id}/round-N/draft-report.json` and `draft-report.html` while decisions are pending. Finalize the round report exactly once after decisions. Never overwrite a finalized prior run or round: later rounds bind the exact preceding report path. A passing round is projected to the canonical root `report.json` and `report.html` for Dev/Ship gate discovery; its target and result bindings still point into the run directory.

The canonical gate row binds `renders/manifest.json` with `render_manifest` and raw `render_manifest_sha256`. The manifest's source hash equals the canonical `report.html` bytes; its desktop, tablet, and narrow viewport plus full-page PNGs and print PDF retain project-relative paths, byte counts, dimensions/pages, and `sha256:` hashes. Gate-time validation rechecks those frozen bytes and metrics without launching a browser or contacting the network.

Review JSON bindings (targets, results, decisions, reports, gate-row references, and retained render payloads) use project-relative regular-file paths. Inputs are opened once with no-follow semantics, identity-checked, byte-bounded, and read through the same descriptor. Target, machine-report, and HTML publication descends from an anchored project-root child process and creates plus commits the temporary file relative to the opened directory, so an ancestor swap cannot redirect the write. Publication returns explicit `committed` and `directory_synced` state. Known platform limitations (`EBADF`, `EINVAL`, `EISDIR`, `ENOSYS`, `ENOTSUP`, `EPERM`) are exposed as non-blocking `directory_sync_error` warnings; genuine storage errors such as `EIO` block the workflow with an explicit committed/do-not-retry error. Traversal, absolute retained paths, stale bindings, unknown fields, and JSON over 4 MiB fail.

## Target

Generate `target.json` with `scripts/review-target.js`. It freezes:

- run ID, round 1–3, iteration cap 3, mode, timestamp;
- current commit, authoritative remote base ref/object, and binary diff SHA-256;
- for Dev-routed work, canonical Dev run/slug, routed mode/version, and acceptance-criteria digest;
- sorted changed-file status, old path, current byte hash, and byte count;
- optional exact acceptance, Design Critique, and prior-report bindings;
- non-overlapping gate ownership;
- every logical lens with applicability deterministically derived from the frozen changed files;
- every physical reviewer with exact profile, runtime, and assigned lenses.

Rounds after 1 bind the immediately prior non-passing report for the same run. Round 1 cannot bind a prior report.

## Results

One result is required for every allocation row. Result run, round, target binding, source, worker, profile, runtime, and ordered lens list exactly match the target. `verdicts` covers every assigned lens exactly once with `clean` or `findings`; the outcome agrees with emitted finding categories. Reviewer findings always use `owner: review` and `disposition: open`; reviewer output cannot dismiss, defer, or hand off a finding.

Findings use the schema in `reviewer-briefs.md`. The `verify` field is an untrusted, non-executable plan; the resolving root independently derives trusted commands from repository-controlled test configuration and never executes reviewer text directly. Deterministic identity is `rv-` plus the first 20 lowercase SHA-256 hex characters over compact JSON:

```text
[normalized file, line_start, line_end, normalized rule, sorted normalized "kind:ref:digest" evidence]
```

`digest` is the exact SHA-256 for trace, benchmark, and upstream-gate evidence. Git-backed source, test, contract, and design-token evidence must not include `sha256` and use the literal `unbound` sentinel in the identity tuple. For example: `source:src/cache.js:18:unbound`.

Category is deliberately excluded so independent lenses can converge on the same defect. A reviewer may emit only assigned categories. The primary file must be changed and line ranges must exist in current text (deleted-file diff locations remain valid).

Evidence locator forms:

| Kind | Locator |
|---|---|
| `source`, `test`, `contract`, `design-token` | `project/path:line[-line]` |
| `trace`, `benchmark` | `artifact:project/path#locator` |
| `upstream-gate` | `project/path/to/gate-artifact.json` with `commit` equal to the target source commit |

Required support by category is checked. Evidence files and line bounds must exist; deleted changed source is resolved from the frozen diff.

## Decisions

`decisions.json` binds the same target/run/round. Each unique current finding decision contains `finding_id`, human `approver`, action, concrete rationale, and RFC 3339 timestamp. Actions are:

- `keep-review`
- `handoff-design`
- `handoff-qa`
- `dismiss`
- `defer`

Never infer approver identity or create a decision from reviewer majority. Repository-local approver text is not authentication. `keep-review` is safety-monotonic for ownership and disposition, but it cannot authenticate resolution of a dispute or decision requirement. The checker preserves every local decision proposal for audit and keeps authority-bearing state blocked until a trusted external approval channel exists.

## Canonical merge

Exact IDs merge. Keep all signals. Use maximum confidence, highest severity, and the strongest signal's detail. Severity spread greater than one tier, fix kind, normalized remediation, disposition, or decision requirement creates a dispute. Local decision rows never resolve the gate-level dispute; they preserve the proposed action and rationale for a future authenticated resolution channel.

Auto-fix eligibility requires all of: Review owner, open, confidence at least 80, `fix_kind: mechanical`, not disputed, not decision-required. Eligibility is a ceiling; the root still verifies the code before editing.

Outcome policy:

- `failed`: unresolved Review-owned high/critical finding at confidence 80+.
- `blocked`: unresolved disagreement/decision, or deferred Review-owned high/critical finding.
- `passed`: complete logical coverage and neither condition above.

Design Critique and QA handoffs require a trusted external approval channel. Reviewer-authored ownership or a self-declared approver can never change Review's outcome.

## Report and HTML

Generate canonical `report.json` with `review-check.js --write-report`. It binds target, every result, decisions, prior report, source identity, coverage, findings/signals, blockers, disputes, auto-fix eligibility, handoffs, top issue, and next action.

Render `report.html` with `scripts/review-report.js`, which uses `references/templates/review-report.html`. Metadata generator is exactly `pm:review` plus `plugin.config.json` version. Metadata source binds `report.json`; evidence binds target, every result, and decisions. Unresolved tokens fail.

The first screenful visibly binds outcome, round, blocker count, top issue, and next action. Every finding marker visibly includes issue, impact, fix, owner, evidence refs, signals, dispute/decision state, and the advisory, non-executable verification plan. Structural and real-browser validation ignore hidden/offscreen/clipped text.

## Commands

Generate the canonical report:

```bash
node "$PM_PLUGIN_ROOT/scripts/review-check.js" \
  --root "$PWD" \
  --target ".pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/target.json" \
  --result ".pm/dev-sessions/{slug}/review/runs/{RUN_ID}/round-{N}/results/reviewer-1.json" \
  --report ".pm/dev-sessions/{slug}/review/report.json" \
  --human-report ".pm/dev-sessions/{slug}/review/report.html" \
  --write-report
```

Repeat `--result` for every planned reviewer and add `--decisions` when present. After rendering HTML, rerun the same command without `--write-report`.

Source, test, contract, and design-token locators are resolved from the target's frozen Git commit (or its base commit for deleted files), never from a later worktree. Trace and benchmark evidence uses `artifact:<project-path>#<literal UTF-8 locator>` and includes the artifact's exact `sha256`. Upstream-gate evidence includes an exact `sha256` and points to JSON with a recognized `outcome` and a `commit` exactly equal to the target source commit. Optional Design Critique evidence follows the same current-commit rule. Missing locators, digest drift, stale commits, symlinked inputs, or malformed gate semantics fail validation.

For a non-passing round, write its report and HTML inside `runs/{RUN_ID}/round-{N}/` instead of the canonical root. Bind that stable report with `--prior-report` after the fix commit.

During synthesis, use `--stage draft` with the current run's `round-{N}/draft-report.json` and `draft-report.html`. After decisions are complete, rerun with `--stage final` (or omit `--stage`) and finalize the appropriate canonical or round report exactly once.
