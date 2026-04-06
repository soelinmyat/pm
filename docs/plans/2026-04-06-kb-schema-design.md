# KB Schema Design (PM-144) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and enforce minimal knowledge base (KB) file contracts (insight, evidence, index.md, log.md) so skills and the dashboard can parse files deterministically and stop guessing field names.

**Architecture:** Document the human-facing contract in `references/templates/kb-schemas.md`, and enforce it in `scripts/validate.js` with regression coverage in `tests/validate.test.js`. Keep the schema minimal for MVP, and keep validation shallow: frontmatter presence, required fields, enums, date formats, and bidirectional citations.

**Apps/services affected:** `scripts/validate.js`, `references/templates/kb-schemas.md`, `tests/validate.test.js`
**Cross-boundary sync required:** no

**Tech Stack:** Node.js (built-in `node:test`), plain JavaScript, repo-local frontmatter parser (no YAML dependencies)

## Contract

> What is binding for this implementation. Reviewers and implementers use this to judge completeness and drift.

**Done criteria:**
1. Insight file schema is documented and matches PM-144 AC: `type: insight`, `domain`, `topic`, `last_updated`, `sources` (array of evidence paths), `status` (active/stale/draft), `confidence` (high/medium/low).
2. Evidence file schema is documented and matches PM-144 AC: `type: evidence`, `evidence_type` (research/transcript/user-feedback/etc), `source_origin` (internal/external), `created`, `sources` (URLs or file refs), `cited_by` (array of insight paths).
3. `index.md` table contract is documented: `| Topic/Source | Description | Updated | Status |` with one row per file in that folder.
4. `log.md` contract is documented: append-only, one line per change with date, action, and file reference.
5. Bidirectional citation contract is documented and enforced in validation: when an insight lists evidence in `sources`, the evidence lists that insight in `cited_by`.
6. Schemas are documented in `references/templates/kb-schemas.md`.
7. Landscape placement is documented as `insights/business/landscape.md`.
8. Evidence type subfolders are documented: `evidence/research/`, `evidence/transcripts/`, `evidence/user-feedback/`.
9. `npm test` passes.

**Verification commands:**
- `npm test`

**Files in scope:**
- Create: `references/templates/kb-schemas.md`
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

**Risk notes:**
- **Parser mismatch risk:** `scripts/validate.js` and `scripts/server.js` use different frontmatter parsers. This work only updates validation; later KB restructure work should consolidate parsing to avoid drift.
- **Empty arrays:** Current validators and parsers treat `sources: []` as a string. This plan includes a minimal `[]` support in `scripts/validate.js` so empty `sources`/`cited_by` do not create false negatives.
- **Backwards compatibility:** Existing `pm/research/` and `research_refs` are unchanged here. This is a schema contract + validation only, not a migration.

---

## Conventions (Binding)

These conventions are part of the schema contract and should be reflected in both the docs and the validator.

- All KB paths in citations are **repo-relative to `pm/`**, use `/` separators, and do **not** start with `/` or `pm/`.
  - Example evidence path: `evidence/research/acme-export-notes.md`
  - Example insight path: `insights/business/reporting-gaps.md`
- `domain` is a **slug** (`[a-z0-9-]+`). Domains are discoverable by folder name under `insights/` (no hardcoded list).
- Dates are `YYYY-MM-DD`.
- Insight `sources` is an array of evidence file paths (strings).
- Evidence `sources` is an array of strings where each item is either:
  - an external URL (`https://...`), or
  - a repo-relative file reference (for internal artifacts) like `evidence/transcripts/user-interview-2026-04-01.md`.

---

### Task 1: Document KB Schemas And Formats

**Files:**
- Create: `references/templates/kb-schemas.md`

- [ ] **Step 1: Create `references/templates/kb-schemas.md` with the schemas and examples**

Include, at minimum, these examples (keep them valid for our simplistic frontmatter parser):

```md
---
type: insight
domain: business
topic: Reporting gaps
last_updated: 2026-04-06
status: active
confidence: medium
sources:
  - evidence/research/reporting-gaps-competitor-scan.md
  - evidence/user-feedback/export-requests-roundup.md
---
# Reporting gaps
```

```md
---
type: evidence
evidence_type: research
source_origin: external
created: 2026-04-06
sources:
  - https://example.com/report.pdf
cited_by:
  - insights/business/reporting-gaps.md
---
# Reporting gaps competitor scan
```

Index format:

```md
| Topic/Source | Description | Updated | Status |
|---|---|---|---|
| [Reporting gaps](reporting-gaps.md) | Export + reporting demand clusters | 2026-04-06 | active |
```

Log format:

```txt
2026-04-06 create insights/business/reporting-gaps.md
2026-04-06 cite insights/business/reporting-gaps.md -> evidence/research/reporting-gaps-competitor-scan.md
```

- [ ] **Step 2: Commit**

```bash
git add references/templates/kb-schemas.md
git commit -m "docs: add KB insight/evidence schema reference (PM-144)"
```

---

### Task 2: TDD Insight Schema Validation

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing tests for `type: insight` schema**

Add helpers to `tests/validate.test.js` for generating insight files:

```js
function makeInsight(overrides = {}) {
  const defaults = {
    type: "insight",
    domain: "business",
    topic: "Reporting gaps",
    last_updated: "2026-04-06",
    status: "active",
    confidence: "medium",
    sources: [],
  };
  const d = { ...defaults, ...overrides };
  let fm = "---\n";
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        fm += `${k}: []\n`;
      } else {
        fm += `${k}:\n`;
        for (const item of v) fm += `  - "${item}"\n`;
      }
    } else {
      fm += `${k}: ${v}\n`;
    }
  }
  fm += "---\n\n# " + d.topic + "\n";
  return fm;
}
```

Then add tests:
- Valid insight passes validation.
- Missing `domain` errors.
- Invalid `status` errors.
- Invalid `confidence` errors.
- Invalid date format for `last_updated` errors.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test`
Expected: FAIL (unknown file type not validated yet, or missing validation for required insight fields).

- [ ] **Step 3: Implement minimal insight validation in `scripts/validate.js`**

Implementation notes (binding):
- Walk `pm/insights/**.md` recursively (skip `index.md` and `log.md`).
- Require fields: `type`, `domain`, `topic`, `last_updated`, `status`, `confidence`, `sources`.
- Enums:
  - `status`: `active|stale|draft`
  - `confidence`: `high|medium|low`
- Allow `sources` to be empty; treat `sources: []` as an empty array in `parseFrontmatter`.
- Validate `domain` matches `/^[a-z0-9-]+$/`.
- Validate date fields match `/^\d{4}-\d{2}-\d{2}$/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for new insight tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: validate insight schema in pm/insights (PM-144)"
```

---

### Task 3: TDD Evidence Schema Validation

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing tests for `type: evidence` schema**

Add helpers to `tests/validate.test.js` for generating evidence files:

```js
function makeEvidence(overrides = {}) {
  const defaults = {
    type: "evidence",
    evidence_type: "research",
    source_origin: "external",
    created: "2026-04-06",
    sources: ["https://example.com/report.pdf"],
    cited_by: [],
  };
  const d = { ...defaults, ...overrides };
  let fm = "---\n";
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        fm += `${k}: []\n`;
      } else {
        fm += `${k}:\n`;
        for (const item of v) fm += `  - "${item}"\n`;
      }
    } else {
      fm += `${k}: ${v}\n`;
    }
  }
  fm += "---\n\n# Evidence\n";
  return fm;
}
```

Then add tests:
- Valid evidence passes validation.
- Missing `evidence_type` errors.
- Invalid `source_origin` errors.
- Invalid `created` date format errors.
- `sources` must be an array of strings (reject scalar).

- [ ] **Step 2: Run tests to verify failures**

Run: `npm test`
Expected: FAIL until evidence validation exists.

- [ ] **Step 3: Implement minimal evidence validation in `scripts/validate.js`**

Implementation notes (binding):
- Walk `pm/evidence/**.md` recursively (skip `index.md` and `log.md`).
- Require fields: `type`, `evidence_type`, `source_origin`, `created`, `sources`, `cited_by`.
- Enums:
  - `source_origin`: `internal|external`
  - `evidence_type`: accept at least `research|transcript|user-feedback` (document other values as future extension; validator can be strict for MVP).
- Validate `created` date format.
- Validate each entry of `sources` is either:
  - `https://` URL, or
  - a repo-relative path without leading `/` or `pm/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS for new evidence tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: validate evidence schema in pm/evidence (PM-144)"
```

---

### Task 4: Index/Log Formats And Bidirectional Citations

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing tests for `index.md` and `log.md` format**

Add tests that:
- An `index.md` in `pm/insights/business/index.md` must contain the header row exactly:
  - `| Topic/Source | Description | Updated | Status |`
- A `log.md` in `pm/insights/business/log.md` must have lines matching:
  - `YYYY-MM-DD <action> <path>`
  - with `<action>` in `create|update|move|delete|cite|uncite`

- [ ] **Step 2: Add failing tests for bidirectional citations**

Add tests that:
- If `insights/business/reporting-gaps.md` has `sources: [ "evidence/research/reporting-gaps.md" ]`,
  then `evidence/research/reporting-gaps.md` must have `cited_by: [ "insights/business/reporting-gaps.md" ]`.
- Missing reciprocal entry is an error (validation `ok: false`).

- [ ] **Step 3: Run tests to verify failures**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 4: Implement index/log validators + citation reciprocity**

Implementation notes (binding):
- `index.md`:
  - Only validate the table header + delimiter line. Do not attempt to parse full markdown tables for MVP.
- `log.md`:
  - Validate each non-empty line matches `/^\d{4}-\d{2}-\d{2} (create|update|move|delete|cite|uncite) [^ ]+(\s+->\s+[^ ]+)?$/`.
  - `cite` lines must include `A -> B` where A is insight path and B is evidence path.
- Citations:
  - Build maps of parsed insight files and evidence files keyed by repo-relative path under `pm/`.
  - For each insight `sources` entry that starts with `evidence/`:
    - Error if the target evidence file does not exist.
    - Error if the evidence file does not include this insight path in `cited_by`.
  - For each evidence `cited_by` entry:
    - Warning if the cited insight file does not exist (allow forward-references during drafts).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: validate KB index/log formats and bidirectional citations (PM-144)"
```

