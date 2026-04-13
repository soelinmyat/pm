---
name: dev
description: "Use when building, debugging, or fixing. Checks for an RFC, generates one if missing, then implements. One flow for all sizes."
---

# Dev — Development Lifecycle

Unified orchestrator for all development work. One flow handles everything — whether work is 1 task or N tasks emerges from the RFC.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, workflow loading, and telemetry.

**Workflow:** `dev` | **Telemetry steps:** `resume-detection`, `intake`, `workspace`, `groom-readiness`, `plan`, `implementation`, `qa`, `review`, `ship`, `retro`.

Execute the loaded workflow steps in order. Each step contains its own instructions.

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` for runtime execution rules and `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

**When NOT to use:** Quick questions about code ("what does this function do?"), explaining existing behavior, or one-line fixes the user can apply themselves. Those don't need an RFC or a branch — just answer directly.

**Source repo access check:** Dev requires a source code repository. If `source_dir` is not in conversation context, check if cwd contains source code indicators (package.json, Cargo.toml, go.mod, pyproject.toml, Gemfile, pom.xml, build.gradle, CMakeLists.txt, etc.). If found, use cwd as `source_dir`. If not found, block with: "Dev requires a source repo. Run pm:setup to configure, or invoke pm:dev from the source repo." Dev session files (`.pm/dev-sessions/`) are always created in the source repo, not the PM repo. See step 01 (Tool Check) for the full check.

**Hard rules:**
- **Fresh agents for each phase.** RFC generation and implementation each get a fresh Agent() — the RFC is the handoff contract. This protects the orchestrator's context window and keeps agents focused.
- **Contract sync before frontend work** — stale types give false test confidence.
- **Simplify before review** — `pm:simplify` normalizes code quality before reviewers see it.
- **Design critique before PR** for any UI change (S/M/L/XL) — users see what reviewers don't.
- **Review before push** (M/L/XL) — `/review` catches cross-cutting issues. Code scan for XS/S.
- **PR flow for all sizes** — push branch, create PR, merge via `references/merge-loop.md`. Branch protection and CI dictate gates.
- **Read learnings at intake** — past context prevents repeating mistakes.
- **No destructive git recovery** — no `git reset --hard`, `git checkout --`, blind `git stash pop`. Fix forward.
- **Checkpoint at every stage transition** — cwd, branch, worktree, next action. The state file is the source of truth.

**Gate routing:**

| Size | Gates before PR | After PR |
|------|----------------|----------|
| XS/S | Code scan | Auto-merge |
| M/L/XL | Full review | Auto-merge after readiness gates |

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is XS, skip TDD" | XS tasks still break when untested. Test takes 30 seconds. |
| "I know the fix, skip debugging" | Known fixes are guesses. Debugging skill exists to prevent wrong fixes. |
| "Review is overkill for this change" | Review catches cross-cutting issues you can't see from inside the change. |
| "I'll just start coding, RFC is overhead" | RFC is 15 minutes. Wrong direction is 2 hours. The RFC IS the shortcut. |
| "Worktree is overhead for one file" | Dirty main blocks all future work. Worktree is insurance, not overhead. |

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

## Fresh Start

**Local backlog resolution (always runs first):** If `$ARGUMENTS` is a slug (e.g., `inspection-checklist-navigation`) or an issue ID (e.g., `PM-036`, `CLE-123`):
1. First, check `{pm_dir}/backlog/{slug}.md` — if found, read frontmatter and use as task context.
2. If the argument looks like an issue identifier (e.g., `PM-036`, `CLE-123`), scan `{pm_dir}/backlog/*.md` frontmatter for a matching `id:` or `linear_id:` field. If found, use that file's slug and content as task context.
3. Only if no local backlog match: fall through to MCP lookup below.

**MCP lookup:** If `$ARGUMENTS` looks like an issue ID and was NOT resolved from local backlog above, fetch via MCP. Also fetch sub-issues — they become context for RFC generation (not a routing decision). If MCP returns nothing, proceed with the argument as the topic.

**Linear issue readiness check:** If the MCP fetch returned an issue, assess dev-readiness.

Read the issue title, description, labels, and status. Check three criteria — be generous, look for testable statements anywhere, not just under "AC:" headers:

- **AC exist:** Testable acceptance criteria (specific, verifiable — not just a vague description)
- **Scope is clear:** What's in scope vs. out of scope is distinguishable
- **Size is inferrable:** Enough detail to classify as XS/S/M/L/XL

Then route based on readiness and size:

| Readiness | Size | Action |
|-----------|------|--------|
| dev-ready (all 3 pass) | any | Store Linear context in session state. Proceed to RFC. |
| needs-groom | XS/S | Confirm scope + ACs conversationally — don't invoke pm:groom. |
| needs-groom | M/L/XL | Announce gaps, invoke pm:groom inline. Pass Linear context as conversation text. |
| fetch failed | any | Ask user to paste the issue description. Proceed with pasted text. |

Store `linear_id`, `linear_readiness`, `linear_title`, `linear_description`, and `linear_labels` in the session state. For needs-groom, also store `size` and `gaps` (e.g., `[missing-ac, vague-scope]`).

After intake is resolved, execute the loaded workflow steps in order.

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

State files live under `.pm/dev-sessions/`, namespaced by feature slug to allow concurrent sessions:

- **All sessions:** `.pm/dev-sessions/{slug}.md` — where `{slug}` is derived from the branch name by stripping the type prefix (`feat/`, `fix/`, `chore/`). Example: branch `feat/add-auth` → `.pm/dev-sessions/add-auth.md`. For XS tasks (no branch), use the topic slug from intake.
- **`.gitignore`:** `.pm/` covers all state files (no separate pattern needed).

When referencing the state file in subsequent sections, `.dev-state.md` means `.pm/dev-sessions/{slug}.md` — the slug is determined at intake.

**Directory creation:** If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before the first write.

**Legacy migration:** On resume detection or any state file read, also check legacy paths (`.dev-state-{slug}.md`, `.dev-epic-state-{slug}.md` at repo root, and `epic-{slug}.md` in `.pm/dev-sessions/`). If found at legacy path but not at new path, read from legacy. New writes always go to `.pm/dev-sessions/{slug}.md`.

**Context recovery:** At the start of every turn, if you're unsure which stage you're in or what decisions were made, read the state file first. The state file is the single source of truth — not conversation history.

## Execution Defaults

See `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/execution-defaults.md` for checkpoint format, path preflight, default branch detection, pre-commit validation, git state guard, subagent git context, and repeated error handling.
