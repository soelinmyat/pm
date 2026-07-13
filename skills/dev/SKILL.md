---
name: dev
description: "Development lifecycle for building, debugging, fixing, implementing, testing, reviewing, or shipping code. Use when the user says 'build this', 'implement this', 'fix this bug', 'code this up', 'work on PM-123', 'develop this feature', 'ship this', or asks to resume an active development session. Routes by observed risk and scope, supports inline or delegated work, and resumes from durable phase state."
---

# Dev — Development Lifecycle

## Purpose

Take an implementation request from intake to verified delivery while preserving enough machine-readable evidence to resume safely after interruption. The runner selects only the current phase, its prerequisites, and the model/runtime profile needed for that phase.

## Iron Law

**NEVER SHIP WITHOUT CURRENT GATE EVIDENCE.**

## When NOT to use

- For explanation or read-only code questions, answer directly.
- For open-ended product exploration, use `pm:think`.
- For a validated feature that still needs a sprint-ready proposal, use `pm:groom`.
- For M/L/XL proposal work without an approved technical design, use `pm:rfc` and resume dev after approval.
- For shipping an already reviewed and committed branch as a standalone request, use `pm:ship`.

**Workflow:** `dev` | **Telemetry steps:** `intake`, `workspace`, `readiness`, `implementation`, `design-critique`, `qa`, `review`, `ship`, `retro`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Workflow

1. **Resume before intake.** Find `.pm/dev-sessions/*/session.json`. If one relevant active session exists, run `scripts/dev-session.js next --session <path> --json`. If only a legacy Markdown state exists, migrate it once with `scripts/dev-session.js migrate --legacy <path> --json`; retain the source file. If multiple sessions plausibly match the request, show their phase and age and ask which one to resume.
2. **Preflight and create canonical state for fresh work.** Read and execute `steps/01-tool-check.md` before initialization. Then run `scripts/dev-session.js init --slug <slug> --source-dir <absolute-source-dir> --json`; init also fails closed outside a Git worktree. Enrich the session during intake with the task, risk facts, acceptance criteria, route, work units, and model profile. `session.json` is authoritative; Markdown is an optional human-readable projection.
3. **Run one phase at a time.** Use `scripts/dev-session.js next` to obtain the active phase, required capabilities, gates, evidence kinds, allowed modes, and instruction path. Read only that step plus its `requires` references. Files in `.pm/workflows/dev/` override same-named bundled steps. Do not preload later phases. Set `PM_DEV_LEGACY_PROMPT=1` only as a temporary compatibility fallback to the previous eager-loading behavior.
4. **Build a bounded execution packet.** Use `scripts/dev-prompt.js` to include exactly: objective, acceptance criteria, current phase, repository context, owned files, constraints, authority, required evidence, and result contract. Do not include instructions for later phases or unrelated repository history.
5. **Choose execution mode deliberately.** Inline is the default for one ordered work unit. Delegate only when `scripts/lib/dev-work-units.js` reports dependency-ready units with disjoint ownership or when a required review skill mandates a read-only fan-out. Workers may edit, test, and commit only within assigned authority; root owns integration, push, PR creation, merge, and tracker updates.
6. **Use a verified runtime profile.** For CLI workers, probe capabilities and use `scripts/dev-runtime/dispatch.js`. Defaults are `gpt-5.6-sol` at `high` and `claude-opus-4-8` at `xhigh`; profiles are data in `references/model-profiles.json`, not prompt prose. Missing structured output, event streaming, resume, or safe-permission support blocks dispatch instead of silently degrading.
7. **Advance from evidence, not narrative.** Each phase returns the strict result envelope described by `references/dev-session.schema.json`. Record it with `scripts/dev-session.js record`. Only the runner advances phase state, enforces retry limits, validates reachable/current commits, and decides completion. A worker cannot declare work merged or mutate aggregate state.
8. **Complete routed gates.** Risk routing determines review depth and whether design critique/QA apply. The final ship action must still pass `scripts/dev-gate-check.js` against current HEAD. In `PM_LOOP_WORKER=1` mode, stop after the reviewed PR is opened and return the loop result; do not merge or update durable card state.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1`, `dev-session init` derives headless mode from the environment and rejects a conflicting explicit mode. All TDD, review, QA, and verification gates remain in force. Stop after the reviewed PR is opened; do not merge. Do not write or update backlog/card state because the loop worker is the only canonical durable card-state writer. Atomically write the versioned result to `PM_LOOP_RESULT_FILE` with mode `0600`. Exact terminal statuses are `shipped, blocked, failed, noop`; include bounded artifacts or remediation. Never wait for user input or treat silence as approval.

## Steps directive

Step files live in `${CLAUDE_PLUGIN_ROOT}/skills/dev/steps/`. Load the single instruction path returned by `dev-session next`, resolving a same-named `.pm/workflows/dev/` override first. Then load only the references named in that step's `requires` metadata. Execute its Goal/How/Done-when contract and record a structured phase result before selecting another step.

## Red Flags — Self-Check

- **"I already know the rest of the workflow, so I can load all steps now."** Stop and load the active phase only; later instructions create authority confusion.
- **"It is a task or bug, so full review is unnecessary."** Kind no longer overrides observed risk; use the risk decision recorded in state.
- **"A fresh agent is always safer."** Use delegation only for dependency-ready, ownership-safe work or mandated review fan-out.
- **"The worker says it merged, so I can advance."** Check the schema-valid result and root-observed repository state; workers have no merge authority.
- **"The tests passed earlier."** Check evidence against the current commit and rerun or recertify when stale.
- **"The CLI probably supports this flag."** Check required capabilities and fail closed before launching a long worker.

## Escalation Paths

- Missing approved RFC for routed M/L/XL proposal work: "Technical design is required before implementation. Run `pm:rfc` for {slug}, approve it, then resume this dev session."
- Baseline or implementation failure after three attempts: "Blocked after three bounded attempts. Preserved state and evidence at {session_path}. Here is the failing command and the smallest next decision needed: {reason}."
- Product decision absent from the approved scope: "Implementation reached an unresolved product decision: {question}. Decide it now, or pause and return to `pm:groom`."
- Runtime lacks a required capability: "The selected runtime cannot provide {capability} safely. Upgrade/switch the CLI profile or run this phase inline."
- QA environment unavailable for UI work: "QA is blocked by {environment issue}; this cannot be recorded as a skip. Restore the environment or explicitly stop delivery."

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It is only a one-line behavior change." | Small changes still need an observed red test and current green verification. |
| "Size alone tells me the review depth." | Security, auth, data, external-contract, operational, UI, reversibility, and cross-module risk can promote any size. |
| "Parallel agents will be faster." | Only dependency-ready units with disjoint ownership are safe to run concurrently. |
| "The result file exists, so it is valid." | Validate schema, run/phase/attempt identity, evidence, authority, and commit reachability. |
| "Broad permissions avoid tool friction." | Use sandboxed/default permission profiles; broad permission requires explicit opt-in. |

## Before Marking Done

- [ ] Canonical `session.json` is saved and validates; any human projection agrees with it.
- [ ] The user confirmed scope/size or approved the RFC where the route requires it.
- [ ] All routed gates passed or have a valid, specific skip; blocked is never converted to skipped.
- [ ] Required tests and verification were run against current HEAD and their evidence was recorded.
- [ ] Root verified repository/PR/merge state and performed any authorized external updates.
- [ ] The user received the delivered outcome or a precise blocker and resume path.
