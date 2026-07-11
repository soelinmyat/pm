# PM Quality Scorecard — Groom happy path

Date: 2026-07-12  
PM release: 1.13.12  
Case: `groom-happy-path`  
Result: `quality-scored`

## Behavioral eligibility

Both candidates passed the same deterministic groom scenario from identical
runtime and scenario hashes.

| Profile | Verdict | Runtime |
|---|---:|---:|
| Sol High | Pass | 404.5s |
| Opus xHigh | Pass | 851.9s |

## Blind quality observation

Two independent blind judges evaluated the Markdown proposal and standalone
HTML artifact. Both preferred the Sol candidate, making Sol the observed leader.
The scorecard intentionally declares no quality winner because one repeat per
profile is below the three-repeat claim threshold. No candidate-dimension crossed
the 1.5-point disagreement threshold.

| Dimension | Sol High | Opus xHigh |
|---|---:|---:|
| Judgment | 5.0 | 4.0 |
| Evidence | 5.0 | 3.5 |
| Decision usefulness | 5.0 | 4.0 |
| Clarity | 5.0 | 5.0 |
| Craft | 5.0 | 4.5 |
| Calibration | 4.5 | 4.5 |
| **Weighted mean** | **4.9** | **4.2** |

Sol's proposal won on verbatim evidence preservation, explicit dependencies,
decision closure, testable acceptance criteria, and metrics tied to the two
requesting customers. Opus's proposal had the cleaner authority posture: it
remained `draft`/`proposed`, kept meaningful uncertainty visible, and named
owners for open decisions. Sol's self-marked `Approved` lifecycle was the main
calibration flaw identified by the judges.

## Limitations

This is one matched repeat per profile. It establishes that the end-to-end blind
quality machinery works and provides a first directional comparison; it does
not support a variance or general model-ranking claim. The committed suite
requires at least three repeats before `variance.claimable` becomes true.
This smoke result predates the case-specific fixture and counterbalanced-view
hardening, so it is retained as a historical calibration artifact and must not
be used as a baseline for the hardened design.
