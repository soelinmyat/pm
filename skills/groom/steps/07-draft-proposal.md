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

Gather all product context into a coherent proposal narrative. Use the exact section names and order from `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md`. The body has twelve Roman-numeralled sections preceded by a TL;DR block. Source content for each section from:

- **TL;DR** (pre-section) — three lines: **For** (audience), **What** (the smallest shippable set), **Why now** (the time-pressure or strategic reason). The frontmatter `outcome:` field becomes the lede paragraph under the H1 — keep it to one sentence.
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

**Wireframes are not a section.** When a UI prototype exists, the markdown surfaces it as a link inside the TL;DR block and the HTML renderer embeds it as a hero-prototype figure between the title and TL;DR (see Step 5 below).

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

   Create `{pm_dir}/backlog/proposals/` if it doesn't exist (`mkdir -p {pm_dir}/backlog/proposals`). Write a styled HTML version of the proposal to `{pm_dir}/backlog/proposals/{topic-slug}.html`. Use the reference template at `${CLAUDE_PLUGIN_ROOT}/references/templates/proposal-reference.html` for structure and styling — it is the canonical render. Match its DOM shape exactly so the styling carries.

   **HTML layout, top to bottom:**

   1. **Masthead** (`<header class="masthead">`) — left: `<span class="masthead-id">{ID}</span>`; right: `<div class="masthead-meta">` with `<span class="status-mark">Proposed</span>` + priority + size + date spans.
   2. **Title block** (`<div class="title-block">`) — `<h1>{title}</h1>` followed by `<p class="lede">{outcome sentence from frontmatter}</p>`.
   3. **Hero prototype** (`<figure class="hero-prototype">`) — only when a UI prototype exists. See "Hero prototype" sub-rules below.
   4. **TL;DR** (`<div class="tldr">`) — `<dl>` with three `<dt>`/`<dd>` pairs: For / What / Why now.
   5. **TOC** (`<nav class="toc" aria-label="Sections">`) — twelve `<a>` links, each containing `<span class="toc-num">{Roman}</span>` plus a short label. Three-column rule-divided layout; styling is in the reference template.
   6. **Twelve sections** in fixed order, each `<section id="{anchor}">` with `<h2><span class="sec-num">{Roman}</span>{Section name}</h2>`. Anchor IDs are fixed: `problem`, `jtbd`, `usecases`, `scope`, `requirements`, `edge`, `flow`, `competitive`, `feasibility`, `open-q`, `metrics`, `status`. See the per-section patterns below.
   7. **Footer** (`<footer>`) — two spans: "`{ID} · {Title}`" and "`Product Proposal · {date}`".

   **Per-section patterns** (use the listed wrapper components from the reference template — do NOT invent new class names):

   - **I. Problem** — `<p class="lead">` for the one-line restatement, then 1–2 `<p>` paragraphs of evidence, then optionally `<div class="annotation">` with `<span class="annotation-label">` for an evidence quote.
   - **II. Users & JTBD** — `<div class="annotation annotation-jtbd">` for the JTBD pullquote (use `<em>` inside for the "in my own language"-style emphasis), then `<div class="personas">` containing one or two `<div class="persona">` cards, each with `<div class="persona-tag">`, `<div class="persona-name">`, `<p class="persona-desc">`.
   - **III. Use Cases** — `<p class="lead">` blurb, then `<div class="usecases">` containing 2–4 `<div class="usecase">` blocks. Each has `<div class="usecase-title"><span class="usecase-num">{01}</span>{title}</div>` and a `<dl>` with Trigger / Action / Result.
   - **IV. Scope** — `<div class="scope">` with two columns: `<div class="scope-col">` (In scope) and `<div class="scope-col scope-col-out">` (Out of scope). Each starts with `<div class="scope-col-label">` and contains a `<ul>`. Out-of-scope items use `<em>` for the inline reason. Below the columns: `<div class="filter-tag">{10x filter result and one-clause rationale}</div>`.
   - **V. Functional Requirements** — `<p class="lead">` blurb, then one `<h3>` per scope item with a `<ul>` of observable behaviors. Use `<code>` for technical identifiers (file paths, function names, env vars).
   - **VI. Edge Cases** — `<p class="lead">` blurb, then a single `<table>` with two columns: Case | Expected handling. Use `<strong>` to bold the case name in the first cell.
   - **VII. User Flow** — `<div class="diagram"><pre class="mermaid">{flow}</pre></div>`. Omit the whole section for non-UI features.
   - **VIII. Competitive Context** — `<table>` with 3–5 rows. End with `<div class="annotation"><span class="annotation-label">Handling decision</span><p>{rationale}</p></div>`.
   - **IX. Feasibility** — `<p class="lead"><strong>Verdict:</strong> {…}</p>`, then `<p>` paragraphs for **Build on:**, **Build new:**, **Top risks:**.
   - **X. Open Questions** — `<p class="lead">` blurb, then one `<div class="open-q">` per open question, each containing `<div class="open-q-q"><span class="open-q-num">{01}</span>{question}</div>`, `<p class="open-q-rec">`, and `<div class="open-q-meta">` with Owner + By. Resolved questions wrap in `<details><summary>Resolved questions ({N})</summary><div class="resolved-list">…</div></details>`, with each entry as `<div class="resolved-q">` containing `<div class="resolved-q-q">` and `<div class="resolved-q-a">`.
   - **XI. Metrics** — `<table>` with four columns: Metric | Baseline | Target | By. Optional caveat paragraph below using `<p style="margin-top:var(--space-3); font-size:0.92rem; color:var(--ink-3); max-width:var(--measure)"><strong style="color:var(--ink-2)">Caveat.</strong> …</p>` — match the reference template inline style verbatim.
   - **XII. Status** — `<div class="pipeline">` containing one `<div class="pipeline-row">` per groomed step. Each row has `<div class="pipeline-step">` (left label) and `<div class="pipeline-verdict">` (right verdict). End the section with `<p class="closing">Ready for engineering. Run <code>pm:rfc {slug}</code> to generate the technical RFC, then <code>pm:dev {slug}</code> to implement.</p>`. If a freshness note applies, render it as a `<p>` with `<strong>Freshness note.</strong>` directly after the closing paragraph.

   Render Mermaid via the existing `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js` CDN script and the `mermaid.initialize` call already in the reference template — keep both the script tag and the initialize block intact.

   **Hero prototype** — when the feature has a UI prototype (a wireframe file exists at `{pm_dir}/backlog/wireframes/{slug}.html` or `{pm_dir}/backlog/wireframes/{slug}/index.html`):

   1. Read the wireframe metadata per `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/prototype-format.md` §6:
      - Single-file: parse `<script type="application/json" id="wireframe-meta">` from the HTML head
      - Multi-file: read `{slug}/meta.json`
   2. Render the hero prototype figure between the title block and TL;DR per `prototype-format.md` §8. The wrapping element is `<figure class="hero-prototype">` and the iframe carries a fidelity modifier class: `hero-prototype-frame--sketch`, `hero-prototype-frame--wireframe`, or `hero-prototype-frame--mockup`.
   3. Iframe height by `fidelity` field: `sketch` → 560px, `wireframe` → 720px, `mockup` → 880px (already encoded in the modifier classes — do NOT inline `style="height: …"`).
   4. Auto-populate the Screens caption from `screens[].label` joined by ` · `.
   5. Auto-populate the fidelity-specific note paragraph per `prototype-format.md` §8.
   6. If wireframe metadata is missing or malformed, fall back to a generic "View prototype" caption with no screens listed and log a warning. Do not crash the render.

   When the feature has no UI prototype, omit the hero prototype figure entirely. The proposal goes masthead → title-block → TL;DR → TOC → sections.

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
