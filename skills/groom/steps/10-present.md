---
name: Present
order: 10
description: Write markdown PRD backlog entry, resolve open questions, get user approval
applies_to: [full]
---

### Step 10: Present to User

**Full tier only.** Quick and standard tiers finalize the proposal in Draft Proposal (Step 7) and skip directly to Link. This step only runs after Team Review and Bar Raiser have completed.

Present the reviewed, iterated proposal as the finalized backlog entry. The PRD content lives inline in the backlog markdown file. A styled HTML artifact is generated for browser presentation.

#### Step 1: Resolve open questions

Before writing the final backlog entry, collect all open questions from team review and bar raiser outputs. For each question:

1. **Attempt to answer it.** Use research files (`{pm_dir}/evidence/research/`), strategy (`{pm_dir}/strategy.md`), codebase exploration, and the proposal context. Most questions raised by reviewers _can_ be answered with data already available — the reviewers just didn't have access to every source.
2. **Record the answer.** Format: `Q: {question} → A: {answer with evidence/rationale}`.
3. **Escalate only what requires human judgment.** If a question genuinely needs a product decision that cannot be derived from existing research or strategy (e.g., pricing, legal, timeline commitments), mark it as "Decision needed" with a recommended answer.

The goal: the backlog entry shows a **Resolved Questions** section with clear answers, and at most 1-2 items under **Decisions Needed** — never a wall of unanswered questions.

#### Step 2: Write the proposal backlog entry

**Before generating, follow the `type: backlog` schema** from `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md`. The frontmatter must conform to this contract.

Write or update the backlog entry at `{pm_dir}/backlog/{topic-slug}.md`. Set `status: proposed`, `prd: null`, `rfc: null`.

**No public content sidecars.** All proposal content metadata lives in the `.md` frontmatter. The private `.pm/artifacts/` integrity manifest generated in Step 3 is operational state, not a second content source.

**Sections:** Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. All 12 sections must be present. Do not rename, reorder, or redefine sections here — `proposal-format.md` is the single authority.

Additional guidance for the full-tier Present step:
- **Resolved Questions** section must include answers resolved from team review and bar raiser outputs (see Step 1 above). If any remain, list under a **Decisions Needed** subsection with a recommended answer.
- **Freshness Notes** — only include if `stale_research` in the groom session state is non-empty. End with: "Run `pm:refresh` to update stale research before starting implementation." If empty, omit entirely.
- **Review Summary** should cover all pipeline steps completed (Scope Review, Team Review, Bar Raiser, Decision) with verdict summary and advisory notes.

#### Step 3: Generate HTML proposal artifact and open in browser

Create `{pm_dir}/backlog/proposals/` if it doesn't exist (`mkdir -p {pm_dir}/backlog/proposals`). Write a styled HTML version of the proposal to `{pm_dir}/backlog/proposals/{topic-slug}.html`.

`${CLAUDE_PLUGIN_ROOT}/references/templates/proposal-reference.html` is the canonical render and sole authority for DOM shape and styling — match it exactly and use only its existing class names. Render all twelve sections (fixed names and anchors per `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`) and follow `${CLAUDE_PLUGIN_ROOT}/references/artifacts/html-artifact-contract.md`: the file is offline, inert, accessible, responsive, and printable. Render diagrams to inline SVG or accessible text, never a CDN script. Full-tier specifics the content must carry: the Review Summary pipeline includes the Team Review and Bar Raiser verdicts, and Resolved Questions render as numbered Q&A (answers resolved in Step 1).

Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-check.js --html {pm_dir}/backlog/proposals/{topic-slug}.html --kind proposal --manifest .pm/artifacts/proposal-{topic-slug}.manifest.json`. Do not open or present a failing artifact.

After writing the HTML, open it in the browser (portable across macOS/Linux; falls back to printing the path):

```bash
open {pm_dir}/backlog/proposals/{topic-slug}.html 2>/dev/null \
  || xdg-open {pm_dir}/backlog/proposals/{topic-slug}.html 2>/dev/null \
  || echo "View: {pm_dir}/backlog/proposals/{topic-slug}.html"
```

#### Step 4: Notify the user

Tell the user:
> "Proposal for '{topic}' is ready. Opening in browser.
> File: `{pm_dir}/backlog/{topic-slug}.md`
> HTML: `{pm_dir}/backlog/proposals/{topic-slug}.html`
>
> Approve this proposal, or would you like changes?"

#### Step 5: Handle feedback

Wait for explicit approval. Accept edits inline. If the user requests changes:
- For minor edits (wording, AC tweaks): revise the proposal, update the backlog entry, and regenerate the HTML. No need to re-run reviews.
- For scope changes (adding/removing in-scope items): re-run from Step 8 (Team Review).

Update state:

```yaml
phase: present
proposal:
  proposal_html_path: {pm_dir}/backlog/proposals/{topic-slug}.html
```

Once approved, proceed to Step 11 (Link).
