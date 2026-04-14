# KB Search

Shared reference for finding files in the knowledge base without reading everything. Used by any skill that needs to locate past artifacts — thinking files, backlog items, research, insights.

**Goal:** Find relevant KB files in under 5 seconds, regardless of how many files exist. Never scan an entire directory. Never read full files to find a match.

---

## When to Invoke

Any skill that needs to find a KB file by topic rather than by exact path. Common callers:

| Caller | Searching for | Index location |
|--------|--------------|----------------|
| think (resume) | Past thinking artifacts | `{pm_dir}/thinking/index.md` |
| think (ground) | Relevant insights | `{pm_dir}/insights/.hot.md` |
| groom (intake) | Related backlog items | `{pm_dir}/backlog/index.md` |
| groom (research check) | Existing research | `{pm_dir}/evidence/research/index.md` |
| research (dedup check) | Existing research | `{pm_dir}/evidence/research/index.md` |
| dev (backlog resolution) | Backlog item by slug or ID | `{pm_dir}/backlog/index.md` |

---

## Search Protocol

Three tiers, executed in order. Stop at the first hit.

### Tier 1: Slug Match (instant)

Derive a slug from the user's topic (kebab-case, max 4 words). Check if the file exists directly:

```bash
test -f {pm_dir}/{domain}/{slug}.md && echo "HIT" || echo "MISS"
```

If HIT, read that file. Done.

**When this works:** User says "let's revisit the onboarding idea" → slug `onboarding` → `thinking/onboarding.md` exists. Covers ~60% of lookups.

### Tier 2: Keyword Grep on Index (fast, scalable)

If no slug match, search the directory's index file using keywords.

**Step 1 — Generate keywords.** From the user's topic, produce 3-5 search terms:
- The literal topic words (e.g., "Slack integration" → `slack`, `integration`)
- 1-2 synonyms or related terms (e.g., `messaging`, `notifications`)
- Avoid generic words (`feature`, `idea`, `thing`, `user`)

**Step 2 — Grep the index.** Run one grep per keyword against the index file:

```bash
grep -i "slack" {pm_dir}/thinking/index.md
grep -i "messaging" {pm_dir}/thinking/index.md
grep -i "notification" {pm_dir}/thinking/index.md
```

**Step 3 — Dedupe and rank.** Collect all matching rows. Dedupe by slug (a row that matches multiple keywords ranks higher). Present the top 5 to the caller.

**Step 4 — Caller picks.** The calling skill reads the matched rows and selects the best one based on semantic relevance. If multiple matches are plausible, ask the user.

**When this works:** Topic doesn't match a slug exactly, but keywords overlap with index entries. Covers ~35% of lookups.

### Tier 3: No Match (honest)

If grep returns zero results across all keywords, report "no match found" to the caller. The caller decides what to do:

- **think:** Start a fresh thinking session
- **groom:** No existing context — proceed with intake
- **research:** No existing research — proceed with new research
- **dev:** No backlog item — proceed with fresh intake

Do NOT fall back to scanning full files. If the index doesn't have it, either the file doesn't exist or the index is stale. Both are better handled by reporting the miss than by burning tokens on a full scan.

---

## Index Format

Every searchable directory maintains an `index.md` with this format:

```markdown
---
type: index
domain: "{thinking | backlog | research | insights}"
updated: YYYY-MM-DD
entry_count: N
---

| Slug | Topic | Tags | Updated | Status |
|------|-------|------|---------|--------|
| onboarding-flow | Guided onboarding for new users | onboarding, ux, activation | 2026-04-10 | active |
| slack-integration | Native Slack bot for notifications | slack, messaging, integration | 2026-03-15 | parked |
```

**Rules:**
- One row per file in the directory
- `Tags` column has 2-4 keywords for grep discoverability (the key to Tier 2 working)
- `Status` column uses the domain's status vocabulary
- Rows sorted by `Updated` descending (most recent first)
- Index is plain markdown — no scripts needed to read it

---

## Index Maintenance

Every skill that writes a file to an indexed directory must update the index in the same operation.

### On file create

Append a new row to the index table. Update frontmatter `entry_count` and `updated`.

### On file update

Find the row by slug, update its `Updated` and `Status` columns. Update frontmatter `updated`.

### On status change

Find the row by slug, update `Status`. No other fields change.

### Index rebuild (recovery)

If an index is missing or corrupt, rebuild it by scanning the directory:

1. Glob `{directory}/*.md` (exclude `index.md` itself)
2. Read the first 10 lines of each file (frontmatter only)
3. Extract slug (from filename), topic, tags (from frontmatter `tags:` or inferred from topic), updated, status
4. Write the index table sorted by updated descending

This is the expensive path — it only runs once to bootstrap or recover. After that, incremental maintenance keeps it current.

---

## Integration with Existing Indexes

Some directories already have indexes that predate this reference:

| Directory | Existing index | Action |
|-----------|---------------|--------|
| `insights/` | `.hot.md` (generated by `hot-index.js`) | Use as-is for Tier 2. Hot index is already grep-friendly. |
| `insights/*/` | `index.md` per domain | Use as Tier 2 fallback if `.hot.md` doesn't match. |
| `evidence/research/` | `index.md` | Migrate to standard format if needed, or use as-is if already grep-friendly. |
| `thinking/` | None | Create on first synthesize. |
| `backlog/` | None | Create on first groom proposal write. |

Do not create duplicate indexes. If a directory already has a working index, use it.

---

## What This Reference Does NOT Cover

- **Full-text search** inside file bodies. This is index-level search only.
- **Semantic search** beyond keyword matching. The LLM does semantic ranking on the grep results — this reference handles retrieval, not ranking.
- **Cross-directory search** (e.g., "find everything about Slack across thinking, backlog, and research"). Each directory is searched independently. The calling skill decides which directories to check.
