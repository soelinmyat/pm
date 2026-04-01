# Writing Plans (Dev Stage 4 Reference)

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** This should be run in a dedicated worktree (created by the design exploration phase).

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

**Output formatting:** Follow `${CLAUDE_PLUGIN_ROOT}/references/writing.md` for prose quality. Plans are dense by nature but should still use short sentences, clear structure, and no jargon.

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during design exploration. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

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

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Apps/services affected:** [list affected apps, packages, or services from project structure]
**Cross-boundary sync required:** [yes/no — yes if changes span layers that require codegen, type sync, or contract sync per AGENTS.md]

**Tech Stack:** [Key technologies/libraries]

## Contract

> What is binding for this implementation. Reviewers and implementers use this to judge completeness and drift.

**Done criteria:**
1. [Testable condition that must be true when this ships]
2. [Testable condition]

**Verification commands:**
- `[test command from AGENTS.md]`
- `[any additional verification — lint, typecheck, e2e]`

**Files in scope:** [List of files/directories this plan creates or modifies — anything outside this list is out of scope]

**Risk notes:** [Known risks, sequencing constraints, or assumptions that could invalidate the plan]

---
```

## Upstream Context (groomed issues only)

When the invoking skill (dev) passes a groom context with a `research_location` path:

1. Read `research_location` from the groom context passed by the invoking skill.
2. Read the findings file at that path (e.g., `pm/research/pm-dev-merge/findings.md`).
3. Extract key findings: competitor landscape summary, market signals, and any decision rationale.
4. Inject as `## Upstream Context` in the plan document, after the header block and before the first task.

**Format:**

```markdown
## Upstream Context

> Injected from groom session `{session-slug}` — research at `{research_location}`.

### Key Findings
- {finding 1}
- {finding 2}
- ...

### Groom Conditions
- {bar_raiser condition 1}
- {team_review condition relevant to this sub-issue}

---
```

**Rules:**
- If `research_location` is missing or the file doesn't exist, skip injection — do not error.
- Keep the section concise (max ~20 lines). Summarize, don't paste the full findings file.
- The `## Upstream Context` section MUST be non-empty when processing a groomed issue that has a valid `research_location`. This is a verifiable AC.

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

## Plan Review Loop

After writing the complete plan, follow the review gate pattern in `${CLAUDE_PLUGIN_ROOT}/references/review-gate.md`:

1. Dispatch a single plan-document-reviewer subagent (see plan-document-reviewer-prompt.md) with precisely crafted review context — never your session history.
   - Provide: path to the plan document, path to spec document
2. If Issues Found: fix the issues, re-dispatch reviewer for the whole plan (max 3 iterations)
3. If Approved: proceed to execution handoff
4. Reviewers are advisory — explain disagreements if you believe feedback is incorrect

## Execution Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `docs/plans/<filename>.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?"**

**If Subagent-Driven chosen (default):**
- **REQUIRED SUB-SKILL:** Use dev:subagent-dev
- Fresh subagent per task + two-stage review
