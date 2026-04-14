---
name: Execute
order: 3
description: Patch stale and incomplete files using research methodologies, respecting trust levels and origin rules
---

## Phase 2: Execute

**Goal:** Patch the selected stale or incomplete artifacts safely, preserving user-authored content while refreshing only the sections that need work.

Read `${CLAUDE_PLUGIN_ROOT}/skills/refresh/references/origin-rules.md` for topic research origin handling.

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

**SEO files:** Use Ahrefs MCP tools per the tool-to-section mapping in the staleness-thresholds reference.

**Landscape keyword data:** Use keywords-explorer tools per `skills/research/SKILL.md` Landscape Mode methodology.

**Profiles, features, API:** Re-run web searches per `skills/research/references/competitor-profiling.md`.

**Sentiment:** Re-run review mining per `skills/research/references/review-mining.md`.

**Topic research:** Check `source_origin` in frontmatter and follow the origin rules reference.
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
- Write only to {pm_dir}/evidence/competitors/{slug}/. Do NOT touch shared indexes; the parent skill owns them.
- Follow methodology in `skills/research/references/competitor-profiling.md` for section content.
- If an Ahrefs call fails, log the error and continue."
```

Parent skill handles: audit report, trust level selection, synthesis files, and the final summary.

### Post-patch Insight Routing

After patching evidence files, route updated findings to insight topics.
Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.
Pass only the evidence files that were refreshed in this run (content actually changed, not just a date bump).
Skip `source_origin: internal` evidence (already skipped by refresh).
If no evidence files were refreshed, skip routing entirely.

### Synthesis File Refresh

After individual competitor files are refreshed, regenerate synthesis files:

1. **`{pm_dir}/evidence/competitors/index.md`** — re-read all competitor profiles, update links, last-profiled/refreshed dates.
2. Update the **Market Gaps** and any synthesized comparison content in `{pm_dir}/evidence/competitors/index.md` based on refreshed capability data.
3. If topic research files were refreshed, update `{pm_dir}/evidence/research/index.md` and `{pm_dir}/evidence/index.md`.
4. Append touched files to the matching domain or evidence `log.md`.

Only run the relevant index and log sync steps for domains or evidence pools that were actually updated during the refresh.

### Post-write Validation

After updating any `{pm_dir}/` artifacts, run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
```

If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

**Done-when:** All approved refresh patches have been applied (or safely skipped), required synthesis/index updates have run, and post-write validation passes.

**Advance:** proceed to Step 4 (Consolidation).
