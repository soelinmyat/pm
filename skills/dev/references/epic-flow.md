# Epic Flow (Multi-Issue Orchestration)

This reference is loaded on-demand by the dev skill router when handling a parent issue with multiple sub-issues.

---

# /dev-epic [parent-issue-id]

Orchestrate an entire epic from a parent issue. The orchestrator stays **thin**: it manages state and dispatches fresh agents for planning and implementation. One RFC covers the entire epic — sub-issues are Issue sections within it, matching the standard RFC template.

**Architecture:**
- **Orchestrator (this context):** Intake, state management, result tracking
- **Planning agent:** One fresh agent writes the RFC for the entire epic. Explores codebase, writes a single RFC with all sub-issues as Issue sections, commits, returns summary, terminates.
- **Epic review agents:** 1-3 short-lived review agents reviewing the RFC as a whole. Return compact JSON verdicts directly.
- **Implementation agents:** One fresh agent per sub-issue. Reads the approved parent RFC (their issue section), implements, merges, terminates.

**Agent lifecycle:**
1. Orchestrator initializes the state file with one slot per sub-issue
2. **Planning phase:** Dispatch one fresh agent that writes the parent-level RFC containing all sub-issues as Issue sections. Returns summary, terminates.
3. **Epic review:** Orchestrator dispatches short-lived review agents — compact JSON comes back directly
4. **Implementation phase:** For each sub-issue in dependency order, dispatch a fresh agent. Agent reads the parent RFC, implements its Issue section, merges, terminates. Next sub-issue starts.

**Reference files (read on-demand, NOT upfront):**
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-rfc-reviewer-prompts.md` - RFC reviewer prompts (Stage 2 raw specs, Stage 3 epic review)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-review-prompts.md` - Epic review prompts (Stage 3)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md` - Sub-issue implementation instructions (Stage 4)
- `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-state-template.md` - State file template

**Runtime mapping:** Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/agent-runtime.md` before dispatching agents.

Use these agent intents consistently:
- Planning and implementation agent: `pm:developer`
- Epic review agents: the reviewer intents referenced in Stage 3

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

## Stage 0: Preflight Check

Run before any epic work begins. Takes ~30 seconds, prevents hours of wasted work.

```bash
# 1. Git state — must be clean
git status --porcelain
# If output is non-empty: STOP. List dirty files, ask user to resolve.

# 2. Branch — should be on main with latest
git branch --show-current  # Should be main
git fetch origin
git log HEAD..origin/main --oneline  # Should be empty (up to date)
# If behind: run `git pull --ff-only origin main`

# 3. Stale worktrees — from prior failed epics
git worktree list
# If worktrees other than main exist: list them, ask user whether to remove

# 4. GitHub CLI — needed for PRs
command -v gh >/dev/null 2>&1
# If missing: STOP, tell user to install from https://cli.github.com
gh auth status 2>&1
# If not authenticated: STOP, tell user to run `gh auth login`

# 5. Stale state files — from prior sessions
ls .pm/dev-sessions/epic-*.md 2>/dev/null
# If found: list with last-modified date, ask user whether to resume or discard
```

If any check fails, report all issues together (don't stop at the first one) and ask the user to resolve before proceeding.

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

Read `learnings.md` at repo root. Surface relevant entries. Skip if file doesn't exist.

### 1.6 Write initial state

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-state-template.md` for the template. Write `.pm/dev-sessions/epic-{parent-slug}.md` (run `mkdir -p .pm/dev-sessions` first).

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
- After Stage 5 (wrap-up) completes: final report

In autonomous mode (after Stage 3.3 approval), do NOT pause for confirmation. Announce and proceed.
</HARD-RULE>

---

## Stage 2: Planning (one RFC for the epic)

No user interaction. One planning agent writes the entire RFC.

**Before dispatching:** Run context discovery per `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md` if not already in `.pm/dev-sessions/epic-{parent-slug}.md`. Build the `{PROJECT_CONTEXT}` block.

### 2.1 Pre-planning: Raw sub-issue specs

Before the main RFC, handle any raw M/L/XL sub-issues that need design exploration:

**Raw XS:** Note "direct implementation, no plan needed" in state file. Include in the RFC as an XS issue with minimal approach section.

**Raw S/M/L/XL that are NOT groomed:** Dispatch a short-lived design worker per raw sub-issue to generate a spec:

```
Design exploration for {ISSUE_ID} ({ISSUE_TITLE}).

## Project Context
{PROJECT_CONTEXT}

**CWD:** {REPO_ROOT}
**Sub-issue description:**
{ISSUE_DESCRIPTION}

**Parent issue context:**
{PARENT_TITLE}: {PARENT_DESCRIPTION_SUMMARY}

Follow ${CLAUDE_PLUGIN_ROOT}/skills/groom/phases/phase-5-design.md.
Save spec to docs/specs/{DATE}-{SLUG}.md.
Commit, then end your response with:
SPEC_COMPLETE
- issue: {ISSUE_ID}
- path: docs/specs/{file}
- summary: {2-line summary}
```

For raw M/L/XL specs, dispatch spec reviewers (UX, Product, Competitive) from `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-rfc-reviewer-prompts.md`. Fix blocking issues, commit.

Groomed sub-issues skip this step — their proposal is sufficient context.

### 2.2 Generate the parent RFC

Dispatch a **single fresh agent** using agent intent `pm:developer`. This agent writes ONE RFC covering the entire epic. Each sub-issue becomes an Issue section within the RFC, matching the standard RFC template structure.

Before dispatching, follow the runtime setup rules in `agent-runtime.md`.

**Prompt for the planning agent:**

```
Phase 1 — Generate engineering RFC for epic: {PARENT_ISSUE_ID} ({PARENT_TITLE}).

## Project Context
{PROJECT_CONTEXT}

**CWD:** {REPO_ROOT}

**Epic description:**
{PARENT_DESCRIPTION}

**Sub-issues (each becomes an Issue section in the RFC):**
{FOR_EACH_SUB_ISSUE:}
  - {ISSUE_ID}: {ISSUE_TITLE} (size: {SIZE}, groomed: {yes/no})
    Description: {ISSUE_DESCRIPTION}
    ACs: {ACCEPTANCE_CRITERIA}
    Spec: {SPEC_PATH or "from proposal ACs"}
{END_FOR_EACH}

**Dependency order:** {ORDERED_LIST_FROM_STAGE_1.4}

**Proposal (if groomed):** pm/backlog/{parent-slug}.md
**PRD (if exists):** pm/backlog/proposals/{parent-slug}.html

Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-reference.html for the HTML structure and styling to replicate.
Read ${CLAUDE_PLUGIN_ROOT}/references/templates/rfc-template.md for section content guidance.
Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/writing-rfcs.md for writing conventions.

Write ONE RFC as a self-contained HTML file to pm/backlog/rfcs/{parent-slug}.html.
Each sub-issue is an Issue section within the RFC (Issue 1, Issue 2, etc.).
Include shared architecture, data model, and risks that span sub-issues.

Commit the RFC, then end your response with:
RFC_COMPLETE
- slug: {parent-slug}
- path: pm/backlog/rfcs/{parent-slug}.html
- summary: {3-line summary}
- issues: {N}

Stop after sending the summary. Separate agents will handle implementation after epic review.
```

The orchestrator waits for the agent to return. Only the `RFC_COMPLETE` payload enters the orchestrator's context.

### 2.3 Size reconciliation

After the RFC agent returns, check if any sub-issue's task count in the RFC suggests a different size than the intake classification. Update sizes in `.pm/dev-sessions/epic-{parent-slug}.md`. This matters because size determines the review path in Stage 4 (code scan for XS/S vs full `/review` for M/L/XL).

### 2.4 State and backlog updates

After the RFC agent returns:

1. Update `.pm/dev-sessions/epic-{parent-slug}.md` with RFC path and commit SHA.
2. **Update the parent backlog item.** If `pm/backlog/{parent-slug}.md` exists, set `rfc: rfcs/{parent-slug}.html` in its frontmatter. This is a single value — the parent RFC contains all sub-issues as Issue sections. This keeps the RFC link in the committed knowledge base, not just the gitignored session state.

---

## Stage 3: Epic Review (via reviewers)

After all plans are committed. Runs automatically.

**Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/epic-review-prompts.md`** for the agent prompts.

### 3.0 Scale review to remaining work

Count sub-issues with actual code work (plan reports tasks > 0). Scale reviewer count:

| Sub-issues with code work | Reviewers | Rationale |
|---------------------------|-----------|-----------|
| 0 | Skip Stage 3 entirely | Nothing to review — all already implemented |
| 1-2 | 1 combined reviewer | Single agent reviews arch + integration + scope |
| 3+ | 3 parallel reviewers | Full review: arch, integration, scope |

### 3.1 Dispatch short-lived review agents

Epic reviewers return compact JSON (~10 lines each) — this fits fine in the orchestrator's context. Use short-lived review agents. Their results return directly to the orchestrator.

**For 3+ sub-issues with code work:** Dispatch all 3 reviewer intents in parallel using the runtime adapter:
- `pm:system-architect` with the architecture prompt from `epic-rfc-reviewer-prompts.md`
- `pm:integration-engineer` with the integration prompt from `epic-rfc-reviewer-prompts.md`
- `pm:product-manager` with the scope prompt from `epic-rfc-reviewer-prompts.md`

**For 1-2 sub-issues with code work:** Dispatch 1 combined reviewer intent using the runtime adapter:
- `pm:system-architect` with `Combined review: architecture + integration + scope. {COMBINED_PROMPT}`

Reviewer results return directly to the orchestrator — no worker handoff needed.

### 3.2 Handling findings

1. Receive reviewer outputs from all active review agents. Merge. Deduplicate.
2. Fix all blocking issues in affected plans.
3. Re-dispatch if fixes made (max 3 iterations).
4. Commit plan updates.

### 3.3 Present to user (LAST INTERACTIVE GATE)

The RFC was already written as HTML by the planning agent in Stage 2.2. Open it in the browser:

```bash
open pm/backlog/rfcs/{parent-slug}.html
```

Show the verdict table (reviewer findings summary). The RFC contains all sub-issues as Issue sections — the user reviews the whole plan in one document.

Ask: "Approve to begin one-shot implementation through to merge?"

After approval, update state file with `Continuous execution: authorized`.

---

## Stage 4: Sequential Implementation (via fresh agents)

<HARD-RULE>
After approval, proceed through ALL sub-issues without pausing. Only stop for: QA Blocked, 3x test failures, merge conflicts, CI failures needing human intervention, human review feedback on PRs.
</HARD-RULE>

**Agent dispatch:** Each sub-issue gets a fresh `pm:developer` agent for implementation. The agent reads the approved parent RFC and focuses on its Issue section. Sub-issues execute sequentially in dependency order — one at a time.

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

If a plan reported 0 tasks (all ACs already implemented with tests), mark the sub-issue as "Already implemented" in the state file and skip to the next one.

### 4.1 Sequential execution

For each sub-issue in dependency order:

1. **Create worktree:**
   ```bash
   git worktree add .worktrees/{slug} -b feat/{slug} origin/{DEFAULT_BRANCH}
   ```

2. **Set issue status** to In Progress (if tracker available).

3. **Dispatch fresh `pm:developer` agent** with this implementation brief:

```
Phase 2 — Implementation approved. Go implement.

**CWD:** {WORKTREE_PATH}
**Branch:** feat/{slug}
**RFC:** pm/backlog/rfcs/{parent-slug}.html
**Your issue:** Issue {N} — {ISSUE_TITLE}
**DEFAULT_BRANCH:** {DEFAULT_BRANCH}

Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/references/implementation-flow.md for the full
implementation lifecycle, then execute it.

Read the RFC. Focus on Issue {N} ({ISSUE_TITLE}) — that is your scope. The RFC also
contains shared architecture and data model sections that apply to your issue.

Lifecycle:
1. cd {WORKTREE_PATH}
2. Install deps (read AGENTS.md for install command), verify clean test baseline
3. Read the RFC, focus on Issue {N}, implement its tasks
4. Invoke pm:simplify - fix findings, run tests, commit
5. If UI changes (tsx/jsx/css in diff): invoke /design-critique if available, else skip
6. If SIZE is M/L/XL: invoke /review on the branch, fix all findings, commit
   If SIZE is XS/S: run code scan (single reviewer per implementation-flow.md)
7. Run full test suite as final verification
8. Push branch, create PR, squash merge via merge-loop, cleanup worktree and branch
9. Report: "Merged. {ISSUE_ID} PR #{N}, sha {abc}, {N} files changed."

If blocked, reply:
Blocked: {ISSUE_ID} — {reason}
```

4. **Wait for agent to return** "Merged" or "Blocked."

5. **Update state file** (see 4.2 Checkpoint).

6. **Sync main** before the next sub-issue:
   ```bash
   git checkout -B {DEFAULT_BRANCH} origin/{DEFAULT_BRANCH}
   ```

7. Proceed to next sub-issue.

### 4.2 Checkpoint after each sub-issue

<HARD-RULE>
After each sub-issue is merged (or fails), update the state file IMMEDIATELY. Do not batch updates. A crash between sub-issues must not lose progress.
</HARD-RULE>

After an agent reports "Merged" or "Blocked":
1. Update the sub-issue row in `## Sub-Issues` table: status, PR number, commit SHA
2. Update `## Implementation Progress` with the result
3. Update `## Resume Instructions` with the next sub-issue
4. Write the state file to disk before dispatching the next agent

On resume (session crash/restart): read the state file, skip sub-issues marked "Merged", restart from the first non-merged sub-issue.

### 4.3 Agent failure recovery

If an implementation agent fails (API error, timeout):

1. Check git state in the worktree: `git log --oneline -5`, `git status`, `git diff --stat`
2. Update state file with failure
3. Dispatch a fresh recovery agent with the RFC path, git state, and instruction to continue from where the previous agent left off
4. Max 3 total attempts per sub-issue. After 3 failures, mark as "Failed" and continue to next.

Track retry count per sub-issue in the state file.

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

### 5.1b Knowledge base update

After all sub-issues are merged and tracker is updated:

1. **Backlog items:** For each sub-issue, if `pm/backlog/{slug}.md` exists, update frontmatter `status` to `done` and `updated` to today's date.

2. **Parent backlog item:** If `pm/backlog/{parent-slug}.md` exists, update its `status` to `done`.

3. **Proposal status:** Proposals have two status fields — `verdict` (grooming outcome, owned by groom) and `status` (implementation lifecycle, owned by dev). **Never overwrite `verdict` or `verdictLabel`.**

   If `pm/backlog/proposals/{parent-slug}.meta.json` exists, set `"status": "shipped"`. If the proposal slug differs from the parent slug, also check child backlog items' `parent` fields to find the matching proposal and update it.

### 5.2 Retro

- What was smooth, what was hard
- Write to the learnings file (default: `learnings.md`, configurable) — max 3 lines each
- Flag AGENTS.md/CLAUDE.md updates if suggested by learnings

### 5.3 Cleanup

<HARD-RULE>
Every item in this checklist MUST be verified. Do not skip cleanup even if you believe artifacts were already removed. Stale artifacts from prior sessions may also be present.
</HARD-RULE>

**5.3.0 Shut down all workers and delete the team:**

Send `shutdown_request` to every teammate still active (planning workers, review workers, implementation workers). Wait up to 10 seconds for each to acknowledge. If a worker does not respond to shutdown after 2 attempts, move on — it will time out on its own.

After all workers are terminated (or non-responsive ones abandoned), delete the team:

```
TeamDelete()
```

If `TeamDelete` fails because a worker is stuck, remove the team files manually:
```bash
rm -rf ~/.claude/teams/{team-name} ~/.claude/tasks/{team-name}
```

Do NOT skip this step. Leftover teams clutter the UI and confuse subsequent sessions.

**5.3.1 Remove this epic's state file:**
```bash
rm -f .pm/dev-sessions/epic-{parent-slug}.md
```

Do NOT delete other state files — they may belong to concurrent sessions.

**5.3.2 Verify worktrees and branches:**
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

**5.3.3 Remove temporary artifacts:**
```bash
# Screenshots left by design-critique or QA agents
find . -maxdepth 2 -name "*.png" -newer .git/index -not -path "./node_modules/*" -not -path "./.git/*" | while read f; do
  git check-ignore -q "$f" 2>/dev/null || echo "WARN: untracked screenshot: $f"
done

# Agent-generated report directories
rm -rf .qa-reports/ .playwright-cli/ 2>/dev/null
```

**5.3.4 Verify clean git status:**
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
5. Fix ALL review findings from ALL active agents
6. Fresh test evidence before every merge
7. State file is single source of truth
8. Parent RFC committed to main so sub-issue agent worktrees can read it
9. Orchestrator creates worktrees; agents work inside them
