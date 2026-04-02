# SWE-bench Skill Eval

Run the SWE-bench Verified Mini eval from within this Claude Code session.
Uses the 50-task SWE-bench Verified Mini subset (Django + Sphinx), which has
a public leaderboard at hal.cs.princeton.edu for comparable results.

## Arguments

- No args: run full Verified Mini (50 tasks) with both `vanilla` and `pm-dev` configs
- `--quick`: run first 10 tasks only (~10 min)
- `--config vanilla|pm-dev`: run a single config instead of both
- `--resume`: skip tasks that already have results in the current run file

## Setup

The eval infrastructure lives in `tools/swe-bench/`. Repos are cached in `tools/swe-bench/repos/`.

Required repos: `django__django`, `sphinx-doc__sphinx` (both already cached).

Task data: `tools/swe-bench/tasks-verified-mini.json` (50 tasks from `MariusHobbhahn/swe-bench-verified-mini`).

## Flow

### 1. Load tasks

Read `tools/swe-bench/tasks-verified-mini.txt` for the task instance IDs (one per line).
Load the full task data from `tools/swe-bench/tasks-verified-mini.json`.

If `--quick` was passed, take only the first 10 tasks.

### 2. Determine configs to run

Default: run both `vanilla` and `pm-dev` sequentially.
If `--config` was passed, run only that config.

### 3. For each config, for each task

**Configs:**

- **vanilla**: Prompt is a plain bug fix request with skills/plugins explicitly disabled:
  ```
  You are solving a GitHub issue. The repo is at {repo_path}.
  Read the issue description below, find the bug, and make the minimal fix.
  Only modify existing files. Do not create new test files.

  IMPORTANT: Do NOT use any skills, slash commands, or plugin workflows
  (no /dev, /tdd, /review, /ship, /groom, or any other skill).
  Do NOT use the Skill tool. Just read the code, find the bug, and fix it directly.

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

**Before starting the loop**, create an empty predictions file:
```bash
mkdir -p tools/swe-bench/results/{config}
> tools/swe-bench/results/{config}/predictions.jsonl
```

**Per task:**

1. **Record start time** (`date -u +%s`)

2. **Dispatch subagent** with `bypassPermissions` to solve the task.
   The subagent resets the repo itself (include repo reset in the prompt):
   ```
   Agent({
     description: "Eval {instance_id}",
     mode: "bypassPermissions",
     prompt: "FIRST: cd {repo_path} && git checkout --force {base_commit} && git clean -fdx -q
              Then {config-specific instructions}..."
   })
   ```

3. **Capture patch** after agent returns:
   ```bash
   cd tools/swe-bench/repos/{owner}__{repo} && git diff HEAD
   ```

4. **IMMEDIATELY append to predictions file** (CRITICAL — patches are destroyed by the next task's repo reset):
   ```python
   # Use python to safely write the patch as JSON
   import json
   entry = {"instance_id": "...", "model_name_or_path": "{config}", "model_patch": patch_text}
   # Append one JSONL line
   with open("results/{config}/predictions.jsonl", "a") as f:
       f.write(json.dumps(entry) + "\n")
   ```
   **This is the #1 failure mode of the eval.** If you skip this step, all patches are lost.

5. **Record result** for the YAML summary:
   - `instance_id`, `patch_bytes`, `elapsed_seconds`, `error_count`

6. **Report progress** to the user:
   ```
   [{N}/{total}] {instance_id} — {patch_bytes}b patch ({elapsed}s). Running total: {patches}/{N} ({pct}%)
   ```

### 4. Verify predictions file

After all tasks complete, verify the predictions file was written correctly:
```bash
wc -l results/{config}/predictions.jsonl  # should equal total tasks
python3 -c "
import json
with open('results/{config}/predictions.jsonl') as f:
    entries = [json.loads(l) for l in f]
print(f'Total: {len(entries)}, With patches: {sum(1 for e in entries if e[\"model_patch\"].strip())}')
"
```

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
subset: "verified-mini-50"
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
- Budget is /task — let the agent retry and self-heal
- If a subagent hangs or errors, record it and move on
- The predictions.jsonl format is what SWE-bench evaluator expects
- Results YAML files accumulate over time for trend tracking
