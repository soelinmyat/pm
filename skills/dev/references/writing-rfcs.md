# Writing RFCs (Dev Stage 3 Reference)

## Overview

Write engineering RFCs that turn a product proposal into an actionable implementation plan. The RFC contains the technical approach, issue breakdown, test strategy, and risks — everything an engineer needs to implement from zero context.

Assume the implementer is a skilled developer but knows almost nothing about the codebase or problem domain. Document everything: which files to touch, implementation approach per issue, test strategy, and verification commands. DRY. YAGNI. TDD. Frequent commits.

**Announce at start:** "I'm generating the engineering RFC."

**Context:** This should be run in a dedicated worktree. Read the proposal (`{pm_dir}/backlog/{slug}.md`) and PRD (`{pm_dir}/backlog/proposals/{slug}.html`) for product context.

**Save RFCs to:** `{pm_dir}/backlog/rfcs/{slug}.html` — RFCs are written directly as self-contained HTML.

**Output formatting:** Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md` for prose quality. RFCs are dense by nature but should still use short sentences, clear structure, and no jargon.

**HTML reference:** Read `${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html` — match its structure, styling, and quality level. This is a complete example; replicate it with the actual RFC content.

**Section content guide:** Read `${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md` for what goes in each section.

## Scope Check

If the proposal covers multiple independent subsystems, split into separate issues within the RFC. Each issue should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## RFC Document Structure

Follow the section structure from `${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html`. The RFC has these sections:

1. **Hero header** — title, one-line summary, metadata strip (size, status, task count)
2. **Sticky TOC** — navigation bar for all active sections
3. **Codebase Findings** — what was discovered during exploration that shaped the design
4. **Architecture** — system diagram (Mermaid), component relationships, data flow
5. **Key Decisions** — alternatives considered, chosen option, rationale (may become ADRs)
6. **Data Model** — schema changes, migrations, types (omit if none)
7. **API** — new/modified endpoints, request/response shapes (omit if none)
8. **Risks** — risk table with impact and mitigations
9. **Issues** — independently implementable units with ACs, approach, dependencies, size
10. **Resolved Questions** — populated during review, empty in draft
11. **Change Log** — review iterations, populated during review

## Proposal Context

Read the proposal and PRD for product context before writing the RFC:

1. Read `{pm_dir}/backlog/{slug}.md` — outcome, scope, competitive context, research refs
2. Read `{pm_dir}/backlog/proposals/{slug}.html` — full PRD with design details, user flows, wireframes
3. If `research_refs` exist, read the referenced research files for key findings
4. Incorporate the product context into the RFC's Codebase Findings and Architecture sections

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

**Task ordering for cross-layer changes:** Sequence tasks so dependencies flow downstream:
1. Shared packages and types (if changed)
2. Backend/API changes (migrations, endpoints, specs)
3. Cross-boundary sync (codegen, type generation — per AGENTS.md)
4. Frontend/consumer changes and tests
5. E2E or integration tests (if applicable)

Each task must produce working, testable code. Never leave cross-boundary sync as a "later" step.

## Remember
- Exact file paths always
- Complete code in plan (not "add validation")
- Exact commands with expected output
- Reference relevant skills with @ syntax
- DRY, YAGNI, TDD, frequent commits

## RFC Review Loop

After writing the complete RFC, the orchestrator handles review (Stage 4 in dev-flow.md). The RFC writer should:

1. Commit the RFC to `{pm_dir}/backlog/rfcs/{slug}.html`
2. Update the proposal's frontmatter to link the RFC
3. Return the `RFC_COMPLETE` payload and stop

The orchestrator then dispatches 3 RFC reviewers, handles findings, and gets user approval before resuming the same worker for implementation.

## Execution Handoff

After RFC approval, the same worker is resumed with an implementation brief. The worker:
- Reads the RFC end-to-end
- Implements issues in dependency order using `dev:subagent-dev`
- Each issue follows TDD: write failing test → implement → verify → commit
