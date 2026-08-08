# Post-Pass Freshness and Delta Supplements

A canonical passing `report.json` is frozen at its reviewed commit. This reference defines when that frozen certification may stay authoritative for a later commit, and the delta-supplement protocol that certifies a small post-pass fix with one scoped reviewer instead of a new full round. Gate-side enforcement lives in `scripts/lib/review-freshness.js`, invoked by `scripts/dev-gate-check.js`; the CLI is `scripts/review-delta.js`. Package semantics and the `supplements/` file layout are in `evidence-contract.md` § Post-pass freshness.

Every path below fails closed: any git error, hash mismatch, schema violation, or budget violation makes the commit not fresh, and a full new `pm:review` round is required. Freshness acceptance never mutates the frozen report, target, results, or render manifest.

Content identity is decided over Git object IDs, never over rendered diff text: a diff is a *rendering*, and what it renders is decided by config a branch can carry (`diff.external`, `textconv`, a `.gitmodules` `ignore = all` that erases submodule rows, `diff.algorithm`, context width, prefixes). Object IDs have no such surface. Where a diff is still hash-bound or budget-bound — the delta supplements — it is taken through the single canonical spelling in `scripts/lib/git-env.js` (`trustedDiffArgs`): `--no-ext-diff --no-textconv --find-renames --ignore-submodules=none --no-color -O <devnull>` plus `-c` pins for the enumerated config-only knobs (hunk algorithm, context width, prefixes, rename detection, submodule format, abbreviation, blank-context rendering, and relative-path scoping). Each pinned value is Git's own default, so on a default clone the pinned invocation is byte-identical to the unpinned one and no previously frozen hash changes meaning. One of those pins is not a rendering knob at all: `diff.relative = true` makes a diff run from a subdirectory *drop* every path outside it. Unpinned, a delta taken with a non-toplevel `--root` prices one file where two changed — though it does not slip through, because the tree cross-check sees the dropped paths and calls the delta ineligible. The pin exists so that backstop is not the only thing between inherited config and a wrong budget, and so a legitimate delta is not forced into a full round by a setting unrelated to it.

That list is the knobs known to move these bytes, not a proof that no other knob can. It is deliberately not what identity rests on: the trust set only has to keep an honestly configured clone reproducible, because a diff hash no longer decides whether a commit was reviewed. Any drift it fails to pin makes a hash mismatch and forces a full round — the fail-closed direction. Content identity is the claim that has to be forgery-proof, and it reads trees.

Paths are compared as raw bytes throughout. A Git path is an arbitrary byte string, and decoding one as UTF-8 maps every invalid sequence to U+FFFD, so `a\xFE` and `a\xFF` would become the same key and the second would shadow the first — hiding a rewrite of the shadowed path from every changed-path and object-ID comparison. `changed_files` in a frozen target is JSON and therefore cannot hold such a path at all: `review-target.js` refuses to certify one, and that repository takes a full round.

## Acceptance paths

Gate validation accepts a frozen passed report for the current commit through exactly three paths — one for the reviewed commit itself and two for a commit other than it. Exact match is checked first; the other two are both attempted whichever way round, so the order between them is a cost choice only — when supplements are recorded the chain is tried first, because it reads the per-supplement deltas instead of walking both whole trees. Order never decides whether a commit is accepted, only which method is reported:

1. **Exact** — the commit equals the reviewed commit (the ordinary case; listed for completeness).
2. **Content identity** — the branch was rebased or amended but its content is unchanged. Both the reviewed commit and the current commit are inventoried with `git ls-tree -r` against their respective merge bases (`base...commit` three-dot semantics), and three facts must hold: the two changed **path sets** are equal; every reviewed path has the identical **mode and object ID** in both; and the reviewed changed set equals the **certified changed-file inventory** in the frozen target. Files the moved base itself changed are never in the reviewed set, so they are free to differ — a reviewed path that differs is content no reviewer read. The third condition is what makes a suppressed or mis-rendered path fatal rather than invisible: anything the commit actually changes but the inventory does not list fails, whatever caused the omission. `ls-tree -r` walks into subtrees but stops at submodules, emitting the gitlink as a `160000 commit <oid>` leaf, so a submodule pointer bump is an ordinary object change here even when `.gitmodules` tells every diff to ignore it.
3. **Delta chain** — one or two hash-bound supplements (below) connect the reviewed commit to the current commit.

Independently, when the authoritative default branch has advanced past the frozen `base_commit`, the target's base binding is authenticated by merge-base equivalence: the frozen base must be an ancestor of the live base, and the merge base of the reviewed commit with each must be identical. A rewritten base, or a base that absorbed the branch's own content, fails.

## Delta-supplement eligibility

A post-pass fix commit (or short series of commits) qualifies only when all of these hold:

- The canonical report outcome is `passed` and its package hashes verify.
- The certified commit (or prior supplement head) is an ancestor of HEAD — a rebase needs content identity or a full round instead.
- The delta diff changes at most **50 code lines** (added + removed). Exempt from the line budget — but still counted as changed files — are exactly these paths:
  - anything under a **repo-root** `test/`, `tests/`, or `__tests__/` directory (`tests/review-freshness.test.js`, `tests/fixtures/sample.json`);
  - `*.test.*` and `*.spec.*` files with a JavaScript or TypeScript extension **only** (`.js`, `.jsx`, `.ts`, `.tsx`, `.cjs`, `.mjs`, `.cts`, `.mts`), at **any** depth — so `packages/api/tests/case.test.js` qualifies, while `api.test.py` and `model_spec.rb` do not;
  - non-runtime documentation under repo-root `docs/**/*.md` **only**.

  The two directory rules are root-anchored on purpose, and this is the security boundary of the whole exemption. **A directory component named `tests` is evidence of nothing.** `skills/tests/SKILL.md` is a loaded skill; `agents/tests/x.md` registers a callable agent; `hooks/tests/x` is executed by `hooks.json`; `scripts/tests/x.js` and `.github/tests/x.yml` are enforcement and CI. Exempting any of them would let a post-pass delta add unbounded instructions or executables past both the line budget and the certified file-set scope. Enumerating the trees that must override the exemption was tried and does not hold — a list naming `skills/ references/ commands/ templates/` left the other four exempt, and it would leak again the next time the repository grows a directory. Anchoring fails closed by construction instead: only the repository's own test root is free by path, and no tree has to be named in advance.

  The extension rule stays unanchored because it is safe at any depth: a `*.test.*` / `*.spec.*` file with a JS/TS extension is not instruction surface, whatever tree it sits in. The cost of the anchoring is real and is the intended direction — a **nested** test directory holding files that are not `*.test.*`/`*.spec.*` (fixtures, `src/test/helper.js`, `packages/api/tests/data.json`) is now priced against the budget and must be inside the certified file set. A monorepo that keeps helpers there spends budget on them or takes a full round.

  A rename is exempt only when both its old and new paths are exempt; a rename crossing the exempt boundary in either direction makes the delta ineligible.
- Every changed file is inside the certified changed-file set (current or old rename paths) or is budget-exempt. New out-of-scope source files require a full round. Budget-exempt paths are outside the file-set scope as well as the line budget — a fix must be able to add a new test file — so a supplement may add test or root-docs content of any size. That content is not unreviewed: the scoped reviewer reads the whole delta diff, including it. Rename detection is forced on (`--find-renames`) so an inherited `diff.renames = false` cannot split a boundary-crossing rename into a free exempt addition plus a priced deletion.
- No non-exempt binary changes.
- At most **2 supplements** chain from one certification. A third fix, however small, requires a full round.

## Protocol

Run from a clean worktree. `--root` defaults to the current directory; `--review-dir` is the project-relative review directory (e.g. `.pm/dev-sessions/{slug}/review`).

1. **Build.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" build --root "$PWD" --review-dir "{review-dir}" --json` validates eligibility, freezes the delta (prior commit, HEAD, delta diff SHA-256, changed files, code-line count) into `supplements/pending.json`, and reports the files to review. Any eligibility failure throws with the reason; do not work around it — run a full round.
2. **Review.** Dispatch **one** read-only reviewer over the delta diff only, using the standard calibration in `reviewer-briefs.md`, scoped to the built file list. The reviewer returns JSON: `reviewer` (provider/model), non-empty `lenses`, `summary` (1–2000 chars), and `findings` — each with `severity` (`critical|high|medium|low`), `file` (must be in the delta), `issue`, optional `line`. Save it inside the project (e.g. `.pm/reviewer-result.json`).
3. **Record.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" record --root "$PWD" --review-dir "{review-dir}" --result "{result-path}" --json` re-verifies that HEAD, the canonical report bytes, and the delta diff are unmoved since build, then finalizes. No critical/high finding → `supplements/supplement-{N}.json` (exit 0). Any critical/high finding → a `rejected-*.json` audit record (exit 1); fix the finding, then start again at Build (the fix consumes the next supplement slot, or the budget, honestly). The rejection binds to the **tree** of the commit it was filed against, not just its SHA, and is enforced rather than merely archived: `build` refuses to re-open a rejected HEAD and chain validation refuses any supplement certifying one. Keying on the tree is what closes the laundering routes — `commit --amend -m`, `--amend --date=`, and `--allow-empty` all mint a fresh commit SHA over content nobody changed, while a genuine fix necessarily moves the tree. So the only way past a blocking finding is a commit that actually carries the fix.
4. **Check / recertify.** `node "$PM_PLUGIN_ROOT/scripts/review-delta.js" check --root "$PWD" --review-dir "{review-dir}" --json` (optionally `--commit <sha>`, `--base <sha>` for the live authoritative base) re-runs the full freshness evaluation and exits 0 only when the current commit is accepted by exact match, content identity, or a valid complete chain. A passing `check` is the sanctioned recheck evidence for `dev-session recertify`, which advances the gate row's `verified_commit`/`verified_at` pair. The gate row must carry that pair for the current commit; the frozen report alone is never sufficient.

## Supplement binding

Each `supplement-{N}.json` is immutable once written and binds:

- `canonical_report` — path, exact SHA-256 of the canonical `report.json` bytes, and the frozen reviewed commit;
- `prior_commit` — the certification head it extends (the reviewed commit for N=1, supplement 1's commit for N=2);
- `chain_index` — its position (1 or 2, contiguous);
- `source` — the certified fix commit, its `tree` object ID (what a rejection is keyed on), and the exact `delta_diff_sha256` of `git diff --binary prior...commit` taken through `trustedDiffArgs`;
- budget facts, changed-file inventory, the reviewer identity/lenses, and a `passed` result.

Validation recomputes every hash and re-derives the delta from Git; a drifted report, drifted diff, gap in the chain, failed outcome, or chain head that is not the current commit rejects the whole chain.

The two post-pass paths do not compose, and that is the intended contract rather than an omission. Content identity always measures the current commit against the **frozen reviewed commit**, so once a supplement is recorded, any rewrite of the chain — `--amend` (including a bare reword), a rebase, a squash — fails the chain (its recorded head is no longer HEAD) and fails identity (the rewritten content is not the frozen content) at the same time, and the branch takes a full round. Widening identity to accept a chain head would mean trusting a second, supplement-shaped certification to stand in for the reviewed one, which is the acceptance surface this design deliberately keeps to a single claim about trees. **So do not rewrite history after recording a supplement** — land the fix commits as-is, and if a rebase is unavoidable, do it before the first supplement.

## What this does not change

- Rounds 1–3 inside an unfinished run still require complete-round re-review after any mutation (`steps/04-resolve.md`); supplements exist only **after** a canonical pass.
- Design Critique, QA, verification, and every other routed gate keep their own freshness rules; a supplement certifies Review only.
- Ship's post-mutation recertification protocol (`skills/ship/references/delivery-contract.md` § 4) still requires advancing the release transaction and rerunning `dev-gate-check.js` before any push.
