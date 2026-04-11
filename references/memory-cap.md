# Memory Cap Enforcement

Shared reference for enforcing the 50-entry cap on `pm/memory.md`. Referenced by the dev retro step and groom retro extraction.

---

## Algorithm

1. **Read** `{pm_dir}/memory.md` and parse the `entries` list from frontmatter
2. **Count** entries. If count <= 50, stop — no action needed
3. **Separate** pinned (`pinned: true`) entries from non-pinned entries
4. **All-pinned check:** If every entry is pinned, warn the user:
   > "All entries are pinned — cannot archive. Unpin some entries to make room."
   Do NOT delete any entries. Stop here.
5. **Sort** non-pinned entries by `date` ascending (oldest first)
6. **Select** the oldest non-pinned entries to archive. Archive enough so the remaining count is exactly 50.
   - Number to archive: `total_entries - 50`
   - Only non-pinned entries are eligible for archival
7. **Write archive:** Read existing `{pm_dir}/memory-archive.md` (or create it if missing). Append selected entries to the `entries` list, adding `archived_at: {today}` to each entry. Preserve any entries already in the archive.
8. **Write memory:** Remove the archived entries from `{pm_dir}/memory.md` and re-write the file
9. **Validate** both files by running:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
   ```

---

## Concurrent Write Guard

Re-read `{pm_dir}/memory.md` immediately before modifying it. Another skill invocation may have appended entries between your initial read and your write. Use the freshly-read version for all count and sort logic.

---

## Archive File Format

`{pm_dir}/memory-archive.md` uses the same YAML frontmatter structure as `memory.md`, with type `project-memory-archive`. Each archived entry carries an `archived_at` date.

```yaml
---
type: project-memory-archive
archived_at: 2026-04-11
entries:
  - date: 2026-01-15
    source: retro
    category: process
    learning: "example archived learning"
    archived_at: 2026-04-11
  - date: 2026-01-20
    source: retro
    category: scope
    learning: "another archived learning"
    detail: "optional expanded context"
    archived_at: 2026-04-11
---
```

### Required fields per entry

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `date` | YYYY-MM-DD | yes | Original date of the learning |
| `source` | string | yes | `retro`, `groom`, or other origin |
| `category` | string | yes | `scope`, `research`, `review`, `process`, `quality` |
| `learning` | string | yes | One-line summary |
| `detail` | string | no | Expanded context |
| `pinned` | boolean | no | Should always be absent or `false` in archive (pinned entries are never archived) |
| `archived_at` | YYYY-MM-DD | yes | Date the entry was moved to archive |

### Document-level frontmatter

| Field | Value |
|-------|-------|
| `type` | `project-memory-archive` |
| `archived_at` | Date of last archival run (YYYY-MM-DD) |

---

## Cap Threshold

**50 entries.** This keeps the memory file scannable and fast to parse at skill intake. The archive preserves history without inflating the active working set.
