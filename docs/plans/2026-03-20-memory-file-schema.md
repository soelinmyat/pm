# PM-039: Define Project Memory File Schema

**Parent:** PM-038 (Project Memory System)
**Date:** 2026-03-20

## Problem

The PM plugin needs a structured file (`pm/memory.md`) to persist learnings across grooming sessions. Without a defined schema, entries will be inconsistent and hard for future sessions to parse programmatically.

## Key Decision: Parser Approach

**Decision: Port the array-of-objects parsing logic from `scripts/server.js` (lines 170-206) into `scripts/validate.js`.**

Rationale:
- The current `parseFrontmatter()` in `scripts/validate.js` (lines 21-57) only handles flat scalars and flat arrays (`- item`). It cannot parse the `entries:` key which contains an array of objects (each entry has `date`, `source`, `category`, `learning`, optionally `detail`).
- The `parseFrontmatter()` in `scripts/server.js` (lines 136-215) already handles array-of-objects with the `objItemMatch` + continuation-line logic.
- Sharing the parser (extracting to a shared module) would be cleaner long-term, but is out of scope for PM-039 — it would require updating both `validate.js` and `server.js` imports plus test coverage for the shared module. We port the relevant subset instead: just the array-of-objects loop from server.js into validate.js's existing parser.

## pm/memory.md Schema

```yaml
---
type: project-memory
created: 2026-03-20
updated: 2026-03-20
entries:
  - date: 2026-03-20
    source: groom-session-001
    category: scope
    learning: Splitting large epics into sub-issues before grooming reduces rework
    detail: During PM-025 grooming, the epic was too large to groom atomically. Breaking it into 4 sub-issues made each session more focused.
  - date: 2026-03-19
    source: retro
    category: process
    learning: Running validate.js before committing catches frontmatter errors early
---

# Project Memory

Learnings captured from grooming sessions, retros, and manual observations.
```

### Frontmatter fields

| Field | Required | Type | Constraints |
|---|---|---|---|
| `type` | yes | string | Must be `"project-memory"` |
| `created` | yes | string | YYYY-MM-DD format |
| `updated` | yes | string | YYYY-MM-DD format |
| `entries` | yes | array | Array of entry objects (may be empty `[]`) |

### Entry object fields

| Field | Required | Type | Constraints |
|---|---|---|---|
| `date` | yes | string | YYYY-MM-DD format |
| `source` | yes | string | Session slug, `"retro"`, or `"manual"` |
| `category` | yes | string | One of: `scope`, `research`, `review`, `process`, `quality` |
| `learning` | yes | string | One-line summary |
| `detail` | no | string | Expanded context (progressive disclosure) |

## Task Breakdown

### Task 1: Upgrade `parseFrontmatter()` in `scripts/validate.js`

**File:** `scripts/validate.js` (lines 21-57)

Port the array-of-objects parsing from `server.js` into the existing `parseFrontmatter()`. Specifically:
- When a `- key: value` pattern is encountered inside an array, create an object and collect continuation lines (indented `key: value` without a leading `-`).
- Keep backward compatibility: flat arrays (`- scalar`) must still work for existing backlog `children` fields.

The upgraded parser should turn:
```yaml
entries:
  - date: 2026-03-20
    source: retro
    category: process
    learning: Some learning
    detail: More context
  - date: 2026-03-19
    source: manual
    category: scope
    learning: Another learning
```
into:
```js
{
  entries: [
    { date: '2026-03-20', source: 'retro', category: 'process', learning: 'Some learning', detail: 'More context' },
    { date: '2026-03-19', source: 'manual', category: 'scope', learning: 'Another learning' }
  ]
}
```

### Task 2: Add `validateMemory()` function in `scripts/validate.js`

**File:** `scripts/validate.js`

Add after `validateStrategy()` (~line 126):
1. New constants:
   - `VALID_MEMORY_CATEGORIES = ['scope', 'research', 'review', 'process', 'quality']`
   - `REQUIRED_MEMORY_ENTRY_FIELDS = ['date', 'source', 'category', 'learning']`
2. `validateMemory(filePath, data, errors, warnings)`:
   - Check `type === 'project-memory'`
   - Check `created` and `updated` exist and are YYYY-MM-DD
   - Check `entries` is an array
   - For each entry (with index for error messages):
     - Check all required fields present
     - Check `date` is YYYY-MM-DD
     - Check `category` is one of the 5 valid values
     - Check `learning` is a non-empty string
   - If `entries.length > 50`, push a **warning** (not error): `"memory.md has ${n} entries — consider archiving older entries"`

### Task 3: Wire memory validation into `validate()` main function

**File:** `scripts/validate.js` (inside `validate()`, after the strategy validation block ~line 211)

Add a block that:
1. Checks if `path.join(pmDir, 'memory.md')` exists
2. If it does: read, parse frontmatter, validate with `validateMemory()`
3. If frontmatter is missing, push an error
4. This is non-blocking for groom flow: validation reports errors/warnings but the groom skill decides whether to halt

### Task 4: Create `pm/memory.md` with schema and seed entry

**File:** `pm/memory.md`

Create the initial file with:
- Valid frontmatter matching the schema
- One seed entry as an example
- A markdown body section explaining the file's purpose (human-readable without tooling, per AC-4)

### Task 5: Add tests for memory validation

**File:** `tests/validate.test.js`

Add test cases:
1. Valid memory.md passes validation
2. Missing required entry field reports error (e.g., missing `category`)
3. Invalid category enum reports error
4. Invalid date format in entry reports error
5. Entry count > 50 produces warning (not error)
6. memory.md with no frontmatter reports error
7. memory.md with wrong type reports error
8. memory.md with empty entries array passes validation
9. Real pm/ directory still passes validation (existing test covers this — just ensure new file doesn't break it)

### Task 6: Run tests, verify

Run `node tests/validate.test.js` and confirm all existing + new tests pass.

## Out of Scope

- Extracting a shared `parseFrontmatter()` module (future cleanup)
- Groom flow integration (PM-040, PM-041 handle this)
- Memory injection at session start (PM-042)
- Archiving/pruning old entries (future issue if needed)
