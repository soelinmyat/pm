# SWE-bench Verified Mini — PM Plugin Eval

## Overview

Regression suite for the pm plugin. Runs the 50-task SWE-bench Verified Mini subset, comparing vanilla Claude vs pm:dev skill. Tracks resolve rate, cost, tokens, and time per run. Versioned results enable trend tracking across plugin releases.

**Benchmark:** SWE-bench Verified Mini (50 tasks, Django + Sphinx)
**Public leaderboard:** [hal.cs.princeton.edu/swebench_verified_mini](https://hal.cs.princeton.edu/swebench_verified_mini)
**Source:** `MariusHobbhahn/swe-bench-verified-mini` on HuggingFace

## Quick Start

### From Claude Code session (recommended)

```
/eval              # Full run: both vanilla + pm-dev, 50 tasks
/eval --quick      # Smoke test: 10 tasks only
/eval --config pm-dev  # Single config
```

Uses your subscription. No API key needed.

### Headless (legacy)

```bash
cd tools/swe-bench
python generate.py --configs vanilla pm-dev --subset tasks-verified-mini.txt --resume
python evaluate.py --run_id pm-dev
```

## Files

| File | Purpose |
|------|---------|
| `tasks-verified-mini.txt` | 50-task Verified Mini subset (Django + Sphinx) |
| `tasks-verified-mini.json` | Full task data with problem statements |
| `tasks-mini.txt` | Legacy 49-task Lite subset (deprecated) |
| `tasks.json` | Legacy 300-task Lite dataset cache |
| `generate.py` | Headless patch generator (legacy) |
| `evaluate.py` | Docker-based scoring |
| `compare.py` | Trend + paired comparison reports |
| `results/{config}/{date}-v{version}.yml` | Versioned run results |
| `results/{config}/predictions.jsonl` | SWE-bench evaluator input |

## Comparing Results

```bash
# Trend: same config over time
python compare.py results/pm-dev/2026-03-15-v1.0.20.yml results/pm-dev/2026-04-02-v1.0.24.yml

# Paired: vanilla vs pm-dev from same run
python compare.py --paired results/vanilla/2026-04-02.yml results/pm-dev/2026-04-02-v1.0.24.yml
```

## Subset Details

SWE-bench Verified Mini (50 tasks):
- **Human-verified**: Each task validated by humans for clear description, correct gold patch, valid tests
- **Repos**: Django (25), Sphinx (25) — ~5GB storage
- **Correlation**: Scores correlate with full 500-task Verified benchmark
- **Leaderboard**: Results directly comparable to public HAL leaderboard

## Budget

- Per-task budget — lets the dev skill fully exercise TDD/debug/retry loops
- Target cadence: biweekly

## Result YAML Format

```yaml
run_id: "2026-04-02-v1.0.24"
date: "2026-04-02"
plugin_version: "1.0.24"
commit: "9d614de"
model: "claude-opus-4-6"
subset: "verified-mini-50"
budget_per_task: 10.0

aggregates:
  resolved: 28
  total: 50
  resolve_rate: 0.56
  patches_generated: 45
  patches_valid: 43
  avg_seconds_per_task: 120
  errors: 3

per_task:
  - instance_id: "django__django-11790"
    resolved: true
    patch_bytes: 503
    elapsed_seconds: 95
    error_count: 0
```
