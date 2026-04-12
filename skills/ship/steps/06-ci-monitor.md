---
name: CI Monitor
order: 6
description: Monitor CI status, auto-fix failures, retry up to 3 rounds
---

## Monitor CI + Auto-fix (Pre-Merge)

<!-- telemetry step: ci-monitor -->

### Watch CI run

1. Get the current branch: `git branch --show-current`
2. Find the latest run: `gh run list --branch [branch] --limit 1 --json databaseId,status`
3. Watch in background: `gh run watch [run-id] --exit-status` (use `run_in_background: true`)
4. Continue with other work while CI runs. You'll be notified when it completes.
5. When notified:
   - Exit code 0 = success, proceed to Phase 2 (Merge Loop)
   - Non-zero = failure, proceed to "Handle CI result" below

### Handle CI result

**If conclusion is "success":** Continue to Phase 2 (Merge Loop).

**If conclusion is "failure", "timed_out", or "cancelled":**

1. Get failed logs: `gh run view [run-id] --log-failed`
2. Categorize failures: test failures, lint errors, build errors, security issues
3. Fix each issue using project-appropriate tools (check AGENTS.md for lint/fix commands)
4. Commit fixes with descriptive message
5. Push: `git push` (use `timeout: 600000`)
6. Return to polling (top of this step)

### Retry limit

**Max 3 CI fix attempts.** After 3 rounds: stop, report failures with full context, ask user whether to continue or investigate manually.
