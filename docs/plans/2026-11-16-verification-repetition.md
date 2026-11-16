---
title: Verification repetition — bounded first release and follow-ups
created: 2026-11-16
updated: 2026-11-16
---

# First release: fail before expensive work

The PM source pre-push hook previously ran every test in a fresh detached
worktree before resolving remote HEAD or checking inventory, release preparation,
and gate evidence. It did not install dependencies, although package.json requires
AJV and AJV formats. New regression fixtures reproduce test execution before a
prerequisite failure and missing dependencies in the committed checkout.

This release checks prerequisites for every ref before any suite, then installs
locked development dependencies inside each pushed-commit checkout. Installation
failure blocks without starting tests. Full suites, exact pushed-source testing,
canonical gate authority and independent CI remain mandatory. No test-result reuse or design recertification is claimed. Active consumer
worktrees and caches stay unchanged.

Release verification reproduced a related compatibility defect: the unchanged
checker passed native file-label and sparse-proof fixtures on main at 1.14.53,
but rejected them after preparation of 1.14.54 because explicit version registries
ended at 1.14.53. This release adds only the reviewed 1.14.54 registry entries.
The native producer, audits and report contract remain byte-identical to main;
active 1.14.50–1.14.53 evidence stays compatible, while pre-boundary 1.14.49 and
unknown 1.14.55/999.0.0 active evidence stay rejected. Historical integrity and
current source bindings remain mandatory. This is explicit compatibility for
this release, not automatic acceptance of future runtime versions.

# Evidence and follow-up boundaries

Read-only inspection of CleanLog's root lefthook.yml found parallel pre-push lanes,
broad apps/api/** triggers, and rails-test invoking bin/with-api-db-lock around
schema preparation, request specs and Rails tests. Reported database lock-memory
exhaustion and demo-password failures therefore cannot be fixed by installing the
PM repository's Node dependencies. No consumer hook was edited or executed.

1. **Verification execution receipts.** scripts/lib/verification-plan.js already
   matches complete supplied environment/dependency identities and retained output,
   but is planning-only; final mandatory checks still execute. Add an owning runner
   that records actual command outcomes and before/after input identities. Determine
   authenticated provenance before permitting gate reuse. Include ignored/generated
   inputs, installed dependency bytes, runtime/executable identity, exact command,
   service/config identity, and conservative unknown-input invalidation. Do not
   elevate hand-authored receipts into passing gates.
2. **Consumer preflight.** repository-gate-runner.js already invokes
   repository-environment-preflight.js for authenticated optimized plans. The
   PostgreSQL probe establishes identity, not sufficient lock capacity or absence
   of competing heavy suites. Comprehensive execution and consumer-specific required
   configuration need an authenticated, bounded prerequisite contract before suites.
   Avoid guessed settings, exposing secrets, resetting databases, or treating a
   successful readiness probe as a test result.
3. **Design compatibility.** Retained PDF/design evidence reportedly invalidated
   after a runtime update despite a test-fixture-only product delta. Define an
   explicit checker/evidence compatibility version and a reviewed dependency closure
   for design inputs before preserving captures. Keep old evidence immutable;
   unknown coverage, changed render inputs, checker semantics or runtime contracts
   require fresh evidence. A blanket exclusion of tests is unsafe.
4. **Supported report recertification.** Extend existing dev-session gate/recertify
   and owning report writers rather than creating editable gate JSON. Recompute
   relevant identities, preserve predecessor failure lineage and independent review
   authority, and adversarially test forged outputs, changed commands/dependencies,
   omitted inputs, source drift and version-incompatible evidence.

These follow-ups require separate scoped implementation and review. This first
release removes wasted full suites before known PM prerequisite rejection and
prevents missing-dependency suite failures; it does not eliminate successful local,
pre-push and CI repetitions or the consumer database/configuration failures.

# CI recovery: bounded Unicode segmentation

The first release candidate's independent CI aborted the unchanged proposal test
file under Node 20.20.2 with V8 heap exhaustion inside Intl segmentation. A
focused reproduction runs a long token and repeated words in a 96 MiB child heap;
it fails before the repair. Consume word and grapheme iterator records immediately
instead of spreading all records before projection. This keeps the same tokens
and Unicode segmentation while avoiding retained input records. The full affected
proposal and multilingual review files pass on Node 20 after this change.

# Follow-through acceptance contracts

Execution reuse remains a separate change: first introduce an owning runner with
immutable actual-output receipts, before/after closure identity and explicit
unknown-input invalidation. Keep it observation-only until forged receipt, dirty
ignored input, command/runtime/dependency drift and service restart tests pass;
only then wire authenticated matches to gate writers. CI remains independent.
Consumer preflight should follow as its own change using the same owning runner:
required config names without secret values, bounded service identity/capacity
checks and inter-process scheduling must fail before the suite. A PM source
release cannot safely guess a consumer's database capacity or demo credentials.
The read-only inspection above supplies the concrete initial consumer case; no
consumer hook or runtime changes are included in this release.
