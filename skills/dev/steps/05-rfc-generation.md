---
name: RFC Generation
order: 5
description: Generate engineering RFC with issue breakdown, test strategy, and risks (M/L/XL)
---

## RFC Generation (M/L/XL)

Generate the engineering RFC — the single artifact that contains the technical approach, issue breakdown, test strategy, and risks. The RFC is written directly as HTML to `{pm_dir}/backlog/rfcs/{slug}.html` using the reference template.

Dispatch a fresh @developer agent that writes the RFC. A separate fresh agent handles implementation — the approved RFC is the handoff contract.

Use the current runtime instructions from `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`.

### Pre-planning: Raw sub-issue specs (multi-task only)

If sub-issues exist and some are raw (ungroomed) M/L/XL, handle them before RFC generation:

**Raw XS:** Note "direct implementation, no plan needed" in state file. Include in the RFC as an XS issue with minimal approach section.

**Raw S/M/L/XL that are NOT groomed:** Dispatch a short-lived design worker per raw sub-issue to generate a spec:

```
Design exploration for {ISSUE_ID} ({ISSUE_TITLE}).

## Project Context
{PROJECT_CONTEXT}

**CWD:** {REPO_ROOT}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}
**Sub-issue description:**
{ISSUE_DESCRIPTION}

**Parent issue context:**
{PARENT_TITLE}: {PARENT_DESCRIPTION_SUMMARY}

Follow ${CLAUDE_PLUGIN_ROOT}/skills/groom/phases/phase-5-design.md.
Save spec to docs/specs/{DATE}-{SLUG}.md.
Commit, then end your response with:
SPEC_COMPLETE
- issue: {ISSUE_ID}
- path: docs/specs/{file}
- summary: {2-line summary}
```

For raw M/L/XL specs, dispatch spec reviewers (UX, Product, Competitive) from `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/spec-reviewer-prompts.md`. Fix blocking issues, commit.

Groomed sub-issues skip this step — their proposal is sufficient context.

### RFC generation prompt

Dispatch an `Agent(...)` with the @developer persona brief (or run inline in Codex without delegation):

```text
Phase 1 — Generate engineering RFC for: {ISSUE_TITLE}.

## Project Context
{PROJECT_CONTEXT}

**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}
**Session file:** {source_dir}/.pm/dev-sessions/{slug}.md
**Proposal:** {pm_dir}/backlog/{slug}.md
**PRD:** {pm_dir}/backlog/proposals/{slug}.html

Read the proposal and PRD for full product context.
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html for the HTML structure and styling to replicate.
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md for section content guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/splitting-patterns.md for issue splitting guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/writing-rfcs.md for writing conventions.

{IF SUB-ISSUES EXIST:}
**Sub-issues (each becomes an Issue section in the RFC):**
{FOR_EACH_SUB_ISSUE:}
  - {ISSUE_ID}: {ISSUE_TITLE} (size: {SIZE}, groomed: {yes/no})
    Description: {ISSUE_DESCRIPTION}
    ACs: {ACCEPTANCE_CRITERIA}
    Spec: {SPEC_PATH or "from proposal ACs"}
{END_FOR_EACH}

**Dependency order:** {ORDERED_LIST}

Each sub-issue becomes an Issue section within the RFC. You may also split sub-issues
further or merge trivial ones if the technical structure warrants it.
{ELSE:}
The RFC may produce multiple Issues if the work naturally splits. Use splitting-patterns.md.
A single Issue is fine if the work is genuinely one concern.
{END IF}

Write the RFC as a self-contained HTML file to {pm_dir}/backlog/rfcs/{slug}.html (match the reference template's structure, styling, and quality — inline CSS, no external deps except fonts and mermaid.js CDN).
Commit the RFC, then end your response with:

RFC_COMPLETE
- slug: {slug}
- path: {pm_dir}/backlog/rfcs/{slug}.html
- summary: {3-line summary}
- issues: {N}

Stop after sending the summary. A separate agent will handle implementation after RFC review.
```

### Orchestrator waits for RFC

Wait for the worker to return and capture only the `RFC_COMPLETE` payload. If RFC generation ran inline, produce the same payload yourself.

After receiving `RFC_COMPLETE`:
1. Record `task_count: {N}` in the session state (from `issues: {N}`).
2. If sub-issues exist: reconcile RFC Issue sections back to sub-issues, update sizes in state file if the RFC reveals different complexity.
3. Update the proposal's frontmatter: set `rfc: rfcs/{slug}.html` in `{pm_dir}/backlog/{slug}.md`
4. Update `.pm/dev-sessions/{slug}.md` with RFC path, commit SHA, and worker metadata
5. Proceed to RFC Review.
