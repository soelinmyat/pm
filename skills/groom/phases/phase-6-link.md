### Phase 6: Link (optional)

1. Check if Linear is configured (`.pm/config.json` has `linear: true` or Linear MCP is available).

2. **If Linear configured:**
   - **Sanitize local file links before sending to Linear.** Linear's markdown renderer treats relative links as relative to the Linear issue URL, producing broken links like `https://linear.app/.../pm/research/...`. Before constructing the issue description:
     - Convert `[text](pm/...)` → `text (\`pm/...\`)` — plain text with path in backticks
     - Convert `[text](pm/backlog/wireframes/...)` → `text (\`pm/backlog/wireframes/...\`)`
     - Apply to all sections: Research Links, Wireframes, Proposal links, and any other relative paths starting with `pm/`
     - Leave absolute URLs (starting with `http://` or `https://`) unchanged
     - Mermaid `%% Source:` comments are inside code blocks and are not affected
   - Create parent issue first. Capture the Linear ID.
   - Create child issues, linking each to the parent.
   - Say: "Issues created in Linear. Parent: {ID}. Children: {IDs}."

3. **If no Linear:**
   - Write each issue to `pm/backlog/{issue-slug}.md` (see Backlog Issue Format in the main SKILL.md).
   - Link child issues to parent via `parent:` frontmatter field.

4. **Validate written artifacts.** Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"
   ```
   If validation fails, fix the frontmatter errors before proceeding. Do not surface the validation step to the user — just fix silently and move on.

5. Update state, then clean up:

```yaml
issues:
  - slug: "{issue-slug}"
    status: created | linked
    linear_id: "{ID}" | null
```

Delete `.pm/.groom-state.md` after successful link. Grooming is complete.

Say:
> "Grooming complete for '{topic}'. {N} issues created.
> Recommended next: $pm-ideate for more ideas, $pm-groom {next-idea}, or update priorities in pm/strategy.md."
