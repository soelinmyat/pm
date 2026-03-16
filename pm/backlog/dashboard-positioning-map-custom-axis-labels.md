---
type: backlog-issue
id: "PM-024"
title: "Dashboard positioning map ignores custom axis labels"
outcome: "Dashboard positioning map renders custom axis labels from landscape.md instead of hardcoded defaults"
status: idea
priority: medium
labels:
  - bug
  - dashboard
research_refs: []
created: 2026-03-14
updated: 2026-03-14
---

# Dashboard positioning map ignores custom axis labels

## Description

The positioning map in the PM dashboard hardcodes axis labels instead of parsing them from the `<!-- positioning -->` header comment in `pm/landscape.md`.

## Expected Behavior

The header comment defines custom axis labels:
```
<!-- positioning: company, x (0-100, Kids-focused to General audience), y (0-100, Teaches coding syntax to Teaches AI interaction), traffic, segment-color -->
```

The dashboard should parse `Kids-focused` / `General audience` and `Teaches coding syntax` / `Teaches AI interaction` and render them as the axis labels.

## Actual Behavior

The dashboard always renders hardcoded defaults:
- X-axis: "Vertical-specific" → "Horizontal" (title: FEATURE SPECIFICITY)
- Y-axis: "SMB" → "Enterprise" (title: TARGET SEGMENT)

Custom labels are ignored.

## Impact

Forces users to position dots on axes that may not fit their market (e.g., kids education products appearing in "Enterprise" zone). Workaround: reposition dots to match the fixed axes instead of using conceptually appropriate axes.

## Steps to Reproduce

1. Write a `pm/landscape.md` with custom axis labels in the positioning header comment
2. Run `/pm:view` and open the dashboard
3. Observe that the positioning map shows hardcoded axis labels instead of custom ones

## Likely Fix Location

`scripts/server.js` or `scripts/frame-template.html` — wherever the positioning map chart is rendered. Parse the axis labels from the first `<!-- positioning: ... -->` comment instead of hardcoding them.
