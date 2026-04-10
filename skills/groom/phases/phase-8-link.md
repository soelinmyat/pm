### Phase 8: Link

1. **Update the proposal backlog entry** (if not already finalized in Phase 7):
   - Write `pm/backlog/{topic-slug}.md` using the Proposal Format from the main SKILL.md.
   - Set `status: proposed`, `prd: proposals/{topic-slug}.html`, `rfc: null`, `linear_id: "{linear_id}" | null`.
   - **Thinking discovery:** Check if `pm/thinking/{topic-slug}.md` exists. If found, set `thinking: thinking/{topic-slug}.md` in the backlog frontmatter. If not found, set `thinking: null`.
   - **ID rule:** If `linear_id` is available, set `id` to the Linear identifier. Otherwise use the local `PM-{NNN}` sequence.
   - Create the `pm/backlog/` directory if needed (`mkdir -p pm/backlog`).

2. **Linear integration:**

   **If `linear_id` is set in the groom session state** (issue already exists in Linear):
   - Do NOT create a new Linear issue.
   - Fetch the current issue description via `get_issue` (to get the latest version).
   - Write a comment to the existing issue via `save_comment` with the groom output:
     ```
     ## Groom Output (auto-generated)

     **Scope:** {in-scope items}
     **Out of scope:** {out-of-scope items}
     **Acceptance Criteria:**
     {numbered AC list}
     **Feasibility:** {verdict}
     **Research:** {1-line summary}
     ```
   - Update the issue description via `save_issue`: append below a separator. **Idempotency rule:** If the description already contains `## Enriched AC (auto-groom)`, replace content from that heading up to (but not including) the next `## ` heading or end of description, whichever comes first. This preserves any human-added sections below the enriched block.
     ```
     {existing description, up to but not including any prior enrichment}

     ---
     ## Enriched AC (auto-groom)
     {numbered AC list}
     ```
   - Set `linear_id` in the backlog entry frontmatter to `linear_id`.
   - Say: "Groom output written back to Linear issue {ID}. AC enriched."

   **If `linear_id` is NOT set** (existing flow, unchanged):
   - If Linear is configured (`.pm/config.json` has `linear: true` or Linear MCP is available):
     - **Sanitize local file links before sending to Linear.** Linear's markdown renderer treats relative links as relative to the Linear issue URL. Before constructing the description:
       - Convert `[text](pm/...)` → `text (\`pm/...\`)` — plain text with path in backticks
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
  backlog_path: pm/backlog/{topic-slug}.md
  prd_path: pm/backlog/proposals/{topic-slug}.html
  linear_id: "{Linear ID}" | null
```

Delete `.pm/groom-sessions/{topic-slug}.md` after successful link. Grooming is complete.

Say:
> "Grooming complete for '{topic}'. Proposal saved to `pm/backlog/{topic-slug}.md`.
> Next: run `pm:dev {topic-slug}` to generate the engineering RFC and begin implementation."
