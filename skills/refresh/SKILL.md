---
name: pm-refresh
description: "Use when updating existing research to backfill gaps from newly added tools or refresh stale data. Audits pm/ files for staleness and missing sections, patches without losing existing content. Triggers on 'refresh,' 'update research,' 'what's stale,' 'backfill.'"
---

# pm:refresh

## Purpose

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:refresh`:
- run start / run end
- one step span for `audit`
- one step span for `cost-guardrail`
- one step span per executed refresh batch (`seo-refresh`, `landscape-refresh`, `topic-refresh`, `competitor-refresh`)
- one step span for synthesis updates

---

## Mode Routing

| Argument | Mode |
|---|---|
| _(no arg)_ | Full audit — scan everything, present report, user picks |
| `seo` | Scoped: SEO files only (all `*/seo.md` + landscape keyword sections) |
| `landscape` | Scoped: `pm/landscape.md` only |
| `topics` | Scoped: all `pm/research/*/findings.md` |
| `{slug}` | Scoped: all 5 files for one competitor |

All paths hit the cost guardrail before executing.

**Slug validation:** If the argument does not match `seo`, `landscape`, `topics`, or a directory under `pm/competitors/`, show: "No competitor found with slug '{slug}'. Available: {list of existing slugs}."

### Scope

**In scope:**
- `pm/landscape.md`
- `pm/competitors/{slug}/profile.md|features.md|api.md|seo.md|sentiment.md`
- `pm/competitors/index.md` and `pm/competitors/matrix.md` (synthesis — regenerated after individual profiles refresh)
- `pm/research/{topic}/findings.md` — **origin-aware** (see Topic Research Rules below)

**Out of scope:**
- `pm/strategy.md` — created via interactive interview. Use `$pm-strategy` to update.

### Topic Research Origin Rules

Topic research files use a `source_origin` frontmatter field that determines ownership. Refresh must respect this:

| `source_origin` | Refresh behavior |
|---|---|
| `external` | Refresh normally — re-run web searches and SEO demand checks. |
| `internal` | **Skip entirely.** Internal evidence is owned by `$pm-ingest`. Do not re-run web searches or modify any content. Show in audit as: "[Internal — skipped, owned by $pm-ingest]". |
| `mixed` | **Refresh external sections only.** Re-run web searches and SEO demand checks for `[external]`-prefixed findings, Summary, Strategic Relevance, and Implications. **Never modify** Representative Quotes, internal evidence entries, or `[internal]`-prefixed findings. When rewriting shared sections (Summary, Strategic Relevance, Implications), incorporate both internal and external evidence. |

**Mixed-topic frontmatter protection:** For `mixed` topics, the following frontmatter fields are owned by `$pm-ingest` and must never be modified by refresh:
- `source_origin` (must remain `mixed`)
- `evidence_count`
- `segments`
- `confidence`
- Internal entries in the `sources` array (sources without a `url` or with local-path references)

Refresh may only add or update: `refreshed:`, external `sources` entries (with URLs), and external-origin metadata it generates.

If `source_origin` is absent, treat as `external`.

---

## Staleness Thresholds

| Data Type | File Pattern | Threshold |
|---|---|---|
| SEO | `*/seo.md` | 30 days |
| Profiles | `*/profile.md` | 60 days |
| Sentiment | `*/sentiment.md` | 60 days |
| Landscape | `landscape.md` | 90 days |
| Features | `*/features.md` | 90 days |
| API | `*/api.md` | 90 days |
| Topic research | `research/*/findings.md` | 90 days |

Defaults are hardcoded. Override in `.pm/config.json` under `refresh.thresholds`:

```json
{
  "refresh": {
    "thresholds": { "seo": 30, "profile": 60, "sentiment": 60, "landscape": 90, "features": 90, "api": 90, "topic": 90 }
  }
}
```

If `.pm/config.json` does not exist, use hardcoded defaults and treat SEO provider as `"none"`.

---

## Frontmatter Date Handling

### Read priority

When determining file age, read the most recent date from this priority order:
1. `refreshed:` (set by this skill on previous runs)
2. `updated:` (set by research/ingest skills on updates)
3. `profiled:` (set by research skill on initial creation — competitor files)
4. `created:` (set by research skill on initial creation — landscape, topic files)

Use the **most recent** date found across these keys.

### Write rule

After patching a file:
- Add or update `refreshed: YYYY-MM-DD` in frontmatter.
- **Never modify** the original `profiled:` or `created:` date.
- If `updated:` exists, leave it as-is.

If the file has no recognizable date key, treat it as stale.

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `pm/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `pm/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `pm/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Phase 1: Audit

### Missing File Detection

Before checking staleness, verify that each competitor directory has all 5 expected files:

For each directory under `pm/competitors/*/`:
- Check for: `profile.md`, `features.md`, `api.md`, `seo.md`, `sentiment.md`
- Classify missing files as **[Missing]** (distinct from Incomplete or Stale)
- Include missing files in the audit report with: `[Missing] {slug}/{file} — never created`

Missing files should be created during Phase 2 execution using the same methodology as initial profiling (`skills/research/competitor-profiling.md`). They take priority over stale file refreshes.

### Staleness Check

Scan all in-scope `pm/` files with frontmatter. For each file:

1. Read the file age using the date priority rules above.
2. Compare against the staleness threshold for that file type.
3. For files with fixed expected sections: compare existing h2 headings against the expected list. Detect missing sections.
4. Classify each file:
   - **Fresh** — within threshold, all expected sections present.
   - **Incomplete** — within threshold, but missing expected sections.
   - **Stale** — past threshold.

### Section Detection Rules

| File Type | Detection Strategy | Expected Sections |
|---|---|---|
| seo.md | Fixed h2 headings | Traffic Overview, Top Organic Keywords, Top Pages by Traffic, Backlink Profile, Traffic by Country, Organic Competitors, Content Strategy Signals |
| profile.md | Fixed h2 headings | Overview, Positioning, Pricing, Strengths, Weaknesses, Notable Signals |
| api.md | Fixed h2 headings | API Availability, Auth Model, Core Entity Model, Endpoint Coverage, Webhooks, Rate Limits, SDKs and Integrations, Architectural Signals |
| sentiment.md | Fixed h2 headings | Overall Sentiment, Top Praise Themes, Top Complaint Themes, High-Severity Signals, Support Quality Signals, Churn Signals, Feature Requests (recurring), Reddit / Community Signals, Analyst Notes |
| features.md | **Age only** | Domain sections vary per competitor. Only check fixed sections: Recent Changelog Highlights, Capability Gaps |
| landscape.md | Fixed h2 headings | Market Overview, Key Players, Keyword Landscape, Market Segments, Initial Observations |
| topic findings.md | Fixed h2 headings | Summary, Findings, Representative Quotes (conditional — only if internal evidence exists), Strategic Relevance, Implications, Open Questions, Source References |

For SEO, map Ahrefs tools to expected sections:

| Ahrefs Tool | Expected Section |
|---|---|
| site-explorer-metrics | Traffic Overview |
| site-explorer-organic-keywords | Top Organic Keywords |
| site-explorer-top-pages | Top Pages by Traffic |
| site-explorer-metrics-by-country | Traffic by Country |
| site-explorer-backlinks-stats | Backlink Profile |
| site-explorer-organic-competitors | Organic Competitors |

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
  [Stale if any competitor updated] competitors/matrix.md

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

---

## Phase 2: Execute

### Dashboard Schema Reference

Before patching any file, read the relevant template schema doc so updated content matches what the dashboard expects:

- Backlog issues: `Read ${CLAUDE_PLUGIN_ROOT}/references/templates/detail.md` and `Read ${CLAUDE_PLUGIN_ROOT}/references/templates/kanban.md`
- Landscape: `Read ${CLAUDE_PLUGIN_ROOT}/references/templates/detail-toc.md`
- Research topics: `Read ${CLAUDE_PLUGIN_ROOT}/references/templates/detail-toc.md`
- Competitor files: `Read ${CLAUDE_PLUGIN_ROOT}/references/templates/detail-tabs.md`

Read only the schemas relevant to the files being refreshed in this run.

### Trust Levels

Before execution, ask the user to choose a mode:

- **Interactive** (default): Show a diff for each section being updated. User approves or rejects each change individually.
- **Auto-accept**: Apply all patches, show a summary at the end of what changed.

### Patch Rules (never rewrite)

All updates are patches. Existing content is never deleted or overwritten without approval.

**Incomplete files (missing sections):**
- Run only the data collection for the missing sections.
- Insert new sections in their canonical position relative to existing sections. Find the nearest existing section that comes after the insertion point in the methodology template and insert before it. If no later section exists, append before any user-added custom sections or at the end of the file.
- Do not modify any existing sections.
- Add/update `refreshed:` date in frontmatter.

**Stale files (past threshold):**
- Re-run data collection for existing methodology-defined sections.
- Diff new data against current content.
- In **interactive mode**: present each section's changes for approval.

  Example:
  ```
  fareharbor/seo.md — Stale (42 days)

    Traffic Overview:
      Organic traffic: 26,710 → 28,450 (+6.5%)
      Domain Rating: 91.0 → 91.0 (unchanged)
      Accept update? [y/n]

    Top Organic Keywords:
      3 new keywords found, 1 position change
      Accept update? [y/n]
  ```

- In **auto-accept mode**: apply all changes, log them for the summary.
- User-written analysis paragraphs (non-tabular content under a section) are never modified unless the user explicitly approves in interactive mode.
- Add/update `refreshed:` date in frontmatter.

**Fresh files:**
- Skip unless user explicitly selects them.

### SEO Provider Handling

Read `.pm/config.json` for the `seo.provider` value.

- If `"ahrefs-mcp"`: use Ahrefs MCP tools directly. Call `mcp__ahrefs__doc` for tool schema before first use.
- If `"none"`: skip all SEO refresh. Note in audit: "SEO refresh unavailable (no provider configured)."

### Execution Strategy

**SEO files:** Use Ahrefs MCP tools per the tool-to-section mapping above.

**Landscape keyword data:** Use keywords-explorer tools per `skills/research/SKILL.md` Landscape Mode methodology.

**Profiles, features, API:** Re-run web searches per `skills/research/competitor-profiling.md`.

**Sentiment:** Re-run review mining per `skills/research/review-mining.md`.

**Topic research:** Check `source_origin` in frontmatter and follow the Topic Research Origin Rules above.
- `external`: re-run web searches. If ahrefs-mcp configured, re-run demand check (keywords-explorer-overview, serp-overview).
- `internal`: skip entirely.
- `mixed`: re-run web searches and demand checks for external evidence only. Preserve all internal evidence, Representative Quotes, and `[internal]`-prefixed findings. Rewrite shared sections (Summary, Strategic Relevance, Implications) to reflect both internal and external evidence.

### Parallel Execution

When refreshing multiple competitors, dispatch one refresh agent per competitor:

```
Agent tool: name="refresh-{slug}",
prompt="Refresh {Company Name} in the {space} space.
Slug: {slug}.
Trust level: {interactive|auto-accept}.
Files to update: {list of files with their status: stale or incomplete with missing sections}.

RULES:
- Read each file before modifying.
- For INCOMPLETE files: add only the missing sections listed. Do not modify existing content.
- For STALE files: re-run data collection for existing sections. {If interactive: present diffs to user for approval before writing. If auto-accept: apply changes and report what changed.}
- Add 'refreshed: {today}' to frontmatter. Never modify 'profiled:' or 'created:'.
- Preserve all user-added custom sections (sections not in the methodology template).
- Write only to pm/competitors/{slug}/. Do NOT touch index.md or matrix.md.
- Follow methodology in skills/research/competitor-profiling.md for section content.
- If an Ahrefs call fails, log the error and continue."
```

Parent skill handles: audit report, trust level selection, synthesis files, and the final summary.

### Synthesis File Refresh

After individual competitor files are refreshed, regenerate synthesis files:

1. **`pm/competitors/index.md`** — re-read all competitor profiles, update links, last-profiled/refreshed dates.
2. **`pm/competitors/matrix.md`** — re-read all features.md files, rebuild the comparison table.
3. Update the **Market Gaps** section in index.md based on refreshed capability data.

Only run this step if at least one competitor file was updated during the refresh.

### Cost Guardrail

Before executing, show:

```
This will make approximately {N} Ahrefs API calls across {M} files.
Additionally: ~{W} web search rounds for {P} non-SEO files.
Mode: interactive / auto-accept
Proceed?
```

Only continue after explicit confirmation.

---

### Post-write Validation

After updating any `pm/` artifacts, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
```

If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

---

## Phase 3: Summary

After execution, show what changed:

```
## Refresh Complete

### Updated ({N} files)
  fareharbor/seo.md — added: Traffic by Country, Organic Competitors
  rezdy/seo.md — added: Traffic by Country, Organic Competitors
  ...

### Synthesis ({N} files)
  competitors/index.md — updated refreshed dates
  competitors/matrix.md — rebuilt feature comparison

### Unchanged ({N} files)
  landscape.md — all sections present and fresh

### Skipped ({N} files)
  All profile, features, API, and sentiment files — fresh.
```

---

## Edge Cases

1. **No `pm/` directory exists:** Error: "No research found. Run `$pm-research landscape` first."
2. **File has no frontmatter date:** Treat as stale (unknown age = should refresh).
3. **SEO provider is `"none"`:** Skip all SEO refresh. Note in audit.
4. **Ahrefs call fails:** Log the error, note in audit summary, continue with other files.
5. **All files fresh:** Report "All files are within threshold. Nothing to refresh." and exit.
6. **User selects a fresh file explicitly:** Allow it. Re-run with interactive mode.
7. **File has user-added custom sections:** Preserve them. Only patch/append methodology-defined sections.
8. **Slug not found:** Error with list of available slugs.
9. **features.md section detection:** Only check fixed sections (Recent Changelog Highlights, Capability Gaps). Domain sections vary — age-only staleness.
10. **Synthesis files with no competitor updates:** Skip index.md/matrix.md refresh.
11. **Interrupted refresh:** Each file is self-contained. Only write `refreshed:` after successfully updating that file. Safe to re-run after interruption.
12. **`.pm/config.json` does not exist:** Use hardcoded defaults. Treat SEO provider as `"none"`.
13. **Topic research with `source_origin: internal`:** Skip entirely. Show in audit as "[Internal — skipped, owned by $pm-ingest]". Never modify internal evidence files.
14. **Topic research with `source_origin: mixed`:** Refresh only external evidence. Preserve Representative Quotes, internal findings, and `[internal]`-prefixed entries. Rewrite shared sections to reflect both sources.
