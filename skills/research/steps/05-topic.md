---
name: Topic Mode
order: 5
description: Targeted deep-dive research on a specific topic with evidence routing and index updates
---

## Topic Mode (`$pm-research {topic}`)

**Goal:** Produce (or update) a sourced evidence file for a specific topic, route findings into insight topics, and update all indexes — so the topic's knowledge is durable and discoverable by downstream skills.

For targeted deep dives not covered by landscape or competitor profiling.

### How

0. **Load Hot Index** (pre-step).
   Before scanning insight files, check if the hot index exists and use it for faster topic lookup.

   ```bash
   # Check for hot index
   if [ -f "{pm_dir}/insights/.hot.md" ]; then
     node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}" --domain {relevant_domain}
   fi
   ```

   - If `{pm_dir}/insights/.hot.md` exists, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}" --domain {relevant_domain}` where `{relevant_domain}` is the insight domain most relevant to the research topic (e.g., `product`, `business`). Parse the output table to identify existing insight topics related to the research topic. Log: "Hot index loaded ({N} insights)".
   - If a match is found in the hot index, read only that specific insight `.md` file for full content instead of scanning all insight files.
   - If `{pm_dir}/insights/.hot.md` does not exist, fall back to reading insight files directly (current behavior). Log: "Hot index not found, falling back to direct file scan".

1. **Check existing knowledge.** Read `{pm_dir}/evidence/index.md` and `{pm_dir}/evidence/research/index.md` if they exist. Check `{pm_dir}/insights/business/landscape.md` and `{pm_dir}/strategy.md` for relevant context. Use hot index results from Step 0 (if available) instead of scanning all insight files to check for existing topics.
   Treat `source_origin: internal` and `source_origin: mixed` topics as customer evidence from `$pm-ingest`, not just external research.
2. **Check strategy alignment.** If `{pm_dir}/strategy.md` exists, note how the topic relates to current priorities.
3. **Search demand check** (if ahrefs-mcp configured). Use Ahrefs MCP tools to:
   - Get volume, difficulty, CPC for the topic as a keyword. Quantifies how much people search for this.
   - Check SERP overview — see who currently ranks and what the SERP looks like. Reveals content competition and opportunity.
   - If volume is significant, note it in findings. If zero volume, the topic may be too niche for SEO-driven content — note that too.
4. **Web search.** Search for the topic directly. Fill gaps with follow-up searches.
5. **Write findings** to `{pm_dir}/evidence/research/{topic-slug}.md` using the shared topic schema:

```markdown
---
type: evidence
evidence_type: research
topic: {Topic Name}
created: YYYY-MM-DD
updated: YYYY-MM-DD
source_origin: external|mixed
cited_by: []
sources:
  - url: ...
    accessed: YYYY-MM-DD
# Keep internal evidence fields if they already exist on a mixed topic file.
evidence_count: 17
segments:
  - SMB
confidence: high
---

# {Topic Name}

## Summary
2-3 sentences. The key answer to "what did we learn?"

## Findings
Numbered findings with supporting evidence and source references.
Prefix external findings with `[external]` when the topic is mixed.

## Representative Quotes
Present only if the topic already contains internal evidence. Do not delete it.

## Strategic Relevance
How this supports or challenges the current strategy.
If inferred, label it clearly.

## Implications
What this means for the product. Link to strategy sections if relevant.

## Open Questions
What this research did NOT answer.

## Source References
- https://example.com/article — accessed YYYY-MM-DD
```

   Mixed-origin write rules:
   - If the topic file already exists with `source_origin: internal`, switch it to `mixed`
   - Append external `sources` entries and `[external]` findings without deleting internal evidence
   - Rewrite shared sections (`Summary`, `Strategic Relevance`, `Implications`) so they reflect both internal and external evidence

6. **Route findings to insight topics.**
   Read and follow `${CLAUDE_PLUGIN_ROOT}/references/insight-routing.md`.
   Pass the evidence file path (`{pm_dir}/evidence/research/{topic-slug}.md`)
   and the key findings from Step 5 as input.
   If no insight domains exist and no `{pm_dir}/strategy.md` exists, skip this step.

7. **Update evidence indexes**:
   - `{pm_dir}/evidence/research/index.md` — add or update the topic row with description, updated date, and `external` or `mixed` status.
   - `{pm_dir}/evidence/index.md` — keep the top-level Research Evidence list in sync with the topic file.
8. **Update evidence logs**:
   - append the topic write to `{pm_dir}/evidence/research/log.md`
   - append the topic write to `{pm_dir}/evidence/log.md`

**Done-when:** Evidence file exists at `{pm_dir}/evidence/research/{topic-slug}.md` with all template sections populated and sourced, insight routing completed (or explicitly skipped), and both evidence indexes and logs are updated.

Say: "Research written to `{pm_dir}/evidence/research/{topic-slug}.md`. Run `/pm:groom {topic-slug}` to scope a feature from these findings, or `/pm:ideate` to mine the knowledge base for ideas. What would you like to do next?"
