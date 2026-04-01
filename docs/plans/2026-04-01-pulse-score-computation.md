# Plan: PM-101 — Pulse score computation and display

## Summary

Add `computePulseScore(pmDir)` to server.js and render the score as a large number with color badge on the dashboard home page, above the stat cards.

## Tasks

### Task 1: Add computePulseScore() function

New function in `scripts/server.js` (~50 lines), placed near the existing `stalenessInfo()`:

```js
function computePulseScore(pmDir) {
  const dimensions = [];
  
  // 1. Research freshness (0-25)
  // Scan pm/research/*/findings.md for updated: frontmatter
  // 25 if all fresh (< 30 days), deduct proportionally per stale topic
  
  // 2. Competitor freshness (0-25)
  // Scan pm/competitors/*/profile.md for updated: frontmatter
  // Same logic as research
  
  // 3. Backlog coverage (0-25)
  // Count items by status. 5 points per shipped item, max 25.
  // Penalty: -5 if ideas:shipped ratio > 3:1
  
  // 4. Strategy presence (0-25)
  // 25 if pm/strategy.md exists and updated within 60 days
  // 15 if exists but older. 0 if missing.
  
  const score = dimensions.reduce((sum, d) => sum + d.score, 0);
  return { score, dimensions };
}
```

Reuses existing `parseFrontmatter()` and date logic already in server.js.

### Task 2: Render score in handleDashboardHome()

In `handleDashboardHome()`, call `computePulseScore(pmDir)` and insert a score widget HTML block between the page header and the stat-grid:

```html
<div class="pulse-score">
  <div class="pulse-score-value" style="color: var(--success|--warning|--accent)">
    72
  </div>
  <div class="pulse-score-label">Project Health</div>
</div>
```

Empty KB shows "—" with setup message instead of 0.

### Task 3: Add CSS

Add pulse-score styles to the existing `<style>` block:
- `.pulse-score` — centered, margin below header
- `.pulse-score-value` — font-size: 3rem, font-weight: 700
- `.pulse-score-label` — small muted text below
- Color: --success for 80+, --warning for 50-79, reddish for <50

### Task 4: Test

- `node --test tests/server.test.js` — no regressions
- Add test: home page contains pulse-score class
- Add test: computePulseScore returns valid structure

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js` | Add computePulseScore(), render in handleDashboardHome(), add CSS |
| `tests/server.test.js` | Add pulse score tests |
