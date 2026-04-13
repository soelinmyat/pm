---
name: dev
description: "Development lifecycle — auto-detects scope. Use when building, debugging, fixing, implementing, or shipping code. Use when the user says 'build this', 'implement this', 'fix this bug', 'code this up', 'start working on', 'develop this feature', 'work on PM-123', 'ship this', 'make this work', or references a ticket/issue to implement. Checks for an RFC, generates one if missing, then implements. One flow for all sizes."
---

# Dev — Development Lifecycle

## Purpose

Unified orchestrator for all development work. Takes a task from intake through implementation to merged PR — whether the work is 1 task or N tasks emerges from the RFC. One flow handles everything from XS typo fixes to XL multi-domain overhauls.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and telemetry.

Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any document output (RFCs, session files).

## Iron Law

**NEVER SHIP WITHOUT TESTS.** Every change — XS through XL — must have test coverage before it reaches a PR. "It's just a one-liner" is not an exemption. If you can't write a test, you don't understand the change well enough to ship it.

**When NOT to use:** Quick questions about code ("what does this function do?"), explaining existing behavior, or one-line fixes the user can apply themselves. Those don't need an RFC or a branch — just answer directly.

**Workflow:** `dev` | **Telemetry steps:** `resume-detection`, `intake`, `workspace`, `groom-readiness`, `plan`, `implementation`, `qa`, `review`, `ship`, `retro`.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/` in numeric filename order. If `.pm/workflows/dev/` exists, same-named files there override defaults. Execute each step in order — each step contains its own instructions.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime execution rules and `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

**Source repo access:** Dev requires a source code repository. Step 01 (Tool Check) validates this and blocks if no source repo is found. See step 01 for the full check.

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
| `dev/references/writing-rfcs.md` (reference) | RFC Generation (M/L/XL) |
| `dev/references/splitting-patterns.md` (reference) | Issue splitting within RFC (M/L/XL) |
| `dev/references/cross-cutting-reviewers.md` (reference) | Multi-task RFC review (task_count > 1) |
| `dev/references/spec-reviewers.md` (reference) | Raw sub-issue spec review before RFC |
| `dev/references/implementation-flow.md` (reference) | Stage 5 implementation |
| `dev/references/tdd.md` (reference) | Implementation agent (all) |
| `dev/references/subagent-dev.md` (reference) | Implementation agent (all) |
| `dev/references/debugging.md` (reference) | Debug |
| `dev/references/qa.md` (reference) | QA ship gate (all UI changes) |
| `ship/references/handling-feedback.md` (reference) | Ship (M/L/XL) — handling PR feedback |

## Project Context Discovery

At intake, run the context discovery protocol defined in `context-discovery.md` (same directory).
This reads CLAUDE.md, AGENTS.md, package manifests, and MCP tools to build the project context.
Store results in `.pm/dev-sessions/{slug}.md` under `## Project Context`.

See `context-discovery.md` for the full discovery contract, fallback behavior, and context injection template.
All downstream agent prompts use the `{PROJECT_CONTEXT}` block from that contract.

## State File

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions. See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` for the full schema, template, valid stage values, and update rules.

When referencing the state file in subsequent sections, `.dev-state.md` means `.pm/dev-sessions/{slug}.md` — the slug is determined at intake.

## Execution Defaults

See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/execution-defaults.md` for checkpoint format, path preflight, default branch detection, pre-commit validation, git state guard, subagent git context, and repeated error handling.

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The RFC is overhead for this change."** The RFC is 15 minutes. Wrong direction is 2 hours. The RFC IS the shortcut. If it feels like overhead, your RFC is too heavy — simplify it, don't skip it.
- **"I'll skip the worktree, it's just one file."** Wrong-branch commits break everything downstream. Worktree setup takes seconds; recovering from a dirty main takes much longer.
- **"Tests pass, so the code is correct."** Tests verify your assumptions, not the user's requirements. Passing tests with wrong assertions give false confidence.
- **"I know what's wrong, I'll skip debugging."** Known fixes are guesses until confirmed. The debugging reference exists to prevent shipping the wrong fix to the right symptom.
- **"I'll just start coding and figure out the plan as I go."** Coding commits you to an approach. The RFC forces you to think before you commit. Improvised architecture is how you end up rewriting.
- **"Review is overkill for this size."** Code scan for XS, simplify for S, full review for M+. The gate scales — it's never skipped. Cross-cutting issues are invisible from inside the change.

## Escalation Paths

- **Tests won't pass after 3 attempts:** "Blocked on test failures after 3 attempts. Here's what I've tried: {summary}. Want to pair on this, or should I document and move on?"
- **Scope is bigger than classified:** "This is growing beyond {size}. Re-classify to {new_size} and re-plan with a new RFC?"
- **Needs product decisions mid-implementation:** "Hit a product question the RFC doesn't answer: {question}. Want to decide now, or pause and groom this first?"
- **Can't get a clean test baseline:** "Worktree tests fail before I've changed anything. Here's what I see: {errors}. Fix the baseline first, or proceed with known failures?"
- **Agent keeps failing (API overload, timeouts):** "Implementation agent failed {N} times on this task. Git state preserved. Resume manually, or skip to the next task?"

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is XS, skip TDD" | XS tasks still break when untested. Test takes 30 seconds. |
| "I know the fix, skip debugging" | Known fixes are guesses. Debugging skill exists to prevent wrong fixes. |
| "Review is overkill for this change" | Review catches cross-cutting issues you can't see from inside the change. |
| "I'll just start coding, RFC is overhead" | RFC is 15 minutes. Wrong direction is 2 hours. The RFC IS the shortcut. |
| "Worktree is overhead for one file" | Dirty main blocks all future work. Worktree is insurance, not overhead. |

## Before Marking Done

- [ ] All tests pass (TDD — tests written before implementation)
- [ ] Simplify gate passed before review
- [ ] State file updated to current stage
- [ ] Code committed on feature branch
- [ ] No destructive git operations used
