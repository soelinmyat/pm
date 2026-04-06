# KB Schema Design (PM-144) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KB schema contract authoritative across docs, validation, and dashboard parsing so the repo has one consistent definition for insight, evidence, `index.md`, and `log.md`.

**Architecture:** Document the canonical KB contract in `references/templates/kb-schemas.md`, extract shared frontmatter/path helpers into a reusable script module, and have both `scripts/validate.js` and `scripts/server.js` consume that shared logic. Then add validator coverage for schema shape, folder/frontmatter alignment, index row completeness, log formatting, and strict bidirectional citation reciprocity.

**Apps/services affected:** `references/templates/kb-schemas.md`, `scripts/kb-frontmatter.js`, `scripts/validate.js`, `scripts/server.js`, `tests/validate.test.js`, `tests/server.test.js`
**Cross-boundary sync required:** no

**Tech Stack:** Node.js (built-in `node:test`), plain JavaScript, repo-local markdown/frontmatter parsing

## Contract

> What is binding for this implementation. Reviewers and implementers use this to judge completeness and drift.

**Done criteria:**
1. Insight schema is documented and enforced: `type: insight`, `domain`, `topic`, `last_updated`, `sources`, `status`, `confidence`.
2. Evidence schema is documented and enforced: `type: evidence`, `evidence_type`, `source_origin`, `created`, `sources`, `cited_by`.
3. `index.md` contract is documented and enforced: header `| Topic/Source | Description | Updated | Status |` plus one row per non-`index.md`/`log.md` file in that folder.
4. `log.md` contract is documented and enforced: append-only one-line entries with date, action, and file reference.
5. Bidirectional citations are strict: if an insight cites an evidence file, that evidence file must cite the insight back in the same stored state.
6. The dashboard parser and validator share the same KB frontmatter semantics for empty arrays, scalar arrays, and body extraction.
7. Landscape placement is documented as `insights/business/landscape.md`.
8. Evidence type subfolders are documented as `evidence/research/`, `evidence/transcripts/`, and `evidence/user-feedback/`.
9. Folder/frontmatter alignment is enforced for new KB files:
   - `insights/<domain>/...` files must have matching `domain`
   - `evidence/<type>/...` files must have matching `evidence_type`
10. Canonical KB citations are repo-relative paths without leading `/` or `pm/`.
11. Legacy `pm/...` prefixes are treated as compatibility inputs only where old surfaces still read them; they are not valid for new KB file storage.
12. `npm test` passes.

**Verification commands:**
- `npm test`
- `node scripts/validate.js --dir pm`

**Files in scope:**
- Create: `references/templates/kb-schemas.md`
- Create: `scripts/kb-frontmatter.js`
- Modify: `scripts/validate.js`
- Modify: `scripts/server.js`
- Modify: `tests/validate.test.js`
- Modify: `tests/server.test.js`

**Risk notes:**
- This is effectively an **M-sized** change now, not S-sized, because it establishes shared parser behavior across both validator and dashboard surfaces.
- Existing backlog `research_refs` and old `pm/research/*` content remain in the repo during the epic. PM-144 should normalize legacy path inputs where needed, but it must define one canonical write format for the new KB structure.
- Do not overbuild a generic YAML system. The shared parser only needs to cover shapes already used in the repo plus the empty-array case that this epic introduces.

---

## Conventions (Binding)

- Canonical KB paths are repo-relative to `pm/`, use `/` separators, and must be stored without leading `/` or `pm/`.
  - Canonical evidence path: `evidence/research/acme-export-notes.md`
  - Canonical insight path: `insights/business/reporting-gaps.md`
- Legacy `pm/...` path prefixes may be normalized when reading old backlog/dashboard references, but new insight/evidence file frontmatter must not store them.
- `domain` is the folder name directly under `insights/`.
- `evidence_type` is the folder name directly under `evidence/`.
- Dates use `YYYY-MM-DD`.
- `sources` and `cited_by` are arrays only. Scalar strings are invalid.
- `index.md` must list every content file in its folder except `index.md` and `log.md`. Missing rows and extra rows are validation failures.
- Reciprocity failures are validation errors, not warnings.

---

### Task 1: Document The Canonical KB Contract

**Files:**
- Create: `references/templates/kb-schemas.md`

- [ ] **Step 1: Write the KB schema reference**

Document:
- insight frontmatter fields, enums, and examples
- evidence frontmatter fields, enums, and examples
- `index.md` table schema, including row expectations
- `log.md` line format and supported actions
- canonical citation format
- folder/frontmatter alignment rules
- compatibility note: legacy `pm/...` references can be normalized on read, but new KB file storage must use canonical unprefixed paths
- landscape placement and evidence type subfolders

- [ ] **Step 2: Add concrete examples that match parser constraints**

Examples must include:

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

```md
| Topic/Source | Description | Updated | Status |
|---|---|---|---|
| [Reporting gaps](reporting-gaps.md) | Export + reporting demand clusters | 2026-04-06 | active |
```

```txt
2026-04-06 create insights/business/reporting-gaps.md
2026-04-06 cite insights/business/reporting-gaps.md -> evidence/research/reporting-gaps-competitor-scan.md
```

- [ ] **Step 3: Commit**

```bash
git add references/templates/kb-schemas.md
git commit -m "docs: document canonical KB schema contract (PM-144)"
```

---

### Task 2: Extract Shared KB Frontmatter And Path Helpers

**Files:**
- Create: `scripts/kb-frontmatter.js`
- Modify: `scripts/validate.js`
- Modify: `scripts/server.js`
- Modify: `tests/server.test.js`

- [ ] **Step 1: Add failing parser tests**

In `tests/server.test.js`, add regression coverage for the shared parser semantics PM-144 depends on:
- empty arrays: `sources: []`, `cited_by: []`
- scalar arrays with quoted/unquoted values
- body extraction after frontmatter
- canonical and legacy path normalization helper behavior:
  - `evidence/research/foo.md` stays unchanged
  - `pm/evidence/research/foo.md` normalizes to `evidence/research/foo.md`
  - `/pm/evidence/research/foo.md` is rejected

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL because the shared parser/helper does not exist yet.

- [ ] **Step 3: Create `scripts/kb-frontmatter.js`**

Export helpers that are reused by both validator and dashboard code:
- `parseFrontmatter(content)` returning `{ data, body }`
- `normalizeKbPath(value)` for canonical vs legacy-path handling
- small date/path predicate helpers if needed (`isIsoDate`, `isCanonicalKbPath`)

Binding rules:
- support the frontmatter shapes the current server parser already handles
- additionally support explicit empty arrays (`[]`)
- do not add third-party YAML libraries

- [ ] **Step 4: Update `scripts/server.js` and `scripts/validate.js` to use the shared helper**

`scripts/server.js` should import the shared parser instead of carrying its own separate implementation.  
`scripts/validate.js` should stop using its custom parser and consume the same helper, so validation and dashboard reads cannot drift on frontmatter shape.

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: PASS for the new parser coverage.

- [ ] **Step 6: Commit**

```bash
git add scripts/kb-frontmatter.js scripts/server.js scripts/validate.js tests/server.test.js
git commit -m "refactor: share KB frontmatter parsing across validator and dashboard (PM-144)"
```

---

### Task 3: TDD Insight And Evidence Schema Validation

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing validation tests for insight files**

Add helpers and tests covering:
- valid insight passes
- missing required fields fail
- invalid `status` fails
- invalid `confidence` fails
- invalid `last_updated` date fails
- scalar `sources` fails
- `sources` entries with leading `/` fail
- `sources` entries with `pm/` prefix fail for new KB files
- `domain` mismatch with `insights/<domain>/...` folder fails
- `sources` pointing outside `evidence/` fail

- [ ] **Step 2: Add failing validation tests for evidence files**

Cover:
- valid evidence passes
- missing `evidence_type` fails
- invalid `source_origin` fails
- invalid `created` date fails
- scalar `sources` fails
- scalar `cited_by` fails
- `cited_by` entries with leading `/` or `pm/` fail
- `evidence_type` mismatch with `evidence/<type>/...` folder fails
- internal file references in `sources` that are not KB-relative fail

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test`
Expected: FAIL until schema validation is implemented.

- [ ] **Step 4: Implement schema validation in `scripts/validate.js`**

Binding behavior:
- walk `pm/insights/**.md` and `pm/evidence/**.md`, skipping `index.md` and `log.md`
- enforce required fields and enums
- enforce array-only semantics for `sources` and `cited_by`
- validate dates with `YYYY-MM-DD`
- enforce folder/frontmatter alignment
- treat canonical unprefixed paths as valid for new KB files
- do not silently coerce invalid scalar values into valid arrays

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: PASS for the new schema validation coverage.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: validate KB insight and evidence schemas (PM-144)"
```

---

### Task 4: Enforce Index And Log Contracts

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing tests for index completeness**

Add tests that validate:
- exact required header row
- exact delimiter row
- one entry per content file in the folder
- missing row for a content file fails
- extra row for a non-existent file fails
- row links stay folder-relative and do not point outside the folder

- [ ] **Step 2: Add failing tests for log format**

Validate:
- each non-empty line matches `YYYY-MM-DD <action> <path>`
- supported actions are `create|update|move|delete|cite|uncite`
- `cite` and `uncite` lines must use `A -> B`
- malformed dates and malformed cite arrows fail

- [ ] **Step 3: Run tests to verify failure**

Run: `npm test`
Expected: FAIL until index/log checks exist.

- [ ] **Step 4: Implement index/log validators**

Binding behavior:
- parse the markdown table enough to compare listed file links against actual folder contents
- ignore `index.md` and `log.md` when computing expected rows
- validate log lines strictly

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: validate KB index and log contracts (PM-144)"
```

---

### Task 5: Enforce Strict Bidirectional Citations

**Files:**
- Modify: `scripts/validate.js`
- Modify: `tests/validate.test.js`

- [ ] **Step 1: Add failing reciprocity tests**

Cover:
- insight cites evidence but evidence does not cite back -> fail
- evidence cites insight but insight does not cite that evidence -> fail
- cited evidence file missing -> fail
- cited insight file missing -> fail
- wrong folder target (`insights/...` inside `sources`, `evidence/...` inside `cited_by`) -> fail

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement reciprocity checks**

Binding behavior:
- key files by canonical repo-relative path under `pm/`
- use canonicalized paths from the shared helper before comparison
- reciprocity violations are errors, not warnings
- missing counterpart files are errors for PM-144 because the schema contract is meant to be authoritative for the new KB layer

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/validate.js tests/validate.test.js
git commit -m "feat: enforce KB bidirectional citation reciprocity (PM-144)"
```
