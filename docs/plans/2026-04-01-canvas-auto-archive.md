# Plan: PM-107 — Canvas auto-archive cleanup

## Summary

On server start, clean up canvas directories that have been completed for >24 hours.

## Tasks

### Task 1: Add cleanup function

New function `archiveCompletedCanvases(pmDir)`:
1. Scan `.pm/sessions/` for directories with `.state === 'completed'`
2. Check `.state` file mtime — if older than 24 hours, delete the directory
3. Protect directories referenced by active groom/dev state files
4. Emit `canvas_archived` SSE event for each archived canvas

### Task 2: Call on server start

Call `archiveCompletedCanvases()` once during dashboard server initialization.

### Task 3: Test

- Test: completed canvas older than 24h is cleaned up
- Test: completed canvas referenced by active state file is NOT cleaned up

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js` | archiveCompletedCanvases(), call on server init |
| `tests/server.test.js` | Archive cleanup tests |
