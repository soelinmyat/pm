---
name: Mode Routing
order: 1
description: Select refresh mode and discover domains based on arguments
---

## Mode Routing

**Goal:** Determine the refresh scope (full audit, scoped audit, or consolidation-only) based on the user's argument and available domains.

**How:** Read `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/mode-routing.md` for the full routing table, domain discovery rules, and scope definitions.

Route to the appropriate phase based on the argument:

- No argument -> Full audit (Step 2: Audit all in-scope files)
- `seo` -> Scoped audit: SEO files only
- `landscape` -> Scoped audit: landscape file only
- `topics` -> Scoped audit: all topic research files
- `consolidate` -> Skip Steps 2-3, jump directly to Step 4 (Consolidation)
- `{domain}` -> Scoped audit: all refreshable files within the discovered domain
- `{domain}/{slug}` -> Scoped audit: one discovered insight file or competitor folder
- `{slug}` -> Backward-compatible shorthand for `competitors/{slug}` when that competitor exists

All paths hit the cost guardrail before executing.

### Domain Discovery

Discover available insight domains by scanning `{pm_dir}/insights/*/index.md`. Treat every matching directory name as a valid domain. Do not hardcode the domain list.

If the argument does not resolve to a known mode or domain, show the discovered domains and any valid competitor slugs.

**Done-when:** The refresh scope is resolved to a concrete set of in-scope files or a consolidation-only path. The agent knows which step to enter next.

**Advance:** if consolidation-only, skip to Step 4 (Consolidation); otherwise proceed to Step 2 (Audit).
