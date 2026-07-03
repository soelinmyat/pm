# Mixed-Origin Write Contract

When a topic already exists from `pm:research`, do **not** overwrite it wholesale.

## Ownership Rules

- `source_origin`: set to `mixed` when both internal and external evidence exist
- `sources`: append your source refs; do not remove the other skill's refs
- `evidence_count`, `segments`, `confidence`: owned by `$pm-ingest`
- `cited_by`: preserve existing values unless another workflow updates them separately
- `Summary`: rewrite to incorporate both internal and external evidence
- `Findings`: append your own numbered findings prefixed `[internal]`
- `Representative Quotes`: owned by `$pm-ingest`
- `Strategic Relevance`: rewrite to incorporate current evidence
- `Implications`: rewrite to incorporate current evidence
- `Open Questions`: additive
- `Source References`: additive

## Write Protocol

1. Read the existing file if present
2. Parse frontmatter and body sections
3. Update only the sections you own
4. Merge shared sections carefully
5. Write the file back
