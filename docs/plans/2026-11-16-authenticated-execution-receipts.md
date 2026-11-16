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
