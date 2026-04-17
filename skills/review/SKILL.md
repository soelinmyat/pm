---
name: review
description: "Use after implementation completes to run multi-agent code review on the current branch diff. Runs 3 parallel agents (code, design, input edge-cases) with tiered confidence output, auto-fixes findings, and commits. Mandatory M/L/XL gate inside pm:dev and ship; also usable standalone on any branch with a diff."
---

# pm:review

## Purpose

Post-implementation multi-agent code review gate. Reviews the current branch diff for genuine bugs, design-system violations, and untested input edge cases using 3 parallel agents, then auto-fixes findings and commits them.

This is the single review entrypoint for all PM workflows. One code path, every runtime, no external dependency on Anthropic's `/review` command.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Iron Law

**NEVER RE-REVIEW THE SAME COMMIT.** Before dispatching agents, check `.pm/dev-sessions/{slug}.md` for `Review gate: passed (commit <sha>)`. If the session's HEAD sha matches, log "skipped (already reviewed)" and return.

**NEVER BYPASS THE GATE.** This gate cannot be skipped via flags, state manipulation, or "I already looked at it." If the diff has real code changes and no prior-review record, agents must run.

**Workflow:** `review` | **Telemetry steps:** `gather-context`, `parallel-reviews`, `merge-findings`, `auto-fix`.

## When to use

- Called by `pm:dev` Step 07 for M/L/XL tasks, after simplify / design critique / QA.
- Called by `pm:ship` Step 03 as the pre-push gate on any branch, including standalone ship invocations.
- Standalone: any branch where you want a multi-agent review pass on the current diff vs `{DEFAULT_BRANCH}`.

## When NOT to use

- Before implementation is committed — review scans committed diffs, not uncommitted edits.
- XS-sized work — `pm:dev` runs a lighter inline code-scan for XS.
- S-sized work — `pm:simplify` is the only code-review gate for S.
- Docs-only, config-only, or lockfile-only changes — skip via the scan below.
- Same-SHA re-review — see Iron Law.

## State file convention

The session state file is `.pm/dev-sessions/{slug}.md` where `{slug}` comes from the current branch name (`feat/add-auth` → `add-auth`). Derive slug from `git branch --show-current`, stripping `feat/` / `fix/` / `chore/` prefixes. If no state file matches, proceed without upstream-gate data — all agents run.

## Default branch detection

Read `{DEFAULT_BRANCH}` from `.pm/dev-sessions/{slug}.md` if available. Otherwise detect:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"
```

All git commands below use `{DEFAULT_BRANCH}` — never hardcode `main`.

---

## Phase 0: Check & Fix Conflicts

Before reviewing, ensure the branch is up to date with `{DEFAULT_BRANCH}`:

1. Run: `git fetch origin {DEFAULT_BRANCH} && git log HEAD..origin/{DEFAULT_BRANCH} --oneline`
2. **No output:** branch is up to date. Continue to Phase 1.
3. **Commits behind:** merge `{DEFAULT_BRANCH}`:
   ```bash
   git merge origin/{DEFAULT_BRANCH}
   ```
   - Clean merge: continue to Phase 1.
   - Conflicts: resolve each preserving both sides' intent, stage, commit `merge: resolve conflicts with {DEFAULT_BRANCH}`, run relevant verification commands for resolved files (see AGENTS.md).

---

## Phase 1: Gather Context

### Skip conditions

1. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only` and filter to code files (exclude `.md`, `.json` config, `.yml`, `.env`, lockfiles, generated files).
2. If no code files changed: log `Review: skipped (no code changes)` in the session file and return.
3. If session file shows `Review gate: passed (commit <current-sha>)`: log `Review: skipped (already reviewed at <sha>)` and return.

### Build project context

Run context discovery per `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md` if `.pm/dev-sessions/{slug}.md` doesn't already have a `## Project Context` block. Build the `{PROJECT_CONTEXT}` block for agent prompts.

### Determine review target

If `$ARGUMENTS` contains a number, treat it as a PR number:
- `gh pr view $PR_NUMBER --json number,title,state,headRefName,baseRefName`
- `gh pr diff $PR_NUMBER`

Otherwise review the current branch:
- `git branch --show-current`
- `git diff {DEFAULT_BRANCH}...HEAD`
- If no diff, report "No changes to review" and stop.

### Identify changed files

From the diff, extract:
- Changed file paths
- Affected apps (for monorepos: scan `apps/*/` directories matching changed paths)
- Affected feature modules

Read these context files:
- `AGENTS.md` (project-level conventions)
- `CLAUDE.md` (project-level conventions, if present)
- App-specific `AGENTS.md` for each affected app

Save the diff and file list — agents receive them as input.

---

## Phase 2: Parallel Reviews

Before first dispatch, run `ToolSearch({ query: "select:TeamCreate,SendMessage" })` to load deferred tools (Claude Code only — skip in other runtimes).

Dispatch via `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`:

- **Claude Code:** parallel `Agent` calls with `subagent_type: general-purpose`
- **Codex with delegation:** parallel `spawn_agent` calls, `wait_agent` all
- **Codex inline / other runtimes:** run review briefs sequentially, merge findings

Check `.pm/dev-sessions/{slug}.md` (if it exists) to determine which reviewers to skip.

### Contract Drift Check (before skipping any agent)

Before skipping any agent based on an upstream-gate pass, verify the implementation stayed within approved scope:

1. Read `.pm/dev-sessions/{slug}.md` and extract the plan's **Files in scope** list (from the Contract section, if present).
2. Compare against the actual changed files in the diff (Phase 1).
3. **All changed files within scope:** skip is safe.
4. **Files outside scope** (new files not listed, files in different modules/apps): log `Contract drift detected — {N} files outside approved scope` and **do not skip** any agent.
5. **No plan scope available** (legacy plans, XS/S tasks): fall back to upstream-gate-pass = skip.

### Agent 1: Code Reviewer (`@staff-engineer`)

Finds genuine bugs in the diff. Scope is **changes only** — do not flag pre-existing issues outside the diff.

```
prompt: |
  Review this diff for genuine bugs introduced by the change.
  SCOPE: changes only. Do not flag pre-existing issues outside the diff.

  Only report issues you can name the specific broken behavior for.
  Do not flag taste calls, stylistic preferences, or refactor suggestions as bugs.

  Look for: null/undefined access, swallowed errors, race conditions,
  off-by-one, missing error feedback, silent no-ops, broken invariants,
  resource leaks, type safety, cache invalidation, API contract drift,
  domain anti-patterns.

  Safety ceiling: 20 findings. If you hit the ceiling, include a note
  that the diff likely needs to be split.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  **Slug:** {slug}

  Return each finding as:
  - confidence: 0-100
  - severity: low | medium | high | critical
  - file: path/to/file
  - line: N
  - issue: one-line description of the broken behavior
  - fix: one-line suggested fix
```

### Agent 2: Design Reviewer (`@designer`)

Design-system compliance, component reuse, visual consistency.

**Conditional skip:** If `.pm/dev-sessions/{slug}.md` contains `Design critique: passed` or `Design critique: completed` **and** the Contract Drift Check passed, skip this agent. Log: `Design review: skipped (Design Critique passed upstream, no drift)`.

**Scope:** UI files only (`tsx`/`jsx`/`css`/`scss` in diff). If none, return no findings.

```
prompt: |
  Review this diff for design-system compliance: token usage, component
  patterns, typography, spacing, color, cross-page consistency, a11y
  regressions, dark-mode breakage.

  SCOPE: UI files only. Only report issues you can name the specific
  violated convention or pattern for. Do not flag taste calls.

  Safety ceiling: 20 findings.

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  **Slug:** {slug}

  Return each finding with the same schema as Agent 1.
```

### Agent 3: Input Edge-Case Reviewer (`@tester`)

Untested input boundaries, error paths, concurrent access patterns, adversarial inputs. In Claude, prefer `model: "opus"` or the strongest available review model.

```
prompt: |
  Find untested input edge cases in user-facing functions touched by
  this diff. Boundaries (empty, max, negative, unicode, very long),
  error paths that aren't exercised, type coercion, concurrency/races,
  injection vectors, partial-failure / retry / idempotency gaps.

  Cross-reference acceptance criteria if present — each AC should have
  an edge case considered.

  Only report issues you can name the specific untested path for.
  Do not flag hypothetical scenarios with no realistic trigger.

  Safety ceiling: 20 findings.

  ## Acceptance Criteria
  {AC list, if present}

  ## Project Context
  {PROJECT_CONTEXT}

  **Diff:**
  {diff}

  **Changed files:**
  {files}

  **Slug:** {slug}

  Return each finding with the same schema as Agent 1.
```

---

## Phase 3: Merge & Tier Findings

After all active agents return:

1. Collect findings from all active agents (2 if design skipped, else 3).
2. Deduplicate: same file + same line range + same issue = one finding, keep the highest confidence.
3. Quick sanity check: if a finding references code or a pattern that doesn't exist, discard it (a 15-second grep is enough).
4. **Tier by confidence** — show every surviving finding, grouped:

| Tier | Range | Treatment |
|------|-------|-----------|
| **High confidence** | 80-100 | Auto-fix in Phase 4 |
| **Worth checking** | 50-79 | Present to caller; auto-fix only if clearly a bug, otherwise flag for human judgment |
| **Noisy** | <50 | List last for visibility; do not auto-fix |

5. Within each tier, sort by severity (critical → high → medium → low).

Present the merged list:

```
## Review Complete

### Code Review Findings
High confidence:
- [critical/high/medium/low] {issue} — {file}:{line}

Worth checking:
- [severity] {issue} — {file}:{line}

Noisy:
- [severity] {issue} — {file}:{line}

### Design Findings
[findings by tier / Skipped (Design Critique passed upstream, no drift)]

### Input Edge-Case Findings
[findings by tier]

### Auto-fixing [N] high-confidence findings...
```

---

## Phase 4: Auto-Fix High-Confidence Findings

For each high-confidence finding (critical → high → medium → low within the tier):

1. Read the target file.
2. Apply the fix as described.
3. Run tests using the test command from the context injection contract (`.pm/dev-sessions/{slug}.md` `## Project Context`, or `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md` fallback).
4. If tests fail: fix the regression before moving to the next finding.
5. If a fix breaks tests and isn't obviously safe to reshape: revert that fix, move it to `Worth checking`, and continue.

**Worth-checking tier:** only auto-fix when the finding is unambiguously a bug (e.g., an obvious null deref missed by tests). When in doubt, leave it for human judgment and include it in the final report.

**Noisy tier:** never auto-fix. Report only.

---

## Phase 5: Commit & Report

### Verify branch

Run `git branch --show-current` and confirm you are NOT on `{DEFAULT_BRANCH}`.

### Commit fixes

```bash
git add -A
git commit -m "fix: address review feedback

- [summary of Code fixes]
- [summary of Design fixes, if agent ran]
- [summary of Input edge-case fixes/tests]"
```

### Report summary

- Agents run: [list; note any skipped with reason]
- Findings by tier: High confidence: N, Worth checking: N, Noisy: N
- Auto-fixed: N
- Deferred for human: N (worth-checking items left unfixed)
- Tests: passing / failing
- Files modified: [list]

### State file update

Append to `.pm/dev-sessions/{slug}.md` (if present):

```
- Review gate: passed (commit <sha>) | failed ({N} findings to address) | skipped ({reason})
- Review findings: High: N, Worth checking: N, Noisy: N | Auto-fixed: N | Deferred: N
```

Standalone invocations (no session file) skip the state write — just report to the caller.

---

## Output Contract

Return to the caller:

```
Review complete. {N} findings. Auto-fixed {N}, deferred {N}, noisy {N}. Tests passing.
```

On skip:

```
Review skipped — {reason}.
```

---

## Guardrails

- **Safety ceiling of 20 findings per agent** catches runaway agent output — not a quality filter. Normal diffs produce 0–10.
- **Tiered output, no hard confidence gate** — the 50-79 band is informational, not silenced. The human decides what's real.
- Agents must name specific broken behavior, not taste calls — the brief enforces this.
- Never pause between Phases 1–5 — run end-to-end.
- Never skip Phase 1 context gathering — agents need the full diff and AGENTS.md.
- Never bypass pre-commit hooks on fix commits.
- If no findings above the noisy tier, report clean and stop (no empty commit).
- Run tests after EVERY fix, not just at the end.

## Handling review feedback

When review feedback is received from human reviewers on a PR after creation, use `${CLAUDE_PLUGIN_ROOT}/skills/ship/references/handling-feedback.md` for the full protocol. Key rules:

- Verify before implementing — check against codebase reality.
- No performative agreement.
- If any item is unclear, stop and ask before implementing.
- Push back with technical reasoning when suggestions are wrong.
- Implement one item at a time, test each.
