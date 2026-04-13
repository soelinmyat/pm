---
name: Audit
order: 2
description: Scan in-scope files for staleness and missing sections, present audit report with cost estimate
---

## Phase 1: Audit

**Goal:** Identify exactly which in-scope artifacts are stale, incomplete, missing, or fresh, and estimate the refresh cost before any patching starts.

Read `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/staleness-thresholds.md` for threshold values, frontmatter date handling, and section detection rules.

Read `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` for topic research origin handling.

### Load Hot Index (pre-step)

Before scanning individual files, load the hot index for a quick overview of insight health.

```bash
# Check for hot index
if [ -f "{pm_dir}/insights/.hot.md" ]; then
  node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"
fi
```

- If `{pm_dir}/insights/.hot.md` exists, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"` and parse the output table. Use the hot index to display an insight health overview at the top of the audit report — confidence levels, source counts, and last updated dates across all insight domains. This gives a fast summary before the detailed per-file staleness check. Log: "Hot index loaded ({N} insights)".
- If `{pm_dir}/insights/.hot.md` does not exist, fall back to scanning individual insight files directly (current behavior). Log: "Hot index not found, falling back to direct file scan".
- The hot index overview does not replace the detailed per-file staleness check below — it supplements it with a quick insight-level summary.

### Missing File Detection

Before checking staleness, verify that each competitor directory has all 5 expected files:

For each directory under `{pm_dir}/evidence/competitors/*/`:
- Check for: `profile.md`, `features.md`, `api.md`, `seo.md`, `sentiment.md`
- Classify missing files as **[Missing]** (distinct from Incomplete or Stale)
- Include missing files in the audit report with: `[Missing] {slug}/{file} — never created`

Missing files should be created during Phase 2 execution using the same methodology as initial profiling (`skills/research/references/competitor-profiling.md`). They take priority over stale file refreshes.

### Staleness Check

Scan all in-scope `{pm_dir}/` files with frontmatter. For each file:

1. Read the file age using the date priority rules from the staleness-thresholds reference.
2. Compare against the staleness threshold for that file type.
3. For files with fixed expected sections: compare existing h2 headings against the expected list. Detect missing sections.
4. Classify each file:
   - **Fresh** — within threshold, all expected sections present.
   - **Incomplete** — within threshold, but missing expected sections.
   - **Stale** — past threshold.

### Audit Report

Present grouped by type. Show all files, visually distinguish status:

```
## Research Audit

### SEO (threshold: 30 days)
  [Incomplete] fareharbor/seo.md — missing: Traffic by Country, Organic Competitors
  [Incomplete] rezdy/seo.md — missing: Traffic by Country, Organic Competitors
  ...

### Landscape (threshold: 90 days)
  [Fresh] landscape.md

### Profiles (threshold: 60 days)
  [Fresh] All profiles up to date.

### Features (threshold: 90 days)
  [Fresh] All feature files up to date.

### API (threshold: 90 days)
  [Fresh] All API files up to date.

### Sentiment (threshold: 60 days)
  [Fresh] All sentiment files up to date.

### Topic Research (threshold: 90 days)
  No topic research files found.

### Synthesis Files
  [Stale if any competitor updated] competitors/index.md
  [Stale if any business insight updated] business/index.md
  [Stale if any research topic updated] evidence/index.md

Estimated API calls: ~{N} Ahrefs calls + ~{W} web search rounds
Proceed with all non-fresh items? Or select specific items?
```

For **scoped mode**, show only relevant files with status and estimated calls.

### Cost Estimation

| Action | Cost |
|---|---|
| Incomplete seo.md — per missing section | 1 Ahrefs call per section |
| Stale seo.md — full re-fetch | 6 Ahrefs calls + 1 web search round |
| Landscape keyword refresh | 3 Ahrefs calls (matching-terms, volume-by-country, overview) |
| Topic research demand check | 2 Ahrefs calls (keywords-explorer-overview, serp-overview) |
| Profile/features/API/sentiment refresh | Web search rounds (no Ahrefs calls) |

### Cost Guardrail

Before executing, show:

```
This will make approximately {N} Ahrefs API calls across {M} files.
Additionally: ~{W} web search rounds for {P} non-SEO files.
Mode: interactive / auto-accept
Proceed?
```

Only continue after explicit confirmation.

**Done-when:** The audit report has classified all in-scope artifacts, estimated API/search cost, and either received explicit user confirmation to proceed or stopped before execution.
