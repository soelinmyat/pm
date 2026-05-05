---
name: Draft Proposal
order: 7
description: Detect feature type, generate flows/wireframes, draft proposal content and backlog entry
applies_to: [quick, standard, full, agent]
---

### Step 7: Draft Proposal

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any document output.

Assemble the product proposal from research, scope, and design artifacts. This step produces the proposal content that will be reviewed and presented — not engineering issues.

#### Step 1: Feature-type detection

Classify the feature type to determine which visual artifacts to include:

- **UI feature:** Has user-facing screens, workflows, or interactions → include user flow diagram + wireframes from Design step
- **Workflow feature:** Has multi-step processes, decision points, or state transitions → include user flow diagram only
- **API feature:** Exposes or consumes APIs → no visual artifacts
- **Data feature:** Introduces new data structures or storage → no visual artifacts
- **Infrastructure feature:** Config, tooling, or plumbing → no visual artifacts

Confirm with the user:
> "This looks like a [UI/workflow/API/data/infrastructure] feature. The proposal will include [user flow diagram + wireframes / user flow diagram / no visual artifacts]. Sound right?"

Wait for confirmation before proceeding.

#### Step 2a: Generate Mermaid user flow diagram (if applicable)

If the feature type is UI or workflow and no flow was generated during the Design step:

1. Generate a Mermaid flowchart showing:
   - Primary happy path from user intent to completion
   - Key decision points as diamond nodes
   - Error states and edge cases as branching paths
   - Start and end states clearly labeled

2. Include citation trails — at least one `%% Source:` comment per diagram referencing the research finding or competitor gap that informed a design decision:
   ```
   %% Source: {pm_dir}/evidence/research/{topic-slug}.md — Finding N: {description}
   %% Source: {pm_dir}/evidence/competitors/{slug}/features.md — {gap or pattern}
   ```

3. Keep diagrams readable — max ~15 nodes. If the flow is more complex, split into sub-flows.

#### Step 2b: Link wireframes (UI features only)

If the feature type is UI, link to wireframes from Design (Step 6). Design owns wireframe generation — this step only links to what already exists.

- If Design step ran: wireframes exist at `{pm_dir}/backlog/wireframes/{topic-slug}.html`. Link them in the proposal.
- If Design step was skipped (backend/infra, or user said "I know what I want"): note "No wireframes — feature is non-visual or design was deferred to implementation." Do NOT generate lo-fi wireframes here as a fallback.

#### Step 3: Assemble proposal content

Gather all product context into a coherent proposal narrative. Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. Source content for each section from:

- **Outcome** — from scope definition (what changes for the user)
- **Problem & Context** — from research (user pain, market signal, strategic driver)
- **Scope** — in-scope and out-of-scope items with 10x filter result
- **User Flows** — Mermaid diagrams (from Step 2a or Design step)
- **Wireframes** — HTML wireframe links (from Step 2b or Design step)
- **Competitive Context** — from research (do competitors have this feature? how do they handle it?) and from scope (10x filter result and handling decision rationale)
- **Technical Feasibility** — EM assessment from Scope Review (Step 5)
- **Review Summary** — pipeline steps completed so far
- **Resolved Questions** — any questions resolved during scoping/research
- **Freshness Notes** — only if `stale_research` in groom session state is non-empty. Format: "'{name}' — {age_days} days old (threshold: {threshold_days}d for {type}). Run `pm:refresh` to update." Omit entirely if empty.
- **Success Metrics** — leading indicators from scope validation (Q4: "What does success look like in 90 days?"). Table format: metric | baseline | target | timeframe. Use leading indicators, not lagging metrics like revenue.
- **Next Steps** — standard dev handoff prompt

This content feeds into the proposal backlog entry (Step 10) and linking (Step 11).

#### Step 4: Write proposal backlog entry

Write the draft proposal to `{pm_dir}/backlog/{topic-slug}.md` so that review agents (Step 8, Step 9) can read the assembled proposal. Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. Set `status: drafted`, `prd: null`, `rfc: null`. For full tier, Step 10 (Present) will resolve open questions, apply final edits, and upgrade `status: drafted` to `status: proposed`.

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
   - Scope changes: for `standard`, re-run from Step 5 (Scope Review). For `quick` (which has no scope review), revise scope inline.

4. After approval, finalize the proposal:
   - Update `status: proposed` in the backlog entry frontmatter
   - Verify all sections match `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md` (names, order, completeness)

5. **Generate HTML proposal artifact and open in browser.**

   Create `{pm_dir}/backlog/proposals/` if it doesn't exist (`mkdir -p {pm_dir}/backlog/proposals`). Write a styled HTML version of the proposal to `{pm_dir}/backlog/proposals/{topic-slug}.html`. Use the reference template at `${CLAUDE_PLUGIN_ROOT}/references/templates/proposal-reference.html` for structure and styling. The HTML must include:

   - Hero with proposal ID, status pill ("Proposed"), priority pill, title, and outcome summary
   - Sticky TOC linking to each section
   - All 12 proposal sections rendered with the section-card pattern from the reference template
   - Mermaid diagrams rendered via the mermaid.js CDN script (same as RFC)
   - Scope presented as in-scope / out-of-scope cards with 10x filter pill
   - Technical Feasibility as a verdict card
   - Review Summary as a pipeline visualization
   - Resolved Questions with numbered Q&A items
   - Footer with proposal ID, date, and "Product Proposal" label

   **Hero prototype** — when the feature has a UI prototype (a wireframe file exists at `{pm_dir}/backlog/wireframes/{slug}.html` or `{pm_dir}/backlog/wireframes/{slug}/index.html`):

   1. Read the wireframe metadata per `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` §6:
      - Single-file: parse `<script type="application/json" id="wireframe-meta">` from the HTML head
      - Multi-file: read `{slug}/meta.json`
   2. Render the hero prototype figure between the title block and TL;DR per `prototype-format.md` §8.
   3. Iframe height by `fidelity` field: `sketch` → 560px, `wireframe` → 720px, `mockup` → 880px.
   4. Auto-populate the Screens caption from `screens[].label` joined by ` · `.
   5. Auto-populate the fidelity-specific note paragraph per `prototype-format.md` §8.
   6. If wireframe metadata is missing or malformed, fall back to a generic "View prototype" caption with no screens listed and log a warning. Do not crash the render.

   When the feature has no UI prototype, omit the hero prototype figure entirely. The proposal goes title → lede → TL;DR → TOC → sections.

   After writing the HTML, open it in the browser:

   ```bash
   open {pm_dir}/backlog/proposals/{topic-slug}.html
   ```

   Notify the user: "Proposal finalized. Opening in browser."

6. Update state and proceed directly to Step 11 (Link):

```yaml
phase: draft-proposal
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  proposal_html_path: {pm_dir}/backlog/proposals/{topic-slug}.html
```

**If `groom_tier` is `full`:**

1. Show a brief preview to the user:
   > "Draft proposal assembled for '{topic}'.
   > Outcome: {outcome statement from draft}
   > Scope: {N} items in-scope, {M} items out-of-scope.
   > This is now entering team review. You'll see the full proposal after reviews complete."

2. Do NOT wait for approval. Proceed directly to Step 8 (Team Review).

3. Update state:

```yaml
phase: draft-proposal
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
```

---

## Agent-tier additions (PM-233)

This subsection runs ONLY when `groom_tier == "agent"`. Co-pilot tiers (quick / standard / full) skip it cleanly — they don't read the `source_citations:` state block and don't render `[source: ...]` tokens.

The agent-tier flow reaches Step 07 after `04a-synthesis.md` (synthesis + scope-lock) and `05a-scope-review-agent.md` (parallel reviewer dispatch). The session state already carries:
- `synthesis:` block — JTBD, personas, scope, risks with `source:` on each item
- `source_citations:` block — flattened mirror of every cited decision

### Citation render — markdown

When emitting the proposal markdown, every claim derived from a citation MUST carry inline `[source: ...]` notation. Use the flatten rules from `references/proposal-format.md` §"Agent-tier source citations":
- `{file: "pm/strategy.md", line: 42}` → `[source: pm/strategy.md#L42]`
- `{file: "pm/evidence/research/agent-mode.md", finding_id: "F3"}` → `[source: pm/evidence/research/agent-mode.md#F3]`
- `{file: "pm/strategy.md"}` (no line/finding) → `[source: pm/strategy.md]`

Tokens go inline next to the claim, NOT in a separate references list. Example output:

```markdown
## Job to be Done

When I groom a feature with KB-rich context, I want to skip questions about
facts already documented [source: pm/strategy.md#L24], so I can review a
complete proposal in one pass [source: pm/evidence/research/agent-mode-pm-tools.md#F2].

## Personas

**Primary** — PM-engineer with mature KB [source: pm/strategy.md#L8]: lives
in CLI, runs many sessions per week against the same project.
```

### Citation render — HTML

The 07 step renders the markdown proposal first, then renders the HTML version (using `references/templates/proposal-reference.html`). For agent-tier:

1. **Inline superscripts.** Every `[source: path#L42]` token in the markdown becomes `<sup class="src">path#L42</sup>` in the HTML, positioned immediately after the cited claim. The `.src` style is already in the proposal-reference template.
2. **Audit details block.** Append a collapsed `<details class="audit-block">` near the end of the HTML proposal (after Risks, before Next Steps):

   ```html
   <section id="citation-audit" class="audit-block">
     <details>
       <summary>Citation audit (N citations)</summary>
       <table class="audit-table">
         <thead><tr><th>Claim</th><th>File</th><th>Line / ID</th><th>Excerpt</th></tr></thead>
         <tbody>
           <!-- One row per citation in source_citations[]. -->
           <tr>
             <td>{anchor — e.g., "JTBD primary"}</td>
             <td><code>pm/strategy.md</code></td>
             <td>L24</td>
             <td>{verbatim excerpt}</td>
           </tr>
           ...
         </tbody>
       </table>
     </details>
   </section>
   ```

   The block is collapsed by default — readers click to expand when verifying a specific claim.

### Parity check

After rendering both layers, count:
- Markdown `[source: ...]` token occurrences
- HTML `<sup class="src">` tag occurrences

Assert `html_count >= md_count`. If `html_count < md_count`: log a warning and surface as a blocking issue for team review (Step 08a). Citation loss between layers is a known render risk per RFC §8.

### Persist state

After both renders complete:

```yaml
phase: draft-proposal
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  proposal_html_path: {pm_dir}/backlog/proposals/{topic-slug}.html
  citation_count_md: int                  # number of [source: ...] tokens in markdown
  citation_count_html: int                # number of <sup class="src"> in HTML
  citation_parity: bool                   # html_count >= md_count
```

If `citation_parity: false`, the team-review step (08a) will flag this as a blocking issue. The fix is to re-render the HTML preserving every markdown citation.

### Proceed to 08a

Agent-tier flow proceeds directly to `08a-team-review-agent.md` for parallel reviewer dispatch. Do NOT wait for user approval at this step — the proposal-ready checkpoint comes after team review converges.
