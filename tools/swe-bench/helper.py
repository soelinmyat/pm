#!/usr/bin/env python3
"""Helper for the orchestrator loop."""
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent
REPOS = BASE / "repos"
RESULTS = BASE / "results" / "pm" / "predictions.jsonl"

def get_next_task():
    """Print the next unprocessed task as JSON."""
    done = set()
    if RESULTS.exists():
        with open(RESULTS) as f:
            for line in f:
                done.add(json.loads(line)["instance_id"])

    with open(BASE / "tasks.json") as f:
        tasks = json.load(f)

    remaining = [t for t in tasks if t["instance_id"] not in done]
    idx = len(done)
    print(json.dumps({"done": len(done), "remaining": len(remaining), "total": len(tasks)}))
    if remaining:
        t = remaining[0]
        print("---TASK---")
        print(json.dumps(t))

def checkout(instance_id_ignored=None):
    """Read next task, clone if needed, checkout base commit. Print task info."""
    done = set()
    if RESULTS.exists():
        with open(RESULTS) as f:
            for line in f:
                done.add(json.loads(line)["instance_id"])

    with open(BASE / "tasks.json") as f:
        tasks = json.load(f)

    remaining = [t for t in tasks if t["instance_id"] not in done]
    if not remaining:
        print("ALL_DONE")
        return

    t = remaining[0]
    repo = t["repo"]
    base_commit = t["base_commit"]
    repo_slug = repo.replace("/", "__")
    repo_path = REPOS / repo_slug

    REPOS.mkdir(parents=True, exist_ok=True)

    if not repo_path.exists():
        print(f"CLONING {repo}...")
        subprocess.run(
            ["git", "clone", "--quiet", f"https://github.com/{repo}.git", str(repo_path)],
            check=True, capture_output=True,
        )

    subprocess.run(
        ["git", "checkout", "--force", "--quiet", base_commit],
        cwd=repo_path, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "clean", "-fdx", "--quiet"],
        cwd=repo_path, check=True, capture_output=True,
    )

    print(f"READY {t['instance_id']} {repo_path}")
    print(f"REPO_PATH {repo_path}")
    print(f"DONE_COUNT {len(done)}")
    print(f"REMAINING {len(remaining)}")
    print("---PROBLEM---")
    print(t["problem_statement"])

def record():
    """Capture diff from the current task's repo and record it."""
    done_ids = []
    if RESULTS.exists():
        with open(RESULTS) as f:
            for line in f:
                done_ids.append(json.loads(line)["instance_id"])
    done = set(done_ids)

    with open(BASE / "tasks.json") as f:
        tasks = json.load(f)

    remaining = [t for t in tasks if t["instance_id"] not in done]
    t = remaining[0]
    repo_slug = t["repo"].replace("/", "__")
    repo_path = REPOS / repo_slug

    # Capture diff
    result = subprocess.run(
        ["git", "diff", "HEAD"], cwd=repo_path, capture_output=True, text=True,
    )
    patch = result.stdout.strip()

    # Record
    pred = {
        "instance_id": t["instance_id"],
        "model_name_or_path": "pm",
        "model_patch": patch,
    }
    with open(RESULTS, "a") as f:
        f.write(json.dumps(pred) + "\n")

    # Reset repo
    subprocess.run(
        ["git", "checkout", "--force", "--quiet", t["base_commit"]],
        cwd=repo_path, check=True, capture_output=True,
    )
    subprocess.run(
        ["git", "clean", "-fdx", "--quiet"],
        cwd=repo_path, check=True, capture_output=True,
    )

    n_done = len(done) + 1
    print(f"RECORDED {t['instance_id']} patch={len(patch)}bytes [{n_done}/300]")

    if n_done % 10 == 0:
        # Count non-empty patches
        patches = 0
        with open(RESULTS) as f:
            for line in f:
                if json.loads(line)["model_patch"]:
                    patches += 1
        print(f"PROGRESS [{n_done}/300] done, {patches} patches generated")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "next"
    if cmd == "next":
        get_next_task()
    elif cmd == "checkout":
        checkout()
    elif cmd == "record":
        record()
