---
name: Link
order: 11
description: Create proposal entry in backlog, Linear integration, retro extraction, cleanup
applies_to: [quick, standard, full]
---

### Step 11: Link

1. **Enrich backlog entry metadata.** The proposal file already exists at `{pm_dir}/backlog/{topic-slug}.md` (written in Draft Proposal / Present). Do NOT rewrite it. Only add linking metadata:
   - **Thinking discovery:** Check if `{pm_dir}/thinking/{topic-slug}.md` exists. If found, set `thinking: thinking/{topic-slug}.md` in the backlog frontmatter. If not found, set `thinking: null`.
   - **ID rule:** If `linear_id` is available, set `id` to the Linear identifier. Otherwise use the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1).
   - Set `linear_id` in frontmatter if known from session state.

2. **Linear integration:**

   **If `linear_id` is set in the groom session state** (issue already exists in Linear):
   - Do NOT create a new Linear issue.
   - Fetch the current issue description via `get_issue` (to get the latest version).
   - Write a comment to the existing issue via `save_comment` with the groom output:
     ```
     ## Groom Output (auto-generated)

     **Scope:** {in-scope items}
     **Out of scope:** {out-of-scope items}
     **Feasibility:** {verdict}
     **Research:** {1-line summary}
     **Proposal:** See local file at {pm_dir}/backlog/{topic-slug}.md
     ```
   - Update the issue description via `save_issue`: append below a separator. **Idempotency rule:** If the description already contains `## Enriched Scope (auto-groom)`, replace content from that heading up to (but not including) the next `## ` heading or end of description, whichever comes first. This preserves any human-added sections below the enriched block.
     ```
     {existing description, up to but not including any prior enrichment}

     ---
     ## Enriched Scope (auto-groom)
     **In scope:** {in-scope items}
     **Out of scope:** {out-of-scope items}
     **10x filter:** {filter_result}
     ```
   - Set `linear_id` in the backlog entry frontmatter to `linear_id`.
   - Say: "Groom output written back to Linear issue {ID}. Scope enriched."

   **If `linear_id` is NOT set** (existing flow, unchanged):
   - If Linear is configured (`{pm_state_dir}/config.json` has `linear: true` or Linear MCP is available):
     - **Sanitize local file links before sending to Linear.** Linear's markdown renderer treats relative links as relative to the Linear issue URL. Before constructing the description:
       - Convert `[text]({pm_dir}/...)` → `text (\`{pm_dir}/...\`)` — plain text with path in backticks
       - Leave absolute URLs (starting with `http://` or `https://`) unchanged
     - Create a single parent issue in Linear. Capture the Linear ID.
     - **Update the local backlog entry's `id` to match the Linear identifier.** The Linear ID is the single source of truth when a tracker is available — do not maintain a separate local PM-{NNN} sequence.
     - Do NOT create child issues — issue splitting happens later during RFC generation in `pm:dev`.
     - Say: "Proposal linked in Linear. ID: {ID}."

3. **Validate written artifacts.** Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
   ```
   If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

4. Update state:

```yaml
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  prd_path: null
  linear_id: "{Linear ID}" | null
```

5. **Retro extraction — extract learnings before cleanup.**

   This step runs after artifact validation and before state file deletion. If extraction fails at any point, do NOT delete the state file. Instead, write `retro_failed: true` to the state file and say:
   > "Retro extraction failed; session state preserved for retry."
   Then stop — do not proceed to deletion.

   **5a. Scan for extractable events.** Read the groom session state (`{pm_state_dir}/groom-sessions/{topic-slug}.md`) and check for these events:

   | Event | Condition | Category | Learning template |
   |-------|-----------|----------|-------------------|
   | Scope review send-back | `scope_review.pm_verdict` = `rethink-scope` or `wrong-priority` | `scope` | "from scope review: sent back for {pm_verdict}" |
   | Bar raiser send-back | `bar_raiser.verdict` = `send-back` | `quality` | "from bar raiser: sent back — {detail from bar_raiser section if available}" |
   | Team review blocking fixes | `team_review.blocking_issues_fixed` > 0 | `review` | "from team review: {N} blocking issues fixed" |
   | Strategy check failure | `strategy_check.status` = `failed` | `process` | "from strategy check: failed against {strategy_check.checked_against}" |

   **5b. No events — skip silently.** If none of the conditions above match, log internally "no learnings detected this session" and skip to step 6 (state file deletion). Do NOT prompt the user.

   **5c. Events found — present auto-extracted learnings.** Build one learning entry per matched event using the templates above, filling in specifics from the session state. Present the list to the user:

   > "Retro: {N} learning(s) extracted from this groom session:
   > 1. [{category}] {learning text}
   > ...
   > Options: (a) Accept as-is (b) Add your own learnings too (c) Accept auto-extracted only"

   Wait for the user's answer.
   - **(a) or (c):** Proceed with auto-extracted entries only.
   - **(b):** Collect additional learnings from the user. Each user-provided learning needs `category` (offer the valid set: `scope`, `research`, `review`, `process`, `quality`) and a one-liner. Append them to the auto-extracted list.

   This is a hard gate — at minimum the auto-extracted learnings must be written before state file deletion.

   **5d. Deduplicate.** Read `{pm_dir}/memory.md`. For each entry to write, check existing entries: if any existing entry matches on `source` + `date` + first 50 characters of `learning`, skip that entry (already written, likely from a prior retro attempt on the same session).

   **5e. Concurrent write guard.** Immediately before appending, re-read `{pm_dir}/memory.md` to get the latest state. Append new (non-duplicate) entries to the `entries` list from the freshly-read version, not from any earlier read.

   **5f. Write entries.** Each entry uses this format inside the `entries` list:

   ```yaml
   - date: {today, YYYY-MM-DD}
     source: "{topic-slug}"
     category: "{mapped category}"
     learning: "{one-liner from template or user}"
     detail: "{optional — only if additional context is available}"
   ```

   Write the updated `{pm_dir}/memory.md` preserving the existing frontmatter structure (`type: project-memory`).

   **5g. Post-write cap check.** After writing, count total entries in `{pm_dir}/memory.md`. If count exceeds 50, follow the algorithm in `${CLAUDE_PLUGIN_ROOT}/references/memory-cap.md`:
   - Move oldest non-pinned entries to `{pm_dir}/memory-archive.md` until count <= 50
   - If all entries are pinned, warn the user

   **5h. Validate.** Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "{pm_dir}"
   ```
   If validation fails, fix the entries and re-validate before proceeding.

6. **Delete state file.**

Delete `{pm_state_dir}/groom-sessions/{topic-slug}.md` after successful retro extraction (or silent skip) and link. Grooming is complete.

Say:
> "Grooming complete for '{topic}'. Proposal saved to `{pm_dir}/backlog/{topic-slug}.md`.
> Next: run `pm:dev {topic-slug}` to generate the engineering RFC and begin implementation."
