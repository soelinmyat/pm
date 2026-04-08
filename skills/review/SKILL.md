---
name: review
description: "Multi-perspective code review (code + PM + design + input edge-cases) with auto-fix. PM always runs; conditionally skips Design when upstream gate passed."
---

# /review [PR#]

**State file convention:** The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (e.g., `feat/add-auth` → `.pm/dev-sessions/add-auth.md`). To find it: derive slug from `git branch --show-current`, stripping the `feat/`/`fix/`/`chore/` prefix. If no state file matches, check legacy path `.dev-state-{slug}.md`. If neither exists, proceed without upstream gate data (all agents run). References to `.dev-state.md` below mean `.pm/dev-sessions/{slug}.md`.

Multi-perspective code review with auto-fix. Runs up to four review agents in parallel:
- **Code Reviewer** — finds ALL genuine code bugs for auto-fix. Routes by runtime: Anthropic official `code-review:code-review` in Claude Code, built-in `pm:code-reviewer` elsewhere.
- **PM Reviewer** — JTBD alignment, feature completeness, product risk. *Always runs.*
- **Design Reviewer** — design system compliance, token usage, component patterns. *Skipped when Design Critique passed upstream.*
- **Input Edge-Case Reviewer** — enumerates input domains/boundaries and missing branch-coverage tests

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime-specific reviewer dispatch.
Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`. Steps: `gather-context`, `parallel-reviews`, `merge-findings`, `auto-fix`.

---

## Default Branch

Read `{DEFAULT_BRANCH}` from `.pm/dev-sessions/{slug}.md` if available. Otherwise detect:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

All git commands below use `{DEFAULT_BRANCH}` — never hardcode `main`.

---

## Phase 0: Check & Fix Conflicts

Before reviewing, ensure the branch is up to date with {DEFAULT_BRANCH}:

1. Run: `git fetch origin {DEFAULT_BRANCH} && git log HEAD..origin/{DEFAULT_BRANCH} --oneline`
2. **If no output:** Branch is up to date. Continue to Phase 1.
3. **If commits behind:** Merge {DEFAULT_BRANCH}:
   ```bash
   git merge origin/{DEFAULT_BRANCH}
   ```
   - If merge succeeds cleanly, continue to Phase 1.
   - If conflicts exist:
     - Run `git diff --name-only --diff-filter=U` to list conflicted files
     - Resolve each conflict preserving the intent of both sides
     - Stage resolved files and commit: `git commit -m "merge: resolve conflicts with {DEFAULT_BRANCH}"`
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
- Run `git diff {DEFAULT_BRANCH}...HEAD` to get the diff against {DEFAULT_BRANCH}
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

## Phase 2: Parallel Reviews (3-4 reviewers)

Launch all active reviews using the current runtime from `agent-runtime.md`. In Claude or Codex-with-delegation, run active reviewers in parallel. In Codex without delegation, run the same review briefs inline before merging findings. Check `.pm/dev-sessions/{slug}.md` (if it exists) to determine which reviewers to skip.

### Agent 1: Code Review

Finds ALL genuine code bugs for auto-fix. Routes by runtime:

1. **Claude Code:** Invoke Anthropic's official `code-review:code-review` skill. Auto-fix all findings it returns — do not filter by confidence score.
2. **Other runtimes:** Dispatch reviewer intent `pm:code-reviewer` via `agent-runtime.md`. Auto-fix all findings.

No PR comments in either path — findings are fixed directly in code.

Dispatch **in parallel with Agents 2, 3, and 4** when delegation is available. Otherwise run the same brief inline:

```
prompt: |
  Review this diff for genuine bugs to auto-fix. Report ALL real issues — no confidence threshold.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {paste the full diff}

  **Changed files:**
  {list of changed files}

  **Slug:** {slug}
```

The agent already knows its methodology (runtime bugs, dead code, API contracts, cache invalidation, type safety, domain anti-patterns). Do not duplicate the checklist here.

### Contract Drift Check (before skipping Design agent)

Before skipping Design review based on upstream gates, verify the implementation stayed within the approved scope:

1. Read `.pm/dev-sessions/{slug}.md` and extract the plan's **Files in scope** list (from the Contract section of the plan, if present).
2. Compare against the actual changed files in the diff (from Phase 1).
3. **If all changed files are within the plan's scope:** Skip is safe. Proceed with skip.
4. **If changed files exist outside the plan's scope** (new files not listed, or files in different modules/apps): Log "Contract drift detected — {N} files outside approved scope" and **do not skip** the agent. Run it even if the upstream gate passed.
5. **If no plan scope is available** (legacy plans without Contract section, or XS/S tasks): Fall back to the original skip logic (upstream gate pass = skip).

This check applies to Design Review (Agent 3) below. PM Review (Agent 2) always runs regardless of drift.

### Agent 2: PM Review (reviewer)

**Always runs.** Spec review evaluates the plan; code review evaluates the implementation. Passing spec review does not mean the code correctly implements the spec.

Dispatch reviewer intent `pm:product-manager` via `agent-runtime.md`:

```
prompt: |
  Review this code diff from a product perspective. Focus on JTBD alignment, feature completeness, workflow impact, copy/labeling, and data integrity.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {paste the full diff}

  **Changed files:**
  {list of changed files}

  **Slug:** {slug}
```

The agent already knows its methodology (JTBD clarity, ICP fit, outcome clarity, scope coverage, etc.). Do not duplicate the checklist here.

### Agent 3: Design Review (reviewer)

**Conditional skip:** If `.pm/dev-sessions/{slug}.md` exists and contains `Design critique: passed` or `Design critique: completed`, skip this agent — **unless contract drift was detected above**. Design Critique already ran 3 enriched designer agents with screenshots. Log: "Design Review: skipped (Design Critique passed upstream, no drift)."

Dispatch reviewer intent `pm:design-system-lead` via `agent-runtime.md`:

```
prompt: |
  Review this diff for design system compliance: token usage, component patterns, typography, spacing, and cross-page consistency.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {paste the full diff}

  **Changed files:**
  {list of changed files}

  **Slug:** {slug}
```

The agent already knows its methodology (token compliance, component reuse, typography, spacing/layout, color, polish checklist). Do not duplicate the checklist here.

### Agent 4: Input Edge-Case Review (reviewer)

Dispatch reviewer intent `pm:edge-case-tester` via `agent-runtime.md`. In Claude, prefer `model: "opus"` or the strongest available review model. Run **in parallel with Agents 1-3** when delegation is available; otherwise run the same brief inline:

```
prompt: |
  Find untested input edge cases in user-facing functions touched by this diff. Test boundaries, nulls, unicode, injection vectors, and type coercion.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {paste the full diff}

  **Changed files:**
  {list of changed files}

  **Slug:** {slug}
```

The agent already knows its methodology (boundary values, empty/null, unicode/encoding, injection vectors, type coercion, concurrency). Do not duplicate the checklist here.

---

## Phase 3: Merge & Deduplicate Findings

After all agents complete:

1. From each agent's result, extract structured findings only (severity + file + issue + fix, one line each)
2. Remove duplicates (same file + same line range + same issue)
3. Sort by severity: P0 first, then P1, then P2
4. Present the merged list:

```
## Review Complete

### Code Review Findings
- P0: [issue] in file:line
- P1: [issue] in file:line

### PM Findings
[findings]

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

Run `git branch --show-current` and confirm you are NOT on {DEFAULT_BRANCH}.

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
- Agent 1 (Code Review) finds ALL genuine bugs for auto-fix — routes by runtime (Anthropic official in Claude Code, built-in `pm:code-reviewer` elsewhere), no confidence threshold filtering, no PR comments
- Agent 4 (Input Edge-Case) findings are first-class findings: same severity rubric, same dedupe, same auto-fix expectations
- The review stage itself cannot be skipped via flags or state manipulation — it is a hard gate
- If no issues found by any active agent, report clean and stop (no empty commit)
- Run tests after EVERY fix, not just at the end
- Max 5 findings per agent to keep scope manageable

## Handling Review Feedback

When review feedback is received (from human reviewers, Claude review, or external reviewers on a PR), read `${CLAUDE_PLUGIN_ROOT}/skills/review/references/handling-feedback.md` for the full protocol. Key rules:
- Verify before implementing — check against codebase reality
- No performative agreement ("You're absolutely right!", "Great point!")
- If any item is unclear, stop and ask before implementing anything
- Push back with technical reasoning when suggestions are wrong
- Implement one item at a time, test each
