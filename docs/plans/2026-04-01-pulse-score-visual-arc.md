# Plan: PM-102 — Pulse score visual arc and breakdown

## Summary

Wrap PM-101's score number in an SVG arc ring and add a clickable breakdown panel showing dimension details.

## Tasks

### Task 1: SVG arc ring

Replace the plain number with an SVG circle:
- Background ring: stroke with `--border` color
- Foreground arc: stroke-dasharray/dashoffset for proportional fill
- Score number centered inside the SVG
- Color matches tier (green/yellow/red)
- 120px diameter desktop, 80px mobile

### Task 2: Arc animation

- On page load, animate from 0 to actual score over 600ms ease-out
- Use CSS `@keyframes` with `stroke-dashoffset` transition
- `prefers-reduced-motion`: skip animation, show final state

### Task 3: Breakdown panel

- Click score toggles a breakdown panel below
- 4 dimension cards in a horizontal row (stacks on mobile)
- Each card: name, score/max, mini progress bar, detail text
- Slide-down/up animation (200ms)
- State persisted to localStorage `pm-pulse-expanded`

### Task 4: Test

- `node --test tests/server.test.js` — no regressions
- Add test: home page contains SVG arc markup
- Add test: breakdown panel markup present

## Files Changed

| File | Change |
|------|--------|
| `scripts/server.js` | Update pulse score HTML template with SVG + breakdown |
| `tests/server.test.js` | Add arc and breakdown tests |
