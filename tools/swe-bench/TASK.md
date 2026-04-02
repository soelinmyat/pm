# SWE-bench Lite — PM Plugin Eval

## Overview

Regression suite for the pm plugin. Runs a curated 49-task subset of SWE-bench Lite, comparing vanilla Claude vs pm:dev skill. Tracks resolve rate, cost, tokens, and time per run. Versioned results enable trend tracking across plugin releases.

## Quick Start

### From Claude Code session (recommended)

```
/eval              # Full run: both vanilla + pm-dev, 49 tasks
/eval --quick      # Smoke test: 10 tasks only
/eval --config pm-dev  # Single config
```

Uses your subscription. No API key needed.

### Headless (legacy)

```bash
cd tools/swe-bench
python generate.py --configs vanilla pm-dev --subset tasks-mini.txt --resume
python evaluate.py --run_id pm-dev
```

## Files

| File | Purpose |
|------|---------|
| `tasks-mini.txt` | Curated 49-task subset (12 repos, mixed difficulty) |
| `tasks.json` | Full 300-task dataset cache |
| `generate.py` | Headless patch generator (legacy) |
| `evaluate.py` | Docker-based scoring |
| `compare.py` | Trend + paired comparison reports |
| `results/{config}/{date}-v{version}.yml` | Versioned run results |
| `results/{config}/predictions.jsonl` | SWE-bench evaluator input |

## Comparing Results

```bash
# Trend: same config over time
python compare.py results/pm-dev/2026-03-15-v1.0.20.yml results/pm-dev/2026-04-02-v1.0.23.yml

# Paired: vanilla vs pm-dev from same run
python compare.py --paired results/vanilla/2026-04-02.yml results/pm-dev/2026-04-02-v1.0.23.yml
```

## Subset Curation

`tasks-mini.txt` contains 49 instance IDs, stratified by:
- **Repo diversity**: All 12 SWE-bench Lite repos represented
- **Difficulty mix**: ~60% tasks vanilla solves (baseline), ~40% it doesn't (room for improvement)
- **Fix type**: Single-file and cross-file bugs

To update the subset, edit `tasks-mini.txt` (one instance_id per line).

## Budget

- $10/task budget — lets the dev skill fully exercise TDD/debug/retry loops
- ~$500 per single-config run, ~$1,000 per paired run
- Target cadence: biweekly

## Result YAML Format

```yaml
run_id: "2026-04-02-v1.0.23"
date: "2026-04-02"
plugin_version: "1.0.23"
commit: "55706e5"
model: "sonnet"
subset: "mini-49"
budget_per_task: 10.0

aggregates:
  resolved: 28
  total: 49
  resolve_rate: 0.571
  patches_generated: 45
  patches_valid: 43
  avg_seconds_per_task: 120
  errors: 3

per_task:
  - instance_id: "django__django-11099"
    resolved: true
    patch_bytes: 503
    elapsed_seconds: 95
    error_count: 0
```
