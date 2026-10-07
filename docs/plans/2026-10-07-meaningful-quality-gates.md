---
title: "Meaningful quality gates"
created: 2026-10-07
updated: 2026-10-07
---

# Meaningful quality gates

Keep gates for consequential failures and honest evidence. Remove mechanical blocks that do not establish those claims. This change implements the approved simplification direction; delivery stops at a reviewed draft PR.

## Before and after

| Gate and existing hook | Failure it prevents | Current cost and false positive | Replacement |
| --- | --- | --- | --- |
| Design Critique score floor; `scripts/design-critique-check.js:validateScores` | A weak score signals poor craft, but is not itself a demonstrated task failure. | Every axis must score at least 3/5 even when there is no consequential finding; a minor preference can force another round. | Keep evidence-backed scores visible as diagnostics. Open/deferred P0/P1, missing required coverage, incorrect source and hidden/dismissed source blockers still prevent passage. Core-journey composition can be P1; presentation is not automatically cosmetic. |
| QA score bands; `scripts/lib/qa-report-schema.js:validateVerdict` | Critical/High findings and failed required assertions establish delivery failures. | An accumulation of minor deductions can prohibit passing; an otherwise healthy numerical index can also misclassify an actual failed test. | Keep the finding-derived index for compatibility and disclosure. Judge the verdict from tested claims and consequential findings; `pass-with-concerns` can disclose minor findings at any index. Retained non-passing history remains non-passing. |
| Structured Review eligibility; `scripts/lib/review-presentation.js:structuredReviewPolicy` | Canonical target/results/findings/decisions and Git identity establish source review. | File count, security routing, report length or a second round can require browser-responsive/print reports although the source review claim is unchanged. The v1.14.0 source-only delivery required the full render matrix. | Canonical current JSON is sufficient for source Review. Keep all logical lenses, independent reviewer evidence, findings/decisions, scope and freshness checks. HTML is optional; choosing it retains its own presentation checks. Actual product UI still follows its QA/Design Critique route. |

## Hard invariants and judgment

Wrong source, corrupted or misleading evidence, failed required assertions, consequential task/data/access failures, and unresolved product/security/privacy/operational authority remain blockers. Scores and the number of minor findings are diagnostics. Assess cumulative friction in the user's core journey; an unusable detail/drawer composition or ambiguous save action must not be split into cosmetic issues to pass. A low score never establishes that a core journey works.

Use executed evidence for the claim it supports. A genuine adapted harness run may establish its observed adapted scope; it does not establish unchanged execution of committed flows. Disclose the effective child command, retained effective inputs and meaningful differences when an unchanged-source claim depends on them. Reviewed adapters and owned harness repairs are permitted. Their successful exit, receipt hashes or report format cannot certify unexercised behavior. The run-18 diagnosis documents real adapted execution and a separate owner harness grouping error, not fraud or a confirmed platform-rejection cause.

Retest the claims affected by a source, fixture, harness or environment change. Preserve unchanged evidence with its original identity and scope; do not count it as new execution or relabel its source. Current canonical checks and supported Review freshness/supplement paths still apply. If impact cannot be bounded, broaden verification. This change does not add a universal QA evidence carry-forward protocol, change browser capture integrity, or bypass repository-required checks.

## Verification and scope

Producer/consumer regressions must show benign advisory reports and browser-independent source Review continuing, while consequential findings, failed assertions, wrong source, stale/tampered evidence and incomplete reviewer coverage still block. The existing QA gate writer must keep its complete canonical precheck and reject changed evidence on a later call without writing a gate. Its candidate manifest check does not certify the complete QA report at this stage; removing the precheck would permit false passes. This inspected removal is deliberately excluded. Existing legacy/OpenCode and v1.14 preview/delegation/recovery regressions remain in the final suite.

No consumer, Product Memory, tracker or installed-cache writes. No merge, release tag or public release is authorized by this task. No claim of improved real-task judgment or commercial results follows from these source regressions.
