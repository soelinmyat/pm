# Frontmatter Schemas

Single source of truth for all KB frontmatter schemas. Skills read this when generating output, the validator enforces it, and productmemory.io parses the same frontmatter server-side.

## Quick Reference

Type-dispatch table mapping `type` value to file location and schema section.

| Type Value | Location | Required Fields | Schema Section |
|---|---|---|---|
| `backlog` | `pm/backlog/*.md` | 9 required + 11 optional | [1. Backlog](#1-backlog) |
| `strategy` | `pm/strategy.md` | 3 required | [2. Strategy](#2-strategy) |
| `evidence` (`research`) | `pm/evidence/research/*.md` | 6 required + 2 optional | [3. Evidence — Research](#3-evidence--research) |
| `competitor-*` | `pm/evidence/competitors/{slug}/*.md` | 5 required + 1 optional | [4. Evidence — Competitor](#4-evidence--competitor) |
| `evidence` (`transcript`) | `pm/evidence/transcripts/*.md` | 6 required | [5. Evidence — Transcript](#5-evidence--transcript) |
| `evidence` (`user-feedback`) | `pm/evidence/user-feedback/*.md` | 6 required | [6. Evidence — User Feedback](#6-evidence--user-feedback) |
| `insight` | `pm/insights/{domain}/*.md` | 7 required | [7. Insight](#7-insight) |
| `notes` | `pm/evidence/**/*.md` | 5 required | [8. Notes](#8-notes) |
| `thinking` | `pm/thinking/*.md` | 6 required + 1 optional | [9. Thinking](#9-thinking) |
| ~~`backlog-issue`~~ | — | — | [Deprecated Types](#deprecated-types) |
| ~~`proposal`~~ | — | — | [Deprecated Types](#deprecated-types) |
| ~~`idea`~~ | — | — | [Deprecated Types](#deprecated-types) |
| ~~`landscape`~~ | — | — | [Deprecated Types](#deprecated-types) |

---

## 1. Backlog

Files in `pm/backlog/*.md`. Every groomed or proposed feature, bug, or task.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"backlog"` | Document type discriminator |
| `id` | string | required | `TEAM-NNN` (e.g., `"PM-199"`) | Unique across all backlog items |
| `title` | string | required | — | Human-readable title |
| `outcome` | string | required | — | What changes when this ships — one sentence |
| `status` | enum | required | `"idea"` \| `"drafted"` \| `"proposed"` \| `"planned"` \| `"in-progress"` \| `"done"` | Lifecycle stage |
| `priority` | enum | required | `"critical"` \| `"high"` \| `"medium"` \| `"low"` | Urgency/importance ranking |
| `labels` | string[] | required | At least one entry | Categorization tags. Must be non-empty. |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `updated` | date | required | `YYYY-MM-DD` | Last modification date |
| `prd` | string\|null | optional | — | Relative path to PRD HTML, or null when PRD content is inline in this file |
| `rfc` | string\|null | optional | — | Relative path to RFC HTML (e.g., `"rfcs/foo.html"`) |
| `linear_id` | string\|null | optional | — | Linear issue ID for external tracking |
| `thinking` | string\|null | optional | — | Path to thinking artifact |
| `branch` | string\|null | optional | — | Git branch name when in progress |
| `parent` | string\|null | optional | — | Slug of parent backlog item (for child issues) |
| `children` | string[] | optional | — | Slugs of child backlog items |
| `prs` | string[] | optional | — | PR references (e.g., `"#188"`) |
| `research_refs` | string[] | optional | — | KB paths to research evidence |
| `evidence_strength` | enum\|null | optional | `"strong"` \| `"moderate"` \| `"weak"` | Strength of supporting evidence |
| `scope_signal` | enum\|null | optional | `"small"` \| `"medium"` \| `"large"` | Estimated implementation scope |
| `competitor_gap` | enum\|null | optional | `"unique"` \| `"partial"` \| `"parity"` \| `"behind"` | Competitive positioning |
| `size` | enum\|null | optional | `"XS"` \| `"S"` \| `"M"` \| `"L"` \| `"XL"` | T-shirt sizing estimate |
| `ac_count` | integer\|null | optional | Non-negative integer | Number of acceptance criteria |

### Example

```yaml
---
type: backlog
id: PM-199
title: Markdown frontmatter schemas
outcome: Every KB document has a validated, documented frontmatter schema
status: in-progress
priority: high
labels:
  - infrastructure
  - quality
created: 2026-04-12
updated: 2026-04-12
rfc: rfcs/markdown-frontmatter-schemas.html
branch: chore/frontmatter-schemas-ref
size: M
ac_count: 4
---
```

---

## 2. Strategy

Single file: `pm/strategy.md`. The product strategy document.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"strategy"` | Document type discriminator |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `updated` | date | required | `YYYY-MM-DD` | Last modification date |

Body sections (ICP, positioning, priorities, non-goals) are enforced by prose convention, not frontmatter.

### Example

```yaml
---
type: strategy
created: 2026-01-15
updated: 2026-04-10
---
```

---

## 3. Evidence — Research

Files in `pm/evidence/research/*.md`. External and internal research findings.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"evidence"` | Document type discriminator |
| `evidence_type` | string | required | `"research"` | Must match parent folder name |
| `topic` | string | optional | — | Human-readable topic name |
| `source_origin` | enum | required | `"internal"` \| `"external"` \| `"mixed"` | Where the research originated |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `updated` | date | optional | `YYYY-MM-DD` | Last modification date. Defaults to `created` if absent. |
| `sources` | array | required | URL strings or `{url, accessed}` objects | Source references |
| `cited_by` | string[] | required | — | KB paths to insight files that cite this evidence |

### Example

```yaml
---
type: evidence
evidence_type: research
topic: AI-assisted product management tools
source_origin: external
created: 2026-03-15
updated: 2026-04-01
sources:
  - https://example.com/report
  - url: https://example.com/survey
    accessed: 2026-03-14
cited_by:
  - insights/product/competitive-landscape.md
---
```

---

## 4. Evidence — Competitor

Files in `pm/evidence/competitors/{slug}/*.md`. Five sub-artifact types.

Unlike other evidence types (which use `type: evidence` + `evidence_type`), competitor files use the sub-type directly as the `type` value (e.g., `type: competitor-profile`). The validator routes on `type.startsWith('competitor-')` BEFORE the `type === 'evidence'` check.

### Base Schema

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"competitor-profile"` \| `"competitor-features"` \| `"competitor-sentiment"` \| `"competitor-api"` \| `"competitor-seo"` | Artifact sub-type |
| `company` | string | required | — | Display name (e.g., "ChatPRD") |
| `slug` | string | required | — | URL-safe identifier, must match parent folder name |
| `profiled` | date | required | `YYYY-MM-DD` | When profiling was done |
| `sources` | array | required | URL strings, `{url, accessed}`, or `{platform, url, accessed}` objects | Source references |
| `cited_by` | string[] | optional | — | KB paths to insight files |

Each competitor artifact sub-type may have additional fields specific to its purpose (e.g., `review_count_sampled` on sentiment, `domain` on profile, `seo_data_available` on seo, `api_available` on api). These are optional and not validated — only the base schema above is enforced.

### Example

```yaml
---
type: competitor-profile
company: ChatPRD
slug: chatprd
profiled: 2026-03-20
sources:
  - https://chatprd.ai
  - url: https://www.g2.com/products/chatprd
    accessed: 2026-03-19
cited_by:
  - insights/product/competitive-landscape.md
domain: chatprd.ai
---
```

---

## 5. Evidence — Transcript

Files in `pm/evidence/transcripts/*.md`. Interview and meeting transcripts.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"evidence"` | Document type discriminator |
| `evidence_type` | string | required | `"transcript"` | Derived from folder name `transcripts/` |
| `source_origin` | enum | required | `"internal"` \| `"external"` \| `"mixed"` | Where the transcript originated |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `sources` | array | required | URL strings or `{url, accessed}` objects | Source references |
| `cited_by` | string[] | required | — | KB paths to citing insights |

### Example

```yaml
---
type: evidence
evidence_type: transcript
source_origin: internal
created: 2026-02-28
sources:
  - url: https://zoom.us/rec/abc123
    accessed: 2026-02-28
cited_by:
  - insights/product/user-pain-points.md
---
```

---

## 6. Evidence — User Feedback

Files in `pm/evidence/user-feedback/*.md`. Normalized customer evidence.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"evidence"` | Document type discriminator |
| `evidence_type` | string | required | `"user-feedback"` | Derived from folder name |
| `source_origin` | enum | required | `"internal"` \| `"external"` \| `"mixed"` | Where the feedback originated |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `sources` | array | required | URL strings or `{url, accessed}` objects | Source references |
| `cited_by` | string[] | required | — | KB paths to citing insights |

### Example

```yaml
---
type: evidence
evidence_type: user-feedback
source_origin: external
created: 2026-03-10
sources:
  - url: https://github.com/org/repo/issues/42
    accessed: 2026-03-10
cited_by:
  - insights/product/user-pain-points.md
---
```

---

## 7. Insight

Files in `pm/insights/{domain}/*.md`. Synthesized findings derived from evidence.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"insight"` | Document type discriminator |
| `domain` | string | required | — | Must match parent folder (e.g., `"product"`, `"business"`). Lowercase, alphanumeric + hyphens. |
| `topic` | string | required | — | Human-readable topic name |
| `last_updated` | date | required | `YYYY-MM-DD` | When the insight was last refreshed |
| `status` | enum | required | `"active"` \| `"stale"` \| `"draft"` | Currency of the insight |
| `confidence` | enum | required | `"high"` \| `"medium"` \| `"low"` | Confidence level |
| `sources` | string[] | required | — | KB paths to evidence files (must start with `evidence/`) |

### Example

```yaml
---
type: insight
domain: product
topic: Competitive landscape analysis
last_updated: 2026-04-05
status: active
confidence: high
sources:
  - evidence/competitors/chatprd/profile.md
  - evidence/competitors/prodpad/profile.md
  - evidence/research/ai-pm-tools-survey.md
---
```

---

## 8. Notes

Monthly note capture files. Already validated.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"notes"` | Document type discriminator |
| `month` | string | required | `YYYY-MM` | Month covered by this notes file |
| `updated` | date | required | `YYYY-MM-DD` | Last modification date |
| `note_count` | integer | required | Non-negative integer | Count of notes in the file |
| `digested_through` | date\|null | required | `YYYY-MM-DD` or `null` | Last date through which notes were digested |

### Example

```yaml
---
type: notes
month: 2026-04
updated: 2026-04-12
note_count: 7
digested_through: 2026-04-10
---
```

---

## 9. Thinking

Files in `pm/thinking/*.md`. Product thinking artifacts produced by the `think` skill.

| Field | Type | Req? | Valid Values | Description |
|---|---|---|---|---|
| `type` | string | required | `"thinking"` | Document type discriminator |
| `topic` | string | required | — | Human-readable topic name |
| `slug` | string | required | — | Kebab-case identifier, must match filename |
| `created` | date | required | `YYYY-MM-DD` | Creation date |
| `updated` | date | required | `YYYY-MM-DD` | Last modification date |
| `status` | enum | required | `"active"` \| `"parked"` \| `"promoted"` | Lifecycle stage |
| `promoted_to` | string\|null | optional | — | Downstream slug when `status: promoted`, otherwise `null` |

### Constraints

- `promoted_to` must be a kebab-case slug — not a file path, Linear ID, or free text
- `promoted_to` should be non-null when `status` is `promoted`. Prefer groom session slug; backlog slug is acceptable when no groom session exists. `null` is acceptable only when the idea was implemented directly without a formal downstream artifact.
- `promoted_to` must be null (or absent) when `status` is not `promoted`
- `slug` must match the filename (without `.md` extension)

### Example

```yaml
---
type: thinking
topic: Plugin marketplace search UX
slug: marketplace-search-ux
created: 2026-04-10
updated: 2026-04-13
status: active
promoted_to: null
---
```

---

## Deprecated Types

The following `type` values are deprecated. The validator accepts them during a transition period but emits deprecation warnings. All should be migrated to their canonical replacements.

### `backlog-issue` (141 files)

**Migration:** Change `type: backlog-issue` to `type: backlog`. No other field changes needed.

Previously the default type emitted by the groom skill. Replaced by `type: backlog` as the canonical value.

### `proposal` (26 files)

**Migration:** Change `type: proposal` to `type: backlog`. No other field changes needed.

Used for early-stage backlog items. All proposals are backlog items — the lifecycle stage is captured by `status`, not `type`.

### `idea` (3 files)

**Migration:** Change `type: idea` to `type: backlog`. No other field changes needed.

Used for rough ideas. Like proposals, the lifecycle stage belongs in `status: idea`, not as a separate type.

### `landscape` (insight reclassification)

**Migration:** Change `type: landscape` to `type: insight`. Rename `title` to `topic`. Add missing required fields: `domain`, `status`, `confidence`, `last_updated`, `sources`.

The landscape document lives in `insights/business/` and is a synthesized insight, not a distinct type. Files affected: `competitive-landscape.md` and `landscape.md`.
