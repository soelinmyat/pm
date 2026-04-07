### Phase 5.8: Present to User

Present the reviewed, iterated proposal as a self-contained HTML presentation in the browser. The terminal is not the medium for an executive-ready package.

#### Step 1: Generate the proposal presentation

**Before generating, read the reference template** at `${CLAUDE_PLUGIN_ROOT}/skills/groom/templates/proposal-reference.html`. This is a complete example of what the output should look like — match its structure, styling, and quality level. Do not invent a new design; replicate the reference with the actual proposal content.

**Note:** The reference template uses a fictional "Dashboard Filtering System" proposal as example content. The structure and 5 metrics slots (issues, team reviews, bar raiser, differentiator, priority) are always present — populate them from the actual groom state values.

Write the PRD to `pm/backlog/proposals/{topic-slug}.html` (create the `proposals/` directory if needed).

**Write the proposal backlog entry** at `pm/backlog/{topic-slug}.md` using the Proposal Format from the main SKILL.md. This is the parent backlog item. Set `status: proposed`, `verdict:` from the bar raiser, `prd: proposals/{topic-slug}.html`, `rfc: null`.

**No `.meta.json` sidecar.** All metadata lives in the proposal `.md` frontmatter. The dashboard reads frontmatter directly.

**Sections** (match the reference template's order and layout):

1. **Title & summary.** Hero header with feature name, one-sentence outcome, key metrics strip: priority, differentiator (10x/parity/gap-fill), expected impact (the key outcome metric), ICP segment (from strategy).
2. **Problem & context.** The user pain, market signal, or strategic driver. Use callout block for key research signals.
3. **Scope overview.** Two-column grid: in-scope vs out-of-scope. Include the 10x filter badge.
4. **User flows.** Mermaid diagrams in `<pre class="mermaid">` blocks. Include `%% Source:` citations.
5. **Wireframes.** Embed via `<iframe>` if generated. Include standalone link.
6. **Competitive context.** Comparison table (capability vs competitors vs our approach, green-highlighted). Callout block for key differentiator.
7. **Technical feasibility.** Four-box color-coded grid: build-on (green), build-new (blue), risks (amber), sequencing (purple). Include verdict badge.
8. **Review summary.** Pipeline stepper (Scope Review -> Team Review -> Bar Raiser -> Decision). Verdict cards grid. Advisory in amber card.
9. **Open questions.** Numbered list of bar raiser questions the decision-maker should be prepared to discuss.
10. **Next steps.** Callout: "Ready for engineering? Run `pm:dev {slug}` to generate the RFC and begin implementation."

**Styling rules** (all defined in the reference template — copy the CSS):

- Self-contained HTML with inline `<style>`. Only external dep: mermaid.js CDN.
- System font stack, `#2563eb` accent, neutral grays, white backgrounds.
- `max-width: 960px` centered layout with generous whitespace.
- Section cards: white background, subtle shadow, clear hierarchy.
- Scope grid, feasibility grid: `grid-template-columns: 1fr 1fr`.
- Verdicts colored: `.verdict-ready` green, `.verdict-caution` amber, `.verdict-blocked` red.
- Print-friendly: `@media print` styles. Responsive: `@media (max-width: 640px)` collapses grids.

#### Step 2: Open in browser and notify

```bash
open pm/backlog/proposals/{topic-slug}.html
```

Tell the user:
> "Proposal for '{topic}' is ready — opening in your browser now.
> File: `pm/backlog/proposals/{topic-slug}.html`
>
> Approve this proposal, or would you like changes?"

#### Step 3: Handle feedback

Wait for explicit approval. Accept edits inline. If the user requests changes:
- For minor edits (wording, AC tweaks): revise issues and regenerate the presentation. No need to re-run reviews.
- For scope changes (adding/removing in-scope items): re-run from Phase 5.5 (Team Review).

Update state:

```yaml
phase: present
```
