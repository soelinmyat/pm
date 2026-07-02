---
name: simplify
description: "Deprecated — absorbed into pm:review in v1.9. Invoking this runs the review fan-out, whose reuse/quality/efficiency lenses replace the old simplify gate."
---

# pm:simplify (deprecated)

`pm:simplify` was absorbed into `pm:review` in v1.9. Read `${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md` and follow it exactly — its 6-lens fan-out (bugs, design, input edge-cases, reuse, quality, efficiency) includes everything this gate used to do. Write the `review` gate row, not a `simplify` row.
