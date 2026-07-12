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
Run the same six-lens review in three independent run namespaces and save `review/repeat-comparison.json`. It must bind the canonical passing report, bind each run's target and complete result set by SHA-256, and authenticate one run as that canonical target. Report the four metrics derived from those checked outputs: pairwise `metrics.finding_set_agreement`, finding-count `metrics.finding_count_stability`, shared-finding `metrics.severity_agreement`, and pairwise `metrics.outcome_agreement`. Each value is rounded to six decimal places from 0 through 1; the checker recomputes and rejects self-reported values that do not match. Passing also requires finding-set agreement and finding-count stability of at least `0.8`, plus exact (`1.0`) severity and outcome agreement.
