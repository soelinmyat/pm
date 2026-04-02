#!/usr/bin/env python3
"""
Compare two SWE-bench eval result YAML files and print a trend report.

Usage:
  python compare.py results/pm-dev/2026-03-15-v1.0.20.yml results/pm-dev/2026-04-02-v1.0.23.yml
  python compare.py --paired results/vanilla/2026-04-02.yml results/pm-dev/2026-04-02-v1.0.23.yml
"""

import argparse
import sys
from pathlib import Path

import yaml


def load_result(path: str) -> dict:
    """Load a YAML result file."""
    with open(path) as f:
        return yaml.safe_load(f)


def trend_report(old: dict, new: dict):
    """Print a trend comparison between two runs of the same config."""
    old_agg = old["aggregates"]
    new_agg = new["aggregates"]

    print(f"=== Trend Report ===")
    print(f"Old: {old['run_id']} ({old['date']})")
    print(f"New: {new['run_id']} ({new['date']})")
    print()

    metrics = [
        ("Resolve rate", "resolve_rate", lambda v: f"{v:.1%}", True),
        ("Patches generated", "patches_generated", lambda v: str(v), True),
        ("Patches valid", "patches_valid", lambda v: str(v), True),
        ("Avg time/task (s)", "avg_seconds_per_task", lambda v: f"{v:.0f}", False),
        ("Errors", "errors", lambda v: str(v), False),
    ]

    print(f"{'Metric':<25} {'Old':>10} {'New':>10} {'Delta':>10} {'':>5}")
    print("-" * 65)

    regression = False
    for label, key, fmt, higher_is_better in metrics:
        old_val = old_agg.get(key, 0)
        new_val = new_agg.get(key, 0)
        if isinstance(old_val, float) and "rate" in key:
            delta_str = f"{(new_val - old_val):+.1%}"
        else:
            delta_str = f"{new_val - old_val:+}"

        # Direction indicator
        if new_val > old_val:
            direction = "+" if higher_is_better else "!"
        elif new_val < old_val:
            direction = "!" if higher_is_better else "+"
        else:
            direction = "="

        print(f"{label:<25} {fmt(old_val):>10} {fmt(new_val):>10} {delta_str:>10} {direction:>5}")

        # Check for significant regression in resolve rate
        if key == "resolve_rate" and (old_val - new_val) > 0.05:
            regression = True

    if regression:
        print()
        print("WARNING: Resolve rate dropped >5% — investigate before shipping!")

    # Per-task diff: what changed?
    old_tasks = {t["instance_id"]: t for t in old.get("per_task", [])}
    new_tasks = {t["instance_id"]: t for t in new.get("per_task", [])}

    gained = []
    lost = []
    for tid in set(old_tasks) | set(new_tasks):
        old_resolved = old_tasks.get(tid, {}).get("resolved", False)
        new_resolved = new_tasks.get(tid, {}).get("resolved", False)
        if new_resolved and not old_resolved:
            gained.append(tid)
        elif old_resolved and not new_resolved:
            lost.append(tid)

    if gained:
        print(f"\nNewly resolved ({len(gained)}):")
        for tid in sorted(gained):
            print(f"  + {tid}")

    if lost:
        print(f"\nRegressed ({len(lost)}):")
        for tid in sorted(lost):
            print(f"  - {tid}")

    if not gained and not lost:
        print("\nNo per-task changes.")


def paired_report(vanilla: dict, pm_dev: dict):
    """Print a paired comparison between vanilla and pm-dev from the same run."""
    v_agg = vanilla["aggregates"]
    p_agg = pm_dev["aggregates"]

    print(f"=== Skill Delta ===")
    print(f"vanilla: {v_agg['resolved']}/{v_agg['total']} ({v_agg['resolve_rate']:.1%})")
    print(f"pm-dev:  {p_agg['resolved']}/{p_agg['total']} ({p_agg['resolve_rate']:.1%})")

    delta = p_agg["resolved"] - v_agg["resolved"]
    delta_pct = p_agg["resolve_rate"] - v_agg["resolve_rate"]
    print(f"Delta:   {delta:+d} tasks ({delta_pct:+.1%})")

    # Per-task diff
    v_tasks = {t["instance_id"]: t for t in vanilla.get("per_task", [])}
    p_tasks = {t["instance_id"]: t for t in pm_dev.get("per_task", [])}

    pm_only = []
    vanilla_only = []
    for tid in set(v_tasks) | set(p_tasks):
        v_resolved = v_tasks.get(tid, {}).get("resolved", False)
        p_resolved = p_tasks.get(tid, {}).get("resolved", False)
        if p_resolved and not v_resolved:
            pm_only.append(tid)
        elif v_resolved and not p_resolved:
            vanilla_only.append(tid)

    if pm_only:
        print(f"\nTasks pm-dev solved that vanilla didn't ({len(pm_only)}):")
        for tid in sorted(pm_only):
            print(f"  + {tid}")

    if vanilla_only:
        print(f"\nTasks vanilla solved that pm-dev didn't ({len(vanilla_only)}):")
        for tid in sorted(vanilla_only):
            print(f"  - {tid}")

    if not pm_only and not vanilla_only:
        print("\nBoth configs resolved the same tasks.")


def main():
    parser = argparse.ArgumentParser(description="Compare SWE-bench eval results")
    parser.add_argument("file1", help="First result YAML (older or vanilla)")
    parser.add_argument("file2", help="Second result YAML (newer or pm-dev)")
    parser.add_argument("--paired", action="store_true",
                        help="Paired comparison (vanilla vs pm-dev) instead of trend")
    args = parser.parse_args()

    r1 = load_result(args.file1)
    r2 = load_result(args.file2)

    if args.paired:
        paired_report(r1, r2)
    else:
        trend_report(r1, r2)


if __name__ == "__main__":
    main()
