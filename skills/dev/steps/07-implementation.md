---
name: Implementation
order: 7
description: Dispatch fresh developer agents to implement the approved RFC
---

## Implementation

Dispatch **fresh** @developer agent(s) using the runtime adapter. Whether resuming from a prior session or continuing from RFC Review, the flow is the same — the RFC is the contract and contains all codebase exploration findings needed for implementation.

**Implementation methodology:** All implementation agents use `pm:tdd` (inside-out TDD) and `pm:subagent-dev` for task execution. The implementation-flow.md reference defines the full lifecycle.

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
After the user approves the plan at the end of RFC Review, the developer agent proceeds through ALL remaining stages without pausing for user input. No "Ready to execute?" prompts, no confirmation dialogs, no options menus.

The rationale: by this point, the spec has been reviewed by product/design agents, the plan has been reviewed by engineering agents, and the user has explicitly approved. The plan is the contract. Execute it.

**Only stop for:**
- QA verdict of **Fail** (fix issues, re-run QA, then continue)
- QA verdict of **Blocked** (ask user for guidance)
- Test failures that can't be resolved after 3 attempts
- Merge conflicts
- CI failures that require human intervention
- Review feedback from human reviewers on the PR (use `review/references/handling-feedback.md`)
</HARD-RULE>

### Agent lifecycle

```
Fresh developer agent dispatched (RFC Generation)
  → explores codebase, writes RFC, commits
  → returns RFC_COMPLETE summary (includes task_count)

Orchestrator runs RFC review (RFC Review)
  → standard + cross-cutting reviewers (if multi-task)
  → fixes blocking issues in RFC
  → user approves

Single-task: Fresh developer agent dispatched (Implementation)
  → reads approved RFC
  → implements → simplify → design critique → QA → review → merge → cleanup
  → returns "Merged. PR #{N}, sha {abc}, {N} files changed."

Multi-task: For each task in order, fresh developer agent dispatched (Implementation)
  → reads approved RFC, focuses on assigned Issue section
  → implements → simplify → design critique → QA → review → merge → cleanup
  → returns "Merged. {ISSUE_ID} PR #{N}" or "Blocked: {reason}"
  → orchestrator checkpoints, syncs main, dispatches next
```
