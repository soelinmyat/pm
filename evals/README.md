# PM Behavioral and Quality Evals

This directory contains committed behavioral scenarios for the PM plugin itself.
The behavioral suite answers whether PM workflows are being followed. The
quality suite separately asks whether a deterministically passing output shows
strong judgment, evidence, clarity, calibration, and artifact craft.

Deterministic checks are authoritative. Quality judging never turns a failed,
skipped, or indeterminate behavioral run into a pass.

## Static Check

Run the CI-safe validator:

```bash
npm run eval:check
```

The static check validates scenario shape, shell safety rules, and the sentinel
baseline ledger. It does not call a model, does not need API credentials, and is
safe to run in CI.

## Local Runs

Live runs are opt-in only and write raw output under `eval-results/`, which is
gitignored:

```bash
node scripts/evals/run.js evals/scenarios/dev-review-before-push --agent stub
```

Raw run artifacts can contain sensitive agent output. Keep them local unless a
specific sanitized artifact is intentionally shared for review.

## Current Score

Run the sentinel suite and write a sanitized result ledger:

```bash
npm run eval:score -- --agent stub --write evals/results/current.json
```

The `stub` adapter is harness-only. It proves runner and scoring behavior; it is
not live Codex behavior.

Run the current Codex adapter when you want to see live-adapter eligibility:

```bash
npm run eval:score -- --agent codex --write /tmp/pm-codex-current.json
```

Codex reports `skip: network-policy` by default. That is an honest score state.
It should be read as "not comparable" rather than as a pass or fail.

Live Codex runs are local and explicitly opt-in. They do not run in public CI
and do not claim RFC-grade container network allowlisting. Use a maintainer-owned
Codex home template that contains auth/session material only:

```bash
PM_EVAL_CODEX_LIVE=1 \
PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1 \
PM_EVAL_CODEX_HOME_TEMPLATE=/path/to/isolated-codex-home \
PM_EVAL_CODEX_MODEL=gpt-5.6-sol \
PM_EVAL_CODEX_REASONING_EFFORT=high \
npm run eval:score -- --agent codex --write /tmp/pm-codex-live.json
```

The adapter copies only allowlisted auth/session material from the template,
stages PM into run-owned Codex and `.agents` discovery paths, ignores user
config/rules, and requires marker evidence that Codex loaded the staged PM
runtime. Missing marker evidence is `indeterminate: wrong-source`.

Optional live tuning:

- `PM_EVAL_CODEX_MODEL` adds `-m <model>` to `codex exec`.
- `PM_EVAL_CODEX_REASONING_EFFORT` adds
  `-c model_reasoning_effort="<value>"`.
- `PM_EVAL_CODEX_TIMEOUT_MS` overrides the per-scenario adapter timeout. Invalid
  values fall back to the default timeout.

Codex JSONL has no native PM skill-call event: the adapter prompt asks Codex to
declare skill usage in agent messages (e.g. "Using `pm:dev`"), and the
transcript normalizer extracts declared skills plus `command_execution` /
`file_change` items into typed events with exit codes.

## Claude Adapter

The `claude` adapter runs Claude Code headless (`claude -p --output-format
stream-json`) against the staged plugin via `--plugin-dir`, in an isolated HOME.
It is gated exactly like Codex — skip `network-policy` by default:

```bash
PM_EVAL_CLAUDE_LIVE=1 \
PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK=1 \
PM_EVAL_CLAUDE_API_KEY=sk-... \
npm run eval:score -- --agent claude --write /tmp/pm-claude-live.json
```

Auth options, in preference order: `PM_EVAL_CLAUDE_API_KEY` (passed as
`ANTHROPIC_API_KEY`), `PM_EVAL_CLAUDE_HOME_TEMPLATE` (auth/credential files
copied into the staged `~/.claude`), or `PM_EVAL_CLAUDE_ALLOW_KEYCHAIN=1`
(explicitly retrieves only the Claude Code access token from the macOS
keychain and forwards it to the isolated process; refresh credentials are never
forwarded or logged).
`PM_EVAL_CLAUDE_MODEL` optionally pins the model; `PM_EVAL_CLAUDE_BIN`
overrides binary resolution. `PM_EVAL_CLAUDE_REASONING_EFFORT` adds the Claude
Code `--effort` option.

Skill invocations arrive as typed `Skill` tool events in stream-json, so
`skill-called`/`no-tool-before-skill` checks are first-class on this adapter.
Tool ordering checks use the adapter-neutral taxonomy (`run-command`,
`edit-file`, `write-file`, `read-file`) with optional command matching, e.g.
`run-command~git push`.

**Security posture of live runs (both adapters):** the agent executes headlessly
with the adapter's configured sandbox/permission mode. HOME/XDG redirection is
the containment boundary — there is no container, seccomp profile, or network
allowlist. Treat a live eval as untrusted-code execution: prefer a disposable
machine or container, and never run with credentials in scope beyond the
eval's own auth.

Live adapters enable PM analytics inside the staged workdir
(`.claude/pm.local.md`), so plugin telemetry step spans are captured with run
artifacts and can serve as rewrite-stable check evidence.

Score an existing sanitized ledger:

```bash
npm run eval:score -- --results evals/results/current.json
npm run eval:score -- --results evals/results/current.json --json
```

Commit scenarios and sanitized ledgers only. Do not commit `eval-results/`.

## Blind Output-Quality Evaluation

The committed quality contract lives under `evals/quality/`:

- `suite.json` inventories substantial workflows, case classes, and named model
  profiles.
- `rubric.json` defines the weighted, anchored 1–5 dimensions.
- `cases/*.md` contains frozen inputs for happy path, ambiguity, resume,
  blocked recovery, authority, schema-valid weak output, and repeated-run
  variance.
- `fixtures/` contains strong and weak RFC sidecars that both pass the
  executable schema validator.
- `evals/scenarios/quality-*` contains generated, case-specific executable
  fixtures. They stage real workflow inputs, repositories/remotes where needed,
  persisted resume state, failing dependency checks, authority sentinels, weak
  schema-valid artifacts, and repeat controls. Regenerate them with
  `npm run eval:quality:scenarios`; suite hashes update in the same operation.
  Resume cases use native RFC/Dev transitions (or Groom's documented state
  schema), begin beyond intake, and freeze accepted decisions, source identity,
  checkpoint state, and user-owned dirt.

The workhorse profiles are intentionally explicit:

- `sol-high` remains the default PM workhorse and uses `gpt-5.6-sol` with
  `high` reasoning. OpenAI documents
  `gpt-5.6-sol` as the model ID and lists `high` among its supported reasoning
  levels: <https://developers.openai.com/api/docs/models/gpt-5.6-sol>.
- `astra-high` is an opt-in comparative lane using `gpt-6-astra` with `high`
  reasoning. Astra supports `low`, `medium`, `high`, `xhigh`, and `max`, but not
  `none`. For stable agent runs, state when delegation is useful and give exact
  worker counts or bounds. Calibrate verification to risk so small, reversible
  edits do not trigger unnecessary broad or repeated tests:
  <https://developers.openai.com/api/docs/guides/latest-model>.
- `opus-xhigh` uses `claude-opus-4-8` with `xhigh` effort. Anthropic recommends
  `xhigh` as the starting point for Opus 4.8 coding and agentic work:
  <https://platform.claude.com/docs/en/build-with-claude/effort>.

### 1. Run a stamped quality case

Overlay a frozen quality prompt on a compatible behavioral scenario. The runner
hashes the exact prompt into `metadata/quality_case_identity.json`; capture
refuses unstamped or mismatched runs. Every suite case also binds to one exact
`scenario_ref`, so a resume or recovery prompt cannot be scored against an
unrelated fixture. Its `scenario_contract_hash` also freezes the fixture setup,
story, and deterministic checks; fixture drift must be reviewed and explicitly
accepted in the suite before another run.

```bash
PM_EVAL_CODEX_LIVE=1 \
PM_EVAL_CODEX_ALLOW_UNCONTAINED_NETWORK=1 \
PM_EVAL_CODEX_HOME_TEMPLATE="$HOME/.codex" \
node scripts/evals/run.js evals/scenarios/quality-dev-happy-path \
  --agent codex --quality-case dev-happy-path --quality-profile sol-high
```

To compare Astra without changing the PM default, run the same frozen case and
repeat index with `--quality-profile astra-high`.

```bash
PM_EVAL_CLAUDE_LIVE=1 \
PM_EVAL_CLAUDE_ALLOW_UNCONTAINED_NETWORK=1 \
PM_EVAL_CLAUDE_ALLOW_KEYCHAIN=1 \
node scripts/evals/run.js evals/scenarios/quality-dev-happy-path \
  --agent claude --quality-case dev-happy-path --quality-profile opus-xhigh
```

The named profile, not ambient model environment variables, selects the exact
adapter, model, and effort. The runner records both the resolved profile and
the executed argument vector; capture verifies both. Use the case's declared
behavioral scenario.
Run each profile at least three times from the same source and scenario identity
before making a variance claim.

Every case must emit `quality-outcome.json`. The runtime validator checks the
exact workflow and case type plus lifecycle-specific evidence: ambiguity
options and rationale, observed blocker command and recovery test, preserved
resume invariants, forbidden authority action not performed, or
evidence-backed weak-artifact defects. Repository checks separately enforce
non-mutation where the correct behavior is to stop.

### 2. Capture candidates

Capture one or more user-facing text, Markdown, JSON, or HTML artifacts from
each run. The command verifies the behavioral verdict, source identity, quality
prompt identity, artifact boundary, and content hash. Candidate ledgers contain
model identity and should stay private.
At most four judge artifacts may be captured per candidate, with a 20 KiB
combined judge-view budget. Intermediate symlinks are resolved before
containment is accepted.

```bash
npm run eval:quality -- capture \
  --run eval-results/runs/<run-id> \
  --profile sol-high \
  --case dev-happy-path \
  --repeat 1 \
  --artifact artifacts/report.md \
  --out eval-results/dev-happy-candidates.json
```

Repeat with each compared profile and repeat indexes 1–3. Capture appends to the
ledger and rejects duplicate case/profile/repeat tuples.

### 3. Build the blind packet

Use a fresh secret salt. The packet replaces profile/model/provider strings,
rehashes the redacted judge content, assigns opaque candidate IDs, sorts them,
and emits only matched-repeat cross-profile comparisons. The private key stores
the identity mapping and original-to-blind hashes.
The private key is validated one-to-one against the packet and candidate ledger
before any score can be attributed. Blind packets use a conservative byte-based
token estimate and cannot exceed 48,000 estimated tokens.

```bash
PM_EVAL_BLIND_SALT="$(openssl rand -hex 32)" \
npm run eval:quality -- packet \
  --candidates eval-results/dev-happy-candidates.json \
  --case dev-happy-path \
  --packet eval-results/dev-happy-packet.json \
  --key eval-results/dev-happy-private-key.json
```

Give only the packet to each judge in a fresh context. The packet carries the
rubric, evidence requirement, strict response contract, and exact pairwise plan.
The command emits two authenticated judge views: the requested packet path and
a sibling `*.judge-2.json`. Candidate order and pair orientation are
counterbalanced; give a different view to each judge. Judgments record the view
ID and authenticated view hash; aggregation rejects reused, relabeled, or
tampered views.
Do not give the candidate ledger, private key, run IDs, or provider information
to a judge.

### 4. Validate judgments and score

Each judge must score every dimension or explicitly mark it `not_applicable`,
cite artifact-grounded evidence, and complete every planned pair. Missing rows,
unknown dimensions, identity/tamper failures, and incomplete comparisons are
hard validation errors.

```bash
npm run eval:quality -- score \
  --candidates eval-results/dev-happy-candidates.json \
  --packet eval-results/dev-happy-packet.json \
  --packet eval-results/dev-happy-packet.judge-2.json \
  --key eval-results/dev-happy-private-key.json \
  --judgment eval-results/judge-a.json \
  --judgment eval-results/judge-b.json \
  --json eval-results/dev-happy-scorecard.json \
  --markdown eval-results/dev-happy-scorecard.md
```

Packet and judgment flags are positional: provide one authenticated packet file
for each judgment, in the same order. Scoring recomputes each view hash and
validates the judgment against that view's exact candidate order and ordered
pair plan; sibling IDs copied from another view are not accepted.

Add `--baseline <prior-scorecard.json>` to report per-profile and per-dimension
release deltas. The scorecard includes behavioral eligibility, weighted means,
dimension coverage, matched pairwise wins/ties, repeat variance, judge
agreement, adjudication flags, and limitations.
An `observed_leader` may be reported from a small sample, but `quality_winner`
remains null until every compared profile meets the minimum repeat count and no
adjudication is pending. Baseline deltas require identical source, scenario,
prompt, rubric, and evaluation-design hashes.

Raw runs, candidate ledgers, blind keys, and judgments remain under the
gitignored `eval-results/`. Share or commit only an intentionally reviewed,
sanitized scorecard.

Long live runs stream stdout and stderr directly into the run-owned metadata
files instead of buffering until exit. Completion refuses to load captures over
32 MiB into memory and marks the run output-limited. `<adapter>_progress.json` records start,
terminal status, duration, exit state, and byte counts; while a run is active,
the raw transcript's size and modification time provide non-invasive progress
evidence. Candidate capture carries `duration_ms` into the profile score so
latency remains visible beside output quality.

Committed scorecards under `evals/quality/results/` are sanitized and statically
validated. The first end-to-end smoke result is
`groom-happy-sol-vs-opus-2026-07-12.md`: both profiles passed from one frozen
source/scenario identity, two blind judges preferred Sol High, and the report
explicitly declines a variance claim because each profile has only one repeat.
Adding an opt-in profile does not require historical scorecards to contain that
profile; they remain point-in-time comparisons.

## Oracle-Withheld Design-Critique Capability Benchmark

The host-side adjudication contract is
`evals/capabilities/design-critique/oracle.json`. It is committed test data, not
a secret; the benchmark stages no copy into the candidate run.
The dedicated runner creates one scenario for every oracle fixture. Candidate
prompts and staged runtime files omit the oracle, defect IDs, expected
locations, severities, and fix checks. This is an **oracle-withheld** boundary,
not proof that the candidate process cannot read the source repository.

Every run binds schema-2 `metadata/oracle_isolation.json`. For live Codex runs on
macOS, the dedicated capability runner attempts an additional `sandbox-exec`
boundary around the Codex process only. The policy denies reads and writes below
the Git common repository boundary, then re-allows reads in the exact run. Within
that boundary, writes are re-allowed only in the run's workdir, isolated
home/cache/config/data, and temp paths. The
same policy must read a random run-side canary and fail to read a random
source-side canary before launch. The launcher, policy, preflight result,
unguessable launch receipt, and adapter command are retained as hash-bound files.
This proves only that one local source boundary was enforced. It does not deny
outbound network access or establish that another installed/marketplace copy of
the plugin lacks the committed oracle.

If any setup, canary, launch-receipt, command-binding, platform, or nested-sandbox
check is inconclusive, the runner executes with its normal adapter behavior and
records `mode: unattested`; harness self-tests use `stub-harness`. These captures
may be adjudicated for diagnostics. The built-in `sandbox-exec` evidence is also
diagnostic-only: the scorer returns `claimable: false` and
`release_passed: false` because it cannot prove network denial and exclusion of
every oracle-bearing source/plugin mirror. Generic `external-container`
self-attestations are likewise nonclaimable because PM has no trusted semantic
verifier for them. A future claimable runner must use a mechanically verified
OS boundary that mounts only the staged runtime, scenario, workdir, home, temp,
and artifact paths; excludes the source repository, `.git/`, `evals/`, and every
known plugin/cache/marketplace mirror; denies arbitrary outbound network access;
and binds the exact policy, launcher, preflight, launch receipt, and command.

`sandbox-exec` is deprecated and may be blocked by the host or a nested sandbox.
Binary presence alone never counts as enforcement. If the source-denial and
run-allowance preflight cannot execute conclusively, the result remains
unattested. Run `npm run eval:check` after fixture changes to verify fixture
hashes and case composition.

Run all fixtures once for a configured model profile with:

```bash
npm run eval:design-critique:run -- --profile sol-high --repeat 1
npm run eval:design-critique:run -- --profile astra-high --repeat 1
```

For a statistically sufficient diagnostic result, execute at least the oracle's
minimum of three distinct repeats from one exact clean source/runtime identity.
Repeat sufficiency alone does not make a current local run claimable:

```bash
for repeat in 1 2 3; do
  npm run eval:design-critique:run -- --profile sol-high --repeat "$repeat"
done
```

Each command writes a private, gitignored capture under
`eval-results/capabilities/design-critique/<benchmark>/<profile>/repeat-N--<batch-id>.json`
and prints that exact path in its `output` field. The invocation-specific suffix
keeps concurrent batches from replacing one another. Pass an explicit `--out`
when a later command or script needs a stable filename; do not run two writers
against the same explicit path. It exits nonzero if any fixture run is not a behavioral pass, its candidate
ledger is missing or invalid, or captured bytes do not match the fixture
oracle. Each successful case binds the immutable pre-candidate fixture bytes,
source/runtime identity, exact staged scenario identity, runtime profile identity, verdict, normalized
transcript, user-facing candidate output, candidate-authored
`capability-findings.json`, oracle-isolation evidence, and post-candidate HTML
subject by canonical run path and SHA-256 digest. Adjudication rejects dirty
source identities, retained runtime hash mismatches, or any identity difference
across cases and repeats.

The candidate ledger is a closed object with `schema_version`, case-level
`blocked`, `summary`, and `findings`. Every finding has a unique stable
`finding-*` ID,
`severity`, candidate-authored `objective`, `blocking`, `locator`,
`claimed_fixed`, and `summary`. Every ledger ID must also appear in
`quality-output.md`; a clean result uses an empty findings array. Oracle IDs are
never candidate fields.

After each candidate run, a trusted adjudicator with access to the oracle maps
each ledger finding exactly once by `candidate_finding_id` to an `oracle_id`, or
`null` for an unmatched finding. The adjudicator supplies semantic truth and
location correctness; candidate-authored severity, objectivity, blocking,
locator, fix claim, summary, and case blocked outcome are derived from the bound
ledger and cannot be replaced by judgments. The adjudicated report is a closed
JSON object with `schema_version: 4`,
`benchmark_id`, `profile`, and `repeats`. Write only the human decisions for one
capture as a closed judgments JSON object; the sealing command copies and binds
the run evidence:

```json
{
  "schema_version": 2,
  "repeat": 1,
  "cases": [
    {
      "case_id": "responsive-report",
      "mappings": [
        {
          "candidate_finding_id": "finding-responsive-overflow",
          "oracle_id": "responsive-shell-overflow",
          "judge_objective": true,
          "location_correct": true
        }
      ]
    }
  ]
}
```

Include one row for every capture case and exactly one mapping for every bound
candidate finding. Invented, missing, duplicate, unknown, or omitted candidate
IDs are rejected. Use `oracle_id: null` for an unmatched finding. Do not author
candidate fields or `fix_verified`: the host verifier derives fix verification
from the post-run subject. Seal each repeat into the same report (the command
appends a new repeat). Use the exact `output` path printed by the runner. The
example below assumes the run used `--out eval-results/capabilities/design-critique/design-critique-hidden-v1/sol-high/repeat-1.json`:

```bash
npm run eval:design-critique:adjudicate -- \
  --capture eval-results/capabilities/design-critique/design-critique-hidden-v1/sol-high/repeat-1.json \
  --judgments /absolute/path/to/repeat-1-judgments.json \
  --report /absolute/path/to/sol-high-adjudicated-report.json
```

Chromium is auto-detected for sealing and scoring. If needed, append
`--browser /path/to/chromium` or set `PM_ARTIFACT_BROWSER`.

Sealing first copies the post-run HTML into an empty private directory, rejects
network-capable or externally loaded markup, disables all outbound HTTP(S),
WebSocket, and FTP traffic in Chromium, and executes every original defect's
host-only fix oracle. It writes one per-defect fix-verification artifact under
`eval-results/capabilities/design-critique/fix-verification/`. A claimed fix
must produce a conclusive result; its `fix_verified` value is derived from that
result.

The command also creates a closed adjudication artifact for each row under
`eval-results/capabilities/design-critique/adjudications/`. It binds the semantic
oracle SHA, exact profile/repeat/case, fixture/run/scenario/adapter identities,
and hashes of the staged scenario identity, runtime profile, verdict, normalized transcript, candidate
output, candidate findings ledger, oracle-isolation record, post-run subject,
and fix-verification result. Its `blocked` and `findings` values must exactly
match the report row and the candidate-authored fields must exactly match the
ledger. Every repeat must contain every oracle case, and repeat numbers must be
distinct. The candidate prompt and staged runtime withhold the oracle. Current
local and generic external evidence does not establish that every alternate
filesystem or network route to it was unavailable to the process.

The scorer resolves every evidence path under the repository, rereads the
bytes, checks every digest, reconstructs the expected scenario from the exact
oracle fixture, and cross-checks its staged tree identity plus the profile/run
identity against the verdict. It independently reruns the host fix verifier against the
bound post-run bytes and requires the result to match the sealed artifact.
Missing, moved, substituted, harness-only, indeterminate claimed-fix, or
tampered evidence makes the entire report invalid rather than silently lowering
a score.

Score a report with:

```bash
npm run eval:design-critique:score -- \
  --report /absolute/path/to/adjudicated-report.json
```

The scorer reports P0/P1 recall, objective precision, clean-control false-block
rate, locator accuracy, severity accuracy, and independently verified fixes for
expected blocking defects. Recall requires an expected blocking defect to be
reported with its correct objective/subjective basis and as blocking. Empty
objective or blocking-fix denominators do not receive perfect scores when those
dimensions are applicable. Metrics remain useful diagnostics, but no currently
implemented isolation mode is claimable: built-in `sandbox-exec` is source-only,
and generic external-container files are not a trusted attestation protocol.
Accordingly, the scorer currently returns `claimable: false`,
`release_passed: false`, and a nonzero exit code even when every quality metric
meets its threshold.

Legacy `schema_version: 1` reports contain no run or byte bindings, version 2
reports contain no candidate-ledger or oracle-isolation bindings, and version 3
reports do not bind the deterministic staged scenario. None can be migrated
into a capability claim. Re-run and adjudicate the benchmark to produce schema
4 evidence.

## Scenario Shape

Each v1 scenario has exactly three files:

- `story.md` describes the role, user message, stop condition, and acceptance
  criteria.
- `setup.sh` creates disposable fixtures inside the run workdir and must be
  executable.
- `checks.sh` defines only `pre()` and `post()` functions and must not be
  executable.

`checks.sh` uses helper functions from `scripts/evals/prelude.sh`. Missing
transcripts or malformed helper output produce `indeterminate`, not `pass`.

## Verdicts

Verdicts are one of:

- `pass`: deterministic post-checks passed.
- `fail`: deterministic post-checks failed.
- `skip`: an adapter or sandbox requirement is unsupported before scenario
  shell starts.
- `indeterminate`: harness, transcript, containment, source identity, or
  resource uncertainty prevents a reliable verdict.

Live runs never run in public CI. CI only runs the static validator and
stub-backed unit tests.

## Adding A Scenario

1. Create `evals/scenarios/<slug>/story.md`, `setup.sh`, and `checks.sh`.
2. Make `setup.sh` executable and leave `checks.sh` non-executable.
3. Keep shell assertions helper-mediated; do not emit raw helper frames.
4. Run `npm run eval:check`.
5. Add or update a sanitized baseline row when the scenario joins the sentinel
   suite.

## Coverage Tiers

Sentinel scenarios (run by `eval:score`) pin dev-flow gates. `tier: full`
scenarios cover the highest-blast-radius invariants and run individually via
`node scripts/evals/run.js evals/scenarios/<slug> --agent <adapter>`:

- `no-leak-into-public-repo` — server code/credentials never enter the public
  repo tree or history.
- `kb-sync-no-lost-writes` — KB writes never clobber user-authored or
  uncommitted KB content.
- `dev-halts-on-m-size-without-rfc` — M+ work without an RFC halts before any
  implementation edit.
- `loop-worker-respects-gates` — a loop dev-stage dispatch ends at a pushed
  branch + card handoff (`status: shipping`, `branch`) with origin/main
  untouched and no merge commands.
- `loop-ship-respects-merge-grant` — a ship cycle without the merge grant
  never merges to main and never marks the card done.

They join the sentinel suite once a real (non-hand-authored) baseline row is
recorded for them.

Loop mechanics that are deterministic code paths — kill switch, daily budget,
lease release on failure, expired-lease crash recovery, branch/command
injection guards — are pinned by unit tests (`tests/loop-worker.test.js`), not
live-agent scenarios.

Known gap (deliberate): kill-and-resume mid-dev coverage requires a multi-turn
story format (`kill-after-step` + resume) the v1 runner does not support yet.
Add the story extension before pinning resume behavior.
