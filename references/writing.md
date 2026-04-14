# Writing Reference

Shared rules for all plugin output — markdown documents, HTML artifacts.
Skills read this before generating any document. Domain skills decide *what* to say; this reference decides *how* to say it.

---

## Prose Rules

### The bar: readable by a 16-year-old in a hurry

1. **Verdict first.** Lead with the decision, status, or answer. Context comes after.
2. **Bullets over prose.** Never write a paragraph when a list works. Max 2 lines per bullet.
3. **Max 3 bullets before interaction.** If you need more, pause and ask the user first.
4. **20 words per sentence.** If a sentence is longer, split it.
5. **Flesch-Kincaid grade ≤ 8.** Simple words, short sentences, clear structure.
6. **No walls of text.** Max 2-line paragraphs. If you hit 3 lines, convert to bullets.
7. **One question per message.** Never bundle questions. Ask the most important one first.
8. **Numbers over prose.** Prefer "80% use no software" over "The majority of operators do not use any booking software."

### Jargon ban list

| Banned | Use instead |
|--------|-------------|
| leverage / utilize | use |
| facilitate | help, enable |
| in order to | to |
| prior to / subsequent to | before / after |
| going forward | next, from now on |
| in the event that | if |
| it should be noted that | (delete — just say it) |
| deep dive | review, analysis |
| circle back | revisit, follow up |
| paradigm / synergy / cadence | pattern / (rewrite) / schedule |
| actionable insights | findings, takeaways |
| best-in-class | leading, top |
| holistic | complete, full |
| robust | strong, thorough |

---

## Document Structure

### Markdown documents

Every markdown document should follow:

```markdown
---
type: {document type}
created: YYYY-MM-DD
updated: YYYY-MM-DD
{additional frontmatter as needed}
---

# {Title}

## {Section}
Content in bullets or short paragraphs.
```

**Rules:**
- Always include frontmatter with `created:` and `updated:` dates
- Use tables for structured comparisons, not nested bullets
- Use `>` blockquotes for verdicts, decisions, or key callouts
- Keep sections focused — if a section exceeds 20 lines, split it
- Reference sources with URLs and access dates

### Parallel agent output

When presenting results from multiple reviewers, collapse into a summary table:

| Reviewer | Verdict | Key note |
|----------|---------|----------|

List only blocking items as bullets. Advisory items come after the user acknowledges blockers.

---

## Output Format

### Markdown documents (default)

All plugin output is markdown by default. Strategy decks, proposals, research findings, PRDs — everything that was previously HTML is now a markdown file with frontmatter.

**Rules:**
- Every output file must include valid YAML frontmatter
- Use sections and subsections instead of slides
- Use blockquotes for verdicts and key callouts
- Use tables for structured comparisons
- Follow the prose rules above — same standards apply

### HTML artifacts (wireframes and mockups only)

Generate HTML only when the content needs visual layout that markdown cannot express: wireframes, mockups, and architecture diagrams.

Generate HTML when:
- The content needs spatial positioning (wireframe layouts, flow diagrams)
- The content needs interactive preview elements (clickable prototypes)

Do **not** generate HTML for: proposals, strategy decks, research output, or any document that works as markdown.

### Template system

Templates live at `${CLAUDE_PLUGIN_ROOT}/references/templates/`.

**Token replacement** (RFC pattern):
1. Read the template HTML file
2. Replace `{{TOKEN_NAME}}` placeholders with generated content
3. Strip conditional blocks for unavailable data (`<!-- BEGIN:X -->...<!-- END:X -->`)
4. Write the final HTML to the output path

RFCs remain HTML. Use the RFC template for all RFC output.

### Wireframe rules

For wireframe and mockup HTML:
- Self-contained (inline CSS, no external dependencies)
- Clear labels, flow arrows, state annotations
- All metadata lives in frontmatter of the parent markdown document, not in sidecar files

### Frontmatter compliance

Before writing any markdown document, read `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md` for the schema contract. All output files must include valid frontmatter matching the schema for their document type.

---

## Quality Checklist

Before saving any document (md or HTML), verify:

- [ ] Verdict/conclusion appears in the first line or paragraph
- [ ] No sentence exceeds 20 words
- [ ] No paragraph exceeds 2 lines (convert to bullets)
- [ ] No jargon from the ban list
- [ ] Sources cited with URLs and dates (for research output)
- [ ] Frontmatter present and dates accurate (for markdown)
- [ ] Tables used for comparisons (not nested bullets)

---

## Before / After Examples

### Research finding

**Before:** "After conducting a thorough review of the competitive landscape, I've determined that this feature aligns well with the current priorities outlined in the strategy document and represents a significant opportunity."

**After:**
> **Aligned.** Supports priority #1: "Ship features that make the free tier indispensable."
> - No non-goal conflicts
> - ICP fit: strong (solo developer match)

### Strategy section

**Before:** "Our ideal customer profile encompasses building operations teams, facility managers, and janitorial service providers who are managing multi-site operations under significant time pressure and need to be able to see status at a glance."

**After:**
> **ICP:** Building ops teams managing 5+ sites.
> - Time-pressed — need scan-level status, not detail
> - Currently using spreadsheets or nothing
> - Buy on "saves me 2 hours/week," not features
