---
name: dev
description: "Use when starting any development work, debugging, or bug fixing. Checks for an approved RFC; generates one if missing (issue split, approach, test strategy). Then implements. Whether work is 1 task or N tasks emerges from the RFC, not from routing. Triggers on 'build this,' 'implement this,' 'let's build,' 'fix this,' 'fix this bug,' 'help me debug,' 'can you debug,' 'it's not working,' 'this is broken,' 'why is this broken,' 'troubleshoot,' 'investigate,' 'let's work on,' 'work on this,' 'add a feature,' 'refactor this,' 'backfill tests.'"
---

# Dev — Development Lifecycle

Unified orchestrator for all development work. One flow handles everything — whether work is 1 task or N tasks emerges from the RFC.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, and telemetry.

**Workflow:** `dev` | **Telemetry steps:** `resume-detection`, `intake`, `workspace`, `groom-readiness`, `plan`, `implementation`, `qa`, `review`, `ship`, `retro`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime execution rules and `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

**Source repo access check:** Dev requires a source code repository. If `source_dir` is not in conversation context, check if cwd contains source code indicators (package.json, Cargo.toml, go.mod, pyproject.toml, Gemfile, pom.xml, build.gradle, CMakeLists.txt, etc.). If found, use cwd as `source_dir`. If not found, block with: "Dev requires a source repo. Run pm:setup to configure, or invoke pm:dev from the source repo." Dev session files (`.pm/dev-sessions/`) are always created in the source repo, not the PM repo. See step 01 (Tool Check) for the full check.

**Hard rules:**
- **Protect the orchestrator's context window for multi-task work.** Each task's planning and implementation MUST run as a **fresh Agent() with isolated context**. Dispatch one fresh agent for RFC generation, and a separate fresh agent for implementation — the approved RFC is the handoff contract. Review/code-scan agents return compact results directly.
- No frontend work without passing the contract sync gate (when project uses API contract tooling)
- Before design critique or review, always run `pm:simplify` (it routes to Anthropic official simplify in Claude Code and normalizes output to PM-required fields)
- No PR or auto-merge without design critique for UI changes (S/M/L/XL with frontend work)
- No PR without passing the review gate (M/L/XL) — `/review` MUST run before push
- No auto-merge without passing the code scan gate (XS/S) — lightweight bug scan before merge
- All sizes use the PR flow — push branch, create PR, merge via `references/merge-loop.md`. The project's branch protection and CI dictate what's required.
- XS/S: code scan gate → PR → auto-merge
- M/L/XL: full review gate → PR → auto-merge after readiness gates pass
- Learnings file MUST be read at intake before any work begins
- Never use destructive git recovery in `/dev` flows (`git reset --hard`, `git checkout --`, blind `git stash pop`)
- At every stage transition, emit a workspace checkpoint (cwd, branch, worktree, next action)

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is XS, skip TDD" | XS tasks still break when untested. Test takes 30 seconds. |
| "I know the fix, skip debugging" | Known fixes are guesses. Debugging skill exists to prevent wrong fixes. |
| "Review is overkill for this change" | Review catches cross-cutting issues you can't see from inside the change. |
| "I'll just start coding, RFC is overhead" | RFC is 15 minutes. Wrong direction is 2 hours. The RFC IS the shortcut. |
| "Worktree is overhead for one file" | Dirty main blocks all future work. Worktree is insurance, not overhead. |

## Resume Detection

**Runs FIRST on every invocation.**

Glob for active sessions in `.pm/dev-sessions/` (+ legacy `.dev-state-*.md`, `.dev-epic-state-*.md` at repo root):

| Matches | Action |
|---------|--------|
| 1 session file | Read it, resume from where it left off |
| Multiple files | List all with stage and last-modified, ask user which to resume |
| None found | Proceed to fresh start |

**Staleness guard:** If a session file is older than 48 hours and the user didn't explicitly reference it, ask whether to resume or discard.

**Legacy migration:** Old `epic-{slug}.md` and `.dev-epic-state-*.md` files are treated identically to regular session files. All resume to the loaded workflow steps.

## Fresh Start

**Local backlog resolution (always runs first):** If `$ARGUMENTS` is a slug (e.g., `inspection-checklist-navigation`) or an issue ID (e.g., `PM-036`, `CLE-123`):
1. First, check `{pm_dir}/backlog/{slug}.md` — if found, read frontmatter and use as task context.
2. If the argument looks like an issue identifier (e.g., `PM-036`, `CLE-123`), scan `{pm_dir}/backlog/*.md` frontmatter for a matching `id:` or `linear_id:` field. If found, use that file's slug and content as task context.
3. Only if no local backlog match: fall through to MCP lookup below.

**MCP lookup:** If `$ARGUMENTS` looks like an issue ID and was NOT resolved from local backlog above, fetch via MCP. Also fetch sub-issues — they become context for RFC generation (not a routing decision). If MCP returns nothing, proceed with the argument as the topic.

**Linear issue readiness check:** If the MCP fetch returned an issue, assess dev-readiness:

1. **Fetch context:** Read the issue title, description, labels, and status from the `get_issue` response.
2. **Dev-readiness assessment:** Check three criteria:
   - **AC exist:** The description contains testable acceptance criteria (specific, verifiable statements — not just a vague description). Be generous: look for testable statements anywhere, not just under "AC:" headers.
   - **Scope is clear:** The description distinguishes what's in scope. It should be possible to determine what the issue does and doesn't cover.
   - **Size is inferrable:** Enough detail exists to classify as XS/S/M/L/XL.
3. **If all three pass:** Store `linear_id`, `linear_readiness: dev-ready`, `linear_title`, `linear_description`, and `linear_labels` in the session state file. Log: `Linear issue {ID}: dev-ready. Proceeding to RFC.`
4. **If any fail:** Also classify size (XS/S/M/L/XL) from the available context. Store `linear_id`, `linear_readiness: needs-groom`, `size`, and the specific gaps (e.g., `gaps: [missing-ac, vague-scope]`) in the session state.
   - **XS/S:** Handle inline — confirm scope + ACs with the user conversationally (same as existing XS/S ungroomed path in Stage 2.5 Step 2). Do NOT invoke pm:groom.
   - **M/L/XL:** Announce gaps and invoke pm:groom within the same conversation. Pass Linear context as conversation text (not CLI flags). Specify the slug for groom: "Use slug: {slug}". Log: `Linear issue {ID}: needs grooming ({gaps}). Invoking pm:groom.`
5. **If MCP fetch fails:** Log `linear_fetch: failed` and `linear_error: {error message}`. Ask the user: "Could not fetch Linear issue {ID}. Can you paste the issue description?" Proceed with the pasted text as conversation-sourced task context.

After intake is resolved, execute the loaded workflow steps in order.

## Bundled Skills

All workflow skills are self-contained within this plugin. No external skill dependencies.

| Skill / Reference | Used in |
|-------------------|---------|
| `pm:groom` | Auto-invoked when no proposal exists (M/L/XL) |
| `dev/references/writing-rfcs.md` (reference) | RFC Generation (M/L/XL) |
| `dev/references/splitting-patterns.md` (reference) | Issue splitting within RFC (M/L/XL) |
| `dev/references/cross-cutting-review-prompts.md` (reference) | Multi-task RFC review (task_count > 1) |
| `dev/references/spec-reviewer-prompts.md` (reference) | Raw sub-issue spec review before RFC |
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

## State File Naming

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions:

- **All sessions:** `.pm/dev-sessions/{slug}.md` — where `{slug}` is derived from the branch name by stripping the type prefix (`feat/`, `fix/`, `chore/`). Example: branch `feat/add-auth` → `.pm/dev-sessions/add-auth.md`. For XS tasks (no branch), use the topic slug from intake.
- **`.gitignore`:** `.pm/` covers all state files (no separate pattern needed).

When referencing the state file in subsequent sections, `.dev-state.md` means `.pm/dev-sessions/{slug}.md` — the slug is determined at intake.

**Directory creation:** If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before the first write.

**Legacy migration:** On resume detection or any state file read, also check legacy paths (`.dev-state-{slug}.md`, `.dev-epic-state-{slug}.md` at repo root, and `epic-{slug}.md` in `.pm/dev-sessions/`). If found at legacy path but not at new path, read from legacy. New writes always go to `.pm/dev-sessions/{slug}.md`.

**Context recovery:** At the start of every turn, if you're unsure which stage you're in or what decisions were made, read the state file first. The state file is the single source of truth — not conversation history.

## Execution Defaults

### Workspace checkpoint format

At stage start/end, print this block and mirror the same fields in `.pm/dev-sessions/{slug}.md`:

```
Checkpoint
- Repo root: <path>
- CWD: <path>
- Branch: <branch>
- Worktree: <path or "none">
- Stage: <intake/workspace/...>
- Next: <single next action>
```

### Path and command preflight

Before running multi-step commands:
- Confirm target paths exist (`test -d`, `test -f`)
- Confirm branch/worktree context (`git branch --show-current`, `git worktree list`)
- Prefer idempotent commands (`pull --ff-only`, guarded `git branch -d`)

### Default branch detection (all flows)

Never hardcode `main` as the default branch. Detect it at intake:

```bash
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"  # fallback only
```

Store in the state file and use `{DEFAULT_BRANCH}` everywhere instead of literal `main`. Pass to delegated workers and reviewers in their prompts when delegation is used.

### Pre-commit validation (all flows)

Before EVERY `git commit`:
1. Verify you're on the correct branch: `git branch --show-current` — must match the expected feature branch
2. Verify cwd is in the correct worktree: `git rev-parse --show-toplevel` — must match expected worktree path
3. Run the project test command (from AGENTS.md) on changed files — if tests fail, fix before committing
4. Check for untracked files that shouldn't be staged: `git status --porcelain` — review any `??` files

If any check fails, fix before committing. Do not commit broken code and hope the push hook catches it.

### Git state guard (all flows)

Before starting ANY implementation work:
1. Check for uncommitted changes: `git status --porcelain`
2. If dirty state from a prior failed attempt: read the state file to understand what happened, then decide whether to commit the partial work or reset it
3. Never start fresh work on a dirty worktree — resolve the state first

### Subagent git context (all flows)

Every delegated worker or reviewer prompt MUST include:
- Explicit repo root path
- Current branch name
- Worktree path (if applicable)
- Instruction: "Verify you are on branch {branch} before making changes"

### Repeated error handling

If the same root-cause error repeats twice (path missing, branch exists, permission denied):
1. Stop repeating the same command
2. Run a short diagnosis (`pwd`, `git status -sb`, `git worktree list`)
3. Switch strategy (reuse existing worktree/branch, fix path, or ask user one focused question)
