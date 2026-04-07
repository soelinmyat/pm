### Phase 6: Link

1. **Write the proposal backlog entry** (if not already written in Phase 5.8):
   - Write `pm/backlog/{topic-slug}.md` using the Proposal Format from the main SKILL.md.
   - Set `status: proposed`, `verdict:` from bar raiser, `prd: proposals/{topic-slug}.html`, `rfc: null`.
   - Create the `pm/backlog/` directory if needed (`mkdir -p pm/backlog`).

2. **If Linear is configured** (`.pm/config.json` has `linear: true` or Linear MCP is available):
   - **Sanitize local file links before sending to Linear.** Linear's markdown renderer treats relative links as relative to the Linear issue URL. Before constructing the description:
     - Convert `[text](pm/...)` → `text (\`pm/...\`)` — plain text with path in backticks
     - Leave absolute URLs (starting with `http://` or `https://`) unchanged
   - Create a single parent issue in Linear. Capture the Linear ID.
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
