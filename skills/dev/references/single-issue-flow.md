# Single Issue Flow

This reference is loaded on-demand by the dev skill router when handling a single issue (feature, bug fix, refactor, or test backfill).

**Agent runtime:** Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching reviewers or persistent workers. This file defines how `pm:*` worker intents map to Claude and Codex.

---

## Stage 0.5: Tool Check

For S+ tasks (which create branches and PRs), verify `gh` early:

```bash
command -v gh >/dev/null 2>&1 || echo "WARN: GitHub CLI (gh) not found. PR creation will fail. Install: https://cli.github.com"
```

All sizes use the PR flow, so `gh` is needed for PR creation. If missing, warn the user before starting work so they can install it rather than discovering at PR creation time.

---

## Stage 1: Intake

1. **Load learnings** — Read the learnings file. Default path: `learnings.md` at repo root. Configurable via `learnings_path` in `dev/instructions.md`. If the file doesn't exist, skip (first run). Surface entries relevant to the task domain.
2. **Discover project context** — Read CLAUDE.md + AGENTS.md. Detect issue tracker from MCP tools.
3. **Get task context** — Issue tracker ticket ID provided? Fetch via MCP. Conversation only? Use that.
4. **Classify size:**

| Size | Signal | Example |
|------|--------|---------|
| **XS** | One-line fix, typo, config tweak | Fix a typo in a label, bump a dep version |
| **S** | Single concern, clear scope, no design decisions needed | Add a column, remove a field, fix a bug in one component |
| **M** | Cross-layer or multi-concern, needs design thought | New API endpoint + frontend feature, remove a concept that touches many files |
| **L** | New domain/module, cross-cutting refactor | New domain module, redesign auth flow |
| **XL** | Multi-domain, multi-sprint, architectural overhaul | New billing system, full app rewrite |

5. **Confirm size with user** before proceeding.
6. **Dashboard session view offer (M/L/XL with UI changes):** If the task involves frontend/UI work:

   <HARD-GATE>You MUST offer the dashboard session view for M/L/XL tasks with UI changes. Do not skip.</HARD-GATE>

   > "I can show specs, wireframes, and review results in the browser. Open the dashboard?"
   - Yes: Open the dashboard session view. Read `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/dashboard-session.md`.
   - No: Text-only. Do not ask again.
   - XS/S or backend-only: Skip this step entirely.
7. **Issue tracking (M/L/XL only):**
   - From ticket: set status "In Progress"
   - From conversation: create issue in current cycle/sprint
8. **Create state file.** Derive the slug from the task (becomes the branch name slug after workspace setup, e.g., `fix-typo`). Create `.pm/dev-sessions/{slug}.md` (run `mkdir -p .pm/dev-sessions` first) with initial state: stage, size, task context, project context from discovery, plus `run_id`, `started_at`, `stage_started_at`, and `completed_at: null`. This is the single source of truth for the session.

## Stage Routing by Size

|  | XS | S | M | L | XL |
|---|---|---|---|---|---|
| Issue tracking | — | — | Yes | Yes | Yes |
| Worktree | Stage 2 | Stage 2 | Stage 2 | Stage 2 | Stage 2 |
| RFC check | Stage 2.5 (skip RFC) | Stage 2.5 (skip RFC) | Stage 2.5 | Stage 2.5 | Stage 2.5 |
| RFC generation | — | — | Stage 3 (persistent worker writes RFC) | Stage 3 | Stage 3 |
| RFC review | — | — | Stage 4 (3 reviewers) | Stage 4 | Stage 4 |
| Implement (same worker) | TDD | TDD | Stage 5 (same worker resumes, inside-out TDD) | Stage 5 | Stage 5 |
| Simplify | `pm:simplify` | `pm:simplify` | `pm:simplify` | `pm:simplify` | `pm:simplify` |
| Design critique | — | If UI (lite, 1 round) | If UI (full) | If UI (full) | If UI (full) |
| QA (persistent worker) | If UI (Quick) | If UI (Focused) | If UI (Full, persistent worker) | If UI (Full) | If UI (Full) |
| Code scan | Code scan | Code scan | `/review` (full) | `/review` (full) | `/review` (full) |
| Verification | Verification gate | Verification gate | Verification gate | Verification gate | Verification gate |
| Finish | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop |
| Review feedback | — | — | `review/references/handling-feedback.md` | handling-feedback | handling-feedback |
| Retro | Yes | Yes | Yes | Yes | Yes |

## Stage 2: Workspace (all sizes)

Set up an isolated git worktree for every task — including XS. Worktree isolation prevents agents from mixing up branches, committing to the wrong branch, or stepping on parallel work. The overhead is seconds; the cost of a wrong-branch commit is much higher.

1. Resolve context:
   - `REPO_ROOT=$(git rev-parse --show-toplevel)`
   - `CURRENT_BRANCH=$(git branch --show-current)`
2. If already on a feature branch inside a worktree, reuse it.
3. **Preflight: ensure new branches are based on the default branch.**
   Before creating a new worktree, verify the starting point:
   ```bash
   git fetch origin
   # Create worktree from the default branch, not the current branch
   git worktree add ${REPO_ROOT}/.worktrees/<slug> -b <type>/<slug> origin/${DEFAULT_BRANCH}
   ```
   This prevents accidentally basing a new feature branch on another feature branch (e.g., if the user is currently on `feat/landing-page`, the new branch would carry over those unmerged commits). Always branch from `origin/${DEFAULT_BRANCH}` to get a clean starting point.
4. Else derive a slug from ticket/topic and propose:
   - branch: `<type>/<slug>` (`feat/`, `fix/`, `chore/`)
   - worktree: `${REPO_ROOT}/.worktrees/<slug>`
5. If branch/worktree already exists:
   - Reuse existing branch + worktree when valid
   - If occupied or ambiguous, suffix branch/worktree with `-v2`, `-v3`
6. Record final `repo root`, `cwd`, `branch`, and `worktree` in `.pm/dev-sessions/{slug}.md`.
7. **Update proposal status:** If `pm/backlog/{slug}.md` exists and has a `parent` field pointing to a proposal, or if `pm/backlog/proposals/{slug}.meta.json` exists, set `"status": "in-progress"` in the proposal's meta.json (only if current status is `"proposed"` or absent). This keeps the dashboard accurate from the moment work begins.

### Worktree environment prep

After worktree creation, prep the environment based on what the project needs.

**Read AGENTS.md** (and any app-specific AGENTS.md) for workspace setup commands. Common patterns:

| Pattern | Detection | Action |
|---------|-----------|--------|
| Dependency install | `package.json` exists, `node_modules` missing | `pnpm install` / `npm install` / `yarn` |
| Dependency install | `Gemfile` exists, gems missing | `bundle install` |
| Code generation | AGENTS.md lists codegen commands | Run them (API specs, types, schemas) |
| Shared package build | Monorepo with shared packages | Build shared packages before consuming apps |
| Database setup | AGENTS.md lists DB commands | Run migrations if needed |

If AGENTS.md doesn't specify workspace setup, fall back to: install dependencies + run the project's test command once to verify the worktree is functional.

### Workspace verification (mandatory)

After prep, run the project's test command (from AGENTS.md) to confirm the worktree is functional. If tests fail at this point, the worktree setup is broken. Fix before proceeding.

```bash
# Example: detect and run the right test command
if [ -f "package.json" ]; then
  # Check for test script in package.json
  npm test  # or pnpm test, yarn test
elif [ -f "Gemfile" ]; then
  bundle exec rails test
elif [ -f "pyproject.toml" ]; then
  pytest
fi
```

Never proceed to implementation without a clean workspace checkpoint.

## Stage 2.5: RFC Check (all sizes)

Before proceeding, check whether an approved RFC exists for this work.

### Step 1: Check for existing proposal + RFC

Look for `pm/backlog/{slug}.md`. If found, read frontmatter:

- **`rfc:` is non-null** AND the referenced RFC file exists with `status: approved` → RFC is ready. Read it and skip to Stage 5 (Implementation). Log: `RFC: approved (path: {rfc_path})`.
- **`rfc:` is null** or RFC file has `status: draft` → RFC needed. Continue to Stage 3.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### Step 2: Route ungroomed work

If no proposal exists, decide whether grooming is needed:

| Size | Action |
|------|--------|
| XS | No groom, no RFC. Confirm scope + ACs with the user inline, then skip to Stage 5 (Implementation). |
| S | No RFC needed. Brief conversational plan with user (Cursor plan-mode style), then skip to Stage 5. |
| M | Invoke `pm:groom` with `groom_tier: standard`. After groom, return here for RFC generation. |
| L/XL | Invoke `pm:groom` with `groom_tier: full`. After groom, return here for RFC generation. |

**User can skip:** If the user says "skip grooming" or "just build it," respect it. Proceed with available context.

Log the decision in `.pm/dev-sessions/{slug}.md`:
```
- RFC check: approved (path: {rfc_path}) | needs-rfc | no-proposal (invoking groom) | skipped-xs | conversational-s | skipped-by-user
```

## Stage 3: RFC Generation (M/L/XL)

Generate the engineering RFC — the single artifact that contains the technical approach, issue breakdown, test strategy, and risks. The RFC is written to `pm/backlog/rfcs/{slug}.md`.

Dispatch a persistent developer worker that writes the RFC. Reuse the same worker for implementation so planning context is preserved.

Use the current runtime instructions from `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md`.

- **Claude:** create a named `pm:developer` worker per `agent-runtime.md`, then resume it later through the same adapter
- **Codex with delegation enabled:** spawn one persistent worker, store its `agent_id` in `.pm/dev-sessions/{slug}.md`, and reuse that same worker for implementation
- **Codex without delegation:** do the planning inline in the orchestrator and preserve continuity through the session file plus the written RFC artifact

### RFC generation prompt

Whether the planner runs as a worker or inline, use this brief:

```text
Phase 1 — Generate engineering RFC for: {ISSUE_TITLE}.

## Project Context
{PROJECT_CONTEXT}

**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**Session file:** .pm/dev-sessions/{slug}.md
**Proposal:** pm/backlog/{slug}.md
**PRD:** pm/backlog/proposals/{slug}.html

Read the proposal and PRD for full product context.
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md for the RFC structure.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/splitting-patterns.md for issue splitting guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/writing-rfcs.md for writing conventions.

Write the RFC to pm/backlog/rfcs/{slug}.md.
Commit the RFC, then end your response with:

RFC_COMPLETE
- slug: {slug}
- path: pm/backlog/rfcs/{slug}.md
- summary: {3-line summary}
- issues: {N}

Stop after sending the summary. You will be resumed for implementation after RFC review.
```

### Orchestrator waits for RFC

Wait for the worker to return and capture only the `RFC_COMPLETE` payload. If RFC generation ran inline, produce the same payload yourself.

After receiving `RFC_COMPLETE`:
1. Update the proposal's frontmatter: set `rfc: rfcs/{slug}.md` in `pm/backlog/{slug}.md`
2. Update `.pm/dev-sessions/{slug}.md` with RFC path, commit SHA, and worker metadata
3. Proceed to Stage 4.

## Stage 4: RFC Review (M/L/XL)

Three senior engineers challenge the RFC — architecture decisions, test strategy, and complexity. This is the last human-interactive gate. After this passes, the same developer worker implements.

### The 3 RFC reviewers

Dispatch these reviewer intents using `agent-runtime.md`. In Claude or Codex-with-delegation, run them in parallel. In Codex without delegation, run the same briefs inline.

**Reviewer intent: `pm:adversarial-engineer`**

```text
Review this engineering RFC for architecture soundness and risk.

**RFC to review:** pm/backlog/rfcs/{slug}.md
**Proposal for reference:** pm/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

**Reviewer intent: `pm:test-engineer`**

```text
Review this engineering RFC for testing strategy and coverage.

**RFC to review:** pm/backlog/rfcs/{slug}.md
**Proposal for reference:** pm/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

**Reviewer intent: `pm:staff-engineer`**

```text
Review this engineering RFC for complexity and long-term maintainability.

**RFC to review:** pm/backlog/rfcs/{slug}.md
**Proposal for reference:** pm/backlog/{slug}.md

## Project Context
{PROJECT_CONTEXT}
```

### Handling findings

1. Merge all 3 RFC reviewer outputs. Deduplicate.
2. Fix all **Blocking issues** in the RFC (orchestrator edits directly). Non-blocking items are advisory.
3. If blocking issues were fixed, re-dispatch reviewers on the updated RFC (max 2 iterations).
4. Commit RFC updates.
5. Update RFC frontmatter to `status: approved`.
6. Update the proposal status to `planned` in `pm/backlog/{slug}.md`.
7. **ADR extraction (M/L/XL only).** Scan the approved RFC for non-obvious technical choices. For each, write an ADR to `docs/decisions/NNNN-slug.md`. Commit ADRs with the RFC.
8. Present the final RFC to the user: "RFC reviewed by 3 engineers. [N] blocking issues found and fixed. Here's the RFC: `pm/backlog/rfcs/{slug}.md`. Approve to begin continuous execution through to merge?"
9. Wait for user approval. This is the **last interactive gate**.
10. Update `.pm/dev-sessions/{slug}.md` with `RFC review: passed (commit <sha>)` and `Continuous execution: authorized`.

## Stage 5: Implementation via the Same Developer Worker

After user approval, resume the same developer worker for implementation.

- **Claude:** resume the same named worker through the adapter
- **Codex delegated:** resume the stored `agent_id`
- **Codex inline:** continue inline from the approved RFC

Use this implementation brief:

```text
Phase 2 — Implementation approved. Go implement.

**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}
**RFC:** pm/backlog/rfcs/{slug}.md
**Merge strategy:** PR → merge-loop
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Lifecycle:
1. cd {WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC end-to-end and implement all issues
4. Invoke pm:simplify — fix findings, run tests, commit
5. If UI changes: invoke /design-critique if available, else skip
6. If UI changes: QA runs as the persistent QA worker (spawned by implementation-flow.md when supported)
7. If SIZE is M/L/XL: invoke /review on the branch, fix all findings, commit
   If SIZE is XS/S: run code scan (single reviewer per implementation-flow.md)
8. Run full test suite as final verification
9. Push branch, create PR, squash merge via merge-loop
10. Cleanup worktree and branch
11. Report: "Merged. PR #{N}, sha {abc}, {N} files changed."

If blocked, report: "Blocked: {reason}"
Do NOT pause for confirmation — the RFC is the contract. Execute it.
```

**What the agent retains from RFC generation:**
- Codebase structure and file organization
- Existing patterns and conventions discovered during exploration
- Test infrastructure and runner details
- Module boundaries and import chains
- Understanding of which files need modification

### Continuous Execution

<HARD-RULE>
After the user approves the plan at the end of Stage 4.5, the developer agent proceeds through ALL remaining stages without pausing for user input. No "Ready to execute?" prompts, no confirmation dialogs, no options menus.

The rationale: by this point, the spec has been reviewed by 3 product/design agents, the plan has been reviewed by 3 engineering agents, and the user has explicitly approved. The plan is the contract. Execute it.

**Only stop for:**
- QA verdict of **Fail** (fix issues, re-run QA, then continue)
- QA verdict of **Blocked** (ask user for guidance)
- Test failures that can't be resolved after 3 attempts
- Merge conflicts
- CI failures that require human intervention
- Review feedback from human reviewers on the PR (use `review/references/handling-feedback.md`)
</HARD-RULE>

### Worker lifecycle

```
Persistent developer worker created (Stage 4)
  → explores codebase, writes plan, commits
  → returns PLAN_COMPLETE summary
  → remains resumable when runtime supports persistent workers

Orchestrator runs RFC review (Stage 4.5)
  → fixes blocking issues in plan
  → user approves

Same worker resumed for implementation (Stage 5-7)
  → worker continues with full planning context
  → implements → simplify → design critique → QA → review → merge → cleanup
  → returns "Merged. PR #{N}, sha {abc}, {N} files changed."

Worker closed after completion when the runtime requires explicit cleanup
```

### Worker death recovery

If the persistent developer worker dies during implementation (API overload, timeout, 529 errors):

1. Check git state in the worktree: `git log --oneline -5`, `git status`, `git diff --stat`
2. Read `.pm/dev-sessions/{slug}.md` for progress
3. Start a **fresh** `pm:developer` worker using the runtime adapter, reusing the same logical worker name when the runtime supports it:

```text
You are a RECOVERY worker. The previous developer worker died during implementation.

**Session file:** .pm/dev-sessions/{slug}.md
**Plan:** {PLAN_FILE_PATH}
**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}

Check what was already done before continuing:
- git log --oneline to see committed work
- git status for uncommitted changes
- Read the plan to identify remaining tasks

Continue from where the previous worker left off.
Follow ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md.
```

The recovery worker loses the original planning context but still has the committed plan and partial implementation to work from.

After the developer agent returns (merged or blocked), continue to Stage 9 below.

## Stage 9: Retro — Compound Learning

Runs after EVERY task regardless of size.

1. Review session: what was smooth, what was hard, any pitfalls or wasted cycles
2. **ADR check (all sizes).** If any non-obvious technical decisions were made during implementation that weren't captured during planning (XS/S skip planning, so this is their only ADR checkpoint), write ADRs to `docs/decisions/`. Skip if no meaningful decisions were made.
3. Write to the learnings file (default: `learnings.md`, configurable via `dev/instructions.md`) — flat table, each entry max 3 lines (one-liner preferred)

```markdown
| Date | Category | Learning |
|------|----------|----------|
| 2026-02-15 | Testing | Mock handlers for sideloaded resources must include related data |
```

3. If learnings suggest AGENTS.md or CLAUDE.md updates — flag to user, don't auto-modify
4. If a learning is a "review should catch this" anti-pattern, and a review checklist exists (e.g., `.claude/references/review-checklist.md`), append it under the appropriate section
5. Cap: 50 entries. Archive >3 months old to `docs/archive/learnings-archive.md`

## Issue Tracker Updates (ALL sizes)

<HARD-GATE>
When an issue tracker is detected (see Project Context Discovery) AND the task was started from a ticket, you MUST update the issue status to "Done" after merge. This applies to ALL sizes (XS/S/M/L/XL), not just M/L/XL. Do NOT proceed to retro until the tracker is updated. Do NOT consider the task complete without this step.
</HARD-GATE>

When an issue tracker is detected:

| Stage | Action | Sizes |
|-------|--------|-------|
| Intake (conversation) | Create issue in current cycle/sprint | M/L/XL |
| Intake (ticket) | Fetch context, set "In Progress" | ALL |
| Plan complete | Comment with plan summary | M/L/XL |
| PR created | Comment with PR link | M/L/XL |
| Merged | Set status "Done", comment with merge SHA. **Also close/complete all sub-issues.** | **ALL** |
| Retro | Comment with learnings summary | M/L/XL |

If no issue tracker is configured, skip these updates.

## Knowledge Base Updates (after merge)

After merge, update the local knowledge base to reflect shipped work:

1. **Backlog item:** If `pm/backlog/{slug}.md` exists, update its frontmatter `status` to `done` and set `updated` to today's date.

2. **Proposal status:** Proposals have two status dimensions — `verdict` (grooming outcome, never changed by dev) and `status` (implementation lifecycle). Dev only updates `status`. **Never overwrite `verdict` or `verdictLabel`** — those belong to the groom skill.

   After merge: if the backlog item has a `parent` field pointing to a proposal slug, check if **all** sibling issues (same parent) are now `done`. If so, update `pm/backlog/proposals/{parent}.meta.json` — set `"status": "shipped"`.

   Also check if a proposal meta.json exists matching the current issue's slug directly (for proposals that are single-issue). If it does and the issue is done, set `"status": "shipped"`.

These updates keep the dashboard accurate without manual bookkeeping.

## State File (.pm/dev-sessions/{slug}.md)

The state file is the **single source of truth** for session state. Updated at every stage transition and task completion. **Deleted after retro.**

After compaction or if context feels stale, read this file to recover full session state.

```markdown
# Dev Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | implement |
| Size | M |
| Ticket | PROJ-456 |
| Repo root | /path/to/project |
| Active cwd | /path/to/project/.worktrees/feature-name |
| Plan | docs/plans/2026-02-15-feature.md |
| Branch | feat/feature-name |
| Worktree | .worktrees/feature-name |
| Started at | 2026-04-04T01:00:00Z |
| Stage started at | 2026-04-04T03:20:00Z |
| Completed at | null |

## Project Context
- Product: Example App — task management for teams
- Stack: Rails API + React frontend + React Native mobile
- Test command: pnpm test (inferred from package.json)
- Issue tracker: Linear (detected via MCP)
- Monorepo: yes (apps/api, apps/web-client, apps/mobile)
- CLAUDE.md: present
- AGENTS.md: present
- Strategy: present

## Decisions
- Platform: frontend (frontend + backend files modified)
- Spec review: passed (commit abc123)
- Plan review: passed (commit def456)
- Continuous execution: authorized
- Contract gate: passed (commit ghi789) — frontend detected, gate required
- Design critique: required (frontend files modified)
- E2E: yes (CRUD flow)

## Tasks
- [x] 1. Add migration
- [x] 2. Model + backend tests
- [ ] 3. Frontend mock + components

## Key Files
- backend/app/controllers/api/v1/features_controller.rb
- frontend/src/features/feature-name/FeatureList.tsx

## Design Critique
- Status: pending
- Size routing: S (lite, 1 round) | M/L/XL (full)
- Report: (not yet run)

## QA
- QA verdict: pending
- Ship recommendation: pending
- Issues found: pending
- Issues fixed: none
- Issues deferred: none
- Confidence: pending
- Re-runs: 0

## Review
- Review gate: pending

## Merge-Watch
- Stage: pending
- PR: (not yet created)
- Gate 1 (CI): pending
- Gate 2 (Claude review): pending
- Gate 3 (Codex review): pending
- Gate 4 (Comments): pending
- Gate 5 (Conflicts): pending

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

**Update rules:**
- Write the full file (not append) at each stage transition
- Keep `Stage started at` current at every stage transition and set `Completed at` when the session finishes
- Include all decisions made so far — a cold reader should understand the full context
- After design critique, add the report path
- Resume Instructions section must be populated at every stage transition. A cold reader should be able to continue the session from this section alone.
- After retro, delete the file
