# Writing Reference

Shared rules for all plugin output — markdown documents, HTML artifacts.
Domain skills decide *what* to say; this reference decides *how* to say it.

Prose principle: verdict first, then support — tight, plain, scannable. Prefer
numbers over adjectives and tables over nested bullets.

Keep chat updates short and verdict-first. Put reviewable detail in the owning artifact and link it; do not repeat the full evidence envelope in chat. Concision does not excuse omitting a material limitation, an approval boundary, or the evidence needed to assess a claim. A clean review may say that no actionable findings were found, with scope and verification limits; never invent findings or pad a correct answer to sound thorough.

## Readable artifacts

- One point per paragraph; normally one or two sentences. Split a paragraph that mixes rules, exceptions, and rationale into labeled bullets.
- Lead with the conclusion or user outcome. Remove generic introductions and repeated explanations.
- Give each fact one primary home. A short decision summary may point to detail; do not reproduce the same requirement in a summary table and again in the body.
- Use lists for independent rules, numbered lists for sequences, and tables for comparisons. Do not move a wall of prose into a table cell.
- Use one page title and two body heading levels: main sections and subsections. HTML navigation mirrors both levels with real anchors and indented child links. Use bold labels for finer distinctions.
- Keep decision status, scope, material risks, uncertainty, unresolved decisions, and next action visible. Full acceptance criteria, execution details, evidence, and review history may use native disclosures.
- Author concise source fields; never mechanically truncate canonical text or remove evidence to meet a word target. Existing long source text remains intact until deliberately revised through its owning approval workflow.
- HTML disclosures must work without scripts, remain keyboard accessible, and expose their complete content in print. Verify links to collapsed subsections in a browser.

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

**Use the owning skill's artifact contract.** Markdown is the default only when
that contract does not require a canonical structured artifact or generated
projection. Every authored markdown output must include valid YAML frontmatter
with `created:` and `updated:` dates; read
`${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md` for the schema matching
the document type.

HTML is appropriate where Markdown cannot express the content or the owning
contract requires a deterministic reader: wireframes, mockups, architecture
diagrams, RFCs, and generated proposal previews. A Groom proposal is canonical
JSON with generated HTML and Markdown projections; never hand-edit either
projection. Strategy and research remain Markdown unless their owning skill
explicitly says otherwise.

### Template system

Templates live at `${CLAUDE_PLUGIN_ROOT}/references/templates/`.

**Token replacement** (RFC pattern):
1. Read the template HTML file
2. Replace `{{TOKEN_NAME}}` placeholders with generated content
3. Strip conditional blocks for unavailable data (`<!-- BEGIN:X -->...<!-- END:X -->`)
4. Write the final HTML to the output path

### Wireframe rules

- Follow `skills/groom/references/prototype-format.md`; it owns file layout,
  metadata, annotations, and prototype identity.
- A single-file wireframe is self-contained: inline CSS and media, fragment-only
  navigation, and no adjacent or remote dependency.
- A multi-file wireframe may load only local files covered by its complete,
  recomputed tree manifest; it never loads remote dependencies.
- Use clear labels and state annotations. Follow the prototype contract's
  numbered-callout rules instead of drawing free-floating arrows.
- Store metadata in the single HTML artifact for single-file wireframes or in
  the manifest-bound `meta.json` for multi-file wireframes.
