#!/usr/bin/env python3
"""
SWE-bench Lite patch generator — runs Claude Code in multiple configurations.

Usage:
  python generate.py                          # Run all 4 configs, all 300 tasks
  python generate.py --configs vanilla pm     # Run specific configs
  python generate.py --limit 10               # First 10 tasks only
  python generate.py --resume                 # Skip tasks with existing predictions
  python generate.py --task django__django-11099  # Single task

Outputs predictions to: results/{config}/predictions.jsonl
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from datasets import load_dataset

RESULTS_DIR = Path(__file__).parent / "results"
REPOS_DIR = Path(__file__).parent / "repos"

# Claude Code configurations
# "subscription" mode: no --bare, uses OAuth/subscription auth, all installed plugins load
# "api" mode: --bare, uses ANTHROPIC_API_KEY, only specified plugins load
CONFIGS = {
    "vanilla": {
        "label": "Vanilla Claude Code",
        "flags": ["--bare", "--no-session-persistence"],
    },
    "pm": {
        "label": "PM Plugin (subscription)",
        "flags": ["--no-session-persistence"],
    },
    "pm-api": {
        "label": "PM Plugin (API, isolated)",
        "flags": [
            "--bare",
            "--no-session-persistence",
            "--plugin-dir", str(Path(__file__).parent.parent.parent / ".claude-plugin"),
        ],
    },
    "superpowers": {
        "label": "Superpowers",
        "flags": ["--bare", "--no-session-persistence"],
        "plugin_name": "superpowers",
    },
    "gstack": {
        "label": "gstack",
        "flags": ["--bare", "--no-session-persistence"],
        "plugin_name": "gstack",
    },
}


def find_plugin_dir(name: str) -> str | None:
    """Find a plugin directory in the Claude Code cache."""
    cache_base = Path.home() / ".claude" / "plugins" / "cache"
    if not cache_base.exists():
        return None
    for org_dir in cache_base.iterdir():
        plugin_dir = org_dir / name
        if plugin_dir.exists():
            # Find the highest version
            versions = sorted(plugin_dir.iterdir(), reverse=True)
            if versions:
                return str(versions[0])
    return None


def resolve_config_flags(config: dict) -> list[str] | None:
    """Resolve flags for a config, finding plugin dirs as needed."""
    flags = list(config["flags"])
    plugin_name = config.get("plugin_name")
    if plugin_name:
        plugin_dir = find_plugin_dir(plugin_name)
        if not plugin_dir:
            return None  # Plugin not installed
        flags.extend(["--plugin-dir", plugin_dir])
    return flags


def checkout_repo(repo: str, base_commit: str) -> Path:
    """Clone repo at base_commit. Returns repo path."""
    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    repo_slug = repo.replace("/", "__")
    repo_path = REPOS_DIR / repo_slug

    if not repo_path.exists():
        print(f"  Cloning {repo}...")
        subprocess.run(
            ["git", "clone", "--quiet", f"https://github.com/{repo}.git", str(repo_path)],
            check=True, capture_output=True,
        )

    # Checkout the base commit
    subprocess.run(
        ["git", "checkout", "--force", "--quiet", base_commit],
        cwd=repo_path, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "clean", "-fdx", "--quiet"],
        cwd=repo_path, check=True, capture_output=True,
    )

    return repo_path


def run_claude(repo_path: Path, problem_statement: str, flags: list[str],
               budget: float = 1.0, timeout: int = 300) -> str:
    """Run Claude Code headless and return the generated patch."""
    prompt = f"""You are solving a GitHub issue. Read the issue description below, then find and fix the bug in this repository.

IMPORTANT: Only modify existing files. Do not create new test files. Make the minimal change needed to fix the issue.

## Issue Description

{problem_statement}

## Instructions

1. Read the relevant source files to understand the codebase
2. Identify the root cause of the issue
3. Make the fix
4. Verify your fix doesn't break anything obvious

When done, output ONLY "DONE" as your final message."""

    cmd = [
        "claude",
        "--print",
        "--output-format", "text",
        "--model", "sonnet",
        "--max-budget-usd", str(budget),
        "--permission-mode", "bypassPermissions",
        *flags,
        "-p", prompt,
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            cwd=repo_path,
        )
    except subprocess.TimeoutExpired:
        print("    TIMEOUT")
        return ""

    if result.returncode != 0:
        stderr = result.stderr[:500] if result.stderr else ""
        print(f"    Claude exited {result.returncode}: {stderr}")

    return result.stdout


def extract_patch(repo_path: Path) -> str:
    """Extract the git diff as a patch."""
    result = subprocess.run(
        ["git", "diff", "HEAD"],
        cwd=repo_path, capture_output=True, text=True,
    )
    return result.stdout.strip()


def run_config(config_name: str, config: dict, tasks: list[dict],
               resume: bool = False):
    """Run all tasks for a single configuration."""
    flags = resolve_config_flags(config)
    if flags is None:
        print(f"\n  SKIP {config_name}: plugin not installed")
        return

    out_dir = RESULTS_DIR / config_name
    out_dir.mkdir(parents=True, exist_ok=True)
    predictions_path = out_dir / "predictions.jsonl"

    # Load existing predictions for resume
    existing = set()
    if resume and predictions_path.exists():
        with open(predictions_path) as f:
            for line in f:
                entry = json.loads(line)
                existing.add(entry["instance_id"])

    total = len(tasks)
    resolved = 0
    skipped = 0

    for i, task in enumerate(tasks):
        instance_id = task["instance_id"]

        if instance_id in existing:
            skipped += 1
            continue

        print(f"\n  [{i+1}/{total}] {instance_id}")

        # Checkout repo at base commit
        try:
            repo_path = checkout_repo(task["repo"], task["base_commit"])
        except Exception as e:
            print(f"    SKIP (checkout failed): {e}")
            continue

        # Run Claude Code
        start = time.time()
        run_claude(repo_path, task["problem_statement"], flags)
        elapsed = time.time() - start
        print(f"    Claude: {elapsed:.0f}s")

        # Extract patch
        patch = extract_patch(repo_path)
        if patch:
            resolved += 1
            print(f"    Patch: {len(patch)} bytes")
        else:
            print("    No patch generated")

        # Write prediction
        prediction = {
            "instance_id": instance_id,
            "model_name_or_path": config_name,
            "model_patch": patch,
        }
        with open(predictions_path, "a") as f:
            f.write(json.dumps(prediction) + "\n")

    print(f"\n  {config_name}: {resolved}/{total} produced patches ({skipped} skipped)")


def main():
    parser = argparse.ArgumentParser(description="SWE-bench Lite patch generator")
    parser.add_argument("--configs", nargs="+", default=list(CONFIGS.keys()),
                        choices=list(CONFIGS.keys()),
                        help="Which configurations to run")
    parser.add_argument("--limit", type=int, default=0,
                        help="Limit to first N tasks (0 = all)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip tasks with existing predictions")
    parser.add_argument("--task", type=str, default=None,
                        help="Run a single task by instance_id")
    parser.add_argument("--budget", type=float, default=1.0,
                        help="Max USD budget per task (default: 1.0)")
    parser.add_argument("--timeout", type=int, default=300,
                        help="Timeout per task in seconds (default: 300)")
    args = parser.parse_args()

    # Load dataset
    print("Loading SWE-bench Lite dataset...")
    ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
    tasks = list(ds)

    if args.task:
        tasks = [t for t in tasks if t["instance_id"] == args.task]
        if not tasks:
            print(f"Task {args.task} not found")
            sys.exit(1)
    elif args.limit > 0:
        tasks = tasks[:args.limit]

    print(f"Tasks: {len(tasks)}")

    for config_name in args.configs:
        config = CONFIGS[config_name]
        print(f"\n{'='*60}")
        print(f"Config: {config['label']} ({config_name})")
        print(f"{'='*60}")
        run_config(config_name, config, tasks,
                   resume=args.resume)

    print(f"\nPredictions saved to {RESULTS_DIR}/")
    print("Next: run 'python evaluate.py' to score results")


if __name__ == "__main__":
    main()
