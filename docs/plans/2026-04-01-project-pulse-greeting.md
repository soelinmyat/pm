# Plan: PM-099 — Project pulse greeting on session start

## Summary

Extend `hooks/auto-launch.sh` to compute and print a 3-line project pulse after the dashboard URL. The pulse scans backlog/research frontmatter for staleness and counts.

## Tasks

### Task 1: Add pulse generation to auto-launch.sh

After printing the dashboard URL, compute and print 3 lines:

**Line 1 — Attention needed:**
- Scan `pm/research/*/findings.md` and `pm/competitors/*/profile.md` for `updated:` frontmatter older than 30 days → stale count
- Scan `pm/backlog/*.md` for `status: idea` with `updated:` older than 14 days → aging ideas count
- Format: `  {N} stale, {M} aging ideas` or `  All fresh`

**Line 2 — Backlog shape:**
- Count `pm/backlog/*.md` by `status:` field (idea, drafted, approved, in-progress, done)
- Format: `  Backlog: {X} ideas, {Y} in progress, {Z} shipped`

**Line 3 — Suggested next:**
- Priority logic (first match wins):
  1. No `pm/strategy.md` → `  Next: /pm:strategy`
  2. stale_count > 0 → `  Next: /pm:refresh ({N} stale items)`
  3. aging_ideas > 3 → `  Next: /pm:groom (promote oldest ideas)`
  4. in_progress > 0 → `  Next: /pm:dev (continue {title of oldest in-progress})`
  5. Default → `  Next: /pm:groom ideate`

Implementation approach: inline bash with `grep`/`sed` for flat YAML frontmatter parsing. No external dependencies.

### Task 2: Handle missing pm/ directory

If `pm/` doesn't exist (no knowledge base), print only:
```
  Next: /pm:setup or /pm:groom to get started
```

Skip lines 1 and 2.

### Task 3: Performance guard

If backlog has 100+ files, pulse scan could be slow. Add a fast path:
- Count files with `ls | wc -l` first
- If > 200 files, use cached pulse from `.pm/.pulse_cache` if fresher than newest file in `pm/`
- Otherwise scan normally (should be < 500ms for 100 files)

### Task 4: Test

- Run `node --test tests/server.test.js` (no regressions)
- Manual test: verify 3-line pulse appears after dashboard URL

## Files Changed

| File | Change |
|------|--------|
| `hooks/auto-launch.sh` | Add pulse generation logic (~60 lines) |

## Risks

- Bash YAML parsing is fragile — only works for flat `key: value` lines. PM's frontmatter is intentionally flat so this is safe.
- `date` portability — macOS `date` differs from GNU `date`. Use `$(date +%s)` for epoch comparisons and avoid `date -d`.
