# PM Telemetry Reference

Shared telemetry contract for PM skills. Use this when analytics are enabled and a workflow needs to record run-level or step-level usage.

## Enable analytics

Analytics are opt-in. A project enables them with:

```yaml
---
analytics: true
---
```

in `.claude/pm.local.md`.

The logger also respects `PM_ANALYTICS=1` for testing.

## Files written

- `.pm/analytics/activity.jsonl` — run-level events such as `invoked`, `started`, and `completed`
- `.pm/analytics/steps.jsonl` — step spans with timing, token estimates, retries, and lightweight metadata

## Run lifecycle

At skill start:

```bash
PM_RUN_ID=$(${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh run-start --skill <skill> --args "$ARGUMENTS")
```

At skill completion:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh run-end \
  --skill <skill> \
  --run-id "$PM_RUN_ID" \
  --status completed
```

If the workflow exits early, use `blocked`, `failed`, `skipped`, or `canceled`.

## Step spans

For any meaningful phase or stage, capture one span:

```bash
STEP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# ... do the work ...
${CLAUDE_PLUGIN_ROOT}/scripts/pm-log.sh step \
  --skill <skill> \
  --run-id "$PM_RUN_ID" \
  --phase <phase> \
  --step <step> \
  --status completed \
  --started-at "$STEP_STARTED_AT" \
  --ended-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --state-file "$STATE_FILE" \
  --files-read 3 \
  --files-written 1
```

Optional size signals:

```bash
--input-file "$STATE_FILE"
--output-file "{pm_dir}/research/topic/findings.md"
```

or:

```bash
--input-chars 2400
--output-chars 1200
```

If exact token usage is available from the platform, pass:

```bash
--input-tokens 3200 --output-tokens 800 --token-source exact
```

Otherwise the logger estimates tokens from character counts and marks `token_source` as `estimated`.

## Stateful workflow fields

Stateful workflows should carry these fields in their state files:

```yaml
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null | YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ   # groom
stage_started_at: YYYY-MM-DDTHH:MM:SSZ   # dev/review/ship
```

Review-heavy flows should also store iteration counts, review verdict timestamps, and send-back / failed-gate outcomes where relevant.

## Suggested coverage

- All skills: run start + run end
- Multi-step skills: one step span per major phase
- Retry loops: increment `--attempt`
- File-writing skills: include `--output-file`
- Stateful skills: mirror run and phase/stage timestamps into the state file

## Automatic agent tracking

Agent dispatches are tracked automatically via PostToolUse hook (`hooks/agent-step.sh`). When analytics is enabled, every Agent tool call logs a step span to `steps.jsonl` with:

- **actor**: `agent:{persona}` (e.g., `agent:@staff-engineer`)
- **input_chars / est_input_tokens**: prompt size sent to the agent
- **output_chars / est_output_tokens**: result size returned from the agent
- **run_id**: correlated to the active skill run via `.pm/analytics/.current-run`

These estimates reflect orchestrator I/O only (prompt briefing + result summary). Actual agent token consumption (internal file reads, tool calls, thinking) is higher. The data answers: "how much context flows between orchestrator and agents?"

Run lifecycle is also automatic. Each `pm:` skill invocation emits `run-start` and closes the previous run. No manual instrumentation needed for run boundaries.

## Automatic stateful workflow tracking

Stateful PM workflows also get automatic phase/stage tracking via the Write/Edit hooks.

- Edits to `.pm/groom-sessions/*.md` (and legacy `.pm/.groom-state.md`) close the previous groom phase and keep the next phase active.
- Edits to `.pm/dev-sessions/*.md` (and legacy `.dev-state-*.md`, `.dev-epic-state-*.md`, `epic-*.md`) close the previous development stage and keep the next stage active.
- The final active phase/stage is closed automatically when the run changes or the session ends.

This automatic layer depends on the state file fields staying current:

- Groom: `phase`, `run_id`, `phase_started_at`, `completed_at`
- Dev/review/ship: `Stage`, `Run ID`, `Stage started at`, `Completed at`

When a skill has richer substeps that are not represented in a state file, keep logging those spans manually with `pm-log.sh step`.

## Baseline generation

After telemetry exists, generate a maintainer summary with:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pm-baseline.js \
  --project-dir "$PWD" \
  --output {pm_dir}/research/tracking-dogfooding/baseline.md
```
