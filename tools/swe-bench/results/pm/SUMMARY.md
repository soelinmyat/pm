# SWE-bench Lite Benchmark — Plain Sonnet Baseline

**Date:** 2026-03-28
**Benchmark:** SWE-bench Lite (300 tasks)
**Result:** 169/300 resolved (56.3%)

## Configuration

| Setting | Value |
|---------|-------|
| Model | Claude Sonnet 4.6 (`claude-sonnet-4-6`) |
| Agent type | General-purpose subagents via Agent tool |
| Plugins | None (no PM plugin, no skills/hooks) |
| Budget per task | ~$1 (soft limit) |
| Retries | 0 (single shot) |
| Test execution | None (agents did not run repo tests) |
| Orchestrator | Claude Opus 4.6 (dispatched subagents) |

## Results

| | Count | Rate |
|--|-------|------|
| ✓ Resolved | **169** | **56.3%** |
| ✖ Unresolved | 124 | 41.3% |
| Error (patch didn't apply) | 7 | 2.3% |
| **Total** | **300** | |

## Per-Repo Breakdown

| Repo | Resolved | Unresolved | Error | Total | Rate |
|------|----------|------------|-------|-------|------|
| astropy/astropy | 4 | 2 | 0 | 6 | 67% |
| django/django | 72 | 40 | 2 | 114 | 63% |
| matplotlib/matplotlib | 13 | 10 | 0 | 23 | 57% |
| mwaskom/seaborn | 3 | 1 | 0 | 4 | 75% |
| pallets/flask | 0 | 3 | 0 | 3 | 0% |
| psf/requests | 5 | 1 | 0 | 6 | 83% |
| pydata/xarray | 1 | 4 | 0 | 5 | 20% |
| pylint-dev/pylint | 4 | 2 | 0 | 6 | 67% |
| pytest-dev/pytest | 10 | 6 | 1 | 17 | 59% |
| scikit-learn/scikit-learn | 12 | 10 | 1 | 23 | 52% |
| sphinx-doc/sphinx | 8 | 7 | 1 | 16 | 50% |
| sympy/sympy | 37 | 38 | 2 | 77 | 48% |

## Key Observations

1. **Strongest repos:** requests (83%), seaborn (75%), astropy/django/pylint (~65%)
2. **Weakest repos:** flask (0%), xarray (20%), sympy (48%)
3. **Django dominance:** 114 of 300 tasks are Django — 63% resolve rate there drives the overall score
4. **Sympy is hardest:** Large codebase, complex math — 48% despite being the biggest slice after Django
5. **Error rate low:** Only 7/300 (2.3%) patches failed to apply cleanly

## What This Measures

This is a **floor** for Claude's SWE-bench capability:
- Single-shot Sonnet with no iteration
- No test verification (agents couldn't check their work)
- No retry logic for failed patches
- No PM plugin skills (no TDD, no debugging workflow)

## Expected Improvements with PM Plugin

The `/dev` skill adds:
- **TDD discipline** — write tests first, verify fix passes
- **Debugging skill** — root cause analysis before fixing
- **Iterative fixing** — run tests, fix failures, repeat
- **Review gates** — multi-perspective code review before finalizing

These should particularly help on:
- Sympy tasks (complex logic needs test verification)
- Scikit-learn tasks (numerical edge cases)
- The 7 error tasks (better patch formatting)

## Evaluation

Evaluated using the official SWE-bench harness (`swebench==4.1.0`):
```
python -m swebench.harness.run_evaluation \
    --dataset_name princeton-nlp/SWE-bench_Lite \
    --predictions_path results/pm/predictions.jsonl \
    --max_workers 4 --timeout 900 --run_id pm
```
