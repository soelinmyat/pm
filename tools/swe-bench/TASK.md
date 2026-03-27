# SWE-bench Lite — PM Benchmark Run

## Goal

Run all 300 SWE-bench Lite tasks using subagents. Each task gets a fresh agent with clean context. The orchestrator (you) stays lean — just dispatches and records results.

## Setup

```python
from datasets import load_dataset
ds = load_dataset('princeton-nlp/SWE-bench_Lite', split='test')
```

## Resume

Read `results/pm/predictions.jsonl`. Collect existing `instance_id`s. Skip those.

## For each task

1. **Checkout:** Clone repo to `repos/{owner}__{repo}/` if not cached. Run `git checkout --force {base_commit} && git clean -fdx -q`.

2. **Dispatch subagent:** Spawn a general-purpose Agent with this prompt:

   > You are solving a GitHub issue. The repo is at {repo_path}. Read the issue below, find the bug, and make the minimal fix. Only modify existing files. Do not create new test files.
   >
   > ## Issue
   > {problem_statement}
   >
   > When done, reply with ONLY the word "DONE".

   Set `mode: "auto"` so it can read/edit files freely. The agent works in the repo directory.

3. **Capture patch:** After the agent returns, run `git diff HEAD` in the repo to get the patch.

4. **Record:** Append to `results/pm/predictions.jsonl`:
   ```json
   {"instance_id": "{instance_id}", "model_name_or_path": "pm", "model_patch": "{patch}"}
   ```

5. **Reset repo:** `git checkout --force {base_commit} && git clean -fdx -q`

6. **Move to next task.**

## Rules

- One subagent per task (fresh context each time)
- Do NOT read the subagent's full output — just check if it returned, then capture the diff
- If a subagent times out or errors, record empty `model_patch` and continue
- Process tasks sequentially (repos are shared, can't parallelize)
- Print progress every 10 tasks: `[N/300] done, M patches generated`
