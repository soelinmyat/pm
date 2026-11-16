# Authenticated execution receipts — bounded follow-through

This implements the first execution-owning layer from the verification-repetition
plan. The runner captures actual outcomes and output, authenticates immutable
attempts, compares full before/after input identities, and can reuse successful
baseline/focused suites under an audited deterministic workspace-only contract.
It never imports the planning-only helper's unsigned receipts or writes gate JSON.

Reuse is deliberately narrower than arbitrary repository tests. Owner
contract authentication establishes the reviewed closure assertion, not process
isolation. Unknown external inputs are ineligible; this release provides no
sandbox or automatic proof of hermeticity. Whole-workspace inventory includes
ignored/generated and installed dependency bytes, with no exclusion interface.
Symlinks, external Git metadata and unobservable dependencies select execution.
macOS shared libraries absent as readable files cannot be matched and therefore
run fresh; real Linux CLI reuse is checked independently in CI.

The consumer prerequisite change adds protected required-setting declarations,
secret-free keyed identities and live policy matching. Required-setting failures
block before runtime/service discovery, including comprehensive hook fallback.
It does not infer demo credentials or PostgreSQL lock capacity. Tests reject
omitted protected settings, changed values and capability drift before suites.

Adversarial coverage includes forged and wrong-key receipts, changed source,
command, environment, installed dependencies and ignored inputs, expired/missing
output, unknown symlinks, input drift, timeout and truncated output. Final-stage
execution remains mandatory even when a valid baseline receipt exists. Review,
final verification, pre-push suites and CI retain their independent authority.

Further consumer reuse needs a service-state/external-input contract and trusted
observation adapter. Database capacity preflight also needs an explicit protected
capacity requirement and bounded query; readiness and server identity alone do
not establish available lock capacity. Do not wire arbitrary Rails/browser suites
to this workspace-only contract. Active CleanLog deliveries and runtimes remain
outside this change.

Independent Review exposed a handled-SIGTERM timeout bug. The repaired executor
uses an asynchronous owned POSIX process group and hard termination on deadline
or output overflow, including inherited-pipe descendants. Regressions verify
bounded failure and successful subsequent store acquisition. Windows execution
is explicitly unsupported; no timeout or process-tree safety is inferred there.

## Observed classification protocol gap

Independent reviewers agreed that a schema regression needed explicit expected
outcomes, but one classified the repair mechanical and another behavioral. The
first later agreed behavioral. The old additive clarification schema could not
preserve that agreement, and an already finalized report remained blocked. The
new protocol requires unanimous target-bound peer remedy/classification
agreement, preserves original bytes, and only strengthens to behavioral. A
separate owning writer can reconcile the original frozen round; successor
creation and checking revalidate the record and require fresh full Review.
Actual product/authority decisions and already decision-required recovery scopes
remain blocked. The parent's later explicit task to implement this protocol is
recorded as new Dev work scope; earlier blocked reports are never rewritten or
retroactively marked passed.

The same recovery exposed a mismatch between target creation and phase recording:
`advance-decision` already allowed new targets after a genuinely new external task
direction, but phase history rejected them. The phase writer now appends a bounded
`decision_boundary` after checking the canonical log and exact predecessor report
and target. Tests retain old blocked outcomes and reject absent logs, unadvanced
decisions, forged boundary hashes and altered predecessor evidence.

Independent Linux coverage CI exposed Node's automatic propagation of
`NODE_V8_COVERAGE` into a caller-supplied spawn environment. That mutation changed
the signed contract after execution and introduced an undeclared child input.
The runner now passes an isolated environment with an explicit absent value for
undeclared coverage, while preserving declared values and binding the owner's
coverage setting into identity. The regression checks unchanged authenticated
contract bytes, absent child coverage, actual reuse and owner-setting invalidation.

Post-pass regression coverage also retains the established boundary for a later
source correction after passing Review. That path must not enter new-decision
reconciliation or reinterpret a replaced canonical projection as authority drift;
the prior immutable checkpoint remains retained.
