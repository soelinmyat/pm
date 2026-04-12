---
name: Consolidation
order: 4
description: Cross-document consolidation — overlap merge, cross-domain tunnels, orphan lint, and contradiction detection
---

## Phase 2.5: Consolidation

After insight routing completes (or directly when invoked via `pm:refresh consolidate`), run three deterministic consolidation checks plus one LLM-based contradiction detection step. All actions respect the trust level — interactive mode approves each action individually; auto-accept mode applies all and reports (except contradictions, which are flagged but never auto-resolved).

**Single-session constraint:** Consolidation modifies evidence `cited_by` entries. Concurrent sessions running both ingest and consolidation may conflict. The `validate.js` check after each merge action detects this. If validation fails mid-consolidation, halt and report the conflict.

### Step 1: Load insight data

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

### Step 2: Overlap detection + merge

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

### Step 3: Cross-domain tunnels

Across all domains, find insight pairs that share an evidence source.

**Detection:**
1. Build a map: `evidence_path -> [insight_paths that cite it]`.
2. For each evidence path cited by 2+ insights from **different** domains, flag all cross-domain pairs as tunnel candidates.

**Tunnel execution (per approved tunnel):**
1. For each insight in the pair, add a `connections` field to its YAML frontmatter (or append to the existing `connections` array).
2. The `connections` entry is the relative path to the other insight file (relative to `{pm_dir}`). Example: `connections: ["insights/business/landscape.md"]`.
3. No file merging — tunnels are cross-references only.
4. Skip if the connection already exists in the insight's `connections` array (idempotent).

### Step 4: Orphan lint

Flag insights that are stale drafts with no evidence backing.

**Detection criteria (all must be true):**
- `sources` array is empty (0 sources)
- `status: draft`
- `last_updated` is **strictly** >30 days old (exactly 30 days is NOT flagged)

**Orphan report:**
- Present each orphan with its path, age, and recommended action: "Delete this draft or manually link evidence."
- In interactive mode: ask for approval before each deletion.
- In auto-accept mode: delete the file, update domain `index.md` and `log.md`, and report.

### Step 5: Contradiction detection

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

### Step 6: Regenerate hot index

After all consolidation actions complete:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/hot-index.js --dir "{pm_dir}" --generate
```

### Step 7: Final validation

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
```

If validation fails, fix the frontmatter errors before proceeding.
