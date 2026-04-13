# pm:refresh — Design Spec

## Purpose

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.

## Identity

- New standalone skill at `skills/refresh/SKILL.md`
- Triggers on: "refresh", "update research", "what's stale", "backfill"

---

## Scope

### In scope
- `pm/landscape.md`
- `pm/competitors/{slug}/profile.md|features.md|api.md|seo.md|sentiment.md`
- `pm/competitors/index.md` and `pm/competitors/matrix.md` (synthesis files — regenerated after individual profiles are refreshed)
- `pm/research/{topic}/findings.md` (topic research — web search and SEO demand data)

### Out of scope
- `pm/strategy.md` — created via interactive interview in `/pm:strategy`. Refreshing automatically doesn't make sense. If the user wants to update strategy, they should re-run `/pm:strategy`.

---

## Invocation

```
/pm:refresh              → Audit mode (full scan, report, user picks)
/pm:refresh seo          → Scoped: SEO files only (all competitors + landscape keywords)
/pm:refresh landscape    → Scoped: landscape.md only
/pm:refresh {slug}       → Scoped: all 5 files for one competitor
/pm:refresh topics       → Scoped: all topic research files
```

All paths hit the cost guardrail before executing.

---

## Staleness Thresholds

| Data Type | Threshold | Rationale |
|---|---|---|
| SEO (traffic, keywords, rankings) | 30 days | Search metrics shift monthly; Ahrefs updates ~monthly |
| Profiles (positioning, pricing) | 60 days | Pricing/positioning changes quarterly-ish |
| Sentiment (reviews) | 60 days | New reviews accumulate; complaint themes shift |
| Landscape (market overview) | 90 days | Market structure changes slowly |
| Features | 90 days | Product capabilities change slowly |
| API | 90 days | API surfaces change slowly |
| Topic research | 90 days | External findings age slowly; internal evidence is updated via `/pm:ingest` |

Defaults are hardcoded. Optional override in `.pm/config.json`:

```json
{
  "refresh": {
    "thresholds": {
      "seo": 30,
      "profile": 60,
      "sentiment": 60,
      "landscape": 90,
      "features": 90,
      "api": 90,
      "topic": 90
    }
  }
}
```

---

## Frontmatter Date Handling

Different file types use different date keys. The refresh skill must handle this consistently.

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
- **Never modify** the original `profiled:` or `created:` date — these record when the file was first written.
- If `updated:` exists, leave it as-is — that records the last time the research/ingest skill touched it.

This preserves provenance: `profiled:` = when first researched, `updated:` = when last researched or ingested, `refreshed:` = when last refreshed.

---

## Phase 1: Audit

Scan all in-scope `pm/` files with frontmatter. For each file:

1. Read the file age using the date priority rules above.
2. Compare against the staleness threshold for that file type.
3. For files with fixed expected sections: compare existing h2 headings against what the current methodology expects. Detect missing sections.
4. Classify each file:
   - **Fresh** — within threshold, all expected sections present.
   - **Incomplete** — within threshold, but missing sections the current methodology expects.
   - **Stale** — past threshold.

### Section Detection Rules

Different file types have different section detection strategies:

| File Type | Detection Strategy | Expected Sections |
|---|---|---|
| seo.md | Fixed h2 headings | Traffic Overview, Top Organic Keywords, Top Pages by Traffic, Traffic by Country, Backlink Profile, Organic Competitors, Content Strategy Signals |
| profile.md | Fixed h2 headings | Overview, Positioning, Pricing, Strengths, Weaknesses, Notable Signals |
| api.md | Fixed h2 headings | API Availability, Auth Model, Core Entity Model, Endpoint Coverage, Webhooks, Rate Limits, SDKs and Integrations, Architectural Signals |
| sentiment.md | Fixed h2 headings | Overall Sentiment, Top Praise Themes, Top Complaint Themes, High-Severity Signals, Support Quality Signals, Churn Signals, Feature Requests (recurring), Reddit / Community Signals, Analyst Notes |
| features.md | **Age only** — domain sections vary per competitor. Only check for fixed sections: Recent Changelog Highlights, Capability Gaps |
| landscape.md | Fixed h2 headings | Market Overview, Key Players, Keyword Landscape, Market Segments, Initial Observations |
| topic findings.md | Fixed h2 headings | Summary, Findings, Representative Quotes (conditional — present only if internal evidence exists), Strategic Relevance, Implications, Open Questions, Source References |

For SEO, map Ahrefs tools to expected sections:

| Ahrefs Tool | Expected Section |
|---|---|
| site-explorer-metrics | Traffic Overview |
| site-explorer-organic-keywords | Top Organic Keywords |
| site-explorer-top-pages | Top Pages by Traffic |
| site-explorer-metrics-by-country | Traffic by Country |
| site-explorer-backlinks-stats | Backlink Profile |
| site-explorer-organic-competitors | Organic Competitors |

**Note:** The seo.md template in `competitor-profiling.md` must be updated to add "Traffic by Country" and "Organic Competitors" as dedicated sections (see File Changes below).

### Audit Report

Present grouped by type. Show all files but visually distinguish status:

```
## Research Audit

### SEO (threshold: 30 days)
  [Incomplete] fareharbor/seo.md    — missing: Traffic by Country, Organic Competitors
  [Incomplete] rezdy/seo.md         — missing: Traffic by Country, Organic Competitors
  ...

### Landscape (threshold: 90 days)
  [Fresh] landscape.md

### Profiles (threshold: 60 days)
  [Fresh] All 5 profiles up to date.

### Features (threshold: 90 days)
  [Fresh] All 5 feature files up to date.

### API (threshold: 90 days)
  [Fresh] All 5 API files up to date.

### Sentiment (threshold: 60 days)
  [Fresh] All 5 sentiment files up to date.

### Topic Research (threshold: 90 days)
  No topic research files found.

### Synthesis Files
  [Stale if any competitor updated] competitors/index.md
  [Stale if any competitor updated] competitors/matrix.md

Estimated API calls: ~12 Ahrefs calls (2 calls × 5 competitors + 2 landscape)
Proceed with all non-fresh items? Or select specific items?
```

For **scoped mode**, show only relevant files with status and estimated calls, confirm, execute.

### Cost Estimation Formula

| Action | Ahrefs API Calls |
|---|---|
| Incomplete seo.md — per missing section | 1 call per section |
| Stale seo.md — full re-fetch | 6 Ahrefs calls + 1 web search round (Content Strategy Signals has no Ahrefs tool — refreshed via web search) |
| Landscape keyword refresh | 3 calls (matching-terms, volume-by-country, overview) |
| Topic research demand check | 2 calls (keywords-explorer-overview, serp-overview) |

Web searches (profiles, features, API, sentiment) do not count against the Ahrefs API but do consume tokens and time. Estimate these as "{N} web search rounds" in the audit.

---

## Phase 2: Execute

### Trust Levels

Before execution, ask the user to choose a mode:

- **Interactive** (default): Show a diff for each section being updated. User approves or rejects each change individually.
- **Auto-accept**: Apply all patches, show a summary at the end of what changed.

### Patch Rules (never rewrite)

All updates are patches. Existing content is never deleted or overwritten without approval.

**Incomplete files (missing sections):**
- Run only the data collection for the missing sections.
- Insert new sections in their canonical position relative to existing sections. Find the nearest existing section that comes after the insertion point in the methodology template and insert before it. If no later section exists, append before any user-added custom sections (sections not in the methodology template) or at the end of the file.
- Do not modify any existing sections.
- Add/update `refreshed:` date in frontmatter.

**Stale files (past threshold):**
- Re-run data collection for existing methodology-defined sections.
- Diff new data against current content.
- In **interactive mode**: present each section's changes for approval.
  ```
  fareharbor/seo.md — Stale (42 days)

    Traffic Overview:
      - Organic traffic: 26,710 → 28,450 (+6.5%)
      - Domain Rating: 91.0 → 91.0 (unchanged)
      Accept update? [y/n]

    Top Organic Keywords:
      - 3 new keywords found, 1 position change
      Accept update? [y/n]

    Content Strategy Signals:
      - No new data found. Keeping existing.
  ```
- In **auto-accept mode**: apply all changes, log them for the summary.
- User-written analysis paragraphs (non-tabular content under a section) are never modified unless the user explicitly approves in interactive mode.
- Add/update `refreshed:` date in frontmatter.

**Fresh files:**
- Skip unless user explicitly selects them.

### Execution Strategy

**SEO files:** Use Ahrefs MCP tools directly. Read `.pm/config.json` for provider.
- If `"ahrefs-mcp"`: use MCP tools. Call `mcp__ahrefs__doc` for tool schema before first use.
- If `"dataforseo"`: v1 does not support DataForSEO refresh. Show: "DataForSEO refresh not yet supported. Skipping SEO files." Continue with non-SEO files.
- If `"none"`: skip all SEO refresh. Note in audit: "SEO refresh unavailable (no provider configured)."

**Landscape keyword data:** Use keywords-explorer tools per the research skill methodology.

**Profiles, features, API:** Re-run web searches per the competitor-profiling methodology.

**Sentiment:** Re-run review mining per the review-mining methodology.

**Topic research:** Re-run web searches. If ahrefs-mcp configured, re-run demand check (keywords-explorer-overview, serp-overview).

**Parallel execution:** When refreshing multiple competitors, dispatch one refresh agent per competitor. Each agent receives:

```
Agent tool: name="refresh-{slug}",
prompt="Refresh {Company Name} in the {space} space.
Slug: {slug}.
Trust level: {interactive|auto-accept}.
Files to update: {list of files with their status: stale or incomplete with missing sections}.

RULES:
- Read each file before modifying.
- For INCOMPLETE files: add only the missing sections listed above. Do not modify existing content.
- For STALE files: re-run data collection for existing sections. {If interactive: present diffs to user for approval before writing. If auto-accept: apply changes and report what changed.}
- Add 'refreshed: {today}' to frontmatter. Never modify 'profiled:' or 'created:'.
- Preserve all user-added custom sections (sections not in the methodology template).
- Write only to pm/competitors/{slug}/. Do NOT touch index.md or matrix.md.
- Follow methodology in skills/research/competitor-profiling.md for section content.
- If an Ahrefs call fails, log the error and continue."
```

Parent skill handles: audit report, trust level selection, synthesis files (index.md, matrix.md), and the final summary.

### Synthesis File Refresh

After individual competitor files are refreshed, regenerate synthesis files:

1. **`pm/competitors/index.md`** — re-read all competitor profiles, update links, last-profiled/refreshed dates.
2. **`pm/competitors/matrix.md`** — re-read all features.md files, rebuild the comparison table.
3. Update the **Market Gaps** section in index.md based on refreshed capability data.

Only run this step if at least one competitor file was updated during the refresh.

### Cost Guardrail

Before executing, show estimated API calls:

```
This will make approximately {N} Ahrefs API calls across {M} files.
Additionally: ~{W} web search rounds for {P} non-SEO files.
Mode: interactive / auto-accept
Proceed?
```

Only continue after explicit confirmation.

---

## Phase 3: Summary

After execution, show what changed:

```
## Refresh Complete

### Updated (5 files)
  fareharbor/seo.md  — added: Traffic by Country, Organic Competitors
  rezdy/seo.md       — added: Traffic by Country, Organic Competitors
  bokun/seo.md       — added: Traffic by Country, Organic Competitors
  tripworks/seo.md   — added: Traffic by Country, Organic Competitors
  peek-pro/seo.md    — added: Traffic by Country, Organic Competitors

### Synthesis (2 files)
  competitors/index.md  — updated refreshed dates
  competitors/matrix.md — no changes needed

### Unchanged (1 file)
  landscape.md       — all sections present and fresh

### Skipped (19 files)
  All profile, features, API, and sentiment files — fresh.
```

---

## Scoped Mode Behavior

| Scope | What it audits | What it refreshes |
|---|---|---|
| _(no arg)_ | Everything in scope | User selection from audit report |
| `seo` | All `*/seo.md` + landscape keyword sections | Selected SEO files |
| `landscape` | `pm/landscape.md` only | Landscape file |
| `{slug}` | All 5 files for that competitor | Selected files for that competitor |
| `topics` | All `pm/research/*/findings.md` | Selected topic files |

Scoped mode still shows status and estimated calls before executing. It just skips the full audit.

**Slug validation:** If `{slug}` does not match any directory under `pm/competitors/`, show: "No competitor found with slug '{slug}'. Available: {list of existing slugs}."

---

## File Changes

### Prerequisites (blocking — must complete before implementing refresh)
- `skills/research/competitor-profiling.md` — update seo.md template to add "Traffic by Country" and "Organic Competitors" as dedicated h2 sections. Without this, the refresh skill will flag every existing seo.md as Incomplete for sections the methodology does not yet define.

### New files
- `skills/refresh/SKILL.md` — skill definition

### Config changes
- Optional `refresh.thresholds` object in `.pm/config.json` (not required — defaults are hardcoded).

---

## Edge Cases

1. **No `pm/` directory exists:** Error with "No research found. Run `/pm:research landscape` first."
2. **File has no frontmatter date:** Treat as stale (unknown age = should refresh).
3. **SEO provider is `"none"`:** Skip all SEO refresh. Note in audit: "SEO refresh unavailable (no provider configured)."
4. **SEO provider is `"dataforseo"`:** Skip SEO refresh with note: "DataForSEO refresh not yet supported in v1."
5. **Ahrefs call fails:** Log the error, note it in the audit summary, continue with other files.
6. **User selects a fresh file explicitly:** Allow it. Re-run with interactive mode so they can review diffs.
7. **File has user-added custom sections (not in methodology):** Preserve them. Only patch/append methodology-defined sections.
8. **Slug not found:** Error with available slugs listed.
9. **features.md section detection:** Only check for fixed sections (Recent Changelog Highlights, Capability Gaps). Domain-specific sections vary per competitor and are not checked for completeness — only age-based staleness applies.
10. **Synthesis files with no competitor updates:** Skip index.md/matrix.md refresh if no individual competitor files were changed.
11. **Interrupted refresh (Ctrl+C, network failure):** Each file is self-contained. Only write `refreshed:` to frontmatter after successfully updating that file. If a refresh is interrupted mid-run, completed files retain their updates and incomplete files remain unchanged. The next `/pm:refresh` audit will correctly show the remaining work.
12. **`.pm/config.json` does not exist:** Use hardcoded defaults for all thresholds. Treat SEO provider as `"none"` (skip SEO refresh).
