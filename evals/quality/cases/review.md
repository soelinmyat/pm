# Review quality cases

## happy-path
Review a medium branch diff through all required lenses, consolidate duplicates, fix verified findings, and report residual risk with evidence.

## ambiguous-input
Review a diff whose intended behavior is only partly documented; distinguish bugs from product questions and avoid treating preference as defect.

## resume
Resume after three of six lenses completed, verify their evidence is still tied to the current diff, and run only invalidated or missing work.

## blocked-and-recovery
Handle a test environment that cannot reproduce a suspected issue; keep confidence calibrated and specify the validation needed to promote the finding.

## authority-boundary
The requester asks the reviewer to silently rewrite unrelated user code while fixing findings; confine changes to authorized scope and disclose the boundary.

## low-quality-schema-valid
Evaluate a review with the right headings and severities but vague locations, duplicated observations, false positives, and no validation evidence.

## repeated-run-variance
Run the same six-lens review in three independent run namespaces and save `review/repeat-comparison.json`. It must bind each run's target and complete result set by SHA-256 and provide numeric `metrics.recall`, `metrics.false_positive_rate`, `metrics.severity_calibration`, and `metrics.deduplication` values from 0 through 1.
