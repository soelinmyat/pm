# PM Behavioral Evals

This directory contains committed behavioral scenarios for the PM plugin itself.
The suite answers whether PM workflows are being followed by agents, without
rewriting those workflows in the same change.

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
PM_EVAL_CODEX_MODEL=gpt-5.5 \
PM_EVAL_CODEX_REASONING_EFFORT=xhigh \
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
(macOS keychain OAuth survives HOME isolation; explicit opt-in required).
`PM_EVAL_CLAUDE_MODEL` optionally pins the model; `PM_EVAL_CLAUDE_BIN`
overrides binary resolution.

Skill invocations arrive as typed `Skill` tool events in stream-json, so
`skill-called`/`no-tool-before-skill` checks are first-class on this adapter.
Tool ordering checks use the adapter-neutral taxonomy (`run-command`,
`edit-file`, `write-file`, `read-file`) with optional command matching, e.g.
`run-command~git push`.

**Security posture of live runs (both adapters):** the agent executes with
permission checks bypassed / full-auto on your host. Isolation is HOME/XDG
redirection only — no container, no seccomp, no network allowlist. Treat a live
eval as untrusted-code execution: prefer a disposable machine or container, and
never run with credentials in scope beyond the eval's own auth.

Live adapters enable PM analytics inside the staged workdir
(`.claude/pm.local.md`), so plugin telemetry step spans are captured with run
artifacts and can serve as rewrite-stable check evidence.

Score an existing sanitized ledger:

```bash
npm run eval:score -- --results evals/results/current.json
npm run eval:score -- --results evals/results/current.json --json
```

Commit scenarios and sanitized ledgers only. Do not commit `eval-results/`.

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
