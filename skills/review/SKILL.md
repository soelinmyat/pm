---
name: review
description: "Multi-perspective code review (code + PM + design + input edge-cases) with auto-fix. Conditionally skips PM/Design agents when upstream gates passed."
---

# /review [PR#]

**State file convention:** The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If no state file matches, check legacy path `.dev-state-{slug}.md`. If neither exists, proceed without upstream gate data (all agents run). References to `.dev-state.md` below mean `.pm/dev-sessions/{slug}.md`.

Multi-perspective code review with auto-fix. Runs up to five review agents in parallel:
- **Code Reviewer** (official code-review skill) — posts PR comment for high-confidence bugs
- **Code Fix Reviewer** — finds ALL genuine code bugs for auto-fix (no confidence threshold)
- **PM Reviewer** — JTBD alignment, feature completeness, product risk. *Skipped when Spec Review passed upstream.*
- **Design Reviewer** — design system compliance, token usage, component patterns. *Skipped when Design Critique passed upstream.*
- **Input Edge-Case Reviewer** — enumerates input domains/boundaries and missing branch-coverage tests

## Phase 0: Check & Fix Conflicts

Before reviewing, ensure the branch is up to date with main:

1. Run: `git fetch origin main && git log HEAD..origin/main --oneline`
2. **If no output:** Branch is up to date. Continue to Phase 1.
3. **If commits behind:** Merge main:
   ```bash
   git merge origin/main
   ```
   - If merge succeeds cleanly, continue to Phase 1.
   - If conflicts exist:
     - Run `git diff --name-only --diff-filter=U` to list conflicted files
     - Resolve each conflict preserving the intent of both sides
     - Stage resolved files and commit: `git commit -m "merge: resolve conflicts with main"`
     - Run relevant verification commands for resolved files (see AGENTS.md)

---

## Phase 1: Gather Context

### Build project context

Run context discovery per `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md` if not already in `.pm/dev-sessions/{slug}.md`. Build the `{PROJECT_CONTEXT}` block for agent prompts.

### Determine review target

If `$ARGUMENTS` contains a number, treat it as a PR number:
- Run `gh pr view $PR_NUMBER --json number,title,state,headRefName,baseRefName` to get PR metadata
- Run `gh pr diff $PR_NUMBER` to get the diff
- Store the PR number, branch name, and base branch

If no argument, review the current branch:
- Run `git branch --show-current` to get current branch
- Run `git diff main...HEAD` to get the diff against main
- If no diff, report "No changes to review" and stop

### Identify changed files

From the diff, extract:
- List of changed files (paths)
- Which apps are affected (for monorepos: scan `apps/*/` directories matching changed paths)
- Which feature modules are touched

Read these context files:
- `AGENTS.md` (project-level conventions)
- App-specific `AGENTS.md` for each affected app (discover by scanning `apps/*/AGENTS.md` for monorepos)

Save the diff content and file list — you'll pass them to review agents.

---

## Phase 2: Parallel Reviews (3-5 agents)

Launch all active reviews simultaneously using the Agent tool. Each runs as an independent agent. Check `.pm/dev-sessions/{slug}.md` (if it exists) to determine which agents to skip.

### Agent 1: Code Review (official skill — PR comment only)

**Only if reviewing a PR (argument provided).** Invoke the `code-review:code-review` skill:

```
Use the Skill tool: skill: "code-review:code-review", args: "$PR_NUMBER"
```

This posts findings directly to the PR as GitHub comments (uses an internal >=80 confidence threshold for commenting). It does NOT feed into auto-fix — Agent 2 handles that.

**If reviewing a branch (no PR number):** Skip this agent. Code review without a PR has nowhere to post.

### Agent 2: Code Fix Review (sub-agent — all genuine bugs for auto-fix)

Spawn via Agent tool (subagent_type: general-purpose) **in parallel with Agents 1, 3, 4, and 5**:

```
You are a Code Reviewer scanning for genuine bugs to auto-fix.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Diff:**
{paste the full diff}

**Changed files:**
{list of changed files}

**Context files to read:**
- `AGENTS.md` — project conventions, API contract requirements
- App-specific `AGENTS.md` for each affected app
- If a review checklist exists (e.g., `.claude/references/review-checklist.md`), read and check sections matching changed files
- Read the actual source files to understand full context (not just the diff)

**Review checklist:**
1. **Runtime bugs** — NaN, null derefs, incorrect logic, missing error handling
2. **Redundant/dead code** — conditions that can never trigger, unused variables
3. **API contract gaps** — missing API spec coverage, serializer/schema mismatches (check AGENTS.md for contract tooling)
4. **Cache invalidation** — mutations that don't invalidate related queries
5. **Type safety** — manually defined types that should use generated schema types (if project uses codegen)
6. **Domain anti-patterns** — anything matching the project's documented anti-patterns in AGENTS.md or review checklist

**Important:** Report ALL genuine issues regardless of how minor. Do NOT apply a confidence threshold — if it's a real issue (not a false positive), include it. False positives to exclude: pre-existing issues, things a linter/compiler would catch, stylistic preferences not in AGENTS.md.

**Output format:**
For each finding:
- **Severity:** P0 (bug/crash) / P1 (incorrect behavior) / P2 (code quality)
- **File:** exact file path and line range
- **Issue:** what's wrong
- **Fix:** specific code change to make

If no code issues found, say "No code issues found."
Max 5 findings (highest leverage only).
```

### Agent 3: PM Review (sub-agent)

**Conditional skip:** If `.pm/dev-sessions/{slug}.md` exists and contains `Spec review: passed`, skip this agent. The Spec Review stage already ran a PM reviewer against the spec. Log: "PM Review: skipped (Spec Review passed upstream)."

Spawn via Agent tool (subagent_type: general-purpose):

```
You are a Product Manager reviewing code changes.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Diff:**
{paste the full diff}

**Changed files:**
{list of changed files}

**Context files to read:**
- Read any backlog, plan, or design docs referenced in CLAUDE.md or the project's docs/ directory
- Read the source files for any changed components to understand the full context

**Review checklist:**
1. **User goal alignment** — Does this change serve a clear user need? Is the JTBD obvious?
2. **Feature completeness** — Are there missing states, edge cases, or flows a user would expect?
3. **Workflow impact** — Does this break or change existing user workflows? If so, is it intentional?
4. **Copy/labeling** — Are labels, error messages, and empty states clear for the target users (see Project Context)?
5. **Data integrity** — Could this change cause data loss, orphaned records, or inconsistent state?

**Output format:**
For each finding:
- **Severity:** P0 (blocks user) / P1 (degrades experience) / P2 (minor polish)
- **File:** exact file path and line range
- **Issue:** what's wrong from a product perspective
- **Fix:** specific code change to make (not vague suggestion)

If no product issues found, say "No product issues found" and explain why the changes look good.
Max 5 findings (highest leverage only).
```

### Agent 4: Design Review (sub-agent)

**Conditional skip:** If `.pm/dev-sessions/{slug}.md` exists and contains `Design critique: passed` or `Design critique: completed`, skip this agent. Design Critique already ran 3 enriched designer agents with screenshots. Log: "Design Review: skipped (Design Critique passed upstream)."

Spawn via Agent tool (subagent_type: general-purpose):

```
You are a Design System Reviewer.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Diff:**
{paste the full diff}

**Changed files:**
{list of changed files}

**Context files to read (REQUIRED — read ALL before reviewing):**
- `AGENTS.md` — design system rules, page patterns, styling rules
- App-specific `AGENTS.md` for each affected app (discover via `apps/*/AGENTS.md`)
- Read any design token files referenced in AGENTS.md
- Read the source of any shared components referenced in the diff

**Review checklist:**
1. **Token compliance** — No hardcoded colors, spacing, shadows, or transitions. All values must use design tokens (check AGENTS.md for token file locations).
2. **Component patterns** — Components follow the patterns documented in AGENTS.md. Feature components compose shared components.
3. **Design system consistency** — Correct use of layout primitives, card patterns, page headers per AGENTS.md rules.
4. **Typography** — Text hierarchy follows design system (no ad-hoc font sizes).
5. **Interactive patterns** — Consistent editing, hover, and action patterns per AGENTS.md.

**Output format:**
For each finding:
- **Severity:** P0 (design system violation) / P1 (inconsistency) / P2 (polish)
- **File:** exact file path and line range
- **Rule violated:** which AGENTS.md rule or token this breaks
- **Issue:** what's wrong
- **Fix:** exact code change (old -> new) with proper token/component references

If no design issues found, say "No design issues found."
Max 5 findings (highest leverage only).
```

### Agent 5: Input Edge-Case Review (sub-agent)

Spawn via Agent tool (subagent_type: general-purpose, model: sonnet) **in parallel with Agents 1-4**:

```
You are an Input Edge-Case Reviewer.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Diff:**
{paste the full diff}

**Changed files:**
{list of changed files}

**Context files to read:**
- Read the actual source files to understand full function signatures and branching logic
- Read corresponding test files to check existing edge-case coverage

**Review focus: Find untested input edge cases in user-facing functions.**

1. Identify all functions that process user input: form handlers, formatters, validators, API param parsers, normalizers
2. For each function, enumerate:
   - All conditional branches (if/else, switch, ternary, guard clauses)
   - Input types: empty string, null, undefined, whitespace-only, max-length, unicode, special characters
   - Boundary values: off-by-one on length checks, prefix/suffix edge cases
   - Composition: what happens when two transformations are applied sequentially?
3. Cross-check against existing test files: which edge cases have no test coverage?
4. Output: list of untested edge cases with specific input values and expected behavior
5. Score each finding with the same P0/P1/P2 rubric used by other review agents

**Output format:**
For each finding:
- **Severity:** P0 (crash/data corruption) / P1 (incorrect behavior) / P2 (minor inconsistency)
- **File:** exact file path and line range
- **Function:** function name and what it processes
- **Untested edge case:** specific input value (e.g., `"  "`, `null`, empty array)
- **Expected behavior:** what should happen
- **Why it matters:** what goes wrong without coverage

If no untested edge cases found, say "No untested input edge cases found."
Max 5 findings (highest leverage only).
```

---

## Phase 3: Merge & Deduplicate Findings

After all agents complete:

1. From each agent's result, extract structured findings only (severity + file + issue + fix, one line each)
2. Remove duplicates (same file + same line range + same issue)
3. Sort by severity: P0 first, then P1, then P2
4. Present the merged list:

```
## Review Complete

### Code Review (PR Comment)
[Posted to PR / Skipped (branch review)]

### Code Fix Findings
- P0: [issue] in file:line
- P1: [issue] in file:line

### PM Findings
[findings / Skipped (Spec Review passed upstream)]

### Design Findings
[findings / Skipped (Design Critique passed upstream)]

### Input Edge-Case Findings
- P0: [issue] in file:line
- P1: [issue] in file:line

### Auto-fixing [N] issues...
```

---

## Phase 4: Auto-Fix All Findings

For each finding (P0 first, then P1, then P2):

1. Read the target file
2. Apply the fix as described in the finding
3. Run tests using the test command from the context injection contract (`.pm/dev-sessions/{slug}.md` `## Project Context` or context-discovery.md fallback)
4. If tests fail: fix the regression before moving to the next finding
5. Continue until all findings are fixed

---

## Phase 5: Commit & Report

### Verify branch

Run `git branch --show-current` and confirm you are NOT on main.

### Commit fixes

```bash
git add -A
git commit -m "fix: address review feedback

- [summary of Code fixes]
- [summary of PM fixes, if agent ran]
- [summary of Design fixes, if agent ran]
- [summary of Input edge-case fixes/tests]"
```

### Report summary

Present a final summary:
- Agents run: [list active agents, note any skipped with reason]
- Total issues found: N (by agent breakdown)
- Issues fixed: N
- Tests: passing/failing
- Files modified: [list]

---

## Critical Rules

- NEVER skip Phase 1 context gathering — agents need the full diff and AGENTS.md
- NEVER bypass pre-commit hooks when committing fixes
- Agent 1 (official code-review skill) posts to PR only — it uses an internal >=80 confidence threshold
- Agent 2 (Code Fix Review) finds ALL genuine bugs for auto-fix — no confidence threshold
- Agent 5 findings are first-class findings: same severity rubric, same dedupe, same auto-fix expectations
- The review stage itself cannot be skipped via flags or state manipulation — it is a hard gate
- If no issues found by any active agent, report clean and stop (no empty commit)
- Run tests after EVERY fix, not just at the end
- Max 5 findings per agent to keep scope manageable
