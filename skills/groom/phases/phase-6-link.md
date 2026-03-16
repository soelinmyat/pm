### Phase 6: Link (optional)

1. Check if Linear is configured (`.pm/config.json` has `linear: true` or Linear MCP is available).

2. **If Linear configured:**
   - Create parent issue first. Capture the Linear ID.
   - Create child issues, linking each to the parent.
   - Add research artifact links as attachments or description links.
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
