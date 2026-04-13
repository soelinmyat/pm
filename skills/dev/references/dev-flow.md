# Dev Flow

Unified development lifecycle for all work — single issues, multi-task features, and issues with sub-issues. Whether work is 1 task or N tasks emerges from the RFC, not from routing.

**Agent runtime:** Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching agents. This file defines how `pm:*` agent intents map to Claude and Codex.

---

## Stage 0.5: Tool Check

For S+ tasks (which create branches and PRs), verify `gh` early:

```bash
command -v gh >/dev/null 2>&1 || echo "WARN: GitHub CLI (gh) not found. PR creation will fail. Install: https://cli.github.com"
```

All sizes use the PR flow, so `gh` is needed for PR creation. If missing, warn the user before starting work so they can install it rather than discovering at PR creation time.

---

## Stage 0.7: Source Repo Access Check

**Runs AFTER resume detection and AFTER the `pm_dir` / `pm_state_dir` fallback checks.**

Dev requires a source code repository to operate — it creates branches, worktrees, and runs tests. This step ensures a source repo is accessible before proceeding.

1. **If `source_dir` is in conversation context** (set by `pm:start`), use it. Proceed.
2. **If `source_dir` is NOT in conversation context**, check if cwd contains source code indicators:

   ```bash
   # Source code indicators — presence of any one means cwd is a source repo
   ls package.json Cargo.toml go.mod pyproject.toml Gemfile pom.xml \
      build.gradle settings.gradle CMakeLists.txt Makefile mix.exs \
      *.sln *.csproj composer.json 2>/dev/null | head -1
   ```

   - **If any indicator is found:** cwd is a source repo. Set `source_dir` to cwd (same-repo mode). Proceed.
   - **If NO indicator is found:** Block with this message and stop:

     > Dev requires a source repo. Run pm:setup to configure, or invoke pm:dev from the source repo.

     Do NOT proceed to Stage 1. The user must either configure `source_repo` in `.pm/config.json` (via `pm:setup separate-repo`) or invoke `pm:dev` from within the source repo.

**Dev session files** (`.pm/dev-sessions/`) are always created in the source repo, not the PM repo. When `source_dir` differs from the PM repo root, use `{source_dir}/.pm/dev-sessions/` for all session file operations. In same-repo mode, this is the same location as `{pm_state_dir}/dev-sessions/`.

---

## Stage 1: Intake

1. **Load learnings** — Read `learnings.md` at repo root. If the file doesn't exist, skip (first run). Surface entries relevant to the task domain.
2. **Discover project context** — Read CLAUDE.md + AGENTS.md. Detect issue tracker from MCP tools.
3. **Get task context** — Issue tracker ticket ID provided? Fetch via MCP. Conversation only? Use that.
4. **Fetch sub-issues** — After fetching the issue, also check for sub-issues via `list_issues({ parentId })`. If sub-issues exist, store them in session state under `## Sub-Issues`. They become context for RFC generation. If no sub-issues, proceed normally.
5. **Linear issue readiness routing** — If `linear_id` is set in the session state (set by SKILL.md routing):

   If `linear_readiness` is `dev-ready`:
   - Use `linear_title` as the task title and `linear_description` as task context.
   - Skip proposal existence check in Stage 2.5 — the Linear issue IS the product context.
   - Proceed to size classification (Step 6) using the Linear description.

   If `linear_readiness` is `needs-groom` AND size is M/L/XL (size was classified during SKILL.md routing):
   - Announce: "Linear issue {linear_id} needs grooming. Gaps: {gaps}. Invoking pm:groom."
   - Invoke `pm:groom` within the same conversation. Pass the Linear context as conversation text: title, description, labels, ID, and the slug to use. Groom picks up this context from the preceding messages — no CLI flags needed.
   - Tell groom: "Use slug: {slug}. This is a Linear issue that needs enrichment. Linear ID: {ID}. Title: {title}. Description: {description}."
   - After groom completes, re-read `{pm_dir}/backlog/{slug}.md`. If the file does not exist or `status` is not `proposed`, `planned`, or `in-progress`:
     - Log: `Groom did not produce a valid proposal. Falling back to conversational scoping.`
     - Set `groom_attempted: true` in the session state.
     - Handle inline — confirm scope + ACs with the user conversationally (same as XS/S path). Do not re-invoke groom.
   - If the file exists with `status: proposed` and `rfc: null`: Stage 2.5 Step 1 suggests running `/rfc`.

   If `linear_readiness` is `needs-groom` AND size is XS/S:
   - Handle inline: confirm scope + ACs with the user conversationally (same as existing XS/S ungroomed path in Stage 2.5 Step 2). Do not invoke groom.
   - Store `linear_id` in session state for ship write-back.

6. **Classify size:**

| Size | Signal | Example |
|------|--------|---------|
| **XS** | One-line fix, typo, config tweak | Fix a typo in a label, bump a dep version |
| **S** | Single concern, clear scope, no design decisions needed | Add a column, remove a field, fix a bug in one component |
| **M** | Cross-layer or multi-concern, needs design thought | New API endpoint + frontend feature, remove a concept that touches many files |
| **L** | New domain/module, cross-cutting refactor | New domain module, redesign auth flow |
| **XL** | Multi-domain, multi-sprint, architectural overhaul | New billing system, full app rewrite |

   **Multi-task:** If sub-issues exist, classify each sub-issue individually. Present a table. The parent size is the largest sub-issue size.

7. **Confirm size with user** before proceeding.
8. **Issue tracking (M/L/XL only):**
   - From ticket: set status "In Progress"
   - From conversation: create issue in current cycle/sprint
9. **Create state file.** Derive the slug from the task (becomes the branch name slug after workspace setup, e.g., `fix-typo`). Create the state file at `{source_dir}/.pm/dev-sessions/{slug}.md` (run `mkdir -p {source_dir}/.pm/dev-sessions` first). In separate-repo mode, `source_dir` is the source repo root — dev sessions always live in the source repo, never in the PM repo. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}.md` as before. Populate with initial state: stage, size, task context, project context from discovery, plus `run_id`, `started_at`, `stage_started_at`, and `completed_at: null`. If sub-issues exist, include a `## Sub-Issues` table. This is the single source of truth for the session.

## Stage Routing by Size

|  | XS | S | M | L | XL |
|---|---|---|---|---|---|
| Issue tracking | — | — | Yes | Yes | Yes |
| Worktree | Stage 2 | Stage 2 | Stage 2 | Stage 2 | Stage 2 |
| RFC check | Stage 2.5 (skip RFC) | Stage 2.5 (skip RFC) | Stage 2.5 (suggest /rfc) | Stage 2.5 (suggest /rfc) | Stage 2.5 (suggest /rfc) |
| Implement | TDD | TDD | Stage 3 (fresh agent, inside-out TDD) | Stage 3 | Stage 3 |
| Simplify | — | `pm:simplify` | `pm:simplify` | `pm:simplify` | `pm:simplify` |
| Design critique | — | If UI (lite, 1 round) | If UI (full) | If UI (full) | If UI (full) |
| QA | If UI (Quick) | If UI (Focused) | If UI (Full) | If UI (Full) | If UI (Full) |
| Code scan | Code scan | — | `/review` (full) | `/review` (full) | `/review` (full) |
| Verification | Verification gate | Verification gate | Verification gate | Verification gate | Verification gate |
| Finish | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop | PR → merge-loop |
| Review feedback | — | — | `ship/references/handling-feedback.md` | handling-feedback | handling-feedback |
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
7. **Update local backlog status to in-progress:**

   <HARD-RULE>
   If `{pm_dir}/backlog/{slug}.md` exists, you MUST update it now. Do not defer this to later.
   </HARD-RULE>

   a. Read `{pm_dir}/backlog/{slug}.md`. If it exists and `status` is not already `in-progress` or `done`:
      - Set `status: in-progress` in frontmatter
      - Set `updated: {today's date}` in frontmatter
      - If `linear_id` is available in session state and not already in frontmatter, add it

   b. If the backlog item has a `parent` field, find `{pm_dir}/backlog/{parent-slug}.md` and set its `status: in-progress` too (if not already `in-progress` or `done`).

   Log: `Backlog: {pm_dir}/backlog/{slug}.md → in-progress`

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

### Step 0.5: Linear-sourced dev-ready shortcut

If `linear_readiness` is `dev-ready` in the session state AND no `{pm_dir}/backlog/{slug}.md` exists:
- This is a Linear issue that passed the readiness check. No local proposal needed.
- If size is M+, suggest running `/rfc` with the Linear context.
- If size is XS/S, proceed with inline scoping.
- Log: `RFC check: linear-sourced-dev-ready`

### Step 1: Check for existing proposal + RFC

Look for `{pm_dir}/backlog/{slug}.md`. If found, read frontmatter:

- **`status:` is not `proposed`, `planned`, or `in-progress`** → Groom started but didn't complete. Treat as ungroomed. Continue to Step 2.
- **`rfc:` is non-null** AND the referenced RFC file exists with `status: approved` → RFC is ready. Create a new session file (`.pm/dev-sessions/{slug}.md`) with `Stage: implement`. Read the RFC and skip to Stage 3 (Implementation). Log: `RFC: approved (path: {rfc_path})`.
- **`rfc:` is null** AND size is M+ → No RFC exists. Suggest running `/rfc` (see RFC prompt below).
- **`rfc:` is null** AND size is XS/S → No RFC needed. Continue to Step 2 for inline scoping.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### Step 2: Route ungroomed work

If no proposal exists, decide whether grooming is needed:

<!-- KB maturity criteria: keep in sync with skills/groom/steps/01-intake.md -->

**For M/L/XL: detect KB maturity first.** Check the knowledge base before choosing a groom tier:

| Signal | Check |
|--------|-------|
| Strategy | `{pm_dir}/strategy.md` exists |
| Research | Any file in `{pm_dir}/evidence/research/` |
| Competitors | Any `{pm_dir}/evidence/competitors/*/profile.md` |

Classify:
- **Fresh** (none of the three signals) → max tier: `quick`
- **Developing** (strategy OR research present) → max tier: `standard`
- **Mature** (strategy AND research AND competitors) → max tier: `full`

Log in `.pm/dev-sessions/{slug}.md`: `kb_maturity: {level}, tier_cap: {tier}`

| Size | Action |
|------|--------|
| XS | No groom, no RFC. Confirm scope + ACs with the user inline, then skip to Stage 3 (Implementation). |
| S | No RFC needed. Brief conversational plan with user (Cursor plan-mode style), then skip to Stage 3. |
| M | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC prompt. |
| L/XL | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC prompt. |

**Before invoking groom, ask:**

> No product proposal exists for this work. KB maturity: **{level}**.
> I can groom this first ({tier} tier, ~{time}) or just build it now. Which do you prefer?

Time estimates by tier:

| Tier | Estimate |
|------|----------|
| `quick` | ~5 min |
| `standard` | ~15 min |
| `full` | ~30 min |

If the user says to skip, proceed with available context. Log: `groom: skipped-by-user`

Log the decision in `.pm/dev-sessions/{slug}.md`:
```
- RFC check: approved (path: {rfc_path}) | needs-rfc | incomplete-groom (status not proposed/planned/in-progress) | no-proposal (invoking groom) | skipped-xs | conversational-s | skipped-by-user
```

## Stage 3: Implementation

Dispatch **fresh** @developer agent(s) using the runtime adapter. The RFC is the contract and contains all codebase exploration findings needed for implementation. RFC generation and review are handled by the standalone `/rfc` skill — dev assumes an approved RFC exists (or inline planning was done for smaller work).

### Single-task implementation (task_count == 1)

One fresh agent in the existing worktree.

**Implementation brief:**

```text
Implement the approved RFC.

**CWD:** {WORKTREE_PATH}
**Branch:** {BRANCH}
**RFC:** {pm_dir}/backlog/rfcs/{slug}.html
**Merge strategy:** PR → merge-loop
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Lifecycle:
1. cd {WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC end-to-end and implement all issues
4. If SIZE is S+: invoke pm:simplify — fix findings, run tests, commit (skip for XS)
5. If UI changes: invoke /design-critique if available, else skip
6. If UI changes: dispatch QA agent per implementation-flow.md
7. If SIZE is M/L/XL: invoke /review on the branch, fix all findings, commit
   If SIZE is XS: run code scan (single reviewer per implementation-flow.md)
   If SIZE is S: skip code scan (simplify already covers it)
8. Run full test suite as final verification
9. Push branch, create PR, squash merge via merge-loop
10. Cleanup worktree and branch
11. Report: "Merged. PR #{N}, sha {abc}, {N} files changed."

If blocked, report: "Blocked: {reason}"
Do NOT pause for confirmation — the RFC is the contract. Execute it.
```

### Multi-task implementation (task_count > 1)

Sequential implementation, one task at a time. Each task gets a fresh agent with its own worktree.

#### Environment readiness check

Before dispatching the first implementation agent, check whether any task touches mobile code (React Native/Expo). If so, ensure Metro is running:

```bash
# Only needed when tasks include mobile changes
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)
sleep 3
```

Skip if no task touches mobile code. Log in the state file whether Metro was started.

#### Skip fully-implemented tasks

If the RFC reported 0 tasks for a sub-issue (all ACs already implemented with tests), mark it as "Already implemented" in the state file and skip to the next one.

#### Sequential execution

For each task (Issue section) in dependency order from the RFC:

1. **Create worktree:**
   ```bash
   git worktree add .worktrees/{task-slug} -b feat/{task-slug} origin/{DEFAULT_BRANCH}
   ```

2. **Set sub-issue status to In Progress** (if sub-issue has a tracker ID):
   ```
   mcp__plugin_linear_linear__save_issue({ id: "{SUB_ISSUE_ID}", state: "In Progress" })
   ```

3. **Dispatch fresh @developer agent:**

```text
Implement the approved RFC.

**CWD:** {TASK_WORKTREE_PATH}
**Branch:** feat/{task-slug}
**RFC:** {pm_dir}/backlog/rfcs/{slug}.html
**Your issue:** Issue {N} — {ISSUE_TITLE}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}
**PM directory:** {pm_dir}
**PM state directory:** {pm_state_dir}
**Source directory:** {source_dir}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Read the RFC. Focus on Issue {N} ({ISSUE_TITLE}) — that is your scope. The RFC also
contains shared architecture and data model sections that apply to your issue.

Lifecycle:
1. cd {TASK_WORKTREE_PATH}
2. Install deps (read AGENTS.md), verify clean test baseline
3. Read the RFC, focus on Issue {N}, implement its tasks
4. Invoke pm:simplify — fix findings, run tests, commit
5. If UI changes: invoke /design-critique if available, else skip
6. If UI changes: dispatch QA agent per implementation-flow.md
7. If SIZE is M/L/XL: invoke /review on the branch, fix all findings, commit
   If SIZE is XS/S: run code scan (single reviewer per implementation-flow.md)
8. Run full test suite as final verification
9. Push branch, create PR, squash merge via merge-loop, cleanup worktree and branch
10. Report: "Merged. {ISSUE_ID} PR #{N}, sha {abc}, {N} files changed."

If blocked, report: "Blocked: {ISSUE_ID} — {reason}"
Do NOT pause for confirmation — the RFC is the contract. Execute it.
```

4. **Wait for agent to return** "Merged" or "Blocked."

5. **Checkpoint** — update state file `## Sub-Issues` table immediately. Update `## Implementation Progress`.

6. **Sync main** before the next task:
   ```bash
   git checkout -B {DEFAULT_BRANCH} origin/{DEFAULT_BRANCH}
   ```

7. **Announce progress:**
   > **Task {N} of {TOTAL} complete.** Next: {ISSUE_TITLE}. Proceeding.

8. Proceed to next task.

#### Agent failure recovery

If an implementation agent fails (API overload, timeout, 529 errors):

1. Check git state in the worktree: `git log --oneline -5`, `git status`, `git diff --stat`
2. Update state file with failure
3. Dispatch a fresh recovery agent with the RFC path, git state, and instruction to continue from where the previous agent left off
4. Max 3 total attempts per task. After 3 failures, mark as "Failed" and continue to next.

Track retry count per task in the state file.

### Continuous Execution

<HARD-RULE>
After the user approves the RFC (via /rfc), the developer agent proceeds through ALL remaining stages without pausing for user input. No "Ready to execute?" prompts, no confirmation dialogs, no options menus.

The rationale: by this point, the spec has been reviewed by product/design agents, the plan has been reviewed by engineering agents, and the user has explicitly approved. The plan is the contract. Execute it.

**Only stop for:**
- QA verdict of **Fail** (fix issues, re-run QA, then continue)
- QA verdict of **Blocked** (ask user for guidance)
- Test failures that can't be resolved after 3 attempts
- Merge conflicts
- CI failures that require human intervention
- Review feedback from human reviewers on the PR (use `ship/references/handling-feedback.md`)
</HARD-RULE>

### Agent lifecycle

```
RFC generated and reviewed via /rfc (separate skill)
  → user approves RFC

Single-task: Fresh developer agent dispatched (Stage 3)
  → reads approved RFC
  → implements → simplify → design critique → QA → review → merge → cleanup
  → returns "Merged. PR #{N}, sha {abc}, {N} files changed."

Multi-task: For each task in order, fresh developer agent dispatched (Stage 3)
  → reads approved RFC, focuses on assigned Issue section
  → implements → simplify → design critique → QA → review → merge → cleanup
  → returns "Merged. {ISSUE_ID} PR #{N}" or "Blocked: {reason}"
  → orchestrator checkpoints, syncs main, dispatches next
```

## Stage 4: Worktree Cleanup

Clean up any worktrees created during this session:

1. For each worktree created in Stage 2 or by dispatched agents, remove it:
   ```bash
   git worktree remove <worktree-path> --force
   ```
2. Delete any leftover branches that were only used inside worktrees:
   ```bash
   git branch -d <worktree-branch>
   ```
3. If removal fails (locked worktree), force-remove:
   ```bash
   git worktree remove <worktree-path> --force
   ```

Do NOT skip this step. Leftover worktrees consume disk and confuse subsequent sessions.

## Stage 5: Retro — Compound Learning

Runs after EVERY task regardless of size.

1. Review session: what was smooth, what was hard, any pitfalls or wasted cycles
2. Write to the learnings file (`learnings.md`) — flat table, each entry max 3 lines (one-liner preferred)

```markdown
| Date | Category | Learning |
|------|----------|----------|
| 2026-02-15 | Testing | Mock handlers for sideloaded resources must include related data |
```

3. If learnings suggest AGENTS.md or CLAUDE.md updates — flag to user, don't auto-modify
4. If a learning is a "review should catch this" anti-pattern, and a review checklist exists (e.g., `.claude/references/review-checklist.md`), append it under the appropriate section
5. Cap: 50 entries. Archive >3 months old to `docs/archive/learnings-archive.md`

## Status Updates (ALL sizes)

<HARD-GATE>
After merge, you MUST complete ALL status updates below — both local backlog AND issue tracker (if available). Do NOT proceed to retro until every step is done. Do NOT consider the task complete without this. This applies to ALL sizes (XS/S/M/L/XL).
</HARD-GATE>

### At intake (set "In Progress")

These happen during Stage 2 (Workspace), not after merge. Listed here for completeness.

**Local backlog:** Handled in Stage 2 step 7 — sets `{pm_dir}/backlog/{slug}.md` status to `in-progress`.

**Linear** (if available, ticket-originated):
```
mcp__plugin_linear_linear__save_issue({ id: "{ISSUE_ID}", state: "In Progress" })
```

For conversation-originated work (M/L/XL): create the Linear issue first, then set In Progress.

### At plan complete (M/L/XL)

**Linear** (if available):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "RFC written: {summary}" })
```

### At PR created (M/L/XL)

**Linear** (if available):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "PR opened: #{pr_number}" })
```

### After merge — set "Done" everywhere

<HARD-GATE>
You MUST complete ALL steps below in order. Every step applies whether or not an issue tracker is configured. A parent marked "Done" with open children is a bug. A merged PR with a backlog item still showing "in-progress" is a bug.
</HARD-GATE>

**Step 1: Create local backlog entry if missing.**

If `linear_id` is set in `.pm/dev-sessions/{slug}.md` (or RFC metadata) AND `{pm_dir}/backlog/{slug}.md` does NOT exist:
- Create `{pm_dir}/backlog/` if needed: `mkdir -p {pm_dir}/backlog`
- **ID rule:** When Linear is available, use the Linear identifier as the local `id`. Only fall back to local `PM-{NNN}` sequence when no tracker is configured.
- Write `{pm_dir}/backlog/{slug}.md`:
  ```yaml
  ---
  type: backlog
  id: "{linear_id}"
  title: "{title from Linear or RFC}"
  outcome: "{one-sentence from RFC summary or Linear description}"
  status: done
  priority: medium
  linear_id: "{linear_id}"
  rfc: rfcs/{slug}.html
  prs:
    - "#{pr_number}"
  created: {today's date, YYYY-MM-DD format}
  updated: {today's date, YYYY-MM-DD format}
  ---

  ## Outcome

  {Summary of what was built, derived from RFC or Linear description.}

  ## Notes

  Originated from Linear issue {linear_id}. Product memory created at ship.
  ```
- Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/validate.js --dir pm` to verify. Fix errors before proceeding.
- Log: `Backlog created: {pm_dir}/backlog/{slug}.md (id: {linear_id})`

**Step 2: Update local backlog item(s) to done.**

Read `{pm_dir}/backlog/{slug}.md`. Update frontmatter:
- Set `status: done`
- Set `updated: {today's date}`
- If `linear_id` is available in session state and not already in frontmatter, add it
- If `prs` field exists, append `"#{pr_number}"` if not already listed

**Multi-task:** Also update each sub-issue's backlog entry (`{pm_dir}/backlog/{sub-issue-slug}.md`) to `status: done`.

Verify the file was written: read it back and confirm `status: done`.

Log: `Backlog: {pm_dir}/backlog/{slug}.md → done`

**Step 3: Update parent/proposal status.**

a. If the backlog item has a `parent` field pointing to a proposal slug:
   - Read all sibling backlog items (same `parent` value)
   - If ALL siblings are now `done`, update `{pm_dir}/backlog/{parent}.md` — set `status: done`
   - Log: `Proposal: {parent} → done`

b. If this is a standalone proposal (has `prd:` field, no `parent`), its status was already set to `done` in Step 2.

**Step 4: Close Linear child issues** (if tracker available).

Fetch children:
```
mcp__plugin_linear_linear__list_issues({ parentId: "{ISSUE_ID}" })
```

For EACH child returned, set to Done:
```
mcp__plugin_linear_linear__save_issue({ id: "{CHILD_ISSUE_ID}", state: "Done" })
```
Log each: `Linear: {CHILD_ISSUE_ID} → Done`

**Step 5: Close Linear parent issue** (if tracker available).

```
mcp__plugin_linear_linear__save_issue({ id: "{ISSUE_ID}", state: "Done" })
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "Merged: {sha}" })
```
Log: `Linear: {ISSUE_ID} → Done (+ {N} children closed)`

**Step 6: Verify.**

- Read `{pm_dir}/backlog/{slug}.md` — confirm `status: done`
- If tracker available: `mcp__plugin_linear_linear__get_issue({ id: "{ISSUE_ID}" })` — confirm state is "Done"
- If either check fails, retry the update. Do NOT proceed until confirmed.

Log summary: `Status updates complete: backlog → done, Linear → Done`

### At retro (M/L/XL)

**Linear** (if available):
```
mcp__plugin_linear_linear__save_comment({ issueId: "{ISSUE_ID}", body: "{learnings summary}" })
```

## Progress Announcements (multi-task)

<HARD-RULE>
When task_count > 1, announce progress at every stage transition and after each task completes. The user should never need to ask "what's next?"

**Format:**
> **Stage N complete.** [M of N] tasks {planned/implemented/merged}. Next: {specific next action}. {Proceeding. | Approve to proceed?}

In autonomous mode (after RFC approval), do NOT pause for confirmation. Announce and proceed.
</HARD-RULE>

## State File ({source_dir}/.pm/dev-sessions/{slug}.md)

The state file is the **single source of truth** for session state. Updated at every stage transition and task completion. **Deleted after retro.**

**Repo location:** Dev sessions always live in the source repo's `.pm/dev-sessions/` directory — even in separate-repo mode. This keeps dev state co-located with the code being modified. In same-repo mode, `source_dir` == cwd, so the path is `.pm/dev-sessions/{slug}.md` as before.

After compaction or if context feels stale, read this file to recover full session state.

```markdown
# Dev Session State

| Field | Value |
|-------|-------|
| Run ID | {PM_RUN_ID} |
| Stage | implement |
| Size | M |
| Task Count | 1 |
| Ticket | PROJ-456 |
| Repo root | /path/to/project |
| Active cwd | /path/to/project/.worktrees/feature-name |
| RFC | {pm_dir}/backlog/rfcs/feature-name.html |
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

## Sub-Issues (only present when task_count > 1)

| # | ID | Title | Size | Status | PR | Retries | Started | Completed |
|---|----|-------|------|--------|----|---------|---------|-----------|
| 1 | ISSUE-001 | First task | S | Merged (PR #312) | #312 | 0 | ... | ... |
| 2 | ISSUE-002 | Second task | M | Implementing | — | 0 | ... | — |

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

## Linear Context (if sourced from Linear)
| Field | Value |
|-------|-------|
| Linear ID | {ID or null} |
| Linear readiness | dev-ready / needs-groom / null |
| Linear fetch | succeeded / failed / null |
| Linear gaps | [missing-ac, vague-scope, unclear-size] or [] |
| Linear labels | {labels or []} |

## Resume Instructions
- Stage: [current stage name]
- Next action: [single next action to take]
- Key context: [1-2 sentences a cold reader needs]
- Blockers: [any blocking issues, or "none"]
```

**Valid Stage values:** `intake`, `workspace`, `rfc-check`, `implement`, `simplify`, `design-critique`, `qa`, `review`, `ship`, `retro`.

**Update rules:**
- Write the full file (not append) at each stage transition
- Keep `Stage started at` current at every stage transition and set `Completed at` when the session finishes
- Include all decisions made so far — a cold reader should understand the full context
- After design critique, add the report path
- Resume Instructions section must be populated at every stage transition. A cold reader should be able to continue the session from this section alone.
- After retro, delete the file
