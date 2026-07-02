---
name: dev
description: "Development lifecycle — auto-detects scope. Use when building, debugging, fixing, implementing, or shipping code. Use when the user says 'build this', 'implement this', 'fix this bug', 'code this up', 'start working on', 'develop this feature', 'work on PM-123', 'ship this', 'make this work', or references a ticket/issue to implement. For M+ work, a completed RFC is required — dev halts with a direct /rfc instruction if missing. One flow for all sizes. After RFC approval, runs autonomously through review, ship, and retro — pausing only on structured Blocked escalations from the merge loop."
---

# Dev — Development Lifecycle

## Purpose

Unified orchestrator for all development work. Takes a task from intake through implementation to merged PR — whether the work is 1 task or N tasks emerges from the RFC. One flow handles everything from XS typo fixes to XL multi-domain overhauls.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.

## Hard rules

- **NEVER SHIP WITHOUT TESTS.** Every change — XS through XL — must have test coverage before it reaches a PR, written before the implementation (TDD): write the failing test, **run it and observe it fail**, then implement until it passes. An unrun test proves nothing. "It's just a one-liner" is not an exemption. If you can't write a test, you don't understand the change well enough to ship it.
- **M+ work requires a completed RFC.** Dev halts with a direct /rfc instruction if it's missing. Don't start coding to figure out the plan as you go — the RFC is 15 minutes; the wrong direction is hours. If the RFC feels like overhead, simplify it, don't skip it.
- **Use a worktree for S+ work.** A wrong-branch commit on a dirty main blocks everything downstream. XS Express is the only worktree-free path, and it branches explicitly.
- **Debugging is not optional on "known" fixes.** A known fix is a guess until confirmed; the debugging reference prevents shipping the wrong fix to the right symptom.
- **Review is never skipped — it scales.** Code scan for XS/S, full 6-lens review for M+ (bugs, design, edge cases, plus the reuse/quality/efficiency simplification lenses). Cross-cutting issues are invisible from inside the change.
- **Passing tests are not proof of correctness.** They verify your assumptions, not the user's requirements — check the assertions match the spec.
- **Every path that can push or open a PR writes a gate sidecar and runs `scripts/dev-gate-check.js` first.** The gate manifest must be current, or a gate explicitly skipped with a reason.
- **Before marking done:** all tests pass, the gate sidecar is current (or skipped with reasons), the state file is at the current stage, code is committed on the feature branch, and the user has the final outcome or a clear handoff.
- **No destructive git operations.**

**When NOT to use:** Quick questions about code ("what does this function do?"), explaining existing behavior, or one-line fixes the user can apply themselves. Those don't need an RFC or a branch — just answer directly.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` is set, this run was dispatched unattended by the PM loop. Two contract changes, all gates unchanged:

1. **Implement-only terminal.** With `PM_LOOP_STAGE=dev`, stop after the review gates pass and the PR is opened — do NOT run ship or merge. Before finishing, update the backlog card frontmatter: `status: shipping`, `branch`, `prs`, `updated`. Subsequent loop wakes run the ship cycles.
2. **Non-interactive.** There is no user. At any point that would ask a question: take the documented default when one exists and it is safe; otherwise stop and print a report stating exactly what decision or input is needed (the loop parks the card as needs-human). Never wait for input; never treat silence as approval; never skip a gate to avoid asking.

**Workflow:** `dev`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/` in numeric filename order. If `.pm/workflows/dev/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

References `agent-runtime.md` and `capability-gates.md` are loaded by the steps that need them — not here. Do not read them at skill load.

**Source repo access:** Dev requires a source code repository. Step 01 (Tool Check) validates this and blocks if no source repo is found. See step 01 for the full check.

## XS Express Path

When the task is classified XS (one-line fix, typo, config tweak) and the user confirms, bypass the full step-file flow. The Iron Law still applies — every change gets a test and a code scan. What changes is the machinery around it.

**XS Express replaces Steps 01-09 with this inline sequence:**

1. **Branch** — `git checkout -b fix/{slug} origin/{DEFAULT_BRANCH}`. No worktree. No state file.
2. **Gate sidecar** — Create `.pm/dev-sessions/{slug}.gates.json` with `schema_version: 1`, `size: "XS"`, and an empty `gates` array even though the full Markdown state file is skipped.
3. **Implement + test** — Write the failing test first, **run it, and observe it fail** — before writing any implementation. Then write the fix and re-run: the same test passes, and the full project suite passes. The observed red run is the tdd gate evidence.
4. **Commit implementation** — Commit the source and test changes before recording gate rows. If `git diff {DEFAULT_BRANCH}...HEAD --quiet` would show no committed diff after this commit, stop; do not push an empty branch. Record the failing command and final passing command as the `tdd` gate artifact tied to this committed HEAD.
5. **Design critique if UI** — If the diff touches UI/UX files or user-visible interaction, invoke `pm:design-critique`, commit any fixes, and record the gate against the resulting HEAD. If there is no visual impact, record `design-critique` as `skipped` with a concrete reason.
6. **QA if UI** — If the diff touches UI/UX files or user-visible interaction, run Quick QA, fix any Fail verdict, commit any fixes, and record `qa` as `passed` against the resulting HEAD. If there is no visual impact, record `qa` as `skipped` with a concrete reason. If the QA environment is blocked, record `qa: blocked` and stop.
7. **Code scan** — Run a single-pass inline code scan (same brief as Step 07's XS/S code scan section — bugs plus simplification wins). Fix any findings, re-run tests, commit any fixes, and record `Review gate: passed (commit <sha>)` plus the `review` gate row.
8. **Verification + recertification** — Run the full project test suite fresh, read the output, record the `verification` gate row, then recertify earlier gate rows for the final HEAD using `verified_commit` / `verified_at` as described in `skills/dev/steps/07-review.md`.
9. **Gate check** — Run:
    ```bash
    PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
    node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
      --manifest .pm/dev-sessions/{slug}.gates.json \
      --commit "$(git rev-parse HEAD)" \
      --base origin/{DEFAULT_BRANCH}
    ```
    If it fails, fix the missing or stale gate before pushing.
10. **Ship** — `git push -u origin fix/{slug}`, create PR via `gh pr create`, squash-merge via `gh pr merge --squash --auto` or the merge loop. Wait for merge confirmation.
11. **Status** — Update `{pm_dir}/backlog/{slug}.md` to `status: done` if it exists. Update Linear issue to Done if configured (ask user first).
12. **Cleanup** — `git checkout {DEFAULT_BRANCH} && git pull && git branch -d fix/{slug}`.

**No worktree, no session state file, no context discovery, no formal retro, no agent dispatch.** The orchestrator does all work inline.

**When to use:** Only when ALL of these are true:
- Size is XS (confirmed by user)
- No active session file exists for this slug
- No RFC exists or is needed
- Single file or tightly-scoped change

**When to fall back to full flow:** If the fix touches multiple files, requires debugging, or fails code scan with structural issues — escalate to the full step flow by creating a session state file and resuming from Step 03 (Workspace).

---

## Resume

**Runs FIRST on every invocation.**

Glob for active sessions in `.pm/dev-sessions/` (+ legacy `.dev-state-*.md`, `.dev-epic-state-*.md` at repo root):

| Matches | Action |
|---------|--------|
| 1 session file | Read it, resume from where it left off |
| Multiple files | List all with stage and last-modified, ask user which to resume |
| None found | Proceed to fresh start |

**Staleness guard:** If a session file is older than 48 hours and the user didn't explicitly reference it, ask whether to resume or discard.

**Legacy migration:** Old `epic-{slug}.md` and `.dev-epic-state-*.md` files are treated identically to regular session files. All resume to the loaded workflow steps.

## Bundled Skills

All workflow skills are self-contained within this plugin. No external skill dependencies.

| Skill / Reference | Used in |
|-------------------|---------|
| `pm:groom` | Auto-invoked when no proposal exists (M/L/XL) |
| `dev/references/splitting-patterns.md` (reference) | Issue splitting within RFC (M/L/XL) |
| `dev/references/implementation-flow.md` (reference) | Stage 3 implementation |
| `dev/references/tdd.md` (reference) | Implementation agent (all) |
| `dev/references/subagent-dev.md` (reference) | Implementation agent (all) |
| `dev/references/debugging.md` (reference) | Debug |
| `pm:design-critique` | UI design critique gate |
| `dev/references/qa.md` (reference) | QA ship gate (all UI changes) |
| `ship/references/handling-feedback.md` (reference) | Ship (M/L/XL) — handling PR feedback |

## Project Context Discovery

At intake, run the context discovery protocol defined in `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md`.
This reads CLAUDE.md, AGENTS.md, package manifests, and MCP tools to build the project context.
Store results in `.pm/dev-sessions/{slug}.md` under `## Project Context`.

See `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md` for the full discovery contract, fallback behavior, and context injection template.
All downstream agent prompts use the `{PROJECT_CONTEXT}` block from that contract.

## State File

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions. See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` for the full schema, template, valid stage values, and update rules.

When referencing the state file in subsequent sections, `.dev-state.md` means `.pm/dev-sessions/{slug}.md` — the slug is determined at intake.

## Execution Defaults

See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/execution-defaults.md` for checkpoint format, path preflight, default branch detection, pre-commit validation, git state guard, subagent git context, and repeated error handling.

## Escalation Paths

- **Tests won't pass after 3 attempts:** "Blocked on test failures after 3 attempts. Here's what I've tried: {summary}. Want to pair on this, or should I document and move on?"
- **Scope is bigger than classified:** "This is growing beyond {size}. Re-classify to {new_size} and re-plan with a new RFC?"
- **Needs product decisions mid-implementation:** "Hit a product question the RFC doesn't answer: {question}. Want to decide now, or pause and groom this first?"
- **Can't get a clean test baseline:** "Worktree tests fail before I've changed anything. Here's what I see: {errors}. Fix the baseline first, or proceed with known failures?"
- **Agent keeps failing (API overload, timeouts):** "Implementation agent failed {N} times on this task. Git state preserved. Resume manually, or skip to the next task?"
