---
title: "Capture, compatibility, and product polish — Wave 10"
created: 2026-07-15
updated: 2026-07-15
status: in-progress
branch: codex/capture-compatibility-product-polish-v2
base: v1.13.39
---

# Capture, compatibility, and product polish — Wave 10

## Outcome

Finish the PM plugin master plan with a mechanically safe lightweight-capture boundary, a deliberately narrow Simplify compatibility surface, and public workflow/artifact documentation that matches the released runtime. This wave changes plugin maintenance behavior, not product scope, so Dev treats it as a high-risk `task`: no fabricated Groom/RFC lineage, but full TDD, design, QA, Review, verification, cache, CI, and release evidence.

## Baseline evidence

- Branch is an isolated worktree based on the `v1.13.39` main merge commit `387b0ce2f064324994c0534107c6ecd388d59d49`.
- The pre-change suite passes: 2,046 tests, 2,040 passed, 0 failed, 6 dependency skips.
- Task and Bug currently call `scripts/capture-backlog.js`, but its destination check, ID scan, and write are not one owned transaction.
- Bug enrichment instructs the model to edit the saved Markdown directly, outside the capture validator and lock.
- `pm:simplify` is already a redirect, but `dev-gate-check.js` still retains obsolete logic that can make Simplify a required/skippable current gate.
- Public docs describe individual commands but do not provide the promised maintained workflow map or artifact gallery.
- Wave 9 left one accepted low-severity reuse debt: reconciliation manually parses pending effect journals beside the shared `readJournal` boundary.

## Non-goals

- No generic capture framework for Note, Ingest, or other evidence workflows.
- No new lifecycle state machine for Task, Bug, or Simplify.
- No removal of the `/pm:simplify` command, skill, manifest entry, or install symlink in this release.
- No forced HTML output for lightweight captures, strategy, features, or evidence notes.
- No broad rewrite of already-released workflow skills or historical planning records.
- No live-model certification matrix for aliases; deterministic behavior and representative workhorse smoke runs are proportionate.

## Workstream 1 — Atomic backlog capture

### Contract

One source-owned service must own each Task/Bug create or enrich transaction:

1. resolve and attest the PM/backlog boundary without following symlinked path components;
2. validate bounded inputs before taking the lock;
3. acquire one owned backlog lock;
4. re-attest the boundary under the lock;
5. allocate the next ID and check slug/ID collisions from the same snapshot;
6. publish with exclusive, atomic no-overwrite semantics;
7. validate the exact published bytes and return a structured receipt;
8. release the owned lock in `finally`.

Task policy remains `kind: task`, `priority: medium`, `labels: [chore]`, concise optional body, then route to Dev. Bug policy remains `kind: bug`, `priority: high`, `labels: [bug]`, ordered Observed/Expected/Reproduction sections, then optional enrichment and Dev routing. Policy lives at the skill boundary; transaction mechanics live in the script.

### Failure semantics

- Concurrent captures serialize and receive distinct monotonic IDs.
- A colliding slug or explicit ID never overwrites or burns an ID.
- Empty/degenerate titles, unknown kinds/priorities, malformed IDs, excessive text/labels/body, unsafe slugs, absolute paths, traversal, symlinked PM/backlog roots, and non-regular body files fail closed.
- A failed create leaves no destination and no temporary residue.
- Enrichment requires the expected kind and observed content identity; stale or cross-kind updates fail instead of clobbering newer work.
- CLI output remains one JSON receipt on stdout and a nonzero exit with a concise error on stderr.

### Test-first evidence

Add failing tests for concurrent child-process capture, duplicate explicit IDs, destination and parent symlinks, unsafe/empty slugs, malformed inputs, body-file bounds/type, atomic no-overwrite, stale enrichment, and preservation of alias defaults. Record the initial failing command and final passing command in the Dev TDD evidence.

## Workstream 2 — Task and Bug skill quality

- Give Task a small step sequence rather than an oversized inline procedure.
- Keep Task and Bug decision criteria distinct while delegating mechanics to `references/capture.md` and the shared helper.
- Replace Bug's direct Edit enrichment instruction with the validated helper operation.
- Ensure every new/changed step has Goal, How, Done-when, and an explicit transition.
- Add representative authoring/behavior fixtures that assert capture-first recovery, useful confirmation, and correct Dev/Groom routing without imposing core-workflow ceremony.

## Workstream 3 — Simplify compatibility boundary

- `/pm:simplify` and `pm:simplify` continue to redirect exactly to Review.
- Current Dev routes, gate manifests, telemetry, and quality instructions never create or require a Simplify gate.
- Legacy session phases and old sidecar rows remain readable only at named migration/inspection boundaries.
- Delete obsolete Simplify skip-policy validation and tests that imply callers may require the old gate.
- Retain concise tests for redirect identity, absence of independent steps, current-route exclusion, migration mapping, and legacy-row tolerance/failure diagnostics.

## Workstream 4 — Public surface and artifacts

Create two maintained reader documents:

- `docs/workflow-map.md`: user intent → skill → durable output → next canonical skill, including capture shortcuts and the Simplify compatibility alias.
- `docs/artifact-gallery.md`: artifact purpose, canonical machine source, human form, location, lifecycle owner, required validation/render gates, and when HTML is intentionally absent.

Link them from README and Codex installation guidance. Reconcile command names/descriptions, skill triggers, examples, telemetry step names, manifest lists, and install symlinks against `plugin.config.json`. Add deterministic parity/link tests so future drift fails CI.

## Workstream 5 — Wave 9 debt and planning reconciliation

- Make reconciliation use the shared operational-effect-journal reader and add valid/malformed pending-journal regression coverage.
- Mark Wave 9 released as `v1.13.39` only with its main commit and tag evidence.
- Replace stale master-plan concerns and next actions with Wave 10 status.
- Mark Wave 10 and the master plan complete only after the final merged main commit satisfies every completion-contract row.
- Keep historical dated plans as release evidence; archive or delete only genuinely superseded, unactionable notes.

## Acceptance matrix

| Requirement | Evidence |
|---|---|
| Atomic create and enrich | focused unit/CLI concurrency, path, stale-write, and validator tests |
| Distinct Task/Bug policy | skill contract tests plus captured frontmatter/body fixtures |
| Pure Simplify redirect | redirect/current-route/migration/legacy-inspection tests |
| Surface parity | plugin authoring audit, manifest/command/docs parity tests, link checks |
| Artifact quality | artifact gallery schema/content checks; README/install rendering inspection |
| Runtime reuse | reconciliation journal-reader regression test and shared-boundary import check |
| Provider neutrality | prompt/result contracts contain no provider-specific workflow semantics; installed Sol/Opus cache smoke tests |
| Release integrity | patch bump is final source commit before review; PR CI green; tag moved to exact main merge commit |
| Master-plan completion | requirement-by-requirement audit on final main, with no open P0/P1 or unowned P2 |

## Verification sequence

1. Observe focused tests fail before production changes.
2. Make focused capture, gate, authoring, journal, and docs parity suites pass.
3. Run `npm run validate:plugin`, formatting/lint checks, artifact/link checks, and `npm test`.
4. Sync source to the installed Claude and Codex workhorse caches; validate and run representative Task/Bug/Simplify/Review smoke suites in each.
5. Run the routed Design Critique and QA on materially changed reader surfaces.
6. Run one bounded full Review lineage against the release-prepared final tree; remediate at most three rounds.
7. Verify final gates and authority, push the feature branch, create the PR, monitor hosted CI, and merge.
8. Move the patch tag to the exact main merge commit, clean the worktree/branch, and perform the final master-plan audit on main.

## Done-when

- Every acceptance row above has current evidence on the same final commit.
- Both installed workhorse copies validate and execute representative smoke cases.
- Hosted CI passes, the PR is merged, and the release tag names the main merge commit.
- The master plan records Waves 1–10 as released and has no unresolved completion-contract item.

**Advance:** implement Workstream 1 with observed red/green evidence, then proceed through the remaining workstreams and the bounded release sequence.
