# Mixed-Origin Write Contract

A topic file can hold evidence from two origins: **internal** customer evidence (owned by `pm:ingest`) and **external** research (owned by `pm:research`, refreshed by `pm:refresh`). When you write a topic that already contains evidence from the *other* origin, do **not** overwrite it wholesale — merge under the ownership rules below.

Two roles reference this contract:

- **Internal producer** (`pm:ingest`) — owns the internal evidence; writes `[internal]`-prefixed findings.
- **External producer** (`pm:research` / `pm:refresh`) — owns the external evidence; writes `[external]`-prefixed findings.

"You" below means whichever role is writing; "the other origin" means the role you are not.

## Ownership Rules

- `source_origin`: set to `mixed` when both internal and external evidence exist.
- `sources`: append your own source refs; never remove the other origin's. Internal entries are those **without** a `url` (or carrying a local-path reference); external entries carry a `url`.
- `evidence_count`, `segments`, `confidence`, `Representative Quotes`: owned by the **internal producer** (`pm:ingest`). The external producer must never modify them.
- `cited_by`: preserve existing values unless another workflow updates them separately.
- `Findings`: append your own numbered findings, prefixed with your origin — `[internal]` for `pm:ingest`, `[external]` for `pm:research`/`pm:refresh`. Never relabel or remove the other origin's findings.
- `Summary`, `Strategic Relevance`, `Implications`: shared sections — rewrite to incorporate both internal and external evidence.
- `Open Questions`, `Source References`: additive.

## Write Protocol

1. Read the existing file if present.
2. Parse frontmatter and body sections.
3. Update only the sections you own, and append (never relabel) your own `[origin]`-prefixed findings.
4. Merge the shared sections (Summary, Strategic Relevance, Implications) carefully so they reflect both origins.
5. Write the file back.
