### Phase 5.8: Present to User

Present the reviewed, iterated proposal as a self-contained HTML presentation in the browser. The terminal is not the medium for an executive-ready package.

#### Step 1: Generate the proposal presentation

**Before generating, read the reference template** at `${CLAUDE_PLUGIN_ROOT}/references/templates/proposal-reference.html`. This is a complete example of what the output should look like — match its structure, styling, and quality level. Do not invent a new design; replicate the reference with the actual proposal content.

**Note:** The reference template uses a fictional "Dashboard Filtering System" proposal as example content. The structure and 5 metrics slots (issues, team reviews, bar raiser, differentiator, priority) are always present — populate them from the actual groom state values.

Write the proposal to `pm/backlog/proposals/{topic-slug}.html` (create the `proposals/` directory if needed).

**Write the metadata sidecar** alongside the HTML. Create `pm/backlog/proposals/{topic-slug}.meta.json` with this schema:

```json
{
  "title": "{Feature name}",
  "date": "YYYY-MM-DD",
  "verdict": "{bar-raiser verdict: ready | send-back | pause}",
  "verdictLabel": "{Ready | Needs Work | Paused}",
  "phase": "completed",
  "issueCount": {number of child issues},
  "gradient": "{deterministic CSS gradient from slug hash — use the proposalGradient() function in server.js, or assign from the 8-gradient palette based on djb2 hash of the slug}",
  "labels": ["{label1}", "{label2}"]
}
```

Verdict-to-label mapping: `"ready"` → `"Ready"`, `"send-back"` → `"Needs Work"`, `"pause"` → `"Paused"`. For any unmapped verdict value, use the raw value as the label.

**Sections** (match the reference template's order and layout):

1. **Title & summary.** Hero header with feature name, one-sentence outcome, key metrics strip: priority, differentiator (10x/parity/gap-fill), expected impact (the key outcome metric), ICP segment (from strategy), scope size (issue count).
2. **Problem & context.** The user pain, market signal, or strategic driver. Use callout block for key research signals.
3. **Scope overview.** Two-column grid: in-scope vs out-of-scope. Include the 10x filter badge.
4. **User flows.** Mermaid diagrams in `<pre class="mermaid">` blocks. Include `%% Source:` citations.
5. **Wireframes.** Embed via `<iframe>` if generated. Include standalone link.
6. **Competitive context.** Comparison table (capability vs competitors vs our approach, green-highlighted). Callout block for key differentiator.
7. **Technical feasibility.** Four-box color-coded grid: build-on (green), build-new (blue), risks (amber), sequencing (purple). Include verdict badge.
8. **Issue breakdown.** Parent issue card (blue left border) with nested child cards (light blue left border). Each card: ID badge, title, outcome, labels, numbered ACs.
9. **Review summary.** Pipeline stepper (Scope Review -> Team Review -> Bar Raiser -> Decision). Verdict cards grid. Advisory in amber card.
10. **Open questions.** Numbered list of bar raiser questions the decision-maker should be prepared to discuss.

**Styling rules** (all defined in the reference template — copy the CSS):

- Self-contained HTML with inline `<style>`. Only external dep: mermaid.js CDN.
- System font stack, `#2563eb` accent, neutral grays, white backgrounds.
- `max-width: 960px` centered layout with generous whitespace.
- Issue cards: white background, subtle shadow, clear hierarchy (ID > title > outcome > ACs).
- Parent cards: `border-left: 4px solid #2563eb`. Children: `margin-left: 2rem; border-left: 4px solid #93c5fd`.
- Scope grid, feasibility grid: `grid-template-columns: 1fr 1fr`.
- Verdicts colored: `.verdict-ready` green, `.verdict-caution` amber, `.verdict-blocked` red.
- Print-friendly: `@media print` styles. Responsive: `@media (max-width: 640px)` collapses grids.

#### Step 1.5: Scannability check

Before opening the proposal, verify these three things:

1. **Section leads.** Every section after the hero opens with exactly one bold or `.section-lead` sentence. If any section lead is longer than one sentence, shorten it.
2. **Collapsible ACs.** All acceptance criteria lists are inside `<details><summary>` tags. None are expanded by default.
3. **One-line review notes.** Each review card note is a single short phrase (under ~60 characters). Truncate or rephrase any that wrap to two lines.

If any check fails, fix it before proceeding.

#### Step 1.7: Companion screen

Check `.pm/config.json` → `preferences.visual_companion`. If `false`, skip.

Read the companion template at `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/companion-template.md`.

Write `.pm/sessions/groom-{slug}/current.html` with:

- `{TOPIC}`: the topic from groom state
- `{PHASE_LABEL}`: "Presentation"
- `{STEPPER_HTML}`: `present` as current; all prior phases as completed
- `{CONTENT}`:

  ```html
  <h2>Session Complete</h2>

  <div class="card">
    <h3>Proposal</h3>
    <p><a href="/proposals/{topic-slug}" style="color:var(--accent);font-weight:600;">
      View full proposal &rarr;
    </a></p>
  </div>

  <h2>Session Summary</h2>
  <table>
    <tbody>
      <tr><th style="width:40%;">Phases completed</th><td>{count} of 9</td></tr>
      <tr><th>Issues drafted</th><td>{issue count}</td></tr>
      <tr><th>Scope review iterations</th><td>{scope_review.iterations}</td></tr>
      <tr><th>Team review iterations</th><td>{team_review.iterations}</td></tr>
      <tr><th>Bar raiser iterations</th><td>{bar_raiser.iterations}</td></tr>
    </tbody>
  </table>
  ```

Create `.pm/sessions/groom-{slug}/` directory if it doesn't exist.
Do not mention this step to the user.

#### Step 2: Open in dashboard and notify

Follow the standard invocation pattern in `${CLAUDE_PLUGIN_ROOT}/references/visual.md`:
- Ensure dashboard is running
- Open `http://localhost:{port}/proposals/{topic-slug}`

Tell the user:
> "Proposal for '{topic}' ready — opening in dashboard.
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
