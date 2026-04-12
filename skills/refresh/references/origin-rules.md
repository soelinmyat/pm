# Topic Research Origin Rules

Topic research files use a `source_origin` frontmatter field that determines ownership. Refresh must respect this:

| `source_origin` | Refresh behavior |
|---|---|
| `external` | Refresh normally — re-run web searches and SEO demand checks. |
| `internal` | **Skip entirely.** Internal evidence is owned by `$pm-ingest`. Do not re-run web searches or modify any content. Show in audit as: "[Internal — skipped, owned by $pm-ingest]". |
| `mixed` | **Refresh external sections only.** Re-run web searches and SEO demand checks for `[external]`-prefixed findings, Summary, Strategic Relevance, and Implications. **Never modify** Representative Quotes, internal evidence entries, or `[internal]`-prefixed findings. When rewriting shared sections (Summary, Strategic Relevance, Implications), incorporate both internal and external evidence. |

## Mixed-topic Frontmatter Protection

For `mixed` topics, the following frontmatter fields are owned by `$pm-ingest` and must never be modified by refresh:
- `source_origin` (must remain `mixed`)
- `evidence_count`
- `segments`
- `confidence`
- Internal entries in the `sources` array (sources without a `url` or with local-path references)

Refresh may only add or update: `refreshed:`, external `sources` entries (with URLs), and external-origin metadata it generates.

If `source_origin` is absent, treat as `external`.
