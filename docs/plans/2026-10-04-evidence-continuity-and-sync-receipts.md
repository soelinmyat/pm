---
title: Evidence continuity and Git sync receipts
created: 2026-10-04
updated: 2026-10-04
---

# Evidence continuity and Git sync receipts

This release preserves valid feature evidence while making integration and remote acknowledgement explicit. Existing review freshness, exact-head CI, safety and authority gates remain required.

## Delivered behavior

- `review-impact.js` compares frozen and current Git trees, reports upstream paths against a declared complete dependency/contract closure, and separates retained feature review from focused, affected-contract or full integration validation. Its output is advisory and cannot certify gates. Missing, malformed or incomplete coverage and material feature changes select full validation.
- Identical Dev authority grants reuse the original audit; new actions or consent reasons retain a separate audit. Material scope/content changes retain their own review and artifact approval contracts. Platform and cross-thread permissions remain independent.
- Review guidance distinguishes causal release blockers from unrelated followups while preserving bounded delta review and the three-round cap. QA guidance preflights harness inputs, build readiness, capture identity and simulator ownership, and separates presentation repair from acceptance behavior.
- Git sync requires a live remote acknowledgement of the configured ref and exact HEAD, hashes staged/working/untracked bytes for recovery, and counts pulled files from Git objects. Missing upstream stops before mutation with a precise blocked result. Pull with staged changes stops before autostash to preserve both variants. Repository serialization, bounded retries and explicit conflict recovery remain in place.
- Comprehensive release transactions can create an explicitly requested draft PR. They must verify the journaled ready transition before merge, retaining existing prepared-release, authority, CI and fresh PR-body attestation checks.

## Verification

Regression coverage exercises unrelated and affected upstream changes, material feature changes, unknown dependency coverage, identical approval replay and additional effects, stale tracking refs, unavailable remotes, dirty recovery identity, staged/working preservation, missing upstream and comprehensive draft readiness. Existing sync conflict, replay and shared-writer lock tests remain required. Final source review and full-suite verification run after the prepared-release commit; GitHub CI must be observed for that exact PR head before merge.

## Limits and deferred work

Dependency completeness is an explicit workflow observation, not automatic dependency discovery. No delivery gate accepts the advisory impact report as certification. QA improvements are workflow preflight and identity guidance; automated management of product-specific fixtures and shared simulators is deferred. This release does not reconcile a mixed canonical KB, invent upstream ownership, migrate ProductMemory data, change consumer product behavior or stop another writer. A blocked shared KB still needs its owning isolated recovery session.
