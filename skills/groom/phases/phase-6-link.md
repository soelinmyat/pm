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

5. **Update state:**

```yaml
issues:
  - slug: "{issue-slug}"
    status: created | linked
    linear_id: "{ID}" | null
```

6. **Retro prompt.** Before deleting the state file, run a short retrospective:

   Say:
   > "Quick retro before we wrap up — three short questions."

   Ask the following questions **one at a time**. Wait for the user's answer before asking the next.

   | # | Question | Category |
   |---|----------|----------|
   | 1 | "What worked well in this session?" | quality |
   | 2 | "What was slow or frustrating?" | process |
   | 3 | "What should we do differently next time?" | process |

   **After each answer:**
   - If the user skips (says "skip", "none", "nothing", "pass", "n/a", or "no"):
     skip this question and all remaining questions. Do not write an entry for skipped questions.
   - Otherwise: write the answer as an entry to `pm/memory.md` (see write logic below), then ask the next question.

   **Write logic for each answered question:**
   1. If `pm/memory.md` does not exist, create it:
      ```yaml
      ---
      type: project-memory
      created: {today YYYY-MM-DD}
      updated: {today YYYY-MM-DD}
      entries: []
      ---

      # Project Memory

      Learnings captured from grooming sessions, retros, and manual observations.
      ```
   2. Read `pm/memory.md`. Parse the frontmatter.
   3. Append a new entry to the `entries` array using the **golden serialization format** (2-space indent for `- `, 4-space indent for continuation fields, quote values containing colons):
      ```yaml
        - date: {today YYYY-MM-DD}
          source: retro
          category: {category from table}
          learning: "{user's answer — preserve their words, trim to one line}"
      ```
   4. Update the `updated` field to today's date.
   5. Write the file back.

   **Serialization rules:** Use exactly 2-space indent + dash for entry start, 4-space indent for continuation fields. Quote any value containing a colon. This matches the parseFrontmatter() format validated in PM-039's round-trip test.

   After all 3 questions are answered (or a skip ends the retro), say:
   > "Retro captured — {N} learning(s) saved to pm/memory.md."

   If all questions were skipped (user skipped on question 1), say nothing about retro and proceed to step 7.

7. **Automated learning extraction.** Silently extract quantitative learnings from the state file. No user interaction.

   Read `.pm/groom-sessions/{slug}.md` and parse the frontmatter. If the file is missing or the frontmatter cannot be parsed, log a warning:
   > "Could not read session state for learning extraction — skipping."

   and proceed to step 8.

   Check each of the following conditions. For each that meets its threshold, generate a memory entry. If no conditions are met, skip to step 8 with no output.

   | # | Check | Threshold | Learning text | Category |
   |---|-------|-----------|---------------|----------|
   | 1 | `scope_review.iterations` | > 1 | "Scope needed {N} iterations — blocking issues: {summary of scope_review issues}" | `scope` |
   | 2 | `team_review.conditions` | array has ≥1 entry | "Team review required: {comma-separated conditions}" | `review` |
   | 3 | `bar_raiser.verdict` | === `"send-back"` | "Bar raiser sent back: {bar_raiser.conditions[0] or 'no reason given'}" | `review` |
   | 4 | Scope tightened during review | `scope_review.iterations` > 1 AND `scope.out_of_scope` is non-empty | "Scope tightened: {comma-separated out_of_scope items}" | `scope` |
   | 5 | Clean session | `scope_review.iterations` === 1 AND `bar_raiser.verdict` === `"ready"` | "Clean session — scope and reviews passed first iteration" | `quality` |

   **Missing fields:** If `scope_review`, `team_review`, or `bar_raiser` sections are missing from the state file, treat their values as null — the condition is not met and no entry is generated.

   **Write logic** (same as retro step, using the **golden serialization format** from PM-039):
   1. If `pm/memory.md` does not exist, create it with the PM-039 schema.
   2. Read `pm/memory.md`, parse the frontmatter.
   3. Append each generated entry to the `entries` array (2-space indent + dash for entry start, 4-space indent for continuation fields, quote values containing colons):
      ```yaml
        - date: {today YYYY-MM-DD}
          source: {session-slug}
          category: {category from table}
          learning: "{generated text}"
      ```
   4. Update the `updated` field to today's date.
   5. Write the file back.

   This step is completely silent — produce no user-facing output. Entries are appended after any retro entries from step 6.

8. **Clean up.** Delete `.pm/groom-sessions/{slug}.md` after the retro and extraction complete (or are skipped). Grooming for this topic is complete.

Say:
> "Grooming complete for '{topic}'. {N} issues created.
> Recommended next: /pm:ideate for more ideas, /pm:groom {next-idea}, or update priorities in pm/strategy.md."
