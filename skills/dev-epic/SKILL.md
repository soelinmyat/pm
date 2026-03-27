---
name: dev-epic
description: "Multi-issue orchestrator: fetch parent issue, plan each sub-issue sequentially, run epic-level review, then autonomously implement/PR/merge all sub-issues one-shot"
---

# /dev-epic [parent-issue-id]

Orchestrate an entire epic from a parent issue. The orchestrator stays **thin**: it manages state, creates a team, and dispatches teammates for planning and implementation. Each sub-issue gets **one combined teammate** that plans first, then implements — preserving codebase context across both phases.

**Architecture:**
- **Orchestrator (this context, team lead):** Intake, state management, team creation, task assignment, result tracking
- **Combined teammates:** One per sub-issue. Plans first (explore codebase, write plan, commit). Goes idle. Resumes for implementation after epic review approval. Context from planning phase is preserved — no duplicate codebase exploration.
- **Epic review sub-agents:** 1-3 parallel sub-agents (NOT teammates) reviewing all plans as a set. Return compact JSON verdicts directly to orchestrator context.

**Team lifecycle:**
1. Orchestrator creates team via `TeamCreate({ team_name: "epic-{parent-slug}" })`
2. Orchestrator creates tasks via `TaskCreate` for each sub-issue
3. Orchestrator spawns combined teammates via `Agent({ team_name: "epic-{parent-slug}", name: "agent-{slug}", ... })`
4. **Planning phase:** Each teammate plans, commits, sends summary via `SendMessage`, goes idle
5. **Epic review:** Orchestrator dispatches sub-agents (not teammates) — compact JSON comes back directly
6. **Implementation phase:** Orchestrator sends "go implement" to idle teammates via `SendMessage` — they resume with full planning context
7. After wrap-up, orchestrator shuts down all teammates via per-agent `SendMessage({ message: { type: "shutdown_request" } })`

**Reference files (read on-demand, NOT upfront):**
- `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/rfc-reviewer-prompts.md` - RFC agent prompts (Stage 2, raw issues only)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/epic-review-prompts.md` - Epic review agent prompts (Stage 3)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/implementation-flow.md` - Sub-issue agent instructions (Stage 4)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/state-template.md` - State file template

---

## State File Naming

State files live under `.pm/dev-sessions/`, namespaced by parent issue slug: `.pm/dev-sessions/epic-{parent-slug}.md`. This allows concurrent epics on the same repo.

When referencing the state file in subsequent sections, `.dev-epic-state.md` means `.pm/dev-sessions/epic-{parent-slug}.md`.

**Directory creation:** If `.pm/dev-sessions/` does not exist, create it (`mkdir -p .pm/dev-sessions`) before the first write.

**Legacy migration:** On resume detection, also check the legacy path (`.dev-epic-state-{parent-slug}.md` at repo root). If found at legacy path but not at new path, read from legacy. New writes always go to `.pm/dev-sessions/`.

## Resume Detection

**Runs FIRST on every invocation.**

Glob for `.pm/dev-sessions/epic-*.md` (and legacy `.dev-epic-state-*.md` at repo root).

**If one match:** Read it. Announce stage/progress/next action. Continue from Resume Instructions.

**If multiple matches:** List them with parent issue and stage. Ask user which to resume.

**If `$ARGUMENTS` matches an existing state file's parent issue:** Resume that one directly.

**If no matches:** Fresh start (Stage 1).

**If manual intervention:** Re-run the interrupted stage, don't skip.

---

## Stage 1: Intake

### 1.1 Fetch issues

**If issue tracker detected** (Linear/Jira/GitHub Issues via MCP — see `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md`):
Fetch parent issue via MCP using `$ARGUMENTS`. Extract title, description, status. Fetch all sub-issues. Display table. Ask user which to include (default: Todo + In Progress).

**If no issue tracker available:**
Accept a manual issue list from the user. Format: markdown with titles, descriptions, and ACs. Parse into the same structure.

### 1.2 Source detection (groomed vs raw)

For each sub-issue, detect groomed status by reading the groom session file:

1. Glob `.pm/groom-sessions/*.md` for a file whose slug matches the sub-issue slug or topic name (normalize: lowercase, spaces to hyphens).
2. If found, parse YAML frontmatter and read `bar_raiser.verdict`.
3. **Groomed** = verdict is `"ready"` or `"ready-if"`. Mark sub-issue as groomed in state file.
4. **Raw** = no matching file, verdict is `"send-back"` / `"pause"` / missing, or parse error. Mark as raw.

| Signal | Verdict |
|--------|---------|
| Groom session exists with `bar_raiser.verdict` = `"ready"` or `"ready-if"` | **Groomed** |
| No matching session, or verdict is `"send-back"` / `"pause"` / missing | **Raw** |

**Ambiguity fallback:** If slug matching is uncertain (multiple partial matches, no exact match), classify as Raw. Never reduce ceremony on ambiguous detection.

**Multiple groom sessions:** When the parent issue maps to a single groom session (e.g., an epic groomed as one initiative), all sub-issues inherit the groomed status from the parent session. When individual sub-issues have their own groom sessions, match per sub-issue.

Groomed issues get reduced ceremony (skip design exploration + spec review). This is the pm -> dev handoff.

Log per sub-issue in `.pm/dev-sessions/epic-{parent-slug}.md` under Decisions:
```
- Groom detection:
  - {slug} -> groomed (session: {file}, verdict: {verdict}) | raw (reason: {reason})
- Skipped phases ({slug}): design-exploration, spec-review, individual-rfc | none
- Research location: {path from session frontmatter} | none
```

### 1.3 Auto-classify size

| Size | Signal |
|------|--------|
| **XS** | One-line fix, typo, config tweak |
| **S** | Single concern, clear scope |
| **M** | Cross-layer or multi-concern |
| **L** | New domain/module, cross-cutting refactor |
| **XL** | Multi-domain, architectural overhaul |

Present classifications. User confirms or overrides.

### 1.4 Dependency ordering

Propose order based on: issue tracker "blocked by" relations, file overlap, common sense (migrations before UI, API before frontend). User confirms.

### 1.5 Load learnings

Read the learnings file (default: `learnings.md`, configurable via `dev/instructions.md`). Surface relevant entries. Skip if file doesn't exist.

### 1.6 Write initial state

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/state-template.md` for the template. Write `.pm/dev-sessions/epic-{parent-slug}.md` (run `mkdir -p .pm/dev-sessions` first).

### 1.7 Merge strategy detection

Detect whether direct pushes to main are possible. Check **all three** sources:

```bash
# 1. GitHub branch protection API
gh api repos/{owner}/{repo}/branches/main/protection 2>/dev/null

# 2. Git hooks (version-controlled or custom path)
HOOKS_PATH=$(git config core.hooksPath 2>/dev/null || echo ".git/hooks")
test -f "$HOOKS_PATH/pre-push" && echo "pre-push hook exists"

# 3. Also check .githooks/ (common convention for committed hooks)
test -f .githooks/pre-push && echo ".githooks/pre-push exists"
```

**If any source blocks direct pushes:** set `Merge strategy: PR required` in state file. Promote XS to S. All subsequent agents use PR flow — no agent should discover this at merge time.

**If none detected:** set `Merge strategy: direct push allowed`.

### 1.8 Create team

```
TeamCreate({
  team_name: "epic-{parent-slug}",
  description: "Epic: {PARENT_TITLE} — {N} sub-issues"
})
```

Create one task per sub-issue (combined plan + implement):
```
TaskCreate({ title: "{ISSUE_ID}: {TITLE}", description: "Plan then implement. Size: {SIZE}. Deps: {DEPS}" })
```

---

## Progress Announcements

<HARD-RULE>
At every stage transition and after each sub-issue completes, announce progress to the user. The user should never need to ask "what's next?"

**Format:**
> **Stage N complete.** [M of N] sub-issues {planned/implemented/merged}. Next: {specific next action}. {Proceeding. | Approve to proceed?}

**When to announce:**
- After Stage 1 (intake) completes: announce planning is starting
- After each sub-issue plan completes: announce progress (e.g., "3 of 5 plans complete. Next: plan CLE-1214.")
- After Stage 2 (all planning) completes: announce epic review is starting
- After Stage 3 (epic review) completes: present for approval (already required)
- After each sub-issue merges during Stage 4: announce progress (e.g., "2 of 5 merged. Next: implement CLE-1215 [mobile].")
- After each wave completes during parallel execution: announce wave completion and next wave
- After Stage 5 (wrap-up) completes: final report

In autonomous mode (after Stage 3.3 approval), do NOT pause for confirmation. Announce and proceed.
</HARD-RULE>

---

## Stage 2: Sequential Planning (via teammates)

No user interaction. For each sub-issue in dependency order.

**Before dispatching any agent:** Run context discovery per `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md` if not already in `.pm/dev-sessions/epic-{parent-slug}.md`. Build the `{PROJECT_CONTEXT}` block and pass it to every dispatched agent.

### 2.1 Groomed sub-issues

Dispatch a **combined teammate** per sub-issue. The teammate explores the codebase, writes the plan, commits it, sends back the plan path + summary, and goes idle. The same teammate resumes for implementation in Stage 4 — preserving all codebase context from the planning phase.

```
Agent({
  description: "Plan+Impl {ISSUE_ID}",
  name: "agent-{slug}",
  team_name: "epic-{parent-slug}",
  subagent_type: "general-purpose",
  prompt: `You are a combined plan+implement teammate on the "epic-{parent-slug}" team.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Your task (Phase 1 — Planning):** Write an implementation plan for {ISSUE_ID} ({ISSUE_TITLE}).
**CWD:** {REPO_ROOT}
**Sub-issue description + ACs:**
{ISSUE_DESCRIPTION}

**Parent issue context:**
{PARENT_TITLE}: {PARENT_DESCRIPTION_SUMMARY}

**Previous plans in this epic (for reference):**
{LIST_OF_PREVIOUS_PLAN_PATHS_AND_SUMMARIES}

**Phase 1 Instructions:**
1. Read AGENTS.md and relevant app-specific AGENTS.md
2. Explore the codebase to understand current state for this sub-issue
3. Use the dev:writing-plans skill methodology
4. Save plan to docs/plans/{DATE}-{SLUG}.md
5. Commit: git add docs/plans/{file} && git commit -m "docs: add plan for {ISSUE_ID} - {TITLE}"
6. Send result to orchestrator: SendMessage({ to: "team-lead", message: "Plan complete. Path: docs/plans/{file}. Summary: {3-line summary}. Tasks: {N}", summary: "{ISSUE_ID} plan done" })

**After sending the plan summary, STOP and wait.** The orchestrator will send you a "go implement" message after epic review passes. You will then proceed to Phase 2 (implementation) with all your codebase context preserved.`
})
```

The orchestrator waits for the teammate's message. Only the message content enters the orchestrator's context — not the teammate's internal work.

**Skip individual RFC review for groomed issues.** Epic review (Stage 3) is the quality gate.

### 2.2 Raw sub-issues

**Raw XS:** Note "direct implementation, no plan needed" in state file. Skip planning.

**Raw S:** Dispatch combined teammate (same prompt as 2.1), then dispatch RFC review sub-agents from `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/rfc-reviewer-prompts.md` (Agents 2+3: Testing & Quality + Complexity & Maintainability). Fix blocking issues, commit.

**Raw M/L/XL:** Three-step process:

1. **Dispatch design exploration teammate** to generate a spec:

```
Agent({
  description: "Design {ISSUE_ID}",
  name: "design-{slug}",
  team_name: "epic-{parent-slug}",
  subagent_type: "general-purpose",
  prompt: `You are a design exploration teammate on the "epic-{parent-slug}" team.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Your task:** Generate a feature spec for {ISSUE_ID} ({ISSUE_TITLE}).
**CWD:** {REPO_ROOT}
**Sub-issue description:**
{ISSUE_DESCRIPTION}

**Parent issue context:**
{PARENT_TITLE}: {PARENT_DESCRIPTION_SUMMARY}

**Instructions:**
1. Read and follow ${CLAUDE_PLUGIN_ROOT}/skills/groom/phases/phase-3.5-design.md
2. Explore the codebase, ask clarifying questions (answer from the issue description), propose approaches, and write a spec
3. Save the spec to docs/specs/{DATE}-{SLUG}.md
4. Commit: git add docs/specs/{file} && git commit -m "docs: add spec for {ISSUE_ID} - {TITLE}"
5. Send result to orchestrator: SendMessage({ to: "team-lead", message: "Spec complete. Path: docs/specs/{file}. Summary: {2-line summary}", summary: "{ISSUE_ID} spec done" })`
})
```

2. **Dispatch UX spec review sub-agent** (prompt from `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/rfc-reviewer-prompts.md`, UX Spec Review section). Fix blocking issues in the spec.

3. **Dispatch combined teammate** (same prompt as 2.1, but referencing the spec file instead of ACs). Then dispatch all 3 RFC review sub-agents. Fix blocking issues, commit.

### 2.3 Context accumulation

When dispatching plan agents, pass previous plan summaries (not full plans). The agent reads the full plan files from disk if needed. For 5+ sub-issues: after plan N is approved, plans 1 through N-2 are replaced with a one-paragraph summary (goal + file structure + key interfaces). Most recent 2 plans always passed in full.

### 2.4 Size reconciliation

After each plan agent returns, check if the plan's task count suggests a different size than the intake classification. If the plan sizes differently (e.g., intake said S but plan has 10+ tasks across 5 chunks, suggesting M), update the size in `.pm/dev-sessions/epic-{parent-slug}.md`. This matters because size determines the review path in Stage 4 (code scan for XS/S vs full `/review` for M/L/XL).

### 2.5 State updates

After each plan agent returns, update `.pm/dev-sessions/epic-{parent-slug}.md` with plan path and commit SHA.

---

## Stage 3: Epic Review (via sub-agents)

After all plans are committed. Runs automatically.

**Read `${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/epic-review-prompts.md`** for the agent prompts.

### 3.0 Scale review to remaining work

Count sub-issues with actual code work (plan reports tasks > 0). Scale reviewer count:

| Sub-issues with code work | Reviewers | Rationale |
|---------------------------|-----------|-----------|
| 0 | Skip Stage 3 entirely | Nothing to review — all already implemented |
| 1-2 | 1 combined reviewer | Single agent reviews arch + integration + scope |
| 3+ | 3 parallel reviewers | Full review: arch, integration, scope |

### 3.1 Dispatch sub-agents (NOT teammates)

Epic reviewers return compact JSON (~10 lines each) — this fits fine in the orchestrator's context. Use regular sub-agents, not teammates. This avoids team communication overhead (SendMessage, idle notifications, shutdown).

**CRITICAL: Do NOT pass `team_name` to the Agent tool for epic reviewers.** Passing `team_name` creates a teammate (requiring SendMessage, idle handling, and manual shutdown). Omitting `team_name` creates a true sub-agent whose result returns directly to the orchestrator's context.

**For 3+ sub-issues with code work:**
```
Agent({ subagent_type: "general-purpose", model: "opus", prompt: "..." })  // Architect — no team_name!
Agent({ subagent_type: "general-purpose", model: "opus", prompt: "..." })  // Integration — no team_name!
Agent({ subagent_type: "general-purpose", model: "opus", prompt: "..." })  // Scope — no team_name!
```

**For 1-2 sub-issues with code work:**
```
Agent({ subagent_type: "general-purpose", model: "opus", prompt: "Combined review: architecture + integration + scope. {COMBINED_PROMPT}" })  // no team_name!
```

Sub-agent results return directly to the orchestrator — no SendMessage needed.

### 3.2 Handling findings

1. Receive verdict messages from all 3 teammates. Merge. Deduplicate.
2. Fix all blocking issues in affected plans.
3. Re-dispatch if fixes made (max 3 iterations).
4. Commit plan updates.

### 3.3 Present to user (LAST INTERACTIVE GATE)

Show verdict table. List plan paths. Ask: "Approve to begin one-shot implementation through to merge?"

After approval, update state file with `Continuous execution: authorized`.

---

## Stage 4: One-Shot Implementation (via existing teammates)

<HARD-RULE>
After approval, proceed through ALL sub-issues without pausing. Only stop for: QA Blocked, 3x test failures, merge conflicts, CI failures needing human intervention, human review feedback on PRs.
</HARD-RULE>

**Why resume existing teammates:** The combined teammate that planned the sub-issue already explored the codebase and understands the current state. Sending "go implement" to the idle teammate preserves this context — no duplicate codebase exploration. Implementation details, test output, CI logs, and diffs stay in the teammate's context. The orchestrator only receives short SendMessage summaries.

### 4.pre Environment readiness check

Before dispatching the first implementation agent, check whether any sub-issue touches mobile code (React Native/Expo). If so, ensure Metro is running. Pre-push hooks that type-check mobile code require Metro, and agents in worktrees cannot easily start it themselves.

```bash
# Only needed when the epic includes mobile changes
# Check: does any sub-issue plan mention apps/mobile or apps/display files?
pgrep -f 'expo.*start' > /dev/null || (cd apps/mobile && npx expo start --dev-client &)
sleep 3
```

Skip this step entirely if no sub-issue touches mobile code. Log in the state file whether Metro was started.

### 4.0 Skip fully-implemented sub-issues

If a plan reported 0 tasks (all ACs already implemented with tests), mark the sub-issue as "Already implemented" in the state file and skip to the next one. Do not send the agent a "go implement" message — shut it down instead.

### 4.1 Layer classification

Classify each sub-issue's **layer set** from its plan's file list:

| Files touched | Layer |
|---------------|-------|
| Only `apps/api/` | `api` |
| Only `apps/web-client/` (+ `packages/shared/`) | `web` |
| Only `apps/mobile/` (+ `packages/shared/`) | `mobile` |
| Only `apps/display/` (+ `packages/shared/`) | `display` |
| Multiple app directories | `cross-layer` (list all: e.g., `[api, web]`) |

Record each sub-issue's layer set in the state file.

### 4.2 Execution wave computation

Group sub-issues into **waves** that respect both dependencies and layer constraints:

1. Start with all sub-issues whose dependencies are satisfied (all deps merged).
2. From that set, find sub-issues that can run in parallel:
   - **Single-layer sub-issues on different layers** can run in parallel (e.g., `[mobile]` + `[web]` + `[api]`).
   - **Cross-layer sub-issues** run alone — they cannot parallelize with any sub-issue that shares a layer.
   - **Two sub-issues on the same layer** must serialize (shared test DB, simulator, pre-push hooks).
3. Assign to the current wave. Remaining sub-issues wait for the next wave.

**Example (SLA epic):**
```
Wave 1: CLE-1210 [api]                       — sequential (first in chain)
Wave 2: CLE-1211 [api]                       — sequential (depends on wave 1)
Wave 3: CLE-1212 [api]                       — sequential (depends on wave 2)
Wave 4: CLE-1213 [mobile] + CLE-1214 [web]   — PARALLEL (different single layers)
Wave 5: CLE-1215 [api+web]                   — alone (cross-layer)
Wave 6: CLE-1216 [api+mobile]                — alone (cross-layer)
```

Record the wave plan in the state file. Present to user as part of Stage 3.3 approval.

### 4.3 Wave execution

#### Single-agent waves (sequential — same as before)

For waves with one sub-issue, use the current flow: agent implements, reviews, PRs, merges, cleans up, and reports "Merged."

The "go implement" message includes `**Mode:** sequential` and follows the standard implementation-flow.md lifecycle through merge.

#### Multi-agent waves (parallel — implement concurrently, merge sequentially)

For waves with 2+ sub-issues:

1. **Create all worktrees** for the wave:
   ```bash
   git worktree add .worktrees/{slug-A} -b feat/{slug-A}
   git worktree add .worktrees/{slug-B} -b feat/{slug-B}
   ```

2. **Set all issue statuses** to In Progress.

3. **Dispatch all agents simultaneously.** The "go implement" message includes `**Mode:** parallel` which tells the agent to stop after pushing the branch and creating the PR — do NOT merge. Agent reports "Ready to merge. PR #{N}" instead of "Merged."

4. **Collect results.** Wait for all agents in the wave to report "Ready to merge" or "Blocked."
   - If any agent reports "Blocked": pause, report to user.
   - If all report "Ready to merge": proceed to sequential merge.

5. **Sequential merge.** For each PR in the wave, in dependency order:
   ```
   SendMessage({
     to: "agent-{slug}",
     message: "Merge now. Rebase on main first: git fetch origin main && git rebase origin/main && git push --force-with-lease origin {BRANCH}. Then squash merge your PR and do cleanup.",
     summary: "Merge {ISSUE_ID}"
   })
   ```
   Wait for "Merged." before telling the next agent to merge.

6. **Sync main** after all wave PRs are merged:
   ```bash
   git checkout -B main origin/main
   ```

#### "Go implement" message template

```
SendMessage({
  to: "agent-{slug}",
  message: `Phase 2 — Implementation approved. Go implement.

  **CWD:** {WORKTREE_PATH}
  **Branch:** feat/{slug}
  **Plan:** {PLAN_FILE_PATH}
  **Merge strategy:** {PR required | direct push allowed}
  **Mode:** {sequential | parallel}

  Read ${CLAUDE_PLUGIN_ROOT}/skills/dev-epic/references/implementation-flow.md for the full
  implementation lifecycle, then execute it:

  1. cd {WORKTREE_PATH}
  2. Install deps (read AGENTS.md for install command), verify clean test baseline
  3. Read the plan and implement all tasks
  4. Invoke /simplify - fix findings, run tests, commit
  5. If UI changes (tsx/jsx/css in diff): invoke /design-critique if available, else skip
  6. If SIZE is M/L/XL: invoke /review on the branch, fix all findings, commit
     If SIZE is XS/S: run code scan (single sub-agent per implementation-flow.md)
  7. Run full test suite as final verification
  8. Push branch, create PR
  9. If Mode is "sequential": squash merge, cleanup, report "Merged. PR #{N}, sha {abc}, {N} files changed."
     If Mode is "parallel": STOP after PR creation, report "Ready to merge. {ISSUE_ID} PR #{N}, {N} files changed."

  **If blocked, send:**
  "Blocked: {reason}"`,
  summary: "Go implement {ISSUE_ID}"
})
```

### 4.4 Agent failure detection

<HARD-RULE>
API errors (429, 529, 5xx) can kill agents silently — they go idle without sending a result message. The orchestrator MUST detect this.
</HARD-RULE>

After sending "go implement", if the teammate goes idle **without** sending a result message ("Merged...", "Ready to merge...", or "Blocked..."):
- **First idle without result:** Send a status check ping: `SendMessage({ to: "agent-{slug}", message: "Status check — send your result or blocked reason" })`
- **Second idle without result:** Agent is dead. Implement directly in the orchestrator session or dispatch a fresh teammate with the same prompt (include the plan path so it can pick up where the dead agent left off).
- Log the failure in the state file for the retro.

### 4.5 Why layer-aware parallelism works

- **No simulator conflicts:** Only one mobile agent runs at a time. Mobile pre-push hooks (Metro, e2e smoke) never contend.
- **No test DB conflicts:** Only one API agent runs at a time. Rails test suites don't corrupt each other.
- **No merge conflicts:** Different layers touch different files. The sequential merge step handles any rare overlap.
- **Implementation is the bottleneck.** A typical M-sized sub-issue takes 15-30 min to implement but only 1-2 min to merge. Parallelizing implementation across layers saves one full sub-issue wall-time per parallel agent.
- **Combined teammates preserve context.** Same architecture as before — each teammate planned the sub-issue and resumes with full codebase context.
- **Orchestrator stays thin.** Only receives short "Ready to merge" messages. All implementation work happens in teammate contexts.

---

## Stage 5: Wrap-Up

After all sub-issues are merged.

### 5.1 Issue tracker update

<HARD-GATE>
If an issue tracker is available, you MUST update ALL issue statuses before proceeding to retro. Do not skip this step. Do not consider the epic complete without it.
</HARD-GATE>

1. **Verify all sub-issue statuses:** Check each sub-issue. If any are not "Done", update them now.
2. **Update parent issue:** Set parent issue to "Done". Comment with summary table (sub-issue | PR | commit).
3. **Announce:** Report the tracker update to the user: "Updated {N} issues to Done in {tracker}."

### 5.2 Retro

- What was smooth, what was hard
- Write to the learnings file (default: `learnings.md`, configurable) — max 3 lines each
- Flag AGENTS.md/CLAUDE.md updates if suggested by learnings

### 5.3 Cleanup

<HARD-RULE>
Every item in this checklist MUST be verified. Do not skip cleanup even if you believe artifacts were already removed. Stale artifacts from prior sessions may also be present.
</HARD-RULE>

**5.3.1 Shutdown teammates individually** (broadcast does not support structured messages):
```
for each remaining teammate name:
  SendMessage({ to: "{name}", message: { type: "shutdown_request", reason: "Epic complete" } })
```

Note: Teammates for fully-implemented sub-issues (0 tasks) should already have been shut down in Stage 4.0. Only teammates that performed implementation need shutdown here.

**5.3.2 Remove state files:**
```bash
# Remove this epic's state file
rm -f .pm/dev-sessions/epic-{parent-slug}.md

# Also scan for any OTHER stale state files from completed epics/sessions
for f in .pm/dev-sessions/*.md; do
  [ -f "$f" ] && echo "WARN: Found stale state file: $f" && rm -f "$f"
done

# Clean up any legacy state files at repo root
for f in .dev-epic-state-*.md .dev-state-*.md; do
  [ -f "$f" ] && echo "WARN: Removing legacy state file: $f" && rm -f "$f"
done
```

**5.3.3 Verify worktrees and branches:**
```bash
git worktree list   # Should only show main working tree
git branch          # Should only show main (and any unrelated branches)
git fetch --prune
```

If stale worktrees or branches from this epic remain, remove them:
```bash
git worktree remove .worktrees/{slug} 2>/dev/null || git worktree remove .worktrees/{slug} --force
git branch -D feat/{slug} 2>/dev/null || true
```

**5.3.4 Remove temporary artifacts:**
```bash
# Screenshots left by design-critique or QA agents
find . -maxdepth 2 -name "*.png" -newer .git/index -not -path "./node_modules/*" -not -path "./.git/*" | while read f; do
  git check-ignore -q "$f" 2>/dev/null || echo "WARN: untracked screenshot: $f"
done

# Agent-generated report directories
rm -rf .qa-reports/ .playwright-cli/ 2>/dev/null
```

**5.3.5 Verify clean git status:**
```bash
git status --short
```

If untracked files remain from agent work (screenshots, reports, temp files), either:
- Add them to `.gitignore` if they're a recurring pattern
- Delete them if one-off

Report any remaining untracked files to the user.

### 5.4 Final report

```
## Epic Complete

**Parent:** {ISSUE_ID} - [title]
**Sub-issues:** N completed, 0 failed

| # | Issue | Size | PR | Status |
|---|-------|------|----|--------|

**Learnings:** N entries added
```

---

## Critical Rules

1. NEVER implement without user approval of epic review (Stage 3.3)
2. NEVER skip `/review` before PR (M/L/XL)
3. NEVER skip code scan before auto-merge (XS/S)
4. NEVER use `--no-verify` on push
5. NEVER run two agents on the same layer concurrently (api+api, mobile+mobile, web+web)
6. Cross-layer sub-issues run alone — not in parallel with anything sharing their layers
7. Merges are always sequential, even when implementation is parallel
8. Fix ALL review findings from ALL active agents
9. Fresh test evidence before every merge
10. State file is single source of truth
11. Plans committed to main so sub-issue agent worktrees can read them
12. Orchestrator creates worktrees; agents work inside them
