# Writing RFCs

## Overview

Write engineering RFCs that turn a product proposal into an actionable implementation plan. The RFC contains a Decision Brief for humans, an Execution Contract for agents, and an Appendix for rationale. It also contains the technical approach, issue breakdown, test strategy (see the [Test Strategy](#test-strategy-section) chapter below), and risks — everything an engineer needs to implement from zero context.

Assume the implementer is a skilled developer but knows almost nothing about the codebase or problem domain. Document everything: which files to touch, implementation approach per issue, verification commands, and the testing contract. DRY. YAGNI. TDD. Frequent commits.

**Announce at start:** "I'm generating the engineering RFC."

**Context:** This should be run in a dedicated worktree. Read the proposal (`{pm_dir}/backlog/{slug}.md`) for product context. The backlog entry contains full PRD content — user flows, wireframes, competitive context.

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

This is the execution layer beneath the Test Strategy — per-task TDD within what the strategy has already scoped.

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
3. **Decision Brief** — <= 400 words for human approval: recommendation, fit, biggest risk, decision needed
4. **Execution Contract** — <= 1,500 words before issue cards: scope, non-goals, files, AC summary, dependency order, test hooks, commands
5. **Appendix marker** — everything below is rationale/detail, not the default read path
6. **Codebase Findings** — what was discovered during exploration that shaped the design
7. **Architecture** — system diagram (Mermaid), component relationships, data flow
8. **Key Decisions** — alternatives considered, chosen option, rationale (may become ADRs)
9. **Data Model** — schema changes, migrations, types (omit if none)
10. **API** — new/modified endpoints, request/response shapes (omit if none)
11. **Risks** — risk table with impact and mitigations
12. **Test Strategy** — test levels, infrastructure, regression surface, verification commands, open questions (see [Test Strategy](#test-strategy-section) chapter)
13. **Issues** — independently implementable units with ACs, approach, dependencies, size, and Test hooks
14. **Resolved Questions** — populated during review, empty in draft
15. **Change Log** — review iterations, populated during review

## Layered Read Contract

- **Humans read first:** Decision Brief, then Risks and Resolved Questions if they need confidence.
- **Agents read first:** Execution Contract, then Issue cards, then Test Strategy.
- **Auditors read later:** Appendix sections with findings, architecture, decisions, advisory notes, and change log.
- **Contract wins:** if the Execution Contract conflicts with appendix prose, fix the appendix before approval.
- **Budget enforcement:** word budgets are warning-first. Required layer presence and parser class preservation are blocking.

## Test Strategy Section

Every M/L/XL RFC must include a **Test Strategy** section between Risks and Issues. This section is the testing contract — it scopes what gets tested, what infrastructure is needed, and what existing behavior must not break. It is grounded in `skills/dev/test-layers.md` principles.

**Subsection schema:** The canonical list of required subsections lives in `${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md` under `## Test Strategy`. Reference that file for the authoritative subsection names and content guidance — do not restate the list here to avoid drift. If a subsection does not apply, state "Not applicable" with a one-sentence rationale.

**Per-issue Test hooks:** Each issue card includes a `Test hooks:` field that names which Test Strategy subsections the issue exercises, traced to specific ACs. Example: `Test hooks: Test levels in scope -> Layer 1 unit; Regression surface -> existing parser tests`. Omit subsections the issue does not touch. This is where the @tester reviewer checks hook-to-AC traceability and where the implementer picks up testing scope during dev.

**Relationship to the per-task TDD rhythm:** The Test Strategy section is the *strategy layer* — it decides what to test and what infrastructure to use. The per-task TDD rhythm below is the *execution layer* — it implements that strategy one task at a time. Strategy scopes; TDD executes.

## Proposal Context

Read the proposal for product context before writing the RFC:

1. Read `{pm_dir}/backlog/{slug}.md` — outcome, scope, competitive context, research refs, plus full PRD content (user flows, wireframes, design details are inline)
2. If `research_refs` exist, read the referenced research files for key findings
3. Incorporate the product context into the RFC's Codebase Findings and Architecture sections

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

## JSON Sidecar Contract

This is the single source for how the **JSON sidecar** works. Consumers point here rather than restating the rule; keep the policy in this one place.

Every RFC is written as **two paired artifacts**:

- `{pm_dir}/backlog/rfcs/{slug}.html` — the human render. Reviewers and approvers read this.
- `{pm_dir}/backlog/rfcs/{slug}.json` — the machine-readable JSON sidecar (`schema_version: 2`). Machine consumers (dev intake, groom re-discovery, RFC review child-card creation) read this **first**, so they stop grepping HTML anchors.

The sidecar is a projection of the render, not a second source of truth: it carries the same content as the HTML's `.issue-detail` cards and `.test-strategy-block` bodies. Schema (exactly these fields — no `status`; RFC lifecycle lives in the RFC frontmatter):

| Field | Content |
|-------|---------|
| `schema_version` | Always `2` |
| `slug`, `title`, `size` | RFC identity — `slug` equals the RFC slug; `size` is canonical uppercase XS/S/M/L/XL |
| `issues[]` | `{ num, title, size, test_hooks[] }` per issue — mirrors the `.issue-detail` cards |
| `test_strategy` | `{ test_levels, new_infrastructure, regression_surface, verification_commands, open_questions }` — mirrors the `.test-strategy-block` bodies |

**Sidecar↔HTML binding.** The HTML root carries `data-sidecar-hash="sha256:{hash-of-json-bytes}"`. This ties the render to its sidecar so drift is detectable. `scripts/rfc-sidecar-check.js --html` verifies the attribute matches the sidecar bytes; `--slug` verifies `slug`.

**Canonical consumer rule (the one halt policy):**

- **Sidecar present and valid** (`rfc-sidecar-check.js` exits clean) → it is the source of truth: read `issues[]` and `test_strategy` from it, no HTML parsing.
- **Sidecar present but invalid** (non-zero exit — bad schema, slug mismatch, or `data-sidecar-hash` mismatch) → **HALT** and route to `/pm:rfc` to regenerate. Never fall back to the HTML for a present-but-broken sidecar.
- **Sidecar absent** → legacy/pre-sidecar RFC. Fall back to the HTML `.issue-detail` / `.test-strategy-block` parse below.

**Era detection.** If the HTML has `data-sidecar-hash` but the sidecar is missing or mismatched, the sidecar was deleted or drifted → **HALT** (do not treat as legacy). Only HTML that lacks `data-sidecar-hash` is a genuine pre-sidecar RFC eligible for the HTML fallback.

## Issue Section HTML Contract (legacy fallback)

The HTML render of every RFC exposes issue data through CSS class names, and pre-sidecar RFCs have no JSON twin — so the dev intake step parses these classes whenever a sidecar is missing. These class names are a **stable contract** — do not rename them without updating the parser in `skills/dev/steps/02-intake.md`.

| Class | Purpose |
|-------|---------|
| `.issue-detail` | Container for each issue card |
| `.issue-detail-num` | Issue number (e.g., "1", "2") |
| `.issue-detail-title` | Issue title text |
| `.issue-detail-size` | Size badge (XS/S/M/L/XL) |
| `#brief` | Decision Brief section anchor |
| `#execution-contract` | Execution Contract section anchor |
| `#appendix` | Appendix marker before rationale/detail |
| `.test-strategy` | Container for the Test Strategy section |
| `.test-strategy-block` | Container for each Test Strategy subsection card |
| `.hooks-badge` | Per-issue Test hooks badge inside `.issue-detail` |

The RFC HTML template (`references/templates/rfc-reference.html`) uses these classes in the Issues and Test Strategy sections. Any RFC generated by this skill must preserve them.

## RFC Writer Contract

After writing the complete RFC, the writer should:

1. Commit the RFC to `{pm_dir}/backlog/rfcs/{slug}.html`
2. Update the proposal's frontmatter to link the RFC
3. Return the `RFC_COMPLETE` payload and stop

The orchestrator then dispatches RFC reviewers, handles findings, and gets user approval. Implementation is a separate `/dev` invocation after RFC approval.
