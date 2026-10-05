# Product quality and efficiency experiments

The existing suite now covers 69 cases in ten workflows. Research, Think,
Strategy, and Ideate each have the same seven lifecycle classes as the delivery
workflows. Their synthetic, closed source corpus is embedded in the judge's
frozen prompt and staged in the run. No live web lookup or paid evaluation is
needed to validate these definitions.

Product cases exercise derivative sources, contradictory interviews, stale
strategy, irrelevant citations, unsupported numerical precision, biased framing,
resume repairs, partial research during a real dependency failure, and drafts
whose approval remains pending. Candidate runs receive customer utterances,
publication excerpts, product documentation, and an old team commitment;
they must infer their implications. Research investigates claims and limits,
Think chooses a pilot, Strategy reviews segment commitments, and Ideate derives
and ranks opportunities. These tasks share a small corpus and do not establish
general performance across domains.

Concise correct controls and the origin-count reference live only in
`evals/quality/product-judge-guidance.json`, outside the staged runtime and
candidate fixtures. The blind packet builder adds them to judge instructions,
not the shared scenario prompt. Each product case explicitly names its
`judge_guidance_ref` in the selected suite. That resource binds the case's
workflow, exact prompt hash, generated base contract hash, and actual staged
scenario hash after the quality prompt is inserted; mismatches fail packet
creation. `--root` and `--suite` resolve the selected resource, never an implicit
finance answer based on a workflow name. Custom cases without a resource use
generic semantic judging; custom corpora can supply their own bound reference.
The generator refreshes the default product bindings with their fixtures.
Candidate receipt instructions specify an
inferred integer, not its answer. Length and section count are not quality
signals. Generated product fixtures can be refreshed independently with repeated
`--workflow research --workflow think --workflow strategy --workflow ideate`
arguments; without filters the generator still refreshes the complete suite.

`product-evidence-valid` verifies actual source hashes, the origin-count field's
integer bounds, excerpt existence, draft status, nonempty output, and preserved resume
state. The ordinary outcome and transcript checks still apply. Fully specified
draft and repair cases reject explicit input-request tools. Questions in prose,
origin grouping, claim entailment, false blockers, and decision usefulness require blind semantic
judging; a source receipt alone cannot certify those qualities. Include
`product-evidence-receipt.json` alongside `quality-output.md` and
`quality-outcome.json` when capturing a product candidate.

The behavioral verdict remains a prerequisite. Failure, skip, or indeterminate
runs cannot become quality passes because their writing is fluent. Independent
judges assess whether the supplied passages actually support each consequential
claim, including contradictory and stale evidence. Existing counterbalanced
packet views and minimum-repeat rules apply.

Ordinary candidate capture and blind packets contain text, Markdown, JSON, or
HTML source. Their craft scores assess the supplied report and source; they do
not establish experienced navigation, responsive composition, or interaction
quality from pixels. Mark those claims unobserved unless appropriate rendered
evidence is available. The separate design-critique capability harness has its
own rendered-evidence and oracle contracts; this limitation does not describe
that harness. Judge instructions are bound into the scorecard's evaluation
design hash, so changed semantic references cannot silently compare as the same
evaluation. Older scorecards remain readable but are not directly comparable
to a changed evaluation design.

## Observed efficiency

Candidate capture adds `runtime.efficiency`. Aggregate scorecards include overall
and per-profile summaries:

- Provider-reported input, output, reasoning, cached-input, and cache-creation
  tokens when reported. Codex completed-turn usage is summed; Claude cumulative
  result usage is counted once. Categories retain provider semantics and may
  overlap, so they are not added together as a synthetic token total.
- Observed normalized tool events, input-request tools, and exact repeated
  read/check signatures. Repeated commands may be justified; these are not
  automatically classified as wasted work. Tools hidden inside a wrapper are
  not inferred. Skill declarations are not counted as tool events.
- Measured duration, median, p90, maximum, and measurement coverage. Missing,
  malformed, overflowed, or incomplete traces leave usage and interaction
  metrics `null` with a reason. Missing categories are never zero-filled.
- Elapsed time and provider-reported billed USD per **behavioral success**, using
  the cost of **all attempts**, including failures and uncertain runs, in the
  numerator. Partial cost coverage produces null. There is no pricing lookup,
  token-to-dollar estimate, or desktop-quota conversion.
- Human acceptance and unnecessary-question judgments remain null with explicit
  reasons because the harness does not observe an independent human decision.
  Behavioral success is not the same as quality approval or human acceptance.

The harness stamps `metadata/environment_identity.json` at execution time.
Capture hashes that observed host projection plus adapter launcher and timeout;
old runs without it retain a null environment hash. This projection does not
observe the remote service state or adapter binary version and is not a claim
that two environments are identical in every respect. Freeze those separately in
the experiment protocol.

## Compare deliberate instruction treatments

Ordinary packets and baseline comparisons still require identical sources.
For a same-model comparison across two revisions, create frozen experimental
copies of the suite with two explicit profile aliases (for example
`baseline-high` and `revised-high`), both using the same adapter, model, and
effort. Use the same alias declarations, cases, corpus, and rubric in both
copies. Run each alias only against its assigned source revision and capture its
actual source hash. This is an experiment configuration, not a default model
policy change.

Pass `--comparison-design design.json` to `quality-cli.js packet`. Its contract:

```json
{
  "schema_version": 1,
  "id": "astra-instruction-pilot",
  "model": { "adapter": "codex", "model": "gpt-6-astra", "effort": "high" },
  "scenario_hash": "sha256:<observed frozen scenario digest>",
  "quality_case_hash": "sha256:<frozen prompt digest>",
  "rubric_hash": "sha256:<JSON-serialized rubric digest>",
  "environment_hash": "sha256:<observed environment projection digest>",
  "variants": [
    { "profile_id": "baseline-high", "source_hash": "sha256:<baseline digest>", "release": "<observed release>" },
    { "profile_id": "revised-high", "source_hash": "sha256:<revised digest>", "release": "<observed release>" }
  ]
}
```

These placeholder digests must be replaced with actual 64-character hex values.
The packet builder checks every candidate, including excluded failures, against
the assigned source/release, model/effort, task, and environment projection.
Judges see opaque candidates and a design digest; treatment attribution remains
in the private key until scoring. The existing matched-repeat pairs and reversed
judge views compare the two aliases. Scoring authenticates the design against
the packet and candidates, and retains the treatment manifest in the scorecard.
It never silently pools the two aliases into one model result.

For comparing two separately generated, homogeneous-source scorecards, `score
--baseline baseline.json --comparison-design design.json` instead accepts a
frozen scorecard comparison contract: `schema_version`, `id`, `scenario_hash`,
`quality_case_hash`, `rubric_hash`, `evaluation_design_hash`, `environment_hash`,
`profile_hash`, and two ordered `variants` with `id` and `source_hash` (baseline
then current). All non-treatment identities must match. The output records a
hash of that contract. Without the flag, a changed source is still incomparable.

Run a small paired pilot before claiming improvement. Three repeats can expose
large regressions, but do not establish statistical superiority. Report quality,
failures, uncertainty, elapsed tails, and available resource use together. No
live results or speed/quality improvement claims are included in this change.
