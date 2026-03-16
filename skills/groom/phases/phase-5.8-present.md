### Phase 5.8: Present to User

Present the reviewed, iterated proposal as a self-contained HTML presentation in the browser. The terminal is not the medium for an executive-ready package.

#### Step 1: Generate the proposal presentation

Write a self-contained HTML file to `pm/backlog/proposals/{topic-slug}.html` (create the `proposals/` directory if needed).

The presentation must include these sections in order:

1. **Title & summary.** Feature name, one-sentence outcome, review effort (team review rounds, bar raiser rounds).

2. **Problem & context.** Why this matters — the user pain, market signal, or strategic driver that prompted this initiative. Pull from intake and research.

3. **Scope overview.** In-scope and out-of-scope as a clean two-column layout. Include the 10x filter result and what it means.

4. **Issue breakdown.** Each issue as a card showing:
   - ID and title
   - Outcome statement
   - Acceptance criteria (numbered list)
   - Labels and priority
   - Parent-child relationships (visually grouped — parent card with nested children)

5. **User flows.** Render Mermaid diagrams using the mermaid.js CDN (`https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js`). Include the raw Mermaid source in `<pre class="mermaid">` blocks — mermaid.js renders them automatically.

6. **Wireframes.** If wireframes were generated, embed them via `<iframe src="../wireframes/{slug}.html">` with a reasonable height. Include a direct link to open the wireframe standalone.

7. **Competitive context.** Summary of how competitors handle this, key differentiators, and positioning implications. Pull from research and competitor profiles.

8. **Technical feasibility.** EM assessment summary — build-on, build-new, risks, sequencing.

9. **Review summary.** Brief table showing team review verdicts and bar raiser verdict. Do not dump full review findings — just the verdicts and any unresolved advisory items.

10. **Open questions.** Bar raiser's "questions the proposal should answer" — presented as a numbered list the decision-maker should be prepared to discuss.

**Presentation styling guidelines:**

- Self-contained: single HTML file with inline `<style>`. Only external dependency is mermaid.js CDN for diagram rendering.
- Clean, professional design: white background, readable typography (system font stack), generous whitespace, subtle section dividers.
- Color palette: neutral grays for structure, one accent color for emphasis (links, issue IDs, labels). No decoration — let the content breathe.
- Responsive: readable on both laptop screens and large monitors.
- Issue cards: light border, subtle shadow, clear visual hierarchy (title > outcome > ACs).
- Parent-child grouping: parent card spans full width, children indented or nested below with a visual connector (left border or indent).
- Print-friendly: should look good if someone prints or exports to PDF.

#### Step 2: Open in browser and notify

```bash
open pm/backlog/proposals/{topic-slug}.html
```

Tell the user:
> "Proposal for '{topic}' is ready — opening in your browser now.
> File: `pm/backlog/proposals/{topic-slug}.html`
>
> Ready to create these issues, or would you like changes?"

#### Step 3: Handle feedback

Wait for explicit approval. Accept edits inline. If the user requests changes:
- For minor edits (wording, AC tweaks): revise issues and regenerate the presentation. No need to re-run reviews.
- For scope changes (adding/removing in-scope items): re-run from Phase 5.5 (Team Review).

Update state:

```yaml
phase: present
```
