# Output Quality Evaluation — Wave 2

**Date:** 2026-07-12  
**Status:** Implementation complete; review and release pending  
**Baseline:** PM v1.13.12 (`293da1f`)  
**Branch:** `codex/output-quality-evaluation`

## Goal

Extend PM's behavioral evaluation harness so it can distinguish an output that
merely completed the workflow from one that demonstrates strong judgment,
clarity, and craft. The comparison must be blind, reproducible, and safe to use
across GPT-5.6 Sol High and Opus 4.8 xHigh without weakening deterministic
workflow gates.

## Non-negotiable boundary

Deterministic checks are authoritative for safety, containment, workflow gates,
and artifact contracts. A quality judge can score only a candidate whose run
bundle has a determinate behavioral verdict, and its score can never turn a
behavioral failure into a pass.

## Architecture

### 1. Versioned quality suite

Add `evals/quality/suite.json` as the committed inventory of substantial
workflows and scenario classes. Each workflow must eventually cover:

- happy path
- ambiguous input
- resume
- blocked and recovery
- authority boundary where applicable
- low-quality but schema-valid output
- repeated-run variance

The suite validator will reject duplicate cases, unknown scenario classes,
missing required classes, unsafe paths, and incomplete model profiles.

### 2. Candidate manifest and artifact extraction

Each quality candidate is represented by a sanitized manifest that records:

- workflow and case identity
- behavioral run reference and verdict
- release/source identity
- provider/model/profile and repeat index
- artifact paths plus content hashes

The private candidate manifest retains model identity. A packet builder creates
a separate judge packet with opaque candidate IDs, artifact content, scenario,
and rubric only. Provider, model, adapter, run ID, filesystem paths, timestamps,
and ordering clues are excluded from judge input.

### 3. Quality rubric

Use a shared anchored 1–5 rubric for:

- problem understanding and judgment
- evidence and traceability
- completeness and decision usefulness
- clarity and information design
- artifact craft and usability
- calibration, boundaries, and recovery guidance

Every score requires artifact-grounded evidence. A judge can mark a dimension
`not_applicable`, but cannot silently omit it. The aggregate uses only applicable
dimensions and reports coverage so a high score with sparse coverage is visible.

### 4. Blind judging and adjudication

Judge output is strict JSON and names opaque candidates only. Validation rejects
identity leakage, out-of-range scores, missing evidence, unknown rubric
dimensions, duplicate judgments, and incomplete pairwise comparisons.

Pairwise preference and absolute rubric scores are both retained:

- absolute scores make releases comparable over time
- pairwise preference is more sensitive when two outputs are close
- ties are allowed and must include a reason

Multiple judge results can be aggregated. Disagreement is reported rather than
averaged away; high disagreement produces an `adjudication_required` flag.

### 5. Repeated-run variance

At least three repeats per model/profile are required for a variance claim.
Aggregation reports mean, median, range, population standard deviation, pass
rate, and score coverage by workflow/case. Results with mixed or indeterminate
behavioral verdicts remain visible but are not treated as quality wins.

### 6. Workhorse model profiles

Commit named profiles rather than scattering environment examples:

- `sol-high`: GPT-5.6 Sol with high reasoning
- `opus-xhigh`: Opus 4.8 with xHigh effort

Profiles map to the existing Codex and Claude adapters and document the exact
environment variables used for opt-in live runs. Secrets and auth paths remain
local and never enter packets or scorecards.

### 7. Scorecard

Generate a sanitized Markdown and JSON scorecard containing:

- behavioral eligibility/pass rate
- rubric totals and dimension breakdowns
- pairwise wins, losses, and ties
- repeated-run variance
- judge agreement and adjudication flags
- release-to-release deltas when a baseline is supplied
- explicit limitations and missing coverage

The scorecard resolves blinded IDs back to public profile labels only after
judgments validate. Raw transcripts and private auth/runtime metadata remain
outside the shareable report.

## Delivery sequence

1. Add failing unit tests for schemas, blinding, rubric validation, aggregation,
   and deterministic/quality precedence.
2. Implement the quality library and CLI without changing behavioral verdict
   semantics.
3. Add the suite inventory, rubric, profiles, fixture artifacts, and a known
   low-quality-but-valid calibration case.
4. Add packet, judgment, and scorecard commands to `package.json` and document
   the live Sol/Opus procedure.
5. Add static validation to `eval:check` and CI-safe tests; keep live model calls
   opt-in.
6. Run a minimum three-repeat Sol/Opus comparison locally when both adapters are
   eligible. If auth or installed model names are unavailable, ship the fully
   tested harness and report live comparison as an explicit follow-up, not as a
   fabricated result.
7. Run PM's six-lens review, fix all actionable findings, full validation, cache
   sync, version bump, PR, hosted CI, merge, and retag on main.

## Exit criteria

- A schema-valid but weak artifact receives a materially lower deterministic
  calibration score than the strong fixture.
- Judge packets contain no model/provider/run identity.
- Behavioral failures remain failures regardless of quality score.
- Three-repeat aggregation exposes variance and incomplete coverage.
- A blind Sol-versus-Opus scorecard can be generated from validated judgments.
- Static validation and the full plugin test suite pass.
- Wave 2 is released from main with its version tag on the merge commit.

## First live calibration result

The frozen `groom-happy-path` smoke pair produced two deterministic passes from
the same release, runtime hash, and scenario hash:

- Sol High: 404.5 seconds, blind weighted mean 4.9/5
- Opus xHigh: 851.9 seconds, blind weighted mean 4.2/5
- two independent blind judges preferred the Sol candidate
- no dimension crossed the 1.5-point adjudication threshold
- one repeat per profile, so variance remains explicitly non-claimable

The run also found and fixed three evaluator defects before scoring: isolated
Claude keychain auth did not forward an access token, long adapter output was
buffered until exit, and the initial judge response contract described rather
than specified its JSON nesting. The released implementation retrieves only the
opted-in access token, streams progress to run-owned files, and uses a closed
field-level judgment contract.
