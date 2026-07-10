---
name: RFC Generation
order: 2
description: Generate engineering RFC with issue breakdown, test strategy, and risks (M/L/XL)
---

## RFC Generation (M/L/XL)

**Goal:** Produce a validated engineering RFC and machine sidecar whose issue breakdown, test strategy, and artifact binding are ready for independent review.

Generate the engineering RFC — the single artifact that contains the technical approach, issue breakdown, test strategy, and risks. The RFC is written directly as HTML to `{pm_dir}/backlog/rfcs/{slug}.html` using the reference template.

**Loop worker branch:** If `PM_LOOP_WORKER=1`, use the copied proposal/PM context read-only. Write the candidate HTML (and validation scratch such as its JSON sidecar) under `PM_LOOP_RESULT_DIR/artifacts/`, never under `{pm_dir}`. Skip the normal proposal/backlog `rfc:` write in this step. Continue through the same generation, Test Strategy, sidecar, and review gates; Step 03 emits the final document result through `PM_LOOP_RESULT_FILE`.

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

Rules the sidecar must satisfy: schema_version is 2; slug and title are non-empty and slug equals the RFC slug; the top-level size and every issue size are canonical uppercase XS/S/M/L/XL (no lowercase, no padding); issues is a non-empty array with unique positive nums and non-empty titles that contain no '|', newlines, or control characters; each test_hooks is an array of non-empty strings mirroring that issue's .hooks-badge; all five test_strategy fields are non-empty strings mirroring the .test-strategy-block bodies. The schema is exactly these fields — no others, and NO status field (RFC lifecycle lives in the RFC frontmatter, not the sidecar).

Bind the sidecar to the HTML: after writing {slug}.json, compute its SHA-256 (e.g. `shasum -a 256 {pm_dir}/backlog/rfcs/{slug}.json`, or `sha256sum`) and write it onto the HTML root element next to data-schema-version, as data-sidecar-hash="sha256:{hex}". This binds the two artifacts so a later HTML edit that forgets to regenerate the sidecar is caught, never silently shipped.

Write the RFC as a self-contained HTML file to {pm_dir}/backlog/rfcs/{slug}.html (match the reference template's structure, styling, and quality — inline CSS, no external deps except fonts and mermaid.js CDN). Write the JSON sidecar to {pm_dir}/backlog/rfcs/{slug}.json.

Before committing, validate the sidecar (schema + slug + HTML hash binding) and fix anything it reports:
  node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-sidecar-check.js --sidecar {pm_dir}/backlog/rfcs/{slug}.json --html {pm_dir}/backlog/rfcs/{slug}.html --slug {slug}

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
1. **Validate the sidecar — completion gate.** Run the validator with the HTML binding and slug cross-check:
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-sidecar-check.js \
     --sidecar {pm_dir}/backlog/rfcs/{slug}.json \
     --html {pm_dir}/backlog/rfcs/{slug}.html \
     --slug {slug}
   ```
   Then cross-check that the HTML and the sidecar agree on the issue count:
   ```bash
   sidecar_n=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).issues.length))" {pm_dir}/backlog/rfcs/{slug}.json)
   html_n=$(grep -c 'class="issue-detail"' {pm_dir}/backlog/rfcs/{slug}.html)
   [ "$sidecar_n" = "$html_n" ] || echo "issue-count drift: sidecar=$sidecar_n html=$html_n"
   ```
   The RFC is NOT done if the validator exits non-zero (missing sidecar, wrong `schema_version`, malformed issues, empty `test_strategy` fields, slug mismatch, or a `data-sidecar-hash` that does not match the sidecar bytes), OR the two issue counts differ, OR the `RFC_COMPLETE` payload `issues: {N}` disagrees with the validated `issues[].length`. Re-dispatch the writer to fix it and revalidate. **Cap at 2 re-dispatches**, then halt and surface the validator output to the user (mirrors the review-loop cap). Do not proceed to RFC Review until the gate passes. The HTML render remains the human artifact; the sidecar is the machine handoff.
2. Set `task_count` from the **validated sidecar's** `issues[].length` — never the `RFC_COMPLETE` payload (a payload/sidecar mismatch is a gate failure caught in step 1). Record it in the session state.
3. If sub-issues exist: reconcile RFC Issue sections back to sub-issues, update sizes in state file if the RFC reveals different complexity. In Loop Worker Mode, keep this local to the run and skip PM/backlog writes.
4. Outside Loop Worker Mode, update the proposal's frontmatter: set `rfc: rfcs/{slug}.html` in `{pm_dir}/backlog/{slug}.md`. If `PM_LOOP_WORKER=1`, skip this backlog write.
5. Update `{source_dir}/.pm/rfc-sessions/{slug}.md` with RFC path, commit SHA, and worker metadata
6. Proceed to RFC Review.

When the HTML and sidecar pass schema, hash-binding, slug, and issue-count
checks, task count and session state are updated, and loop mode has made no
canonical backlog write, proceed to Step 03 (RFC Review).
