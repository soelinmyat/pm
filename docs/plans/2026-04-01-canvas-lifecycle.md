# Plan: PM-105 — Canvas lifecycle states

## Summary

Add `.state` file to canvas directories, render state indicators on tabs, emit `canvas_state` SSE events.

## Tasks

### Task 1: Read .state file in discoverCanvases()

Extend `discoverCanvases()` to read `.state` file from each canvas directory. Values: `active`, `idle`, `completed`. Default: `active` if missing.

### Task 2: State indicator dots on canvas tabs

Update canvas tab HTML to include a state dot:
- Active: green pulsing dot (reuse `.activity-status.live` animation)
- Idle: yellow static dot
- Completed: gray checkmark

### Task 3: `canvas_state` SSE event type

New event: `{ type: "canvas_state", slug: "groom-my-feature", state: "idle" }`.
Client listener updates the tab indicator dot without page reload.

### Task 4: Separate completed canvases

On the home page, completed canvases render in a "Recent" section below active tabs after 5 minutes since completion.

### Task 5: Tests

- Test: canvas tab shows state dot
- Test: completed canvases appear in recent section

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js` | discoverCanvases .state read, tab indicator CSS/HTML, canvas_state SSE handling |
| `tests/server.test.js` | Lifecycle state tests |
