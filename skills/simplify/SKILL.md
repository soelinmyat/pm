---
name: simplify
description: "Post-implementation code simplification gate. Routes by runtime: delegates to Anthropic's official simplify in Claude Code, runs built-in 3-agent review in other runtimes. Returns structured findings for the caller to fix."
---

# /simplify

Post-implementation code simplification gate. Runs after implementation, before design critique and QA. Reviews the current diff for reuse opportunities, code quality issues, and efficiency problems using 3 parallel review agents.

This is the single simplify entrypoint for all PM workflows.

## Runtime Routing

1. Detect runtime.
2. If running in Claude Code, invoke Anthropic's official simplify skill, then normalize its output to the finding format below.
3. If running in any other agent/runtime, run the built-in 3-agent simplify flow.
4. Return structured findings to the caller.

## When This Runs

Called by `implementation-flow.md` Step 3, after implementation and before design critique/QA:

```
Implement -> Simplify -> Design Critique -> QA -> Review -> Ship
```

Cleaning up code before design critique and QA means those stages see cleaner code with fewer noise findings.

## Skip Conditions

Before dispatching agents, check:

1. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` and filter to code files (exclude `.md`, `.json` config, `.yml`, `.env`, lockfiles).
2. If no code files changed (config-only, docs-only): log `Simplify: skipped (no code changes)` in `.pm/dev-sessions/{slug}.md` and return.

## Built-in Flow: 3 Parallel Review Agents

Before first dispatch, run `ToolSearch({ query: "select:TeamCreate,SendMessage" })` to load deferred tools (Claude Code only — skip in other runtimes).

Dispatch all 3 agents using `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`:

- Codex with delegation: 3 `spawn_agent` calls, `wait_agent` all
- Codex inline / other runtimes: run 3 review briefs sequentially, merge findings

Intent label for all 3: `pm:code-reviewer` (same base intent, different briefs).

### Inputs (shared across all agents)

```
Diff: git diff {DEFAULT_BRANCH}...HEAD
Changed files: git diff {DEFAULT_BRANCH}...HEAD --name-only
Project Context: {PROJECT_CONTEXT} from .pm/dev-sessions/{slug}.md
```

### Agent 1: Code Reuse Reviewer

Finds existing project utilities, helpers, shared components, or established patterns that could replace newly written code. Reduces duplication.

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
3. Sort by severity: high first, then medium, then low.
4. Return the consolidated list.

## Output Contract

The skill returns a flat list of findings:

```
- severity: high
  file: src/features/auth/LoginForm.tsx
  line: 42
  issue: Duplicates existing useAuth hook logic
  fix: Replace with useAuth() from src/hooks/useAuth.ts

- severity: medium
  file: src/api/users.ts
  line: 18
  issue: N+1 query in user list fetch
  fix: Batch with Promise.all or use dataloader pattern
```

The **caller** (implementation-flow.md) is responsible for:
1. Fixing all real findings
2. Skipping false positives
3. Running tests after fixes
4. Committing simplification changes before proceeding

## State File Update

After simplify completes, log in `.pm/dev-sessions/{slug}.md`:

```
- Simplify: passed (0 findings) | passed (N findings fixed) | skipped (no code changes)
```

## Guardrails

- Max 5 findings per agent (15 total max) to keep scope manageable.
- Do not fix code inside this skill — return findings only, the caller fixes.
- False positive handling: if a finding references a utility or pattern that doesn't actually exist in the project, discard it during merge.
- If a finding is ambiguous (could be intentional), mark it `low` severity so the caller can skip it easily.
