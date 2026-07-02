# Writing Reference

Shared rules for all plugin output — markdown documents, HTML artifacts.
Domain skills decide *what* to say; this reference decides *how* to say it.

Prose principle: verdict first, then support — tight, plain, scannable. Prefer
numbers over adjectives and tables over nested bullets.

## Jargon ban list

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

## Output format

**Markdown is the default for everything** — strategy, proposals, research,
PRDs. Every markdown output file must include valid YAML frontmatter with
`created:` and `updated:` dates; read
`${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md` for the schema
matching the document type.

**HTML only where markdown can't express the content**: wireframes, mockups,
architecture diagrams, and RFCs (which stay HTML via the template). Never HTML
for proposals, strategy decks, or research output.

### Template system

Templates live at `${CLAUDE_PLUGIN_ROOT}/references/templates/`.

**Token replacement** (RFC pattern):
1. Read the template HTML file
2. Replace `{{TOKEN_NAME}}` placeholders with generated content
3. Strip conditional blocks for unavailable data (`<!-- BEGIN:X -->...<!-- END:X -->`)
4. Write the final HTML to the output path

### Wireframe rules

- Self-contained (inline CSS, no external dependencies)
- Clear labels, flow arrows, state annotations
- All metadata lives in frontmatter of the parent markdown document, not in
  sidecar files
