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

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER OVERWRITE USER-WRITTEN RESEARCH DURING REFRESH.** Refresh patches stale or incomplete sections in place. If you are about to replace or delete existing analysis wholesale, you are doing research, not refresh.

**Workflow:** `refresh` | **Telemetry steps:** `audit`, `cost-guardrail`, `seo-refresh`, `landscape-refresh`, `topic-refresh`, `competitor-refresh`, `synthesis-updates`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/refresh/steps/` in numeric filename order. If `.pm/workflows/refresh/` exists, same-named files there override defaults. Execute each step in order. Mode routing (Step 1) determines which subsequent steps run — `consolidate` mode skips Steps 2-3 and jumps directly to Step 4.

## References

The following reference files provide detailed guidance for specific refresh phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/mode-routing.md` | Mode selection table and domain discovery logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` | Threshold values, date handling, and section detection rules |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` | Topic research origin rules (`external`, `internal`, `mixed`) |

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"It would be faster to rewrite the whole file."** Faster is not safer. Refresh preserves user-authored content and only patches what is stale or missing.
- **"The audit is optional because the target file is obvious."** The audit is what defines scope, freshness, and API cost. Skipping it burns budget and misses adjacent stale state.
- **"If the origin is mixed, I can just rewrite everything consistently."** Mixed-origin files have ownership boundaries. Internal evidence must be preserved.
- **"I can refresh SEO even if the provider is off."** No configured provider means skip SEO and report it. Don’t improvise pseudo-refresh data.

## Escalation Paths

- **No existing research artifacts:** "There’s nothing durable to refresh yet. Want to run `/pm:research` instead and create the first artifact?"
- **Projected Ahrefs cost is too high:** "This refresh would make approximately {N} Ahrefs calls. Want to narrow scope, switch to interactive mode, or stop here?"
- **A file needs a full rewrite rather than a patch:** "This file is too structurally divergent for safe patching. Want me to stop and handle it as a manual rewrite, or leave it unchanged?"

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
