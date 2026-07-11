---
name: Draft Proposal
order: 7
description: Detect feature type, generate flows/wireframes, draft proposal content and backlog entry
applies_to: [quick, standard, full, agent]
---

### Step 7: Draft Proposal

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

Gather all product context into a coherent layered proposal. Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. The body has a Decision Brief, an Execution Contract, and an Appendix body with twelve Roman-numeralled sections. Source content for each layer and section from:

- **Decision Brief** (pre-section) — three TL;DR lines plus a <= 120-word approval recommendation. It must state For, What, Why now, smallest useful scope, biggest risk, and any decision still needed. The frontmatter `outcome:` field becomes the lede paragraph under the H1 — keep it to one sentence.
- **Execution Contract** (pre-section) — structured handoff for agents. Include scope, non-goals, acceptance criteria, edge cases, success metrics, and open decisions. If this block conflicts with appendix prose, the contract wins and the prose must be revised before approval.
- **I. Problem & Context** — from research (user pain, market signal, strategic driver). Include one verbatim evidence quote as a blockquote when one exists.
- **II. Users & Job to be Done** — Primary JTBD in "When I X, I want to Y, so I can Z" form. 1–2 personas (Primary required, Secondary only when meaningfully different).
- **III. Use Cases** — top 2–4 ranked scenarios. Each has Trigger / Action / Result.
- **IV. Scope** — in-scope and out-of-scope items with one-clause reasons on out-of-scope. End with the 10x filter result line.
- **V. Functional Requirements** — observable behaviors grouped by in-scope item (one H3 per item, bullets under it). Not implementation detail.
- **VI. Edge Cases & Constraints** — markdown table: Case | Expected handling.
- **VII. User Flow** — Mermaid diagrams (from Step 2a or Design step). Omit entirely for non-UI features.
- **VIII. Competitive Context** — comparison table (3–5 rows). End with the **Handling decision** paragraph that ties the 10x filter result to competitor reality.
- **IX. Technical Feasibility** — EM assessment from Scope Review (Step 5). Verdict line, Build on, Build new, Top risks.
- **X. Open Questions** — each open question carries a **Recommendation**, **Owner**, and **By** date so reviewers can confirm or override. Resolved questions go into a `<details>` block at the end of this section.
- **XI. Success Metrics** — leading indicators from scope validation (Q4: "What does success look like in 90 days?"). Table: Metric | Baseline | Target | By. Optional **Caveat** paragraph naming the assumption that would invalidate the metrics. Use leading indicators, not lagging metrics like revenue.
- **XII. Status & Next Steps** — bulleted pipeline of grooming steps completed (Intake, Strategy check, Research, Scope, Scope review, Team review if full, Bar raiser if full), each with a one-clause verdict. Closing line invokes `pm:rfc {slug}` and `pm:dev {slug}`. If `stale_research` in groom session state is non-empty, append a **Freshness note** at the end of this section. Format: "'{name}' — {age_days} days old (threshold: {threshold_days}d for {type}). Run `pm:refresh` to update." Omit entirely if empty.
- **Appendix discipline** — evidence, alternatives, citations, flow details, feasibility details, and review notes live in the numbered sections. Keep the default brief/contract path compact; the appendix can be longer.

**Wireframes are not a section.** When a UI prototype exists, the markdown surfaces it as a link inside the TL;DR block and the HTML renderer adds an offline-safe hero preview card between the title and TL;DR (see Step 5 below). The proposal never frames or executes the prototype.

This content feeds into the proposal backlog entry (Step 10) and linking (Step 11).

#### Step 4: Write proposal backlog entry

Write the draft proposal to `{pm_dir}/backlog/{topic-slug}.md` so that review agents (Step 8) can read the assembled proposal. Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. Set `status: drafted`, `prd: null`, `rfc: null`. For full tier, Step 10 (Present) will resolve open questions, apply final edits, and upgrade `status: drafted` to `status: proposed`.

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

   Create `{pm_dir}/backlog/proposals/` if it doesn't exist (`mkdir -p {pm_dir}/backlog/proposals`). Write a styled HTML version of the proposal to `{pm_dir}/backlog/proposals/{topic-slug}.html`.

   `${CLAUDE_PLUGIN_ROOT}/references/templates/proposal-reference.html` is the canonical render and the sole authority for DOM shape, per-section wrapper components, and styling — match it exactly and use only its existing class names (do not invent new ones). Its layout runs masthead → title block → optional hero prototype → TL;DR → decision brief → execution contract → TOC → the twelve appendix sections → footer. The two pre-body sections carry the fixed anchors `decision-brief` and `execution-contract`; the twelve appendix sections use the fixed section names and anchor IDs defined in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md` (`problem`, `jtbd`, `usecases`, `scope`, `requirements`, `edge`, `flow`, `competitive`, `feasibility`, `open-q`, `metrics`, `status`), in that order. Read and follow `${CLAUDE_PLUGIN_ROOT}/references/artifacts/html-artifact-contract.md`: use system fonts, inline presentation assets, render diagrams to inline SVG or an accessible text fallback, and never add CDN or active-script dependencies. Omit the User Flow section for non-UI features.

   Before opening the artifact, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-check.js --html {pm_dir}/backlog/proposals/{topic-slug}.html --kind proposal --manifest .pm/artifacts/proposal-{topic-slug}.manifest.json`. A non-zero result blocks presentation; fix the render rather than waiving offline, safety, accessibility, anchor, responsive, print, or budget failures.

   **Hero prototype:** include `<figure class="hero-prototype">` between the title block and TL;DR only when a UI prototype exists (`{pm_dir}/backlog/wireframes/{slug}.html` or `{pm_dir}/backlog/wireframes/{slug}/index.html`). Read the metadata and render the inert preview card per `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` §6 and §8: fidelity, screen names, fidelity note, and a local link to the standalone prototype. Never use an iframe. If metadata is missing or malformed, fall back to a generic "View prototype" caption and log a warning — do not crash the render. When there is no UI prototype, omit the figure entirely.

   After writing the HTML, open it in the browser (portable across macOS/Linux; falls back to printing the path):

   ```bash
   open {pm_dir}/backlog/proposals/{topic-slug}.html 2>/dev/null \
     || xdg-open {pm_dir}/backlog/proposals/{topic-slug}.html 2>/dev/null \
     || echo "View: {pm_dir}/backlog/proposals/{topic-slug}.html"
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

The agent-tier flow reaches Step 07 after `04a-synthesis.md` (synthesis + scope-lock) and `05-scope-review.md` with agent-tier parameters (parallel reviewer dispatch). The session state already carries:
- `synthesis:` block — JTBD, personas, scope, risks with `source:` on each item
- `source_citations:` block — flattened mirror of every cited decision

### Citation render — markdown

When emitting the proposal markdown, every claim derived from a citation MUST carry inline `[source: ...]` notation. Use the flatten rules from `references/proposal-format.md` §"Agent-tier source citations":
- `{file: "pm/strategy.md", line: 42}` → `[source: pm/strategy.md#L42]`
- `{file: "pm/evidence/research/agent-mode.md", finding_id: "F3"}` → `[source: pm/evidence/research/agent-mode.md#F3]`
- `{file: "pm/strategy.md"}` (no line/finding) → `[source: pm/strategy.md]`

Tokens go inline next to the claim, NOT in a separate references list. Example output:

```markdown
## II. Users & Job to be Done

**Primary JTBD.** When I groom a feature with KB-rich context, I want to
skip questions about facts already documented [source: pm/strategy.md#L24],
so I can review a complete proposal in one pass
[source: pm/evidence/research/agent-mode-pm-tools.md#F2].

**Primary persona — PM-engineer with mature KB** [source: pm/strategy.md#L8]:
lives in CLI, runs many sessions per week against the same project.
```

### Citation render — HTML

The 07 step renders the markdown proposal first, then renders the HTML version (using `references/templates/proposal-reference.html`). For agent-tier:

1. **Inline superscripts.** Every `[source: path#L42]` token in the markdown becomes `<sup class="src">path#L42</sup>` in the HTML, positioned immediately after the cited claim. The `.src` style is already in the proposal-reference template.
2. **Audit details block.** Append a collapsed `<details class="audit-block">` near the end of the HTML proposal (after Success Metrics, before Status & Next Steps):

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

Assert `html_count >= md_count`. If `html_count < md_count`: log a warning and surface as a blocking issue for team review (Step 08, agent parameters). Citation loss between layers is a known render risk per RFC §8.

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

If `citation_parity: false`, the team-review step (Step 08) will flag this as a blocking issue. The fix is to re-render the HTML preserving every markdown citation.

### Proceed to Step 08 (agent tier)

Agent-tier flow proceeds directly to `08-team-review.md` (agent parameters) for parallel reviewer dispatch. Do NOT wait for user approval at this step — the proposal-ready checkpoint comes after team review converges.
