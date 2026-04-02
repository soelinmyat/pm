---
type: backlog-issue
id: "PM-111"
title: "SWE-bench skill eval harness with versioned tracking"
outcome: "Every plugin release can be measured against a 50-task benchmark, showing resolve rate, cost, and token trends over time"
status: drafted
parent: null
children: []
labels:
  - "eval"
  - "dev-skill"
  - "quality"
priority: high
research_refs:
  - pm/research/coding-agent-evals/findings.md
created: 2026-04-02
updated: 2026-04-02
---

## Outcome

After this ships, running `python generate.py --configs pm-dev --subset mini` produces versioned results showing how the pm:dev skill performs on real GitHub issues. Running it again after plugin changes shows whether resolve rate improved or regressed — with cost, token, and time trends alongside pass rate.

## Acceptance Criteria

1. A curated 50-task subset file (`tasks-mini.txt`) exists, stratified by: repo diversity (at least 5 repos), fix type (single-file vs cross-file), difficulty (mix of tasks vanilla solves and doesn't)
2. A `pm-dev` config in `generate.py` that prompts with `/dev` to exercise the skill (TDD, debugging, simplify gates)
3. Each run records per-task: instance_id, resolved (bool), cost_usd, prompt_tokens, completion_tokens, elapsed_seconds, error_count, patch_valid (bool)
4. Results are saved as versioned YAML: `results/{config}/{date}-v{version}.yml` with plugin version, commit hash, and aggregate stats including cost_per_resolved_task
5. A `compare.py` script that diffs two result files and prints a table: resolve rate delta, cost delta, cost-per-resolve delta, token delta, time delta
6. Full subset run completes in under 1 hour on an M-series Mac
7. Scoring uses the existing Docker eval (already set up in `evaluate.py`)
8. Every run executes both `vanilla` and `pm-dev` configs on the same subset — the paired delta is the primary output
9. Tasks that timeout or exceed budget are recorded with `resolved: false` and `error_count` incremented; the run continues to the next task
10. compare.py prints a warning when resolve rate drops >5% vs the previous run
11. Runs as a project-level command (`/eval`) in `.claude/commands/eval.md` — not shipped with the plugin, not headless
12. README updated with usage instructions

## Technical Notes

### Execution model

NOT headless (`claude --print`). Runs as a **slash command** (`/eval` or `pm:eval`) within an active Claude Code session, using the user's subscription. The command:

1. Reads the task subset and checks out the repo for the next task
2. Dispatches a subagent (via `Agent` tool) per task with the dev skill prompt
3. Captures the patch via `git diff` after the agent returns
4. Records metrics (elapsed time, error count, patch validity)
5. **Reports progress to the user** after each task: `[12/50] django__django-11099 — resolved (42s). Running: 8/12 resolved (66.7%)`
6. Moves to the next task (sequential — repos are shared)
7. After all tasks: writes versioned YAML result file
8. **Runs Docker scoring** automatically via `evaluate.py` to get actual resolved counts
9. **Prints final summary** with resolve rate, cost, token totals, and comparison to previous run if one exists

Token/cost tracking: use the `usage` fields returned by the Agent tool result. If unavailable, track elapsed time and patch size as proxies.

### pm-dev prompt design

The subagent prompt triggers the dev skill's debugging/TDD flow:

```
You are solving a GitHub issue. The repo is at {repo_path}.

Use /dev to fix this issue:

{problem_statement}

When done, reply with ONLY "DONE".
```

### Result YAML format (inspired by Aider)

```yaml
run_id: "2026-04-02-v1.0.23"
date: "2026-04-02"
plugin_version: "1.0.23"
commit: "55706e5"
model: "sonnet"
subset: "mini-50"
budget_per_task: 10.0
timeout_per_task: 300

aggregates:
  resolved: 28
  total: 50
  resolve_rate: 0.56
  total_cost_usd: 12.40
  avg_cost_per_task: 0.248
  cost_per_resolved_task: 0.443
  avg_tokens_per_task: 45000
  avg_seconds_per_task: 120
  errors: 3
  patches_valid: 47

per_task:
  - instance_id: "django__django-11099"
    resolved: true
    cost_usd: 0.32
    prompt_tokens: 28000
    completion_tokens: 5000
    elapsed_seconds: 95
    error_count: 0
```

### Subset curation criteria

Pick 50 tasks that cover:
- Single-file vs cross-file fixes
- Different repos (django, flask, sympy, scikit-learn, etc.)
- Different difficulty levels (some that vanilla solves, some it doesn't)
- Tasks where TDD/debugging skill should add value

### Files to change

- `.claude/commands/eval.md` — project-level slash command (not shipped with plugin)
- `tools/swe-bench/compare.py` — trend comparison script (run via bash)
- `tools/swe-bench/tasks-mini.txt` — curated 50-task subset
- `tools/swe-bench/evaluate.py` — existing Docker scoring (unchanged)
- `tools/swe-bench/TASK.md` — update with new usage

## Competitor Context

- **Aider**: YAML leaderboard files with date/version/commit, time-series plots, tracks cost + tokens + edit format success rate
- **OpenHands**: Pydantic EvalOutput with accumulated_cost, token usage, response latency per call, Google Sheets dashboard
- **Industry trend**: Moving from SWE-bench Verified (contaminated) to SWE-bench Pro, but Lite/Mini remain useful for fast iteration

## Notes

- The existing `pm` config in generate.py does NOT invoke any skill — it's just vanilla with plugins loaded. The new `pm-dev` config is the first to actually exercise plugin workflows.
- Budget $10/task × 50 tasks × 2 configs = ~$1,000 per full paired run. Token cost is cheap relative to engineer time — letting the agent retry and self-heal is the whole point of the pm:dev skill.
- Consider adding a `--quick` flag that runs just 10 tasks for smoke testing (~10 min).
- The paired vanilla vs pm-dev run is mandatory — the delta is the proof that the plugin adds value.
