# pm:refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `/pm:refresh` skill that audits existing research for staleness and missing sections, then patches files without losing existing content.

**Architecture:** Two deliverables — (1) update the seo.md template in competitor-profiling.md to add two new sections as a prerequisite, (2) create the new `skills/refresh/SKILL.md` skill definition. Both are markdown instruction files, not executable code.

**Tech Stack:** Claude Code plugin skill system (markdown-based skill definitions)

**Spec:** `.planning/2026-03-12-pm-refresh-v1.md`

---

## Task 1: Update seo.md Template (Prerequisite)

**Files:**
- Modify: `skills/research/competitor-profiling.md` (lines 222-249, seo.md Structure section)

The current seo.md template has 5 sections: Traffic Overview, Top Organic Keywords, Top Pages by Traffic, Backlink Profile, Content Strategy Signals. The refresh skill expects 7 sections — the two missing ones map to Ahrefs tools that were already wired in (`site-explorer-metrics-by-country`, `site-explorer-organic-competitors`) but whose data was previously folded into other sections.

- [ ] **Step 1: Add "Traffic by Country" section to seo.md template**

In `skills/research/competitor-profiling.md`, find the seo.md Structure section (the markdown template inside the code fence). Insert a new `## Traffic by Country` section after `## Backlink Profile` and before `## Content Strategy Signals`:

```markdown
## Traffic by Country

| Country | Organic Traffic | % of Total |
|---|---|---|
| ... | ... | ... |

Geographic concentration and presence in target markets.
```

- [ ] **Step 2: Add "Organic Competitors" section to seo.md template**

Insert `## Organic Competitors` after `## Traffic by Country` and before `## Content Strategy Signals`:

```markdown
## Organic Competitors

| Competitor Domain | Common Keywords | Keyword Overlap |
|---|---|---|
| ... | ... | ... |

Domains competing for the same organic keyword space. May reveal adjacent competitors not found via web search.
```

- [ ] **Step 3: Verify the template now has 7 sections in order**

Read back the modified template and confirm the section order is:
1. Traffic Overview
2. Top Organic Keywords
3. Top Pages by Traffic
4. Backlink Profile
5. Traffic by Country
6. Organic Competitors
7. Content Strategy Signals

- [ ] **Step 4: Commit**

```bash
git add skills/research/competitor-profiling.md
git commit -m "$(cat <<'EOF'
feat(research): add Traffic by Country and Organic Competitors to seo.md template

Prerequisite for pm:refresh — these sections map to Ahrefs tools
(metrics-by-country, organic-competitors) that were already wired in
but lacked dedicated template sections.
EOF
)"
```

---

## Task 2: Create the Refresh Skill

**Files:**
- Create: `skills/refresh/SKILL.md`

This is the core deliverable. The SKILL.md file is a markdown instruction file that the LLM follows at runtime when the user invokes `/pm:refresh`. It must encode the full audit → execute → summary flow from the spec.

- [ ] **Step 1: Create the skills/refresh directory**

```bash
mkdir -p skills/refresh
```

- [ ] **Step 2: Write SKILL.md frontmatter and purpose**

Write the file header with frontmatter (name, description) following the pattern used by other skills (e.g., `skills/dig/SKILL.md`, `skills/research/SKILL.md`).

```markdown
---
name: refresh
description: "Use when updating existing research to backfill gaps from newly added tools or refresh stale data. Audits pm/ files for staleness and missing sections, patches without losing existing content. Triggers on 'refresh,' 'update research,' 'what's stale,' 'backfill.'"
---

# pm:refresh

## Purpose

Re-run data collection on existing research to backfill gaps from newly added tools and update stale data — without losing user-written content or burning unnecessary API budget.
```

- [ ] **Step 3: Write Mode Routing section**

Encode the invocation routing from the spec:

```markdown
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
- `pm/research/{topic}/findings.md`

**Out of scope:**
- `pm/strategy.md` — created via interactive interview. Use `/pm:strategy` to update.
```

- [ ] **Step 4: Write Staleness Thresholds section**

```markdown
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
```

- [ ] **Step 5: Write Frontmatter Date Handling section**

```markdown
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
```

- [ ] **Step 6: Write Phase 1 Audit section**

This is the largest section. It includes the audit flow, section detection rules, the audit report format, and cost estimation.

```markdown
---

## Phase 1: Audit

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

> **Research Audit**
>
> **SEO** (threshold: 30 days)
>   [Incomplete] fareharbor/seo.md — missing: Traffic by Country, Organic Competitors
>   [Incomplete] rezdy/seo.md — missing: Traffic by Country, Organic Competitors
>   ...
>
> **Landscape** (threshold: 90 days)
>   [Fresh] landscape.md
>
> **Profiles** (threshold: 60 days)
>   [Fresh] All profiles up to date.
>
> ... (etc.)
>
> **Synthesis Files**
>   [Stale if any competitor updated] competitors/index.md
>   [Stale if any competitor updated] competitors/matrix.md
>
> Estimated API calls: ~{N} Ahrefs calls + ~{W} web search rounds
> Proceed with all non-fresh items? Or select specific items?

For **scoped mode**, show only relevant files with status and estimated calls.

### Cost Estimation

| Action | Cost |
|---|---|
| Incomplete seo.md — per missing section | 1 Ahrefs call per section |
| Stale seo.md — full re-fetch | 6 Ahrefs calls + 1 web search round |
| Landscape keyword refresh | 3 Ahrefs calls (matching-terms, volume-by-country, overview) |
| Topic research demand check | 2 Ahrefs calls (keywords-explorer-overview, serp-overview) |
| Profile/features/API/sentiment refresh | Web search rounds (no Ahrefs calls) |
```

- [ ] **Step 7: Write Phase 2 Execute section**

```markdown
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
- Insert new sections in their canonical position relative to existing sections. Find the nearest existing section that comes after the insertion point in the methodology template and insert before it. If no later section exists, append before any user-added custom sections or at the end of the file.
- Do not modify any existing sections.
- Add/update `refreshed:` date in frontmatter.

**Stale files (past threshold):**
- Re-run data collection for existing methodology-defined sections.
- Diff new data against current content.
- In **interactive mode**: present each section's changes for approval.

  Example:
  > fareharbor/seo.md — Stale (42 days)
  >
  > Traffic Overview:
  >   Organic traffic: 26,710 → 28,450 (+6.5%)
  >   Domain Rating: 91.0 → 91.0 (unchanged)
  >   Accept update? [y/n]
  >
  > Top Organic Keywords:
  >   3 new keywords found, 1 position change
  >   Accept update? [y/n]

- In **auto-accept mode**: apply all changes, log them for the summary.
- User-written analysis paragraphs (non-tabular content under a section) are never modified unless the user explicitly approves in interactive mode.
- Add/update `refreshed:` date in frontmatter.

**Fresh files:**
- Skip unless user explicitly selects them.

### SEO Provider Handling

Read `.pm/config.json` for the `seo.provider` value.

- If `"ahrefs-mcp"`: use Ahrefs MCP tools directly. Call `mcp__ahrefs__doc` for tool schema before first use.
- If `"dataforseo"`: show "DataForSEO refresh not yet supported in v1. Skipping SEO files." Continue with non-SEO files.
- If `"none"`: skip all SEO refresh. Note in audit: "SEO refresh unavailable (no provider configured)."

### Execution Strategy

**SEO files:** Use Ahrefs MCP tools per the tool-to-section mapping above.

**Landscape keyword data:** Use keywords-explorer tools per `skills/research/SKILL.md` Landscape Mode methodology.

**Profiles, features, API:** Re-run web searches per `skills/research/competitor-profiling.md`.

**Sentiment:** Re-run review mining per `skills/research/review-mining.md`.

**Topic research:** Re-run web searches. If ahrefs-mcp configured, re-run demand check (keywords-explorer-overview, serp-overview).

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

> This will make approximately {N} Ahrefs API calls across {M} files.
> Additionally: ~{W} web search rounds for {P} non-SEO files.
> Mode: interactive / auto-accept
> Proceed?

Only continue after explicit confirmation.
```

- [ ] **Step 8: Write Phase 3 Summary section**

```markdown
---

## Phase 3: Summary

After execution, show what changed:

> **Refresh Complete**
>
> **Updated ({N} files)**
>   fareharbor/seo.md — added: Traffic by Country, Organic Competitors
>   rezdy/seo.md — added: Traffic by Country, Organic Competitors
>   ...
>
> **Synthesis ({N} files)**
>   competitors/index.md — updated refreshed dates
>   competitors/matrix.md — rebuilt feature comparison
>
> **Unchanged ({N} files)**
>   landscape.md — all sections present and fresh
>
> **Skipped ({N} files)**
>   All profile, features, API, and sentiment files — fresh.
```

- [ ] **Step 9: Write Edge Cases section**

```markdown
---

## Edge Cases

1. **No `pm/` directory exists:** Error: "No research found. Run `/pm:research landscape` first."
2. **File has no frontmatter date:** Treat as stale (unknown age = should refresh).
3. **SEO provider is `"none"`:** Skip all SEO refresh. Note in audit.
4. **SEO provider is `"dataforseo"`:** Skip SEO refresh: "DataForSEO refresh not yet supported in v1."
5. **Ahrefs call fails:** Log the error, note in audit summary, continue with other files.
6. **User selects a fresh file explicitly:** Allow it. Re-run with interactive mode.
7. **File has user-added custom sections:** Preserve them. Only patch/append methodology-defined sections.
8. **Slug not found:** Error with list of available slugs.
9. **features.md section detection:** Only check fixed sections (Recent Changelog Highlights, Capability Gaps). Domain sections vary — age-only staleness.
10. **Synthesis files with no competitor updates:** Skip index.md/matrix.md refresh.
11. **Interrupted refresh:** Each file is self-contained. Only write `refreshed:` after successfully updating that file. Safe to re-run after interruption.
12. **`.pm/config.json` does not exist:** Use hardcoded defaults. Treat SEO provider as `"none"`.
```

- [ ] **Step 10: Assemble and write the complete SKILL.md file**

Combine all sections from steps 2-9 into a single file at `skills/refresh/SKILL.md`.

- [ ] **Step 11: Verify skill structure**

Read the file back and verify:
- Frontmatter has `name` and `description`
- All sections from the spec are present
- Section detection tables match the spec exactly
- No references to strategy.md (out of scope)
- Subagent prompt template is complete

- [ ] **Step 12: Commit**

```bash
git add skills/refresh/SKILL.md
git commit -m "$(cat <<'EOF'
feat: add pm:refresh skill for auditing and patching stale research

Scans pm/ files for staleness and missing sections, presents an audit
report with cost estimates, then patches files without losing existing
content. Supports interactive and auto-accept modes.
EOF
)"
```

---

## Task 3: Sync Plugin Cache

**Files:**
- Sync: All modified files to `/Users/soelinmyat/.claude/plugins/cache/pm/pm/1.0.0/`

- [ ] **Step 1: Copy updated files to plugin cache**

```bash
cp -r skills/refresh /Users/soelinmyat/.claude/plugins/cache/pm/pm/1.0.0/skills/
cp skills/research/competitor-profiling.md /Users/soelinmyat/.claude/plugins/cache/pm/pm/1.0.0/skills/research/
```

- [ ] **Step 2: Verify cache has the new skill**

```bash
ls /Users/soelinmyat/.claude/plugins/cache/pm/pm/1.0.0/skills/refresh/
```

Expected: `SKILL.md`
