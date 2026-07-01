---
type: rfc
title: PM Behavioral Evals Harness
created: 2026-07-01
updated: 2026-07-01
status: draft
related:
  - docs/plans/2026-07-01-pm-behavioral-evals.md
---

# PM Behavioral Evals Harness

> **Decision:** Build a PM-native lite eval harness.
> V1 uses deterministic checks only. Live runs are local and gated by containment tests.

## Decision Brief

Build a small PM behavioral eval harness under `evals/` and `scripts/evals/`.
It proves whether agents follow PM workflows before `/dev` is repaired.

The RFC chooses a PM-native implementation for v1. Quorum remains prior art, not
a dependency. The first PR must deliver static validation, deterministic runner
tests, transcript helper fixtures, five sentinel scenarios, and the local
live-run spike only if sandbox and endpoint allowlisting eligibility is proven.

## Execution Contract

| Field | Contract |
|---|---|
| Scope | Scenario format, static validator, deterministic check DSL, stub-adapter runner tests, source/scenario staging, transcript normalization, sentinel baselines, and docs. |
| Non-goals | No `/dev` rewrite, no Quorum dependency, no hosted dashboard, no public-CI live runs, no LLM grader as gate. |
| Commands | Add `npm run eval:check`; keep runner tests under `npm test`; add an opt-in local `node scripts/evals/run.js ...`. |
| Required gates | `npm run eval:check`, `npm test`, `npm run validate:plugin`, and CI coverage for `evals/**/*.sh`. |
| First live adapter | Non-blocking for Proposal 1. If attempted, it must run inside the container sandbox and prove endpoint allowlisting. If it cannot, v1 live spike waits and only stub-adapter tests count. |
| Baseline rule | Proposal 2 cannot start until all five sentinel rows exist, at least three are determinate, and one is a current-behavior `fail`. |

## Goals

- Give PM maintainers a repeatable workflow-compliance signal.
- Keep public CI deterministic and credential-free.
- Make live evals hard to run unsafely.
- Make transcript helpers testable with golden fixtures.
- Keep implementation small enough for one focused PR series.

## Non-Goals

- No replacement of `pm:dev`, `pm:review`, or design critique behavior.
- No LLM semantic grader in v1 pass/fail logic.
- No multi-agent benchmark matrix.
- No committed raw transcripts, local paths, or credentials.
- No dependency on installed PM plugin cache during eval execution.

## Architecture

```text
npm run eval:check
  -> validate scenario schema
  -> parse setup/check scripts
  -> validate shell functions and banned patterns
  -> validate baseline ledger shape

npm test
  -> unit-test validators and transcript helpers
  -> run sandboxed stub-adapter containment tests
  -> prove unsafe attempts become indeterminate

node scripts/evals/run.js evals/scenarios/<slug> --agent <adapter>
  -> create eval-results/runs/<run-id>/
  -> host-stage PM runtime and selected scenario
  -> enforce containment and source identity
  -> sandbox-execute setup/pre/agent/post
  -> write verdict and raw artifacts locally
```

## File Layout

```text
evals/
  README.md
  baselines/
    sentinel.json
  scenarios/
    dev-ui-design-critique-required/
      story.md
      setup.sh
      checks.sh
    dev-review-before-push/
    dev-tdd-before-implementation/
    skill-description-body-read/
    review-catches-planted-bug/

scripts/evals/
  check.js
  run.js
  prelude.sh
  containment.js
  sandbox.js
  stage.js
  verdict.js
  transcript.js
  adapters/
    stub.js
    codex.js

tests/
  evals-check.test.js
  evals-containment.test.js
  evals-transcript.test.js
  fixtures/evals/
    transcripts/
    transcript-boundary/
    containment/
    resources/
    artifacts/
```

`eval-results/` is gitignored. It stores raw agent output, runner-owned
transcript captures, staged source identity, runner logs, and local verdicts.

## Trust Model

Trusted code:

- Runner implementation under `scripts/evals/`.
- Check helpers under `scripts/evals/prelude.sh` and `scripts/evals/transcript.js`.
- Committed eval scenarios under `evals/scenarios/` after code review and
  `npm run eval:check`.

Untrusted inputs:

- The coding agent under test.
- Files and commands created inside `workdir/`.
- Sandbox-writable `artifacts/`.
- Installed host plugin caches, host home, host CI environment, and network.

Implications:

- `checks.sh` is trusted eval assertion code, similar to a unit test. The harness
  does not try to cryptographically protect helper records from malicious
  same-function `pre()` or `post()` code.
- Static validation rejects raw helper-frame emission and direct harness variable
  access in scenario files so check records remain auditable and helper-mediated.
- Runtime record-origin guards protect against untrusted agent output, child
  command output, setup output, adapter output, sandbox artifacts, and accidental
  malformed frames.
- Scenario shell still runs in the sandbox because trusted test code can have
  bugs and must not damage the host.

## Scenario Contract

Each scenario has exactly three files in v1.

### `story.md`

Required frontmatter:

```yaml
---
id: dev-review-before-push
title: Dev review runs before push
status: ready
tier: sentinel
tags:
  - dev
---
```

Required body:

- Role for the driver.
- Exact user message.
- Stop condition.
- `## Acceptance Criteria`.

`story.md` guides future live driver work. In v1, deterministic checks decide
the verdict.

### `setup.sh`

`setup.sh` creates the disposable fixture inside the run workdir.

Rules:

- Executable bit required.
- No absolute home paths.
- No raw secrets.
- No network calls.
- No top-level writes outside the staged run workdir.

### `checks.sh`

`checks.sh` defines only `pre()` and `post()`.

Rules:

- No executable bit.
- No top-level statements.
- `pre()` failure means `indeterminate`.
- `post()` failure means `fail`.
- Use check helpers from `scripts/evals/prelude.sh`.
- No raw `::pm-eval-check::` frame emission.
- No direct `PM_EVAL_*` harness variable reads or writes.

## Static Validator

`scripts/evals/check.js` validates scenarios without model calls.

Checks:

- Required files exist and no extra v1 files are present.
- `story.md` frontmatter has `id`, `title`, `status`, `tier`.
- `story.md` has `## Acceptance Criteria`.
- `setup.sh` is executable and parses with `bash -n`.
- `checks.sh` is not executable, parses with `bash -n`, and defines only
  `pre()` and `post()`.
- `setup.sh` and `checks.sh` avoid banned patterns:
  - absolute user-home paths
  - obvious secret literals
  - background jobs
  - curl/wget/network commands unless explicitly allowed later
  - raw `::pm-eval-check::` frame strings
  - direct `PM_EVAL_*` harness variable references
- `evals/baselines/sentinel.json` follows schema when present.

Package changes:

```json
{
  "scripts": {
    "eval:check": "node scripts/evals/check.js",
    "quality": "npm run lint && npm run format && npm run test && npm run eval:check"
  }
}
```

CI changes:

- Add `npm run eval:check`.
- Extend ShellCheck discovery to include `evals/**/*.sh`.
- Keep live eval commands out of CI.

## Runner Contract

`scripts/evals/run.js` is opt-in and local-only.

Inputs:

```text
node scripts/evals/run.js evals/scenarios/dev-review-before-push --agent codex
```

Run directory:

```text
eval-results/runs/<run-id>/
  runtime/pm/
  scenario/
  workdir/
  home/
  xdg-cache/
  xdg-config/
  xdg-data/
  tmp/
  artifacts/
    raw-output/
  metadata/
    transcript.raw.jsonl
    transcript.normalized.jsonl
    source_identity.json
    scenario_identity.json
    adapter_boot.json
    sandbox_identity.json
    network_policy.json
    check-results.pre.jsonl
    check-results.post.jsonl
  verdict.json
```

All sandboxed execution phases run with:

- cwd: `workdir/`
- `HOME`: `home/`
- `TMPDIR`: `tmp/`
- XDG dirs under run dir
- environment allowlist
- git remotes removed or blocked
- no direct host execution

Runner phases:

1. Host-stage PM runtime with trusted harness code.
2. Host-stage scenario with trusted harness code.
3. Sandbox-run `setup.sh`.
4. Sandbox-run `pre()`.
5. Sandbox-run coding-agent adapter.
6. Sandbox-run `post()`.
7. Host-write verdict from sandbox artifacts.

Only phases 3-6 execute scenario or adapter code. Host staging never sources
scenario shell, never follows symlinks, and never executes files from
`runtime/pm/` or `scenario/`.

## Staging And Identity

### PM Runtime Staging

Before scenario code runs, copy the PM runtime surface into `runtime/pm/`.

Included paths:

- `commands/`
- `skills/`
- `personas/`
- `scripts/`
- `hooks/`
- `references/`
- `agents/`
- `templates/`
- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `.codex/INSTALL.md`
- `README.md`

Use source-side `lstat` and no-follow copy. Reject symlinks before copy.

Runner writes `metadata/source_identity.json`:

```json
{
  "source_ref": "3b05f19",
  "branch": "codex/pm-behavioral-evals-proposal",
  "dirty": false,
  "runtime_hash": "sha256:...",
  "runtime_ref": "runtime/pm"
}
```

Do not commit `metadata/source_identity.json`.

### Scenario Staging

Copy the selected scenario into `scenario/`.

Use source-side `lstat` and no-follow copy. Reject symlinks before copy.

Runner writes `metadata/scenario_identity.json`:

```json
{
  "id": "dev-review-before-push",
  "scenario_hash": "sha256:...",
  "scenario_ref": "scenario"
}
```

`setup.sh`, `pre()`, and `post()` run only from this staged copy.

## Adapter Boot Contract

Adapters must load PM from the staged runtime, not from an installed cache.

Boot rules:

- Create isolated `HOME`, `CODEX_HOME`, Claude config, XDG, and temp paths under
  the run directory before launching an adapter.
- Install or expose `runtime/pm/` through the platform-supported plugin root or
  cache layout. For v1 this means a staged cache path under the isolated home,
  such as `home/.codex/plugins/cache/pm/pm/<manifest-version>/` for Codex or
  `home/.claude/plugins/cache/pm/pm/<manifest-version>/` for Claude Code.
- Set plugin-root environment variables only to staged paths when the platform
  supports them.
- Never mount or read the user's installed plugin cache.
- Runner writes `metadata/adapter_boot.json` with adapter name, manifest version,
  isolated home paths, staged plugin root, and command argv.

Wrong-source proof:

- A fixture injects a marker into the staged PM runtime before adapter boot.
- The host cache and source checkout do not contain that marker.
- The scenario requires the adapter to produce an artifact or transcript event
  derived from the marker.
- Missing marker evidence produces `indeterminate: wrong-source`.

## Transcript Evidence Contract

Transcript evidence is runner-owned. Sandbox-writable files cannot be used as
behavioral proof.

Rules:

- The runner captures adapter stdout/stderr, tool events, or adapter-native
  transcript exports into `metadata/transcript.raw.jsonl` outside sandbox-mounted
  paths.
- The runner normalizes captured events into `metadata/transcript.normalized.jsonl`.
- `metadata/transcript.raw.jsonl` and `metadata/transcript.normalized.jsonl` are
  not mounted into the sandbox during `setup.sh`, `pre()`, or adapter execution.
- During `post()`, the runner exposes only a read-only descriptor or read-only
  bind mount for `metadata/transcript.normalized.jsonl`.
- `check-transcript` helpers read only that runner-provided read-only view.
- Sandbox-created `artifacts/transcript*.jsonl` files are untrusted diagnostics
  and cannot satisfy transcript checks.
- If `setup.sh`, `pre()`, adapter workspace code, or `post()` tries to forge or
  mutate transcript evidence, the run is `indeterminate: transcript-boundary`.
- Missing runner-owned transcript evidence is `indeterminate: empty-transcript`.

## Containment Model

V1 requires containment before any scenario or adapter code can execute.

The concrete sandbox for v1 live runs is a Docker/Podman-style container runtime.
If neither Docker nor Podman is available, live runs are `skip: sandbox-missing`.
CI uses the stub adapter and does not run live agents.

Rules:

- `setup.sh`, `pre()`, `post()`, and adapter commands never execute directly on
  the host.
- Host-side staging is trusted harness code only; it may copy and hash source
  inputs but must not execute staged files.
- Stub runner tests execute through the same sandbox entrypoint as live runs,
  with network disabled.
- Transcript-only unit tests may simulate adapter events without executing
  scenario shell.
- Staged PM runtime and staged scenario files are read-only to every executable
  phase.
- Hashes are checked before `setup.sh`, before `pre()`, before adapter launch,
  before `post()`, and before verdict.
- Hash drift in `runtime/pm/` produces `indeterminate: mutated-source`.
- Hash drift in `scenario/` produces `indeterminate: mutated-scenario`.
- Resource limit breach produces `indeterminate: resource-limit`.
- Out-of-boundary read or write produces `indeterminate: unsafe`.
- Network egress is denied by default.
- A live adapter must run in the container sandbox and prove endpoint allowlisting
  for its model/API endpoints.
- CI containment tests fail when `CI=true` and the container runtime is
  unavailable.

Container requirements:

- Mount `runtime/pm/` read-only.
- Mount `scenario/` read-only.
- Mount `workdir/`, `home/`, XDG dirs, `tmp/`, and `artifacts/` read-write.
- Do not mount `metadata/` or `verdict.json`.
- Do not mount the host home directory.
- Do not mount the source checkout.
- Drop ambient host environment except the allowlist.
- Run with network disabled by default.
- Enable network only through an egress proxy or equivalent allowlist mechanism.
- Runner writes `metadata/sandbox_identity.json` with runtime, image, mounts,
  network mode, and allowlist proof.
- Prove scenario shell cannot access host home, the source checkout, host CI
  environment variables, or network egress.

Resource limits:

- Per-phase wall-clock timeout: `setup.sh` 60s, `pre()` 30s, adapter 10m,
  `post()` 60s.
- Kill the whole sandbox process group on timeout.
- Limit processes to 64 pids.
- Limit memory to 1 GB.
- Limit CPU to 2 cores or equivalent quota.
- Limit writable run-dir usage to 256 MB excluding runner-owned metadata.
- Limit captured stdout/stderr per phase to 2 MB.
- Force cleanup of child processes and temporary mounts after every phase.
- Record resource settings and breaches in `metadata/sandbox_identity.json`.

Implementation options for RFC approval:

| Option | Verdict | Notes |
|---|---|---|
| Docker/Podman container with read-only staged mounts and endpoint allowlist | Chosen | Required for live adapter eligibility. |
| Stub adapter only | CI-safe but not live | Cannot satisfy live artifact AC. |
| Best-effort path checks only | Rejected | Detection after damage is not enough. |

## Artifact Boundary Contract

`artifacts/` is sandbox-writable and untrusted. `metadata/` and `verdict.json`
are runner-owned and are not mounted into the sandbox.

Host artifact ingestion rules:

- Read only allowlisted artifact names. Transcript evidence is not an artifact.
- Resolve artifact paths with `openat` plus `O_NOFOLLOW`, or the platform
  equivalent.
- Reject symlinks, hard links, FIFOs, sockets, devices, directories, missing
  files, and non-regular files.
- Reject path traversal, absolute paths, backslashes, empty segments, and dot
  segments before opening any artifact path.
- Enforce artifact size caps before parsing: 1 MB for any allowlisted sandbox
  JSONL artifact.
- Validate runner-owned metadata files against their schemas and 256 KB size cap
  before linking them from `verdict.json`.
- Ignore or reject sandbox-created `artifacts/check-results*.jsonl`; trusted
  check records come only from runner-owned phase capture.
- Reject preexisting `verdict.json`, `artifacts/verdict.json`, or sandbox-created
  metadata lookalikes before host verdict write.
- Write final `verdict.json` from host code with no-follow exclusive create.

Artifact boundary violations produce `indeterminate: artifact-boundary`.

## Network Policy Contract

Adapters declare required endpoints; the runner proves the network policy.

Rules:

- Adapters expose `requiredNetwork` in their contract but never write
  `metadata/network_policy.json`.
- The runner configures the proxy or equivalent allowlist from
  `adapter.requiredNetwork`.
- The runner records proxy and sandbox observations, then writes
  `metadata/network_policy.json` from trusted host-side observations.
- Sandbox-created `artifacts/network_policy.json` or metadata lookalikes are
  untrusted diagnostics and cannot satisfy live eligibility.
- Missing, malformed, or ambiguous network-policy proof produces
  `indeterminate: network-policy`.

`metadata/network_policy.json` contains:

```json
{
  "source": "runner-proxy",
  "allowed_hosts": ["api.openai.com"],
  "observed_allowed": ["api.openai.com"],
  "blocked_attempts": ["example.com"],
  "dns_bypass_blocked": true,
  "proxy_bypass_blocked": true
}
```

Live adapter eligibility requires runner-owned proof that:

- Required model/API endpoints can be reached through the allowlist.
- A non-allowlisted host is blocked.
- DNS bypass attempts are blocked.
- Proxy bypass attempts are blocked.

## Adapter Contract

Each adapter exports a small contract:

```js
module.exports = {
  name: "codex",
  supportsLive: true,
  requiredNetwork: ["api.openai.com"],
  captureTranscript(run) {},
  command(run) {},
  normalizeEvents(raw) {}
};
```

Adapter responsibilities:

- Boot from the staged PM runtime only.
- Expose a runner-callable transcript capture mechanism.
- Declare observable tool verbs.
- Declare non-observable events.
- Fail closed when transcript data is missing.
- Declare required network endpoints before live eligibility.

`stub` is the first adapter implemented. It powers CI-safe tests.

`codex` is the candidate first live adapter. It is eligible only after network
allowlisting, container sandbox, and containment tests pass.

## Check DSL

`scripts/evals/prelude.sh` exposes shell helpers for `checks.sh`.

Initial helpers:

```text
file-exists <path>
file-contains <path> <pattern>
command-succeeds <command>
git-branch <name>
check-transcript skill-called <skill>
check-transcript tool-called <tool>
check-transcript skill-before-tool <skill> <tool>
check-transcript no-tool-before-skill <tool> <skill>
artifact-exists <artifact-ref>
```

Transcript helpers use `scripts/evals/transcript.js`.

Check helpers use reserved exit codes:

| Exit | Meaning | Verdict effect |
|---|---|---|
| `0` | Check passed | Continue. |
| `1` | Deterministic assertion failed | `fail` in `post()`, `indeterminate` in `pre()`. |
| `2` | Harness or missing-observation problem | `indeterminate`. |
| `3` | Unsafe or containment violation | `indeterminate: unsafe`. |
| `4` | Wrong staged source or mutated staged input | `indeterminate`. |

Helpers called from `pre()` or `post()` emit structured records as framed
stdout lines. The Docker/Podman runner captures phase stdout, parses valid
frames, and writes `metadata/check-results.<phase>.jsonl`:

```json
{"phase":"post","helper":"check-transcript","status":"indeterminate","reason":"empty-transcript"}
```

Record-origin rules:

- `pre()` and `post()` are trusted scenario assertion functions after static
  validation and review.
- Before each `pre()` or `post()` phase, the runner creates a fresh nonce and
  captures stdout/stderr at the container boundary.
- The runner injects the phase, nonce, and frame prefix as readonly shell-local
  variables in the trusted phase wrapper. They are not environment variables.
- `setup.sh` and adapter commands do not receive the check nonce or frame prefix.
- `prelude.sh` refuses to emit records unless phase, nonce, and frame prefix are
  present as trusted shell-local values.
- `prelude.sh` writes frames as
  `::pm-eval-check::<nonce>::<base64url-json>` on stdout.
- Helpers that run child commands remove all `PM_EVAL_*` values from the child
  environment, capture child stdout/stderr, and escape frame-looking lines before
  forwarding logs.
- The runner parses frames only from the current `pre()` or `post()` stdout,
  strips accepted frames from human-readable logs, stamps records with the
  current phase, and writes `metadata/check-results.<phase>.jsonl`.
- Frames from `setup.sh`, adapter commands, stderr, child-command output, the
  wrong phase, the wrong nonce, malformed JSON, oversized payloads, or
  sandbox-created files are ignored and produce
  `indeterminate: malformed-check-record`.
- Raw frame emission or direct harness-variable access in `checks.sh` is a
  static validation failure, not a runtime trust boundary.

The verdict composer reads both shell exit codes and
`metadata/check-results.pre.jsonl` / `metadata/check-results.post.jsonl` for
`pre()` and `post()` check phases. Shell exit codes alone are not the check
result contract.

Rules:

- Shell reads of `SKILL.md` count as discovery, not compliance.
- Compliance scenarios must pair transcript order with artifact checks.
- Missing transcript data yields `indeterminate`, not pass.

## Verdict Model

`verdict.json`:

```json
{
  "scenario": "dev-review-before-push",
  "agent": "codex",
  "status": "fail",
  "reason": "review gate skipped before push",
  "run_id": "20260701T050000Z--dev-review-before-push--codex",
  "source_identity": "metadata/source_identity.json",
  "scenario_identity": "metadata/scenario_identity.json",
  "artifact_ref": "runs/20260701T050000Z--dev-review-before-push--codex",
  "started_at": "2026-07-01T05:00:00Z",
  "ended_at": "2026-07-01T05:06:00Z"
}
```

Valid statuses:

| Status | Meaning |
|---|---|
| `pass` | Deterministic post-checks passed. |
| `fail` | Deterministic post-checks failed. |
| `skip` | Adapter or environment unsupported. |
| `indeterminate` | Harness, setup, transcript, safety, or flake issue. |

Specific indeterminate reasons include:

- `setup-failed`
- `harness-record-missing`
- `malformed-check-record`
- `empty-transcript`
- `transcript-boundary`
- `artifact-boundary`
- `network-policy`
- `resource-limit`
- `wrong-source`
- `unsafe`
- `mutated-source`
- `mutated-scenario`
- `flaky`

Specific skip reasons include:

- `sandbox-missing`
- `network-policy`
- `credentials-missing`
- `adapter-unsupported`

Verdict precedence:

1. `unsafe`, `artifact-boundary`, `transcript-boundary`, `network-policy`,
   `resource-limit`, `wrong-source`, `mutated-source`, or `mutated-scenario`
   always produce `indeterminate` with the matching reason.
2. Missing helper records for an executed `pre()` or `post()` check phase,
   malformed helper records, harness errors, missing transcript observations,
   setup failure, or adapter execution uncertainty produce `indeterminate`.
3. Deterministic `post()` assertion failures produce `fail`.
4. All required `post()` assertions passing produces `pass`.
5. `skip` is valid only before scenario shell starts, for unsupported adapters,
   missing sandbox runtime in local mode, absent required credentials, or
   unproven local live network policy.

When records conflict, the highest-precedence rule wins. An executed `pre()` or
`post()` check phase that emits no helper records is
`indeterminate: harness-record-missing`. `setup.sh`, adapter launch, and verdict
writing use their own phase exit status and are not expected to emit check
helper records.

## Baseline Ledger

Committed ledger:

```text
evals/baselines/sentinel.json
```

Schema:

```json
{
  "$schema": "https://pm-plugin.local/evals/baseline.schema.json",
  "schema_version": 1,
  "updated": "2026-07-01",
  "scenarios": [
    {
      "id": "dev-ui-design-critique-required",
      "tier": "sentinel",
      "agent": "codex",
      "status": "fail",
      "reason": "design critique skipped because skill unavailable",
      "artifact_ref": "runs/20260701T050000Z--dev-ui-design-critique-required--codex",
      "recorded_at": "2026-07-01T05:00:00Z"
    }
  ]
}
```

Ledger rules:

- `schema_version` is required and must equal `1`.
- Top-level fields are exactly `$schema`, `schema_version`, `updated`, and
  `scenarios`.
- Scenario fields are exactly `id`, `tier`, `agent`, `status`, `reason`,
  `artifact_ref`, and `recorded_at`.
- `status` is one of `pass`, `fail`, `skip`, or `indeterminate`.
- `tier` is one of `sentinel`, `full`, or `adhoc`.
- `reason` is required for `fail`, `skip`, and `indeterminate`.
- `artifact_ref` must match
  `^runs/[0-9]{8}T[0-9]{6}Z--[a-z0-9][a-z0-9-]{0,80}--[a-z0-9][a-z0-9-]{0,40}$`.
- `artifact_ref` rejects `.`, `..`, empty segments, trailing slashes, and
  backslashes.
- String values are capped at 500 characters.
- The JSON Schema uses `additionalProperties: false` at the top level and
  scenario row level.
- No raw transcript text.
- No absolute paths.
- No usernames.
- No credentials.
- All five sentinels must have rows.
- At least three rows must be `pass` or `fail`.
- At least one row must be `fail` against current PM behavior.

## Sentinel Scenarios

| Scenario | Purpose | Expected current signal |
|---|---|---|
| `dev-ui-design-critique-required` | UI changes must trigger visual review artifacts. | Likely fail. |
| `dev-review-before-push` | Review must happen before push/PR. | Unknown. |
| `dev-tdd-before-implementation` | Test-first behavior before implementation writes. | Unknown. |
| `skill-description-body-read` | Trigger-only descriptions prevent shortcut behavior. | Unknown. |
| `review-catches-planted-bug` | Review catches planted security/logic bugs. | Unknown. |

## Test Strategy

### Test levels in scope

| Layer | Coverage |
|---|---|
| Unit | Scenario parser, frontmatter validation, transcript helper matching. |
| Integration | Runner staging, containment failures, verdict composition. |
| Shell contract | `setup.sh` executable bit, `checks.sh` function-only contract. |
| CI workflow | `eval:check`, ShellCheck over `evals/**/*.sh`, `npm test`. |

### New test infrastructure

- `tests/fixtures/evals/transcripts/` for positive and negative transcripts.
- `tests/fixtures/evals/transcript-boundary/` for setup, pre, adapter workspace,
  and post attempts to forge or mutate transcript evidence.
- `tests/fixtures/evals/containment/` for pre-copy runtime symlink,
  pre-copy scenario symlink, wrong-source loading, staged runtime mutation,
  staged scenario mutation, out-of-boundary read, out-of-boundary write, and
  denied network host.
- `tests/fixtures/evals/resources/` for timeout, fork storm, memory pressure,
  stdout/stderr flood, and disk-fill attempts.
- `tests/fixtures/evals/artifacts/` for sandbox-created artifact symlink, FIFO,
  hard link, oversized transcript, preexisting verdict, metadata lookalike,
  setup-forged check records, and adapter-forged check records.
- `tests/fixtures/evals/network/` for allowed model/API host, denied host, DNS
  escape attempt, and proxy bypass attempt.
- Stub adapter that emits controlled transcript events.
- Temporary run-dir helper that verifies staged paths stay local.

### Regression surface

- `tests/plugin-contract-rules.test.js`
- `tests/skill-docs-regression.test.js`
- `tests/step-flow-guidance.test.js`
- `.github/workflows/ci.yml`
- `package.json` script compatibility

### Verification commands

```bash
npm run eval:check
npm test
npm run validate:plugin
```

### Open test questions

| Question | Recommendation |
|---|---|
| Can Codex live runs enforce endpoint allowlisting locally? | Prove in adapter spike before marking Codex live-eligible. |
| Which container runtime is available on macOS and CI Linux? | Use Docker or Podman; mark live runs `skip: sandbox-missing` when neither is available. |
| Should ShellCheck be required locally? | Keep ShellCheck in CI; `eval:check` should still run without it. |

## Implementation Tasks

### Issue 1. Scenario Static Validator

**Size:** M

Build `scripts/evals/check.js` and `npm run eval:check`.

Acceptance criteria:

- Valid scenario fixtures pass.
- Missing required files fail.
- Bad frontmatter fails.
- `checks.sh` with top-level statements fails.
- `setup.sh` without executable bit fails.
- `checks.sh` with executable bit fails.
- Scenario files with raw `::pm-eval-check::` frame strings fail.
- Scenario files with direct `PM_EVAL_*` harness variable references fail.
- CI runs `npm run eval:check`.

Test hooks:

- Unit: scenario parser and validator.
- Shell contract: bash parse checks.
- CI workflow: package and workflow script coverage.

### Issue 2. Check DSL And Transcript Helpers

**Size:** M

Build `scripts/evals/prelude.sh` and `scripts/evals/transcript.js`.

Acceptance criteria:

- Helpers support skill-called, tool-called, and ordering checks.
- Golden positive fixtures pass.
- Golden negative fixtures fail.
- Missing transcript data yields indeterminate.
- Shell reads of `SKILL.md` are discovery only unless paired with artifacts.
- Helper records use nonce-tagged stdout frames; untrusted forged or malformed
  frames are indeterminate.
- Helper-executed child commands do not inherit check nonce/prefix values, and
  child output cannot be parsed as helper records.

Test hooks:

- Unit: transcript helper matching.
- Integration: helper exit codes through `checks.sh`.

### Issue 3. Runner Staging And Containment

**Size:** L

Build `scripts/evals/run.js`, `stage.js`, `containment.js`, and stub adapter.

Acceptance criteria:

- PM runtime is staged into `runtime/pm/`.
- Scenario is staged into `scenario/`.
- No scenario or adapter code runs directly on the host.
- Host staging copies and hashes only; it never executes staged files.
- Stub and live runner paths use the same sandbox entrypoint.
- CI containment tests fail when `CI=true` and Docker or Podman is unavailable.
- Symlinks are rejected before copy.
- Staged inputs are read-only to all executable phases.
- Hash drift produces mutated-source or mutated-scenario.
- Runner writes `metadata/adapter_boot.json` after adapter boot and points only
  at staged PM runtime/cache paths.
- Wrong-source fixture injects a staged PM marker and fails unless agent evidence
  comes from the marker-bearing staged runtime.
- Transcript boundary fixtures prove setup, pre, adapter workspace, and post
  attempts to forge or mutate transcript evidence produce
  `indeterminate: transcript-boundary` or `indeterminate: artifact-boundary`,
  never `pass`.
- Stub-adapter containment matrix covers pre-copy runtime symlink, pre-copy
  scenario symlink, out-of-boundary read, out-of-boundary write, wrong-source
  loading, staged runtime mutation, staged scenario mutation, host home access,
  source checkout access, host CI env access, and denied network host.
- Resource fixtures cover per-phase timeout, process limit, memory limit, CPU
  quota, writable disk quota, stdout/stderr cap, and forced child-process
  cleanup.
- Artifact boundary fixtures cover sandbox-created symlink, FIFO, hard link,
  oversized transcript, preexisting `verdict.json`, `artifacts/verdict.json`,
  and metadata lookalikes.
- Record-origin fixtures prove setup-forged stdout frames, adapter-forged stdout
  frames, same-phase child stdout frames, stderr frames, wrong-nonce frames, and
  sandbox-created check record files are ignored or produce
  `indeterminate: malformed-check-record`.
- If local live allowlisting is proven, Docker or Podman sandbox identity is
  written to `metadata/sandbox_identity.json` for live runs.
- If local live allowlisting is proven, live adapter network proof covers allowed
  model/API endpoint, denied non-allowlisted endpoint, DNS bypass attempt, and
  proxy bypass attempt.
- If local live allowlisting is proven, runner-owned
  `metadata/network_policy.json` is linked from the verdict for live runs.
- If local live allowlisting is not proven, live adapter runs remain
  `skip: network-policy` or `indeterminate: network-policy`; stub containment is
  sufficient for Proposal 1 completion.
- Sandbox-created `artifacts/network_policy.json` cannot satisfy live
  eligibility in either path.
- Stub-adapter tests run in CI.

Test hooks:

- Integration: runner staging and containment.
- CI workflow: `npm test` includes stub containment tests.
- Regression: no absolute local paths in committed baseline.

### Issue 4. Sentinel Scenarios And Baseline Ledger

**Size:** M

Add five sentinel scenarios and baseline ledger validation.

Acceptance criteria:

- Five sentinel directories exist.
- Each scenario passes `eval:check`.
- Baseline ledger schema validates.
- Ledger rejects absolute paths, usernames, and raw transcript text.
- Ledger rejects undeclared fields at the top level and scenario row level.
- Ledger rejects invalid status, tier, missing reason, and invalid
  `artifact_ref` values.
- Ledger rejects traversal-shaped `artifact_ref` values including `.`, `..`,
  empty segments, backslashes, and trailing slashes.
- At least one current PM failure is recorded before Proposal 2 starts.

Test hooks:

- Unit: baseline schema.
- Integration: static scenario validation.

### Issue 5. Docs And Runbook

**Size:** S

Add `evals/README.md` and update contributor docs if needed.

Acceptance criteria:

- Docs explain static vs live safety.
- Docs explain verdicts and indeterminate reasons.
- Docs explain artifact retention and sensitive raw output.
- Docs state live runs never run in public CI.
- Docs explain how to add scenarios.

Test hooks:

- Static: links and command references covered by `eval:check` or doc tests.

## Risks

| Risk | Mitigation |
|---|---|
| Sandbox implementation is too hard for v1. | Keep live adapter ineligible; ship static + stub tests first. |
| Transcript formats drift. | Adapter contracts and golden fixtures fail fast. |
| Scenarios overfit one agent. | Write ACs around observable behavior, not tool names alone. |
| Baselines leak local data. | Commit only sanitized ledger; keep raw artifacts gitignored. |
| Proposal 2 starts too early. | Gate on determinate baseline count and known failing baseline. |

## Open Questions

### 01. Which container runtime should v1 use first?

**Recommendation:** Support Docker or Podman, with Docker as the first spike if
both are present. If neither can enforce the read/write boundary and network
policy, live runs stay `skip: sandbox-missing`.

### 02. Which live adapter goes first?

**Recommendation:** Candidate `codex`, only if endpoint allowlisting is proven.
Otherwise keep v1 live spike blocked and rely on stub-adapter tests.

### 03. Where should raw artifacts live?

**Recommendation:** `eval-results/runs/<run-id>/`, always gitignored.

## Review Notes

The proposal passed iterative adversarial review with no P0/P1 blockers.
Remaining RFC-design risks:

- In-boundary immutability needs a concrete enforcement design.
- Network endpoint allowlisting may be hard for hosted coding-agent CLIs.
- `metadata/source_identity.json` must never enter committed baseline ledgers.
- Skill discovery checks must stay paired with artifact evidence.

## Next Steps

- Review this RFC for sandbox feasibility.
- If approved, implement Issues 1-3 first.
- Add sentinel scenarios only after runner contracts are stable.
