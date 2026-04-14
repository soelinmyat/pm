---
name: Draft Proposal
order: 7
description: Detect feature type, generate flows/wireframes, draft proposal content and backlog entry
applies_to: [quick, standard, full]
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
   - Notify the user: "Proposal finalized at `{pm_dir}/backlog/{topic-slug}.md`."

5. Update state and proceed directly to Step 11 (Link):

```yaml
phase: draft-proposal
proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
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
