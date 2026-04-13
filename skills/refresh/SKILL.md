---
name: refresh
description: "Use when updating existing research to backfill gaps or refresh stale data. Audits pm/ files for staleness, patches without losing content."
---

# pm:refresh

## Purpose

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.

Refresh patches. Research creates. Don't confuse them.

**When NOT to use:** Creating new research from scratch (use research). Manual edits to a specific file. Quick factual lookups that don't need artifact updates.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

**Workflow:** `refresh` | **Telemetry steps:** `audit`, `cost-guardrail`, `seo-refresh`, `landscape-refresh`, `topic-refresh`, `competitor-refresh`, `synthesis-updates`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/refresh/steps/` in numeric filename order. If `.pm/workflows/refresh/` exists, same-named files there override defaults. Execute each step in order. Mode routing (Step 1) determines which subsequent steps run — `consolidate` mode skips Steps 2-3 and jumps directly to Step 4.

## References

The following reference files provide detailed guidance for specific refresh phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/mode-routing.md` | Mode selection table and domain discovery logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` | Threshold values, date handling, and section detection rules |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` | Topic research origin rules (`external`, `internal`, `mixed`) |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Research looks fine, skip the audit" | "Looks fine" means you read the conclusions, not the dates. Staleness hides in source timestamps. |
| "I'll just re-run the whole research" | Full re-run overwrites user edits and burns API budget. Refresh patches gaps surgically. |
| "Only one file is outdated" | Stale files reference other stale files. Refresh catches cascading staleness. |

## Before Marking Done

- [ ] All stale sections identified with dates
- [ ] Updated sections have fresh source URLs and access dates
- [ ] User-written content preserved (not overwritten)
- [ ] Synthesis sections updated to reflect new data

