#!/usr/bin/env python3
"""
Prepare a SWE-bench task for interactive solving.

Usage:
  python setup-task.py                          # List all 300 tasks
  python setup-task.py astropy__astropy-12907   # Checkout specific task
  python setup-task.py --random                 # Pick a random task
  python setup-task.py --index 5                # Pick task by index

Checks out the repo at base_commit and prints the issue + test info.
"""

import argparse
import json
import os
import random
import subprocess
import sys
from pathlib import Path

from datasets import load_dataset

REPOS_DIR = Path("/repos") if Path("/repos").exists() else Path(__file__).parent / "repos"


def list_tasks(tasks):
    print(f"{'#':<4} {'Instance ID':<45} {'Repo':<30}")
    print("-" * 80)
    for i, t in enumerate(tasks):
        print(f"{i:<4} {t['instance_id']:<45} {t['repo']:<30}")


def checkout_task(task):
    repo = task["repo"]
    base_commit = task["base_commit"]
    repo_slug = repo.replace("/", "__")
    repo_path = REPOS_DIR / repo_slug

    REPOS_DIR.mkdir(parents=True, exist_ok=True)

    if not repo_path.exists():
        print(f"Cloning {repo}...")
        subprocess.run(
            ["git", "clone", "--quiet", f"https://github.com/{repo}.git", str(repo_path)],
            check=True,
        )

    print(f"Checking out {base_commit[:10]}...")
    subprocess.run(
        ["git", "checkout", "--force", "--quiet", base_commit],
        cwd=repo_path, check=True,
    )
    subprocess.run(
        ["git", "clean", "-fdx", "--quiet"],
        cwd=repo_path, check=True,
    )

    return repo_path


def print_task_info(task, repo_path):
    fail_to_pass = task.get("FAIL_TO_PASS", "[]")
    pass_to_pass = task.get("PASS_TO_PASS", "[]")

    # Parse test names
    try:
        fail_tests = json.loads(fail_to_pass) if isinstance(fail_to_pass, str) else fail_to_pass
    except json.JSONDecodeError:
        fail_tests = [fail_to_pass]

    try:
        pass_tests = json.loads(pass_to_pass) if isinstance(pass_to_pass, str) else pass_to_pass
    except json.JSONDecodeError:
        pass_tests = [pass_to_pass]

    print(f"""
{'='*70}
TASK: {task['instance_id']}
REPO: {task['repo']}  (version: {task.get('version', 'unknown')})
PATH: {repo_path}
{'='*70}

ISSUE:
{task['problem_statement'][:2000]}
{'...(truncated)' if len(task['problem_statement']) > 2000 else ''}

{'='*70}
TESTS THAT SHOULD FAIL (before fix) AND PASS (after fix):
""")
    for t in fail_tests[:20]:
        print(f"  FAIL→PASS: {t}")

    if len(pass_tests) <= 10:
        print(f"\nTESTS THAT MUST KEEP PASSING ({len(pass_tests)}):")
        for t in pass_tests:
            print(f"  PASS→PASS: {t}")
    else:
        print(f"\nTESTS THAT MUST KEEP PASSING: {len(pass_tests)} tests (too many to list)")

    # Try to infer the test command
    test_cmd = infer_test_command(task, fail_tests)

    print(f"""
{'='*70}
HOW TO SOLVE:
  1. cd {repo_path}
  2. Run: claude          (interactive, uses your subscription)
     Or:  claude --bare   (no plugins — vanilla)
     Or:  claude --plugin-dir /path/to/plugin  (specific plugin)
  3. Tell Claude: "Fix this issue: <paste the issue above>"
  4. Verify: {test_cmd}

HOW TO CHECK YOUR FIX:
  cd {repo_path}
  {test_cmd}
  # All FAIL→PASS tests should now pass
  # All PASS→PASS tests should still pass

HOW TO GET THE PATCH:
  cd {repo_path}
  git diff HEAD
{'='*70}
""")


def infer_test_command(task, fail_tests):
    """Try to infer how to run the failing tests."""
    repo = task["repo"]

    if not fail_tests:
        return "# (no test command inferred)"

    first_test = fail_tests[0]

    # Python repos (most of SWE-bench)
    if "django" in repo:
        # Django uses its own test runner
        test_module = first_test.split("::")[0] if "::" in first_test else first_test.rsplit(".", 1)[0]
        return f"python -m django test {test_module} --settings=test_settings"
    elif any(x in repo for x in ["astropy", "scikit-learn", "matplotlib", "sympy", "sphinx", "pylint", "pytest", "flask", "requests", "xarray", "pydata"]):
        # pytest-based
        return f"python -m pytest {first_test} -xvs"

    return f"python -m pytest {first_test} -xvs"


def main():
    parser = argparse.ArgumentParser(description="Setup SWE-bench task for interactive solving")
    parser.add_argument("task_id", nargs="?", default=None, help="Instance ID to checkout")
    parser.add_argument("--list", action="store_true", help="List all tasks")
    parser.add_argument("--random", action="store_true", help="Pick a random task")
    parser.add_argument("--index", type=int, default=None, help="Pick task by index")
    args = parser.parse_args()

    print("Loading SWE-bench Lite dataset...")
    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    tasks = list(ds)

    if args.list or (not args.task_id and not args.random and args.index is None):
        list_tasks(tasks)
        print(f"\n{len(tasks)} tasks. Use: python setup-task.py <instance_id>")
        return

    if args.random:
        task = random.choice(tasks)
    elif args.index is not None:
        task = tasks[args.index]
    else:
        matches = [t for t in tasks if t["instance_id"] == args.task_id]
        if not matches:
            # Try partial match
            matches = [t for t in tasks if args.task_id.lower() in t["instance_id"].lower()]
        if not matches:
            print(f"Task not found: {args.task_id}")
            sys.exit(1)
        if len(matches) > 1:
            print(f"Multiple matches:")
            for m in matches:
                print(f"  {m['instance_id']}")
            sys.exit(1)
        task = matches[0]

    repo_path = checkout_task(task)
    print_task_info(task, repo_path)


if __name__ == "__main__":
    main()
