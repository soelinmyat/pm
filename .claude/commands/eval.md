# SWE-bench Skill Eval

Run the SWE-bench Lite skill eval from within this Claude Code session.

## Arguments

- No args: run full mini subset (49 tasks) with both `vanilla` and `pm-dev` configs
- `--quick`: run first 10 tasks only (~10 min)
- `--config vanilla|pm-dev`: run a single config instead of both
- `--resume`: skip tasks that already have results in the current run file

## Setup

The eval infrastructure lives in `tools/swe-bench/`. Repos are cached in `tools/swe-bench/repos/`.

Before first run, ensure repos are cloned:
```bash
cd tools/swe-bench && python3 -c "
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
print(f'Dataset: {len(ds)} tasks')
"
```

## Flow

### 1. Load tasks

Read `tools/swe-bench/tasks-mini.txt` for the task instance IDs (one per line).
Load the full task data from `tools/swe-bench/tasks.json` (or the HuggingFace dataset if tasks.json doesn't have the needed fields).

If `--quick` was passed, take only the first 10 tasks.

### 2. Determine configs to run

Default: run both `vanilla` and `pm-dev` sequentially.
If `--config` was passed, run only that config.

### 3. For each config, for each task

**Configs:**

- **vanilla**: Prompt is a plain bug fix request (no skill invocation):
  ```
  You are solving a GitHub issue. The repo is at {repo_path}.
  Read the issue description below, find the bug, and make the minimal fix.
  Only modify existing files. Do not create new test files.

  ## Issue
  {problem_statement}

  When done, reply with ONLY "DONE".
  ```

- **pm-dev**: Prompt invokes the dev skill:
  ```
  You are solving a GitHub issue. The repo is at {repo_path}.

  Use /dev to fix this issue:

  {problem_statement}

  When done, reply with ONLY "DONE".
  ```

**Per task:**

1. **Checkout repo** at the task's base commit:
   ```bash
   cd tools/swe-bench/repos/{owner}__{repo}
   git checkout --force {base_commit}
   git clean -fdx -q
   ```

2. **Record start time** (`date -u +"%Y-%m-%dT%H:%M:%SZ"`)

3. **Dispatch subagent** to solve the task:
   ```
   Agent({
     description: "Eval {instance_id}",
     mode: "bypassPermissions",
     prompt: "{config-specific prompt}"
   })
   ```
   The agent works in the repo directory. It may succeed, fail, or timeout.

4. **Capture patch** after agent returns:
   ```bash
   cd tools/swe-bench/repos/{owner}__{repo}
   git diff HEAD
   ```

5. **Record result**:
   - `instance_id`
   - `patch` (the git diff)
   - `patch_valid`: true if patch is non-empty and applies cleanly
   - `elapsed_seconds`: wall time from dispatch to return
   - `error_count`: 0 if agent returned normally, 1 if it errored/timed out

6. **Report progress** to the user:
   ```
   [{N}/{total}] {instance_id} — {patch_bytes}b patch ({elapsed}s). Running total: {resolved_patches}/{N} with patches ({pct}%)
   ```

7. **Reset repo** for next task:
   ```bash
   git checkout --force {base_commit}
   git clean -fdx -q
   ```

### 4. Write predictions file

After all tasks complete, write `tools/swe-bench/results/{config}/predictions.jsonl`:
```json
{"instance_id": "...", "model_name_or_path": "{config}", "model_patch": "..."}
```
One line per task. This is the format the SWE-bench evaluator expects.

### 5. Run scoring

```bash
cd tools/swe-bench
python3 evaluate.py --run_id {config} --predictions results/{config}/predictions.jsonl
```

Or if Docker eval is set up:
```bash
python3 -m swebench.harness.run_evaluation \
  --predictions_path results/{config}/predictions.jsonl \
  --run_id {config} \
  --max_workers 4
```

### 6. Write versioned result YAML

Read the plugin version from `.claude-plugin/plugin.json`.
Read the git commit hash.

Write `tools/swe-bench/results/{config}/{date}-v{version}.yml`:

```yaml
run_id: "{date}-v{version}"
date: "{YYYY-MM-DD}"
plugin_version: "{version}"
commit: "{short hash}"
model: "current session model"
subset: "mini-49"
budget_per_task: 10.0

aggregates:
  resolved: {count from scoring}
  total: {total tasks}
  resolve_rate: {resolved/total}
  patches_generated: {count of non-empty patches}
  patches_valid: {count of valid patches}
  avg_seconds_per_task: {mean}
  errors: {total error count}

per_task:
  - instance_id: "..."
    resolved: true|false
    patch_bytes: 503
    elapsed_seconds: 95
    error_count: 0
```

### 7. Compare to previous run (if exists)

Look for prior YAML files in `tools/swe-bench/results/{config}/`.
If found, run comparison:

```bash
python3 tools/swe-bench/compare.py \
  tools/swe-bench/results/{config}/{previous}.yml \
  tools/swe-bench/results/{config}/{current}.yml
```

### 8. Print final summary

```
=== SWE-bench Eval Complete ===

Config: {config}
Tasks: {total}
Resolved: {count}/{total} ({pct}%)
Patches generated: {count}
Avg time/task: {seconds}s
Errors: {count}

vs previous ({prev_date}):
  Resolve rate: {delta}% ({direction})
  Avg time: {delta}s ({direction})
```

If both vanilla and pm-dev ran, also print the paired comparison:
```
=== Skill Delta ===
vanilla: {N}/{total} ({pct}%)
pm-dev:  {N}/{total} ({pct}%)
Delta:   +{N} tasks ({delta}%)

Tasks pm-dev solved that vanilla didn't:
  - {instance_id_1}
  - {instance_id_2}

Tasks vanilla solved that pm-dev didn't:
  - {instance_id_3}
```

## Important Notes

- Tasks run sequentially (repos are shared, can't parallelize)
- Budget is $10/task — let the agent retry and self-heal
- If a subagent hangs or errors, record it and move on
- The predictions.jsonl format is what SWE-bench evaluator expects
- Results YAML files accumulate over time for trend tracking
