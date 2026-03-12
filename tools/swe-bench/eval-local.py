#!/usr/bin/env python3
"""
Lightweight local evaluator for SWE-bench predictions.
Runs each task in a Docker container without the heavy swebench image pipeline.

Usage:
  python eval-local.py                          # Evaluate all configs
  python eval-local.py --configs vanilla        # Specific config
  python eval-local.py --task astropy__astropy-12907  # Single task
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from datasets import load_dataset

RESULTS_DIR = Path(__file__).parent / "results"

# Map repos to their test setup + run commands
# SWE-bench Lite is mostly Python scientific packages
REPO_SETUP = {
    "astropy/astropy": {
        "install": "pip install -e '.[test]' 2>/dev/null || pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
    "django/django": {
        "install": "pip install -e . 2>/dev/null",
        "test_cmd": "python tests/runtests.py {test} --verbosity=2 2>&1 | tail -30",
    },
    "scikit-learn/scikit-learn": {
        "install": "pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
    "sympy/sympy": {
        "install": "pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
    "matplotlib/matplotlib": {
        "install": "pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
    "sphinx-doc/sphinx": {
        "install": "pip install -e '.[test]' 2>/dev/null || pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
    "_default": {
        "install": "pip install -e '.[test]' 2>/dev/null || pip install -e . 2>/dev/null",
        "test_cmd": "python -m pytest {test} -xvs 2>&1 | tail -30",
    },
}


def get_setup(repo: str) -> dict:
    return REPO_SETUP.get(repo, REPO_SETUP["_default"])


def run_in_docker(repo: str, base_commit: str, patch: str,
                  fail_to_pass: list[str], version: str,
                  timeout: int = 600) -> dict:
    """Run a single task evaluation in Docker. Returns {passed, output}."""

    if not patch.strip():
        return {"passed": False, "output": "No patch provided"}

    setup = get_setup(repo)

    # Determine Python version based on repo version hints
    python_image = "python:3.11-slim"

    # Build test command from FAIL_TO_PASS
    test_args = " ".join(fail_to_pass[:5])  # Limit to 5 tests to keep it fast
    test_cmd = setup["test_cmd"].format(test=test_args)

    import base64
    patch_b64 = base64.b64encode(patch.encode()).decode()

    script = f"""#!/bin/bash
set -e

# Install git and build deps
apt-get update -qq && apt-get install -y -qq git build-essential 2>/dev/null | tail -1

# Clone and checkout
git clone --quiet https://github.com/{repo}.git /work 2>/dev/null
cd /work
git checkout --quiet {base_commit}

# Decode and apply patch
echo '{patch_b64}' | base64 -d > /tmp/task.patch
git apply --verbose /tmp/task.patch || patch -p1 < /tmp/task.patch

# Install
{setup['install']}

# Run tests
echo "=== RUNNING TESTS ==="
set +e
{test_cmd}
TEST_EXIT=$?
set -e

echo "=== TEST EXIT CODE: $TEST_EXIT ==="
exit $TEST_EXIT
"""

    with tempfile.NamedTemporaryFile(mode="w", suffix=".sh", delete=False) as f:
        f.write(script)
        script_path = f.name

    cmd = [
        "docker", "run", "--rm",
        "--platform", "linux/amd64",
        "-v", f"{script_path}:/tmp/run.sh:ro",
        python_image,
        "bash", "/tmp/run.sh",
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        output = result.stdout + result.stderr
        passed = result.returncode == 0
    except subprocess.TimeoutExpired:
        output = "TIMEOUT"
        passed = False
    finally:
        Path(script_path).unlink(missing_ok=True)

    return {"passed": passed, "output": output[-2000:]}  # Keep last 2000 chars


def evaluate_config(config_name: str, tasks_by_id: dict,
                    task_filter: str | None = None):
    """Evaluate all predictions for a config."""
    predictions_path = RESULTS_DIR / config_name / "predictions.jsonl"
    if not predictions_path.exists():
        print(f"  Skip {config_name}: no predictions")
        return []

    predictions = []
    with open(predictions_path) as f:
        for line in f:
            predictions.append(json.loads(line))

    if task_filter:
        predictions = [p for p in predictions if p["instance_id"] == task_filter]

    results = []
    total = len(predictions)

    for i, pred in enumerate(predictions):
        instance_id = pred["instance_id"]
        task = tasks_by_id.get(instance_id)
        if not task:
            print(f"  [{i+1}/{total}] {instance_id}: SKIP (not in dataset)")
            continue

        patch = pred.get("model_patch", "")
        fail_to_pass = task.get("FAIL_TO_PASS", "[]")
        try:
            fail_tests = json.loads(fail_to_pass) if isinstance(fail_to_pass, str) else fail_to_pass
        except json.JSONDecodeError:
            fail_tests = [fail_to_pass]

        if not fail_tests:
            print(f"  [{i+1}/{total}] {instance_id}: SKIP (no FAIL_TO_PASS tests)")
            continue

        print(f"  [{i+1}/{total}] {instance_id}...", end=" ", flush=True)

        result = run_in_docker(
            repo=task["repo"],
            base_commit=task["base_commit"],
            patch=patch,
            fail_to_pass=fail_tests,
            version=task.get("version", ""),
        )

        status = "PASS" if result["passed"] else "FAIL"
        print(status)

        results.append({
            "instance_id": instance_id,
            "passed": result["passed"],
            "output": result["output"],
        })

    # Save results
    results_path = RESULTS_DIR / config_name / "eval_results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)

    return results


def print_comparison(configs: list[str]):
    """Print comparison table."""
    print(f"\n{'='*60}")
    print("SWE-bench Lite Evaluation Results")
    print(f"{'='*60}")
    print(f"{'Config':<15} {'Tasks':>6} {'Passed':>8} {'Failed':>8} {'Rate':>8}")
    print(f"{'-'*15} {'-'*6} {'-'*8} {'-'*8} {'-'*8}")

    for config_name in configs:
        results_path = RESULTS_DIR / config_name / "eval_results.json"
        if not results_path.exists():
            print(f"{config_name:<15} {'(no results)':>6}")
            continue

        with open(results_path) as f:
            results = json.load(f)

        total = len(results)
        passed = sum(1 for r in results if r["passed"])
        failed = total - passed
        rate = f"{passed/total*100:.0f}%" if total > 0 else "N/A"
        print(f"{config_name:<15} {total:>6} {passed:>8} {failed:>8} {rate:>8}")

        # Show per-task breakdown
        for r in results:
            status = "PASS" if r["passed"] else "FAIL"
            print(f"  {r['instance_id']}: {status}")

    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="Lightweight SWE-bench evaluator")
    parser.add_argument("--configs", nargs="+", default=None)
    parser.add_argument("--task", type=str, default=None)
    parser.add_argument("--timeout", type=int, default=600,
                        help="Timeout per task in seconds (default: 600)")
    parser.add_argument("--compare", action="store_true",
                        help="Just show results, don't run evaluation")
    args = parser.parse_args()

    # Find configs with predictions
    if args.configs:
        configs = args.configs
    else:
        configs = []
        if RESULTS_DIR.exists():
            for d in sorted(RESULTS_DIR.iterdir()):
                if (d / "predictions.jsonl").exists():
                    configs.append(d.name)

    if not configs:
        print("No predictions found. Run generate.py first.")
        sys.exit(1)

    if args.compare:
        print_comparison(configs)
        return

    # Load dataset
    print("Loading SWE-bench Lite dataset...")
    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    tasks_by_id = {t["instance_id"]: t for t in ds}

    for config_name in configs:
        print(f"\n{'='*60}")
        print(f"Evaluating: {config_name}")
        print(f"{'='*60}")
        evaluate_config(config_name, tasks_by_id, task_filter=args.task)

    print_comparison(configs)


if __name__ == "__main__":
    main()
