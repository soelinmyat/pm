# Topic Research Origin Rules

Topic research files use a `source_origin` frontmatter field that determines ownership. Refresh must respect this:

| `source_origin` | Refresh behavior |
|---|---|
| `external` | Refresh normally — re-run web searches and SEO demand checks. |
| `internal` | **Skip entirely.** Internal evidence is owned by `$pm-ingest`. Do not re-run web searches or modify any content. Show in audit as: "[Internal — skipped, owned by $pm-ingest]". |
| `mixed` | **Refresh external sections only.** Re-run web searches and SEO demand checks for `[external]`-prefixed findings, Summary, Strategic Relevance, and Implications. **Never modify** Representative Quotes, internal evidence entries, or `[internal]`-prefixed findings. When rewriting shared sections (Summary, Strategic Relevance, Implications), incorporate both internal and external evidence. |

## Mixed-topic Ownership

The canonical ownership contract for mixed topics lives at `${CLAUDE_PLUGIN_ROOT}/references/mixed-origin.md` — `$pm-ingest` owns `source_origin`, `evidence_count`, `segments`, `confidence`, Representative Quotes, and internal `sources` entries. Refresh must **never** modify any of them.

Refresh's scope is the mirror image: it may only add or update `refreshed:`, external `sources` entries (with URLs), and the external-origin metadata it generates. When it rewrites a shared section (Summary, Strategic Relevance, Implications), it incorporates both internal and external evidence, per the shared contract.

If `source_origin` is absent, treat as `external`.
