---
name: refresh
description: "Use when updating existing research to backfill gaps or refresh stale data. Audits pm/ files for staleness, patches without losing content."
---

# pm:refresh

## Purpose

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.

Refresh patches. Research creates. Don't confuse them.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

**Workflow:** `refresh` | **Telemetry steps:** `mode_routing`, `audit`, `execute`, `consolidation`, `summary`

## Iron Law

**NEVER ERASE USER AUTHORED RESEARCH.**

## When NOT to use

- For new research from scratch, use `pm:research`.
- For a manual edit to one known passage, use the owning document workflow.
- For a quick factual lookup with no artifact update, answer directly.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/refresh/steps/` in numeric filename order. If `.pm/workflows/refresh/` exists, same-named files there override defaults. Mode routing (Step 1) determines which subsequent steps run — `consolidate` mode skips Steps 2-3 and jumps directly to Step 4.

## Hard rules

- Never overwrite user-written research — refresh patches stale or incomplete sections in place. If you would replace or delete existing analysis wholesale, that's research, not refresh.
- Mixed-origin files have ownership boundaries: preserve internal evidence; never rewrite a `mixed`- or `internal`-origin file to be uniformly external.
- Run the audit (Step 2) before patching — it defines scope, freshness, and API cost. Skipping it burns budget and misses adjacent stale state.
- Before an SEO refresh, project the Ahrefs call count and confirm scope with the user when it's high. If no SEO provider is configured, skip SEO and report it — never improvise pseudo-refresh data.
- Every patch retains source provenance and access dates, records refreshed sections, and writes back only after staleness and origin ownership are verified.

## Red Flags — Self-Check

- **"Rewriting the section is cleaner than patching it."** Stop and preserve user-authored analysis and origin boundaries.
- **"This file is probably stale."** Check the canonical threshold and its actual update/access dates.
- **"The provider call is cheap enough."** Project cost and ask when the configured threshold requires confirmation.
- **"Internal evidence can be refreshed from the web."** Keep internal and mixed-origin ownership boundaries intact.
- **"A nearby stale section is harmless to include."** Keep the audit-defined scope unless the user expands it.

## References

The following reference files provide detailed guidance for specific refresh phases:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/mode-routing.md` | Mode selection table and domain discovery logic |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` | Threshold values, date handling, and section detection rules |
| `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` | Topic research origin rules (`external`, `internal`, `mixed`) |

## Escalation Paths

- **No existing research artifacts:** "There’s nothing durable to refresh yet. Want to run `/pm:research` instead and create the first artifact?"
- **Projected Ahrefs cost is too high:** "This refresh would make approximately {N} Ahrefs calls. Want to narrow scope, switch to interactive mode, or stop here?"
- **A file needs a full rewrite rather than a patch:** "This file is too structurally divergent for safe patching. Want me to stop and handle it as a manual rewrite, or leave it unchanged?"

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "Fresh external data can replace old internal context." | Origin describes ownership, not just age; internal evidence must be preserved. |
| "Refreshing everything is more efficient." | Unbounded provider calls waste budget and increase accidental overwrite risk. |

## Before Marking Done

- [ ] Canonical evidence artifacts are patched in place with provenance and refreshed timestamps; user-authored content remains intact.
- [ ] The user confirmed high-cost scope and any ambiguous origin or consolidation decision.
- [ ] Audit, staleness, origin, provider-cost, patch, writeback, and post-refresh validation gates passed.
