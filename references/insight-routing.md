# Insight Routing

Shared reference for routing evidence findings into synthesized insight topics. Invoked as a sub-step by research (topic mode), ingest (after Phase 3), and refresh (after evidence patching).

**Goal:** After new evidence is written, match its findings against existing insight topics (or seed new ones), present proposed routings for user confirmation, then atomically update both sides of the bidirectional citation.

---

## When to Invoke

Caller skills read and follow this document after writing evidence files. Three integration points:

1. **Research topic mode** — after Step 5 (write findings), before updating indexes.
2. **Ingest** — after Phase 3 (Synthesize Research), before Phase 4 (Report Back).
3. **Refresh** — after patching evidence files, before Synthesis File Refresh.

### Inputs from Caller

- **Evidence file path(s):** One or more canonical paths (e.g., `evidence/research/bulk-editing.md`).
- **Key findings:** Summary of what the evidence contains — used for topic matching.
- For ingest: potentially multiple evidence files with clustered findings. Batch all together for one routing pass.
- For refresh: only evidence files whose content actually changed (not just a date bump). Skip `source_origin: internal` evidence.

---

## Step 1: Domain Check and Seeding

Check each domain under `insights/*/` for existing insight files.

### 1.1 Discover domains

Scan the filesystem for `insights/*/index.md`. Each directory with an `index.md` is a domain. Skip domains that use subdirectory-based content (e.g., `insights/competitors/` contains per-competitor subdirectories, not flat insight files) — the routing sub-step only operates on domains with flat `type: insight` files.

### 1.2 Check domain emptiness

For each domain, count files with `type: insight` in their frontmatter. Files like `index.md`, `log.md`, and `type: landscape` files do not count. Check per-domain — an empty `product/` gets seeded even if `competitors/` is populated.

### 1.3 Seed empty domains (if strategy.md exists)

If a domain has zero insight files and `{pm_dir}/strategy.md` exists:

1. Read `{pm_dir}/strategy.md`. Extract up to **6** specific, falsifiable product/business claims that map to this domain:
   - For `trends/`: extract from "Core Value Prop" and "Differentiation" sections.
   - For `business/`: extract from "Competitive Positioning" and "Go-to-Market" sections.
   - For other domains: extract up to 6 relevant topics from strategy.md for that domain.
   - Each topic must be a specific claim, not a vague priority. "Full-lifecycle context reduces tool switching" is good. "Better UX" is too vague.
2. Present extracted topics to the user in a numbered list. Each topic is one line with a topic name and a one-sentence summary:
   ```
   Proposed insight topics for product/ (seeded from strategy.md):
   1. Full-lifecycle context — PM context follows code from planning through implementation
   2. Evidence-driven grooming — Feature decisions backed by research and customer evidence
   3. ...

   Which topics should I create? (all / select numbers / skip)
   ```
3. For accepted topics, create insight files with this template:
   ```yaml
   ---
   type: insight
   domain: {domain}
   topic: {Topic Name}
   last_updated: {today YYYY-MM-DD}
   status: draft
   confidence: low
   sources: []
   ---
   # {Topic Name}

   Seeded from strategy.md. No evidence routed yet.
   ```
4. Update the domain's `index.md`:
   - If the index has no canonical table header (`| Topic/Source | Description | Updated | Status |`), add one before appending rows.
   - Add one row per created file: `| [{slug}.md]({slug}.md) | {one-line summary} | {today} | draft |`
5. Append `create` log entries to the domain's `log.md`:
   ```
   {today} create insights/{domain}/{slug}.md
   ```

If user rejects all topics, seeding is skipped. Routing proceeds with zero topics (goes to the skip/log path in Step 4).

If no `{pm_dir}/strategy.md` exists and the domain is empty, skip seeding for that domain silently.

---

## Step 2: Read Existing Topics

Scan all `insights/*/index.md` files. For each insight file listed, read its frontmatter to build a topic map:

```
{domain}/{slug}: {
  topic: "Full-lifecycle context",
  sources: ["evidence/research/bulk-editing.md"],
  filePath: "insights/trends/full-lifecycle-context.md"
}
```

Include both pre-existing topics and any just-seeded topics from Step 1.

Skip domains that use subdirectory-based content (same check as Step 1.1).

---

## Step 3: Match Findings to Topics

For each finding in the evidence file(s):

1. **Compare against existing topics.** Evaluate whether the finding relates to an existing insight topic. Consider semantic relevance, not just keyword overlap.
2. **Propose matches** with a brief reason for each match.
3. **Propose new topics** when a finding is substantial enough but does not match any existing topic. The user confirms both the topic name and its domain placement.

### Deduplication check

Before proposing a match, check if the evidence file path already exists in the insight's `sources` array. If it does, skip that evidence-topic pair — it was already routed in a previous pass.

---

## Step 4: Batch Presentation

Show all proposed routings in a single numbered list, grouped by domain for readability. For each proposed routing:

- Topic name (existing or new)
- Match type: `existing` or `new`
- Evidence file path
- One-line match reason

```
Proposed insight routings:

product/
  1. [existing] Full-lifecycle context <- evidence/research/bulk-editing.md
     Bulk editing findings support the lifecycle context claim
  2. [new] Inline collaboration patterns <- evidence/research/bulk-editing.md
     New topic: collaboration patterns emerged from bulk editing research

business/
  3. [existing] Enterprise readiness <- evidence/research/bulk-editing.md
     Bulk operations are an enterprise requirement

Accept or skip per topic? (all / select numbers / skip all)
```

If no matches exist and no new topic is warranted, go directly to the skip path (Step 6).

---

## Step 5: Atomic Write

For each accepted routing, update both files before moving to the next topic:

### 5.1 For existing topics

1. Read the insight file at `insights/{domain}/{slug}.md`.
2. **Dedup check:** If the evidence path is already in `sources`, skip this pair.
3. Append the evidence file path to the insight's `sources` array.
4. Update `last_updated` to today.
5. Read the evidence file.
6. Append the insight file path to the evidence file's `cited_by` array.
7. **Dedup check:** If the insight path is already in `cited_by`, skip writing `cited_by`.

### 5.2 For new topics

1. Create the insight file using the seeding template (same as Step 1.3), but with `sources: ["{evidence path}"]` and `confidence: low`.
2. Read the evidence file.
3. Append the insight file path to the evidence file's `cited_by` array.

### Write rules

- **Only write to `cited_by`** on evidence files. Never modify `source_origin`, `evidence_count`, `segments`, `confidence`, or internal `sources` entries.
- **Never create duplicate entries** in `sources` or `cited_by`.
- **On write failure:** skip that topic, report the error, and continue with the next topic. Do not attempt rollback.

---

## Step 6: Update Indexes and Logs

After all writes complete:

### For each affected insight domain:

- Update `insights/{domain}/index.md` — add or update rows for modified/created insight files.
- Append entries to `insights/{domain}/log.md`:
  - For new topics: `{today} create insights/{domain}/{slug}.md`
  - For updated topics: `{today} cite insights/{domain}/{slug}.md -> {evidence path}`

### For the evidence pool:

- Append cite entries to `{pm_dir}/evidence/log.md` and `{pm_dir}/evidence/research/log.md` (or the appropriate evidence type log):
  ```
  {today} cite insights/{domain}/{slug}.md -> {evidence path}
  ```

### Skip path

When no matches exist and no new topic is warranted:
- Append a skip entry to each checked domain's `log.md`:
  ```
  {today} skip reason: no match for {evidence path}
  ```
- Return to the caller skill.

---

## Step 7: Validate

After all writes, run the validator:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
```

If validation fails, report the failure and continue returning to the caller. Do not attempt auto-fix. Pre-existing unrelated validation failures do not block routing.

---

## Multi-file Batching (Ingest)

When ingest produces multiple evidence files, routing runs once with all findings batched:

1. Collect all evidence file paths and their key findings.
2. Run Steps 1-6 once, matching all findings against all topics in a single pass.
3. The batch presentation shows all routings across all evidence files.

This avoids repeated user prompts for each evidence file.

---

## Quick Reference

| Caller | Evidence input | When to skip routing |
|--------|---------------|---------------------|
| Research (topic mode) | Single evidence file + findings | No insight domains exist and no strategy.md |
| Ingest | Multiple evidence files + clustered findings | No insight domains exist and no strategy.md |
| Refresh | Changed evidence files only | No files refreshed, or all files are `source_origin: internal` |
