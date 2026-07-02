---
name: RFC Generation
order: 2
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

Follow ${CLAUDE_PLUGIN_ROOT}/skills/groom/steps/06-design.md.
Save spec to docs/specs/{DATE}-{SLUG}.md.
Commit, then end your response with:
SPEC_COMPLETE
- issue: {ISSUE_ID}
- path: docs/specs/{file}
- summary: {2-line summary}
```

For raw M/L/XL specs, dispatch spec reviewers (UX, Product, Competitive) from `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/spec-reviewers.md`. Fix blocking issues, commit.

<!-- Test Strategy is owned by the parent RFC generator (Phase 1 prompt below); design workers do not emit Test hooks. -->

Groomed sub-issues skip this step — their proposal is sufficient context.

### RFC generation prompt

Dispatch an `Agent(...)` with the @developer persona brief (or run inline in Codex without delegation):

```text
Phase 1 — Generate engineering RFC for: {ISSUE_TITLE}.

## Project Context
{PROJECT_CONTEXT}

**CWD:** {CWD}
**Branch:** {BRANCH}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}
**Session file:** {source_dir}/.pm/rfc-sessions/{slug}.md
**Proposal (includes full PRD):** {pm_dir}/backlog/{slug}.md

Read the proposal for full product context (PRD content is inline — user flows, wireframes, competitive context).
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html for the HTML structure and styling to replicate.
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md for section content guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/splitting-patterns.md for issue splitting guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/writing-rfcs.md for writing conventions.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/test-layers.md for test layer routing principles (inside-out TDD order, platform × layer matrix, per-layer guidance).

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

**Layered artifact requirements:**
The RFC must include a Decision Brief, an Execution Contract, and an Appendix marker before detailed rationale. Decision Brief is for human approval (target <= 400 words). Execution Contract is for agents (target <= 1,500 words before issue cards) and must summarize scope, non-goals, files, dependencies, ACs, Test hooks, verification commands, and open implementation questions. Appendix contains codebase findings, architecture, decisions, risks, advisory notes, resolved questions, and change log.

**Test Strategy requirements:**
The RFC must include a complete Test Strategy section between Risks and Issues. Read `rfc-template.md` (already in your reading list above) for the canonical subsection schema — fill every subsection. Ground the strategy in the test-layers.md principles you read above. Each Issue must include a `Test hooks:` field that names which Test Strategy subsections the issue exercises and traces them to specific ACs. Do not list hooks that the issue does not actually exercise.

**Stable HTML contract:**
Preserve `id="brief"`, `id="execution-contract"`, `id="appendix"`, `id="test-strategy"`, `data-schema-version="2"`, `.issue-detail`, `.issue-detail-num`, `.issue-detail-title`, `.issue-detail-size`, `.test-strategy`, `.test-strategy-block`, and `.hooks-badge`. Dev intake depends on these hooks.

**Structured JSON sidecar (machine-readable twin):**
Alongside the HTML, write a JSON sidecar to {pm_dir}/backlog/rfcs/{slug}.json. The HTML stays the human render; the sidecar is the machine source that downstream consumers (dev intake, groom re-discovery, RFC review child cards) read instead of grepping HTML anchors. It carries the same content as the .issue-detail cards and .test-strategy-block bodies you write into the HTML — do not invent new facts. Schema (schema_version 2), written as plain JSON:

    {
      "schema_version": 2,
      "slug": "{slug}",
      "title": "{RFC title}",
      "size": "{XS|S|M|L|XL}",
      "status": "draft",
      "issues": [
        {
          "num": 1,
          "title": "{issue title, same as .issue-detail-title}",
          "size": "{XS|S|M|L|XL, same as .issue-detail-size}",
          "test_hooks": ["{Test Strategy subsection -> AC, same as the issue .hooks-badge}"]
        }
      ],
      "test_strategy": {
        "test_levels": "{Test levels in scope block body}",
        "new_infrastructure": "{New test infrastructure block body}",
        "regression_surface": "{Regression surface block body}",
        "verification_commands": "{Verification commands block body}",
        "open_questions": "{Open test questions block body}"
      }
    }

Rules the sidecar must satisfy: schema_version is 2; issues is a non-empty array with unique positive nums, non-empty titles, and sizes in XS/S/M/L/XL; each test_hooks mirrors that issue's .hooks-badge; all five test_strategy fields are non-empty strings mirroring the .test-strategy-block bodies. Do not add fields beyond this schema.

Write the RFC as a self-contained HTML file to {pm_dir}/backlog/rfcs/{slug}.html (match the reference template's structure, styling, and quality — inline CSS, no external deps except fonts and mermaid.js CDN). Write the JSON sidecar to {pm_dir}/backlog/rfcs/{slug}.json.

Before committing, validate the sidecar and fix anything it reports:
  node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-sidecar-check.js --sidecar {pm_dir}/backlog/rfcs/{slug}.json

Commit the RFC and its JSON sidecar together, then end your response with:

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
1. **Validate the JSON sidecar** — completion gate. Run:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-sidecar-check.js --sidecar {pm_dir}/backlog/rfcs/{slug}.json
   ```
   If it exits non-zero (missing sidecar, wrong `schema_version`, malformed issues, or empty `test_strategy` fields), re-dispatch the writer to fix the sidecar and revalidate. Do not proceed to RFC Review until it passes. The HTML render remains the human artifact; the sidecar is the machine handoff.
2. Record `task_count: {N}` in the session state (from `issues: {N}`).
3. If sub-issues exist: reconcile RFC Issue sections back to sub-issues, update sizes in state file if the RFC reveals different complexity.
4. Update the proposal's frontmatter: set `rfc: rfcs/{slug}.html` in `{pm_dir}/backlog/{slug}.md`
5. Update `{source_dir}/.pm/rfc-sessions/{slug}.md` with RFC path, commit SHA, and worker metadata
6. Proceed to RFC Review.
