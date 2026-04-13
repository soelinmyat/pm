---
name: Present
order: 10
description: Write markdown PRD backlog entry, resolve open questions, get user approval
---

### Step 10: Present to User

**Full tier only.** Quick and standard tiers finalize the proposal in Draft Proposal (Step 7) and skip directly to Link. This step only runs after Team Review and Bar Raiser have completed.

Present the reviewed, iterated proposal as the finalized backlog entry. The PRD content lives inline in the backlog markdown file — no separate HTML artifact.

#### Step 1: Resolve open questions

Before writing the final backlog entry, collect all open questions from team review and bar raiser outputs. For each question:

1. **Attempt to answer it.** Use research files (`{pm_dir}/evidence/research/`), strategy (`{pm_dir}/strategy.md`), codebase exploration, and the proposal context. Most questions raised by reviewers _can_ be answered with data already available — the reviewers just didn't have access to every source.
2. **Record the answer.** Format: `Q: {question} → A: {answer with evidence/rationale}`.
3. **Escalate only what requires human judgment.** If a question genuinely needs a product decision that cannot be derived from existing research or strategy (e.g., pricing, legal, timeline commitments), mark it as "Decision needed" with a recommended answer.

The goal: the backlog entry shows a **Resolved Questions** section with clear answers, and at most 1-2 items under **Decisions Needed** — never a wall of unanswered questions.

#### Step 2: Write the proposal backlog entry

**Before generating, follow the `type: backlog` schema** from `${CLAUDE_PLUGIN_ROOT}/references/frontmatter-schemas.md`. The frontmatter must conform to this contract.

Write or update the backlog entry at `{pm_dir}/backlog/{topic-slug}.md`. Set `status: proposed`, `prd: null`, `rfc: null`.

**No sidecar files.** All metadata lives in the proposal `.md` frontmatter.

**Sections** (all 11 must be present as markdown sections):

1. **Title & summary.** Feature name, one-sentence outcome, key metrics: priority, differentiator (10x/parity/gap-fill), expected impact (the key outcome metric), ICP segment (from strategy).
2. **Problem & Context.** The user pain, market signal, or strategic driver. Use blockquotes for key research signals.
3. **Scope Overview.** In-scope vs out-of-scope lists. Include the 10x filter badge.
4. **User Flows.** Mermaid diagrams in fenced code blocks (```` ```mermaid ````). Include `%% Source:` citations.
5. **Wireframes.** Link to wireframe HTML files: `[Wireframe]({pm_dir}/backlog/wireframes/{name}.html)`. Wireframes live at `{pm_dir}/backlog/wireframes/{name}.html`.
6. **Competitive Context.** Markdown comparison table (capability | competitors | our approach). Blockquote for key differentiator.
7. **Technical Feasibility.** Build-on, build-new, risks, sequencing. Include verdict.
8. **Review Summary.** Pipeline steps (Scope Review, Team Review, Bar Raiser, Decision). Verdict summary. Advisory notes.
9. **Resolved Questions.** Each question from reviewers with its answer and evidence. If any questions remain that require human judgment, list them under a **Decisions Needed** subsection with a recommended answer for each.
10. **Freshness Notes** (conditional). If `stale_research` in the groom session state is non-empty, list each stale research source: "'{name}' — {age_days} days old (threshold: {threshold_days}d for {type})." End with: "Run `pm:refresh` to update stale research before starting implementation." If `stale_research` is empty, omit this section entirely — do not show an empty freshness section.
11. **Next Steps.** "Ready for engineering? Run `pm:dev {slug}` to generate the RFC and begin implementation."

#### Step 3: Notify the user

Tell the user:
> "Proposal for '{topic}' is ready.
> File: `{pm_dir}/backlog/{topic-slug}.md`
>
> Approve this proposal, or would you like changes?"

#### Step 4: Handle feedback

Wait for explicit approval. Accept edits inline. If the user requests changes:
- For minor edits (wording, AC tweaks): revise the proposal and update the backlog entry. No need to re-run reviews.
- For scope changes (adding/removing in-scope items): re-run from Step 8 (Team Review).

Update state:

```yaml
phase: present
```
