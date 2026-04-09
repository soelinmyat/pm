# KB Schemas

Canonical schema reference for the layered knowledge base introduced by PM-143.

## Path Rules

- Store KB file references relative to `pm/`.
- Do not start stored paths with `/` or `pm/`.
- Canonical insight path example: `insights/business/reporting-gaps.md`
- Canonical evidence path example: `evidence/research/reporting-gaps-source.md`
- Legacy `pm/...` references may be normalized on read for backward compatibility, but new KB files must store canonical unprefixed paths.

## Insight Files

Required frontmatter:

| Field | Type | Notes |
|---|---|---|
| `type` | string | Must be `insight` |
| `domain` | string | Folder-aligned slug under `insights/` |
| `topic` | string | Human-readable topic name |
| `last_updated` | date | `YYYY-MM-DD` |
| `status` | enum | `active`, `stale`, `draft` |
| `confidence` | enum | `high`, `medium`, `low` |
| `sources` | array | Canonical evidence file paths |

Example:

```md
---
type: insight
domain: business
topic: Reporting gaps
last_updated: 2026-04-06
status: active
confidence: medium
sources:
  - evidence/research/reporting-gaps-source.md
---
# Reporting gaps
```

## Evidence Files

Required frontmatter:

| Field | Type | Notes |
|---|---|---|
| `type` | string | Must be `evidence` |
| `evidence_type` | string | Folder-aligned type under `evidence/` |
| `source_origin` | enum | `internal`, `external`, `mixed` |
| `created` | date | `YYYY-MM-DD` |
| `sources` | array | Strings (URLs, internal paths) or `{url, accessed}` objects |
| `cited_by` | array | Canonical insight file paths |

Evidence type folders:

- `evidence/research/`
- `evidence/transcripts/`
- `evidence/user-feedback/`

Example:

```md
---
type: evidence
evidence_type: research
source_origin: external  # or: internal, mixed
created: 2026-04-06
sources:
  - https://example.com/report.pdf           # string URL
  - url: https://example.com/article          # object with url + accessed
    accessed: 2026-04-09
cited_by:
  - insights/business/reporting-gaps.md
---
# Reporting gaps source
```

## Index Files

Every folder-level `index.md` uses this table header and should contain one row for each markdown file in the folder other than `index.md` and `log.md`.

```md
| Topic/Source | Description | Updated | Status |
|---|---|---|---|
| [reporting-gaps.md](reporting-gaps.md) | Export pain clusters | 2026-04-06 | active |
```

## Log Files

Every folder-level `log.md` is append-only and stores one change per line:

```txt
2026-04-06 create insights/business/reporting-gaps.md
2026-04-06 cite insights/business/reporting-gaps.md -> evidence/research/reporting-gaps-source.md
```

Supported actions:

- `create`
- `update`
- `move`
- `delete`
- `cite`
- `uncite`
- `skip`

## Bidirectional Citations

- If an insight references an evidence file in `sources`, that evidence file must reference the insight in `cited_by`.
- Reciprocity is strict for canonical KB files. Missing counterpart links are validation errors.

## Placement Rules

- `insights/business/landscape.md` is the canonical location for the market landscape document.
- Domain discovery is filesystem-driven from folders under `insights/`.
