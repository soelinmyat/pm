---
name: Draft Proposal
order: 7
description: Detect feature type, generate flows/wireframes, draft proposal content and backlog entry
---

### Phase 5.5: Draft Proposal

Assemble the product proposal from research, scope, and design artifacts. This phase produces the proposal content that will be reviewed and presented — not engineering issues.

#### Step 1: Feature-type detection

Classify the feature type to determine which visual artifacts to include:

- **UI feature:** Has user-facing screens, workflows, or interactions → include user flow diagram + wireframes from Design phase
- **Workflow feature:** Has multi-step processes, decision points, or state transitions → include user flow diagram only
- **API feature:** Exposes or consumes APIs → no visual artifacts
- **Data feature:** Introduces new data structures or storage → no visual artifacts
- **Infrastructure feature:** Config, tooling, or plumbing → no visual artifacts

Confirm with the user:
> "This looks like a [UI/workflow/API/data/infrastructure] feature. The proposal will include [user flow diagram + wireframes / user flow diagram / no visual artifacts]. Sound right?"

Wait for confirmation before proceeding.

#### Step 2a: Generate Mermaid user flow diagram (if applicable)

If the feature type is UI or workflow and no flow was generated during the Design phase:

1. Generate a Mermaid flowchart showing:
   - Primary happy path from user intent to completion
   - Key decision points as diamond nodes
   - Error states and edge cases as branching paths
   - Start and end states clearly labeled

2. Include citation trails — at least one `%% Source:` comment per diagram referencing the research finding or competitor gap that informed a design decision:
   ```
   %% Source: {pm_dir}/evidence/research/{topic}.md — Finding N: {description}
   %% Source: {pm_dir}/evidence/competitors/{slug}/features.md — {gap or pattern}
   ```

3. Keep diagrams readable — max ~15 nodes. If the flow is more complex, split into sub-flows.

#### Step 2b: Generate HTML wireframe (UI features only)

If the feature type is UI and no wireframe was generated during the Design phase:

1. **Create the wireframes directory** if it doesn't exist: `{pm_dir}/backlog/wireframes/`

2. **Write a self-contained HTML file** to `{pm_dir}/backlog/wireframes/{topic-slug}.html` with:
   - A `<style>` block — no external dependencies. Use lo-fi wireframe CSS: gray boxes, borders, labels, placeholder areas.
   - Component vocabulary: `.wireframe-screen`, `.wireframe-header`, `.wireframe-nav`, `.wireframe-sidebar`, `.wireframe-content`, `.wireframe-form`, `.wireframe-button`, `.wireframe-input`, `.wireframe-table`, `.wireframe-card`, `.wireframe-placeholder`
   - Layout using CSS flexbox/grid

3. **Ground the wireframe in scope, research, and existing UI** (if `codebase_available: true`):
   - Component labels should match the terminology from the scope definition
   - Screen layout should reflect the user flow from Step 2a
   - Add HTML comments citing sources: `<!-- Source: {pm_dir}/evidence/research/{topic}.md -->`
   - If the project has existing UI, scan for current layout patterns and make the wireframe a natural extension

4. **Keep it lo-fi.** Gray backgrounds, black borders, system fonts. No colors, icons, or images. Max 2-3 screens per wireframe file.

5. **Open the wireframe in the browser** immediately after writing it:
   ```bash
   open {pm_dir}/backlog/wireframes/{topic-slug}.html
   ```

#### Step 3: Assemble proposal content

Gather all product context into a coherent proposal narrative:

- **Outcome statement:** What changes for the user when this ships (from scope)
- **Problem & context:** The user pain, market signal, or strategic driver (from research)
- **Scope:** In-scope and out-of-scope items with 10x filter result
- **User flows:** Mermaid diagrams (from Step 2a or Design phase)
- **Wireframes:** HTML wireframe links (from Step 2b or Design phase)
- **Competitive context:** How competitors handle this, with specific references from research
- **Technical feasibility:** EM assessment from Scope Review (Phase 4.5)
- **Research links:** Paths to relevant findings

- **Freshness notes:** If `stale_research` in the groom session state is non-empty, include a "Freshness notes" section listing each stale research source. Format each entry as: "'{name}' — {age_days} days old (threshold: {threshold_days}d for {type}). Run `pm:refresh` to update." If `stale_research` is empty, omit this section entirely.

This content feeds into the proposal backlog entry (Phase 7) and linking (Phase 8).

#### Step 4: Write proposal backlog entry

Write the draft proposal to `{pm_dir}/backlog/{topic-slug}.md` so that review agents (Phase 6, Phase 6.5) can read the assembled proposal. Use the Proposal Format from the main SKILL.md. Set `status: drafted`, `prd: null`, `rfc: null`. Phase 7 (Present) will upgrade this to `status: proposed` and write the full PRD content inline.

Create the `{pm_dir}/backlog/` directory if needed (`mkdir -p {pm_dir}/backlog`).

#### Step 5: Show draft and update state

Behavior depends on the current `groom_tier` from session state.

**If `groom_tier` is `quick` or `standard`:**

1. Present the full draft proposal to the user. Show the outcome statement, scope (in-scope and out-of-scope), competitive context summary, and research links from the draft at `{pm_dir}/backlog/{topic-slug}.md`.

2. Ask:
   > "Here's the draft proposal for '{topic}'. Review the outcome, scope, and competitive context above.
   > Approve this proposal, or tell me what to change?"

3. Wait for explicit approval.
   - Minor edits (wording, AC tweaks): revise the draft and re-show. No need to re-run earlier phases.
   - Scope changes: for `standard`, re-run from Phase 4.5 (Scope Review). For `quick` (which has no scope review), revise scope inline.

4. After approval, finalize the proposal. Read and follow Phase 7 (Present) Steps 2-3 from `steps/10-present.md` to write the full PRD content into `{pm_dir}/backlog/{topic-slug}.md`.

5. Update state and proceed directly to Phase 8 (Link):

```yaml
phase: draft-proposal
proposal_path: {pm_dir}/backlog/{topic-slug}.md
```

**If `groom_tier` is `full`:**

1. Show a brief preview to the user:
   > "Draft proposal assembled for '{topic}'.
   > Outcome: {outcome statement from draft}
   > Scope: {N} items in-scope, {M} items out-of-scope.
   > This is now entering team review. You'll see the full proposal after reviews complete."

2. Do NOT wait for approval. Proceed directly to Phase 6 (Team Review).

3. Update state:

```yaml
phase: draft-proposal
proposal_path: {pm_dir}/backlog/{topic-slug}.md
```
