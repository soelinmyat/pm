---
name: Summary
order: 5
description: Report refresh results — updated files, synthesis changes, unchanged and skipped items
---

## Phase 3: Summary

**Goal:** Give the user a concise, trustworthy report of what changed, what was skipped, and what still needs attention after refresh.

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

**Done-when:** The user has a complete refresh summary covering updated, synthesized, unchanged, and skipped items, plus any edge cases that affected the run.
