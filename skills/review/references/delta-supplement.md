# Post-Pass Freshness and Delta Supplements

A canonical passing `report.json` is frozen at its reviewed commit. This reference defines when that frozen certification may stay authoritative for a later commit, and the delta-supplement protocol that certifies a small post-pass fix with one scoped reviewer instead of a new full round. Gate-side enforcement lives in `scripts/lib/review-freshness.js`, invoked by `scripts/dev-gate-check.js`; the CLI is `scripts/review-delta.js`. Package semantics and the `supplements/` file layout are in `evidence-contract.md` § Post-pass freshness.

Every path below fails closed: any git error, hash mismatch, schema violation, or budget violation makes the commit not fresh, and a full new `pm:review` round is required. Freshness acceptance never mutates the frozen report, target, results, or render manifest.

## Acceptance paths

Gate validation accepts a frozen passed report for a commit other than its reviewed commit through exactly three paths, tried in order:

1. **Exact** — the commit equals the reviewed commit (the ordinary case; listed for completeness).
2. **Diff identity** — the branch was rebased or amended but its content is unchanged. The frozen diff bytes must still hash to the frozen `diff_sha256`; then, against the frozen base the current diff bytes must hash to the same `diff_sha256`, and against a moved live base `git patch-id --verbatim` of the current diff must equal that of the reviewed diff (`--verbatim` because `--stable` ignores intra-line whitespace, which is semantics-bearing). Any content change, a git that cannot honor `--verbatim`, or a tampered frozen package fails.
3. **Delta chain** — one or two hash-bound supplements (below) connect the reviewed commit to the current commit.

Independently, when the authoritative default branch has advanced past the frozen `base_commit`, the target's base binding is authenticated by merge-base equivalence: the frozen base must be an ancestor of the live base, and the merge base of the reviewed commit with each must be identical. A rewritten base, or a base that absorbed the branch's own content, fails.

## Delta-supplement eligibility

A post-pass fix commit (or short series of commits) qualifies only when all of these hold:

- The canonical report outcome is `passed` and its package hashes verify.
- The certified commit (or prior supplement head) is an ancestor of HEAD — a rebase needs diff identity or a full round instead.
- The delta diff changes at most **50 code lines** (added + removed). Test files (`tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) and non-runtime documentation (`docs/**/*.md`) are exempt from the line budget but still counted as changed files. Runtime Markdown — `skills/`, `references/`, `commands/`, `templates/` — is source and stays budgeted. A rename is exempt only when both its old and new paths are exempt; a rename crossing the exempt boundary in either direction makes the delta ineligible.
- Every changed file is inside the certified changed-file set (current or old rename paths) or is budget-exempt. New out-of-scope source files require a full round.
- No non-exempt binary changes.
- At most **2 supplements** chain from one certification. A third fix, however small, requires a full round.

## Protocol

Run from a clean worktree. `--root` defaults to the current directory; `--review-dir` is the project-relative review directory (e.g. `.pm/dev-sessions/{slug}/review`).

1. **Build.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" build --root "$PWD" --review-dir "{review-dir}" --json` validates eligibility, freezes the delta (prior commit, HEAD, delta diff SHA-256, changed files, code-line count) into `supplements/pending.json`, and reports the files to review. Any eligibility failure throws with the reason; do not work around it — run a full round.
2. **Review.** Dispatch **one** read-only reviewer over the delta diff only, using the standard calibration in `reviewer-briefs.md`, scoped to the built file list. The reviewer returns JSON: `reviewer` (provider/model), non-empty `lenses`, `summary` (1–2000 chars), and `findings` — each with `severity` (`critical|high|medium|low`), `file` (must be in the delta), `issue`, optional `line`. Save it inside the project (e.g. `.pm/reviewer-result.json`).
3. **Record.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" record --root "$PWD" --review-dir "{review-dir}" --result "{result-path}" --json` re-verifies that HEAD, the canonical report bytes, and the delta diff are unmoved since build, then finalizes. No critical/high finding → `supplements/supplement-{N}.json` (exit 0). Any critical/high finding → a `rejected-*.json` audit record (exit 1); fix the finding, then start again at Build (the fix consumes the next supplement slot, or the budget, honestly).
4. **Check / recertify.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" check --root "$PWD" --review-dir "{review-dir}" --json` (optionally `--commit <sha>`, `--base <sha>` for the live authoritative base) re-runs the full freshness evaluation and exits 0 only when the current commit is accepted by exact match, diff identity, or a valid complete chain. A passing `check` is the sanctioned recheck evidence for `dev-session recertify`, which advances the gate row's `verified_commit`/`verified_at` pair. The gate row must carry that pair for the current commit; the frozen report alone is never sufficient.

## Supplement binding

Each `supplement-{N}.json` is immutable once written and binds:

- `canonical_report` — path, exact SHA-256 of the canonical `report.json` bytes, and the frozen reviewed commit;
- `prior_commit` — the certification head it extends (the reviewed commit for N=1, supplement 1's commit for N=2);
- `chain_index` — its position (1 or 2, contiguous);
- `source` — the certified fix commit and the exact `delta_diff_sha256` of `git diff --binary prior...commit`;
- budget facts, changed-file inventory, the reviewer identity/lenses, and a `passed` result.

Validation recomputes every hash and re-derives the delta from Git; a drifted report, drifted diff, gap in the chain, failed outcome, or chain head that is not the current commit rejects the whole chain.

## What this does not change

- Rounds 1–3 inside an unfinished run still require complete-round re-review after any mutation (`steps/04-resolve.md`); supplements exist only **after** a canonical pass.
- Design Critique, QA, verification, and every other routed gate keep their own freshness rules; a supplement certifies Review only.
- Ship's post-mutation recertification protocol (`skills/ship/references/delivery-contract.md` § 4) still requires advancing the release transaction and rerunning `dev-gate-check.js` before any push.
