---
name: refresh
description: "Use when updating existing research to backfill gaps from newly added tools or refresh stale data. Audits pm/ files for staleness and missing sections, patches without losing existing content. Triggers on 'refresh,' 'update research,' 'what's stale,' 'backfill.'"
---

# pm:refresh

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

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
| `landscape` | Scoped: `{pm_dir}/insights/business/landscape.md` only |
| `topics` | Scoped: all `{pm_dir}/evidence/research/*.md` |
| `consolidate` | Consolidation only — skip Phases 1-2 (staleness audit + evidence patching), jump directly to Phase 2.5. Runs overlap merge, cross-domain tunnels, orphan lint, and contradiction detection. If hot index does not exist, falls back to reading insight files directly. |
| `{domain}` | Scoped: all refreshable files within a discovered insights domain |
| `{domain}/{slug}` | Scoped: one discovered insight file or competitor folder |
| `{slug}` | Backward-compatible shorthand for `competitors/{slug}` when that competitor exists |

All paths hit the cost guardrail before executing.

### Domain Discovery

Discover available insight domains by scanning `{pm_dir}/insights/*/index.md`.

Rules:
- Treat every matching directory name as a valid domain (`business`, `competitors`, `product`, `developer-experience`, etc.).
- Do not hardcode the domain list.
- For `{domain}` scope: refresh the domain index plus refreshable markdown files directly under that domain.
- For `{domain}/{slug}` scope:
  - if `{pm_dir}/insights/{domain}/{slug}.md` exists, target that single file
  - if `{pm_dir}/insights/{domain}/{slug}/` exists, target the files within that directory
- If the argument does not resolve, show the discovered domains and any valid competitor slugs.

### Scope

**In scope:**
- `{pm_dir}/insights/business/landscape.md`
- `{pm_dir}/insights/competitors/{slug}/profile.md|features.md|api.md|seo.md|sentiment.md`
- discovered domain indexes at `{pm_dir}/insights/*/index.md`
- `{pm_dir}/evidence/research/{topic}.md` — **origin-aware** (see Topic Research Rules below)

**Out of scope:**
- `{pm_dir}/strategy.md` — created via interactive interview. Use `$pm-strategy` to update.

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
| Topic research | `{pm_dir}/evidence/research/*.md` | 90 days |

Defaults are hardcoded. Override in `{pm_state_dir}/config.json` under `refresh.thresholds`:

```json
{
  "refresh": {
    "thresholds": { "seo": 30, "profile": 60, "sentiment": 60, "landscape": 90, "features": 90, "api": 90, "topic": 90 }
  }
}
```

If `{pm_state_dir}/config.json` does not exist, use hardcoded defaults and treat SEO provider as `"none"`.

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

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Phase 1: Audit

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

For each directory under `{pm_dir}/insights/competitors/*/`:
- Check for: `profile.md`, `features.md`, `api.md`, `seo.md`, `sentiment.md`
- Classify missing files as **[Missing]** (distinct from Incomplete or Stale)
- Include missing files in the audit report with: `[Missing] {slug}/{file} — never created`

Missing files should be created during Phase 2 execution using the same methodology as initial profiling (`skills/research/competitor-profiling.md`). They take priority over stale file refreshes.

### Staleness Check

Scan all in-scope `{pm_dir}/` files with frontmatter. For each file:

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
| topic research `.md` | Fixed h2 headings | Summary, Findings, Representative Quotes (conditional — only if internal evidence exists), Strategic Relevance, Implications, Open Questions, Source References |

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
- Append the successfully refreshed file to the matching domain or evidence `log.md`.

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
- Append the successfully refreshed file to the matching domain or evidence `log.md`.

**Fresh files:**
- Skip unless user explicitly selects them.

### SEO Provider Handling

Read `{pm_state_dir}/config.json` for the `seo.provider` value.

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
- Write only to {pm_dir}/insights/competitors/{slug}/. Do NOT touch shared indexes; the parent skill owns them.
- Follow methodology in skills/research/competitor-profiling.md for section content.
- If an Ahrefs call fails, log the error and continue."
```

Parent skill handles: audit report, trust level selection, synthesis files, and the final summary.

### Post-patch Insight Routing

After patching evidence files, route updated findings to insight topics.
Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.
Pass only the evidence files that were refreshed in this run (content actually changed, not just a date bump).
Skip `source_origin: internal` evidence (already skipped by refresh).
If no evidence files were refreshed, skip routing entirely.

### Phase 2.5: Consolidation

After insight routing completes (or directly when invoked via `pm:refresh consolidate`), run three deterministic consolidation checks plus one LLM-based contradiction detection step. All actions respect the trust level — interactive mode approves each action individually; auto-accept mode applies all and reports (except contradictions, which are flagged but never auto-resolved).

**Single-session constraint:** Consolidation modifies evidence `cited_by` entries. Concurrent sessions running both ingest and consolidation may conflict. The `validate.js` check after each merge action detects this. If validation fails mid-consolidation, halt and report the conflict.

#### Step 1: Load insight data

```bash
# Try hot index first
if [ -f "{pm_dir}/insights/.hot.md" ]; then
  node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}"
fi
```

- If `{pm_dir}/insights/.hot.md` exists, run `hot-index.js` and parse the output to get all insight metadata (sources, status, last_updated, domain, connections).
- If `.hot.md` does not exist, fall back to reading all insight files directly by scanning `{pm_dir}/insights/*/` for `.md` files with insight frontmatter. Log: "Hot index not found, falling back to direct file scan".

For each insight file, extract:
- File path (relative to `{pm_dir}`)
- `sources` array (evidence file paths)
- `status` field
- `last_updated` date
- `domain` (parent directory under `insights/`)
- `connections` array (if present)

#### Step 2: Overlap detection + merge

Within each domain, identify insight pairs with >50% source overlap.

**Detection:**
1. Group insights by domain.
2. For each domain, compare every pair of active insight files.
3. Compute shared sources: the intersection of both insights' `sources` arrays.
4. Calculate overlap ratio: `shared_count / min(sources_A.length, sources_B.length)`.
5. If overlap ratio > 0.50, flag the pair as an overlap candidate.

**Merge proposal:**
- The insight with **more** sources absorbs the other (survivor). If equal, the older file (earlier `last_updated`) is absorbed.
- Present to user: "Overlap: {insight_A} and {insight_B} share {N}/{M} sources ({pct}%). Merge into {survivor}?"

**Merge execution (per approved merge):**
1. Read both insight files fully.
2. Compute the union of both `sources` arrays (deduplicated) — this becomes the surviving insight's new `sources`.
3. Rewrite the surviving insight's body using the ripple rewrite pattern from `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md` Step 5.5:
   - Read all evidence files from the merged `sources` array.
   - Read the rewrite template at `${CLAUDE_PLUGIN_ROOT}/references/insight-rewrite-template.md`.
   - Rewrite the body as an evolving synthesis incorporating all linked evidence.
   - Update `confidence` based on source count (0-1: low, 2-3: medium, 4+: high).
   - Update `last_updated` to today's date.
4. Delete the absorbed insight file.
5. Update all evidence files that had `cited_by` entries pointing to the absorbed file — replace with the surviving file path.
6. Update the domain's `index.md` — remove the absorbed insight entry, update the surviving insight entry.
7. Append the merge action to the domain's `log.md`.
8. Create a git commit for this merge: `refactor({domain}): merge {absorbed_slug} into {survivor_slug}`.
9. Run validation:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
```

If validation fails, halt consolidation and report the conflict. Do not continue to the next merge or to tunnels/orphans.

#### Step 3: Cross-domain tunnels

Across all domains, find insight pairs that share an evidence source.

**Detection:**
1. Build a map: `evidence_path → [insight_paths that cite it]`.
2. For each evidence path cited by 2+ insights from **different** domains, flag all cross-domain pairs as tunnel candidates.

**Tunnel execution (per approved tunnel):**
1. For each insight in the pair, add a `connections` field to its YAML frontmatter (or append to the existing `connections` array).
2. The `connections` entry is the relative path to the other insight file (relative to `{pm_dir}`). Example: `connections: ["insights/business/landscape.md"]`.
3. No file merging — tunnels are cross-references only.
4. Skip if the connection already exists in the insight's `connections` array (idempotent).

#### Step 4: Orphan lint

Flag insights that are stale drafts with no evidence backing.

**Detection criteria (all must be true):**
- `sources` array is empty (0 sources)
- `status: draft`
- `last_updated` is **strictly** >30 days old (exactly 30 days is NOT flagged)

**Orphan report:**
- Present each orphan with its path, age, and recommended action: "Delete this draft or manually link evidence."
- In interactive mode: ask for approval before each deletion.
- In auto-accept mode: delete the file, update domain `index.md` and `log.md`, and report.

#### Step 5: Contradiction detection

Within each domain, detect insights that make contradictory claims using LLM pairwise comparison. This step runs after the deterministic checks (overlap, tunnels, orphans) because it is nondeterministic and more expensive.

**Scale guard:**
- For each domain, count the number of active insights (status is not `archived`).
- Compute pairwise comparisons: `n * (n - 1) / 2`.
- If pairwise comparisons exceed 50 (more than ~10 active insights), log a warning and skip that domain:
  `"Too many insights for full contradiction scan in {domain} ({n} insights, {pairs} pairs). Run with --domain {d} to narrow scope."`
- Maximum 50 pairwise comparisons per domain.

**Detection:**
1. For each domain that passes the scale guard, enumerate all pairs of active insight files.
2. For each pair, read both insights' synthesis sections (the body text below the frontmatter).
3. Dispatch an LLM pairwise comparison with the following prompt structure:

```
You are comparing two product insights for contradictions.

Insight A: {path_A}
---
{synthesis_A}
---

Insight B: {path_B}
---
{synthesis_B}
---

Do these two insights make contradictory claims? A contradiction means they assert
opposite or incompatible things about the same topic — not merely different emphasis
or scope.

Examples of contradictions:
- Insight A says "Zero-infra is the primary differentiator" while Insight B says
  "Zero-infra is a limitation that must be overcome."
- Insight A says "Users prefer guided workflows" while Insight B says
  "Users reject structured processes in favor of freeform input."

Examples that are NOT contradictions:
- Insight A covers pricing while Insight B covers onboarding (different topics).
- Insight A says "Feature X is important" while Insight B says "Feature X needs
  improvement" (complementary, not contradictory).

If contradictory: respond with CONTRADICTORY, then quote the specific conflicting
statement from each insight.
If not contradictory: respond with COMPATIBLE.
```

4. Collect all pairs flagged as `CONTRADICTORY`.

**Contradiction report:**
- Present each contradiction with both insight file paths and the specific conflicting text quoted from each.
- Format:

```
Contradiction: {insight_A_path} vs {insight_B_path}
  A claims: "{quoted_claim_A}"
  B claims: "{quoted_claim_B}"
```

**Resolution (trust-level aware):**
- In **interactive mode**: for each contradiction, ask the user to choose:
  - **(a) Keep both** — no action, the insights stand as-is.
  - **(b) Rewrite one** — user specifies which insight to rewrite; rewrite its synthesis to resolve the contradiction using the ripple rewrite pattern from `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md` Step 5.5.
  - **(c) Merge into one** — combine both insights into the survivor (same merge procedure as Step 2: Overlap detection). Delete the absorbed insight, update `cited_by` entries, domain index, and log.
- In **auto-accept mode**: contradictions are flagged in the consolidation report but are **NOT auto-resolved**. Contradiction resolution requires human judgment. Log each contradiction for the final summary.

#### Step 6: Regenerate hot index

After all consolidation actions complete:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}" --generate
```

#### Step 7: Final validation

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
```

If validation fails, fix the frontmatter errors before proceeding.

### Synthesis File Refresh

After individual competitor files are refreshed, regenerate synthesis files:

1. **`{pm_dir}/insights/competitors/index.md`** — re-read all competitor profiles, update links, last-profiled/refreshed dates.
2. Update the **Market Gaps** and any synthesized comparison content in `{pm_dir}/insights/competitors/index.md` based on refreshed capability data.
3. If topic research files were refreshed, update `{pm_dir}/evidence/research/index.md` and `{pm_dir}/evidence/index.md`.
4. Append touched files to the matching domain or evidence `log.md`.

Only run the relevant index and log sync steps for domains or evidence pools that were actually updated during the refresh.

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

After updating any `{pm_dir}/` artifacts, run:

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
  evidence/index.md — synced research evidence entries

### Unchanged ({N} files)
  landscape.md — all sections present and fresh

### Skipped ({N} files)
  All profile, features, API, and sentiment files — fresh.
```

---

## Edge Cases

1. **No `{pm_dir}/` directory exists:** Error: "No research found. Run `$pm-research landscape` first."
2. **File has no frontmatter date:** Treat as stale (unknown age = should refresh).
3. **SEO provider is `"none"`:** Skip all SEO refresh. Note in audit.
4. **Ahrefs call fails:** Log the error, note in audit summary, continue with other files.
5. **All files fresh:** Report "All files are within threshold. Nothing to refresh." and exit.
6. **User selects a fresh file explicitly:** Allow it. Re-run with interactive mode.
7. **File has user-added custom sections:** Preserve them. Only patch/append methodology-defined sections.
8. **Slug not found:** Error with list of available slugs.
9. **features.md section detection:** Only check fixed sections (Recent Changelog Highlights, Capability Gaps). Domain sections vary — age-only staleness.
10. **Synthesis files with no domain updates:** Skip index/log refresh for that domain.
11. **Interrupted refresh:** Each file is self-contained. Only write `refreshed:` after successfully updating that file. Safe to re-run after interruption.
12. **`{pm_state_dir}/config.json` does not exist:** Use hardcoded defaults. Treat SEO provider as `"none"`.
13. **Topic research with `source_origin: internal`:** Skip entirely. Show in audit as "[Internal — skipped, owned by $pm-ingest]". Never modify internal evidence files.
14. **Topic research with `source_origin: mixed`:** Refresh only external evidence. Preserve Representative Quotes, internal findings, and `[internal]`-prefixed entries. Rewrite shared sections to reflect both sources.
