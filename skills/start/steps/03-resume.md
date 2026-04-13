---
name: Resume
order: 3
description: Refresh status, detect evidence, generate session brief, and recommend next move
---

## Resume Mode

### Goal

Give the user a fast session kickoff with update status, active-work detection, and one recommended next move.

### Flow

1. Refresh update status:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/check-start.sh
```

This refreshes `.pm/.update_status` and may print a one-line update notice at session start.

2. Auto-push (non-blocking):

Silently push local knowledge base changes to the server in the background. This step is fire-and-forget — it must never block the session brief or interrupt the user.

**Pre-conditions (both must be true):**
- `.pm/config.json` exists and contains a `projectId` field
- `~/.pm/credentials` exists

If either condition is missing, skip this step silently — produce no output.

**Execution:**

```bash
nohup node ${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync.js push > /dev/null 2>&1 &
```

This runs in the background. Do not wait for it to complete. Proceed to the next step immediately.

**Failure handling:**
- If the lock file (`.pm/sync.lock`) is held by a concurrent process, `kb-sync.js` exits cleanly without error — no action needed.
- Any sync errors are written to `sync-status.json` by the script's crash-safe wrapper (Issue #3). They do not surface to the user during `pm:start`.

3. Evidence detection:

Scan `{pm_dir}/evidence/user-feedback/` for unprocessed files and offer to route them to `pm:ingest`.

**Detection:**
- List all files in `{pm_dir}/evidence/user-feedback/` (non-recursive).
- Read `{pm_dir}/evidence/user-feedback/log.md`. Each non-heading, non-blank line contains a previously processed file path.
- Compute the difference: files present on disk but not listed in `log.md`.
- Filter out system files (`.DS_Store`, `.gitkeep`, `Thumbs.db`) — skip them entirely, do not show them.
- Filter out `index.md` and `log.md` themselves.
- If no unprocessed files remain, skip this step silently — produce no output.

**Name extraction (text-based files only):**

For each unprocessed file, attempt to extract a human-readable name:

| File type | Extraction rule |
|---|---|
| `.md` | First heading (`# ...`) |
| `.txt` | First non-empty line |
| `.html`, `.eml` | `Subject:` line if present, else `<title>` tag, else first non-empty line |
| Binary or unreadable files | Use the filename as the display name |

Read at most the first 5 lines of each file for extraction. If extraction fails or the file cannot be read, fall back to the filename.

**Display:**

Present a numbered list:

```text
Evidence drop zone — {N} new file(s):
1. "Pricing confusion on enterprise tier" (text, 4.8KB)
2. "user-interview-2026-04.md" (markdown, 12.1KB)
3. "feedback-export.csv" (csv, 89KB)
```

File type labels: use a human-friendly description based on extension (`.md` → "markdown", `.txt` → "text", `.csv` → "csv", `.eml` → "email", `.html` → "html", `.pdf` → "pdf", `.json` → "json"). For unknown extensions, use the extension itself. File size should use KB with one decimal for files under 1MB, MB with one decimal otherwise.

**User choice:**

Ask ONE question:

> "How do you want to handle these?
> (a) Ingest all
> (b) Pick specific files
> (c) Skip — leave for later"

Routing:
- **(a) Ingest all** → invoke `pm:ingest` with the full list of unprocessed file paths. After ingestion completes, append each file path with a timestamp to `{pm_dir}/evidence/user-feedback/log.md` in the format: `{relative_path_from_pm_dir} — {ISO 8601 timestamp}`.
- **(b) Pick specific files** → show the numbered list again and let the user select by number. Invoke `pm:ingest` with the selected files. After ingestion, append only the selected file paths to `log.md`.
- **(c) Skip** → continue with the normal flow. Files remain unprocessed for the next session.

After ingestion or skip, continue to step 4 (session brief).

4. Generate the canonical session brief:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/start-status.js --project-dir "$PWD" --format json --include-update
```

This script is the shared source of truth used by the runtime hook and should determine:

- whether PM is initialized
- whether an update is available
- whether active delivery or grooming work exists (see session locations below)
- the focus summary
- the backlog summary
- the recommended next move
- up to two concrete alternative moves

### Session file locations

When detecting active work, check the correct locations based on repo mode:

| Session type | Same-repo mode | Separate-repo mode |
|---|---|---|
| Groom sessions | `{pm_state_dir}/groom-sessions/*.md` | `{pm_state_dir}/groom-sessions/*.md` (PM repo) |
| Dev sessions | `{pm_state_dir}/dev-sessions/*.md` | `{source_dir}/.pm/dev-sessions/*.md` (source repo) |

In separate-repo mode, groom and dev sessions live in different repos. Always check both locations to detect all active work, regardless of which repo the user is standing in.

5. Pick the recommended next move using this priority:

- Any active delivery work (`dev`) → resume that work
- Active grooming work → resume `pm:groom`
- No durable work yet (no strategy, no insights, no evidence, no backlog) → go back to the first-workflow selector from Bootstrap Mode
- Missing strategy with insights or evidence already present → `pm:strategy`
- Stale insights or evidence → `pm:refresh`
- Idea-heavy backlog → `pm:groom`
- Otherwise → stay in Pulse Mode and let the user choose

6. Present the session brief in this format:

```text
PM ready.
Update: {update line}            # only if available
Dashboard: {dashboard line}      # always present (see variants below)
Focus: {active-session summary OR attention summary}
Backlog: {backlog line}          # if available
Next: {recommended next move}
Also: {alternative move}         # up to two lines, only if available
```

### Dashboard line variants

The `Dashboard:` line reflects the current sync status with productmemory.io. It appears in every Resume and Pulse Mode session brief but is not shown in Bootstrap Mode (first-run stays zero-config).

| Variant | Format |
|---------|--------|
| Configured + synced | `Dashboard: productmemory.io/project (synced 2m ago)` |
| Configured + sync failed | `Dashboard: productmemory.io/project (last sync failed)` |
| Not configured | `Dashboard: not configured — set up at productmemory.io` |

Rules:

- The `Dashboard:` line always appears between `Update:` and `Focus:`.
- If there is no update available, omit the `Update:` line.
- Use `Focus:` for the most important thing right now. Prefer an active session over a generic freshness summary.
- If the shared status output includes alternatives, show them as short `Also:` lines after `Next:`.
- If this was auto-invoked at session start, do **not** force the user into a follow-up choice. Show the brief and continue with their actual request.
- If the user explicitly invoked `/pm:start` with no other request:
  - when active work exists, ask one question:
    - "How do you want to proceed?
      (a) Continue the recommended path
      (b) Do something else"
  - when no active work exists, ask one question:
    - "Want me to continue with the recommended next move, or choose one of the alternatives?"

### Done-when

The session brief is printed with the correct dashboard, focus, and next move, and any explicit `/pm:start` follow-up question has been asked exactly once.
