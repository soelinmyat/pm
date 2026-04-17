---
name: simplify
description: "Use after implementation completes to review the current diff for reuse, quality, and efficiency issues. Runs 3 parallel review agents (reuse, quality, efficiency), merges findings, and fixes them. Mandatory S+ gate inside pm:dev; also usable standalone on any branch with a diff."
---

# pm:simplify

## Purpose

Post-implementation code simplification gate. Reviews the current diff for reuse opportunities, code-quality issues, and efficiency problems using 3 parallel review agents, then fixes findings.

This is the single simplify entrypoint for all PM workflows. One code path, every runtime, no external dependency.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER SKIP THE DIFF SCAN.** Before dispatching review agents, always compute the actual changed files. If there are zero code changes, log "skipped (no code changes)" and return — do not fabricate findings to justify running.

**Workflow:** `simplify` | **Telemetry steps:** `scan`, `review`, `merge`, `fix`.

## When to use

- Called by `pm:dev` Step 06 after implementation is committed, before design critique / QA / review.
- Standalone: any branch where you want a post-hoc cleanup pass on the current diff vs `{DEFAULT_BRANCH}`.

## When NOT to use

- Before implementation is committed — simplify reviews committed diffs, not uncommitted edits.
- Docs-only, config-only, or lockfile-only changes — skip via the scan below.
- XS-sized work — the size routing in `pm:dev` skips simplify for XS.

## Sequence

```
Implement -> Simplify -> Design Critique -> QA -> Review -> Ship
```

Cleaning up code before design critique and QA means those stages see cleaner code with fewer noise findings.

## Skip Conditions

Before dispatching agents:

1. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` and filter to code files (exclude `.md`, `.json` config, `.yml`, `.env`, lockfiles, generated files).
2. If no code files changed: log `Simplify: skipped (no code changes)` in `.pm/dev-sessions/{slug}.md` (if present) and return.

## 3 Parallel Review Agents

Before first dispatch, run `ToolSearch({ query: "select:TeamCreate,SendMessage" })` to load deferred tools (Claude Code only — skip in other runtimes).

Dispatch all 3 agents using `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`:

- Codex with delegation: 3 `spawn_agent` calls, `wait_agent` all
- Codex inline / other runtimes: run 3 review briefs sequentially, merge findings
- Claude Code: 3 parallel `Agent` calls with `subagent_type: general-purpose`

Persona for all 3: `@staff-engineer` (same base persona, different briefs).

### Inputs (shared across all agents)

```
Diff: git diff {DEFAULT_BRANCH}...HEAD
Changed files: git diff {DEFAULT_BRANCH}...HEAD --name-only
Project Context: {PROJECT_CONTEXT} from .pm/dev-sessions/{slug}.md (if present)
```

### Agent 1: Code Reuse Reviewer

Finds existing project utilities, helpers, shared components, or established patterns that could replace newly written code.

```
prompt: |
  Review this diff for code reuse opportunities. Find existing project
  utilities, helpers, components, or patterns that could replace newly
  written code. Check imports and existing modules before flagging —
  only flag when you can name the specific existing code to reuse.

  Max 5 findings.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  Return each finding as:
  - severity: low | medium | high
  - file: path/to/file
  - line: N
  - issue: one-line description
  - fix: one-line suggested fix
```

### Agent 2: Code Quality Reviewer

Redundant state, parameter sprawl, copy-paste patterns, dead code, overly complex conditionals, unnecessary abstractions, naming inconsistencies.

```
prompt: |
  Review this diff for code quality issues. Look for: redundant state,
  parameter sprawl, copy-paste patterns, dead code paths, overly complex
  conditionals, unnecessary abstractions, naming inconsistencies.

  Max 5 findings.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  Return each finding as:
  - severity: low | medium | high
  - file: path/to/file
  - line: N
  - issue: one-line description
  - fix: one-line suggested fix
```

### Agent 3: Efficiency Reviewer

Unnecessary work (redundant fetches, re-renders, recomputation), missed concurrency opportunities, hot-path bloat, N+1 patterns.

```
prompt: |
  Review this diff for efficiency issues. Look for: unnecessary work
  (redundant fetches, re-renders, recomputation), missed concurrency,
  hot-path bloat, N+1 query patterns, unnecessary synchronous waits.

  Max 5 findings.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  Return each finding as:
  - severity: low | medium | high
  - file: path/to/file
  - line: N
  - issue: one-line description
  - fix: one-line suggested fix
```

## Merge and Deduplicate

After all agents return:

1. Collect findings from all 3 agents.
2. Deduplicate: same file + same line range + same issue = one finding.
3. Drop false positives: if a finding references a utility or pattern that doesn't actually exist in the project, discard it. Verify with a quick grep before discarding.
4. Sort by severity: high first, then medium, then low.

## Fix and Commit

This skill owns fixing, not just reporting:

1. For each real finding, apply the fix in the codebase.
2. Mark low-severity / ambiguous findings as "skipped" with a one-line reason in the state file — don't block on taste calls.
3. Run the full project test suite. All tests must pass before committing.
4. Commit simplification fixes as a single commit: `chore({slug}): simplify — {N} findings fixed`.
5. If a fix breaks a test and isn't obviously safe to reshape, revert that specific fix and log it as skipped.

## State File Update

After simplify completes, append to `.pm/dev-sessions/{slug}.md` (if the session file exists):

```
- Simplify: passed (0 findings) | passed (N findings fixed, M skipped) | skipped (no code changes)
```

Standalone invocations (no session file) skip the state write — just report the findings and fixes to the caller.

## Output Contract

Return to the caller:

```
Simplify complete. {N} findings fixed, {M} skipped. Tests passing.
```

Or, on skip:

```
Simplify skipped — no code changes in diff.
```

## Guardrails

- Max 5 findings per agent (15 total max) to keep scope manageable.
- Do NOT pause for confirmation between scan, review, merge, and fix — run end-to-end.
- Do NOT expand scope: fix only what the agents flagged; don't refactor surrounding code.
- If a finding requires a design call (e.g. "should this be a hook or a context?"), mark it skipped and surface it to the caller rather than guessing.
