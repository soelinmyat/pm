
# Subagent-Driven Development

Execute plan by dispatching fresh subagent per task, with two-stage review after each: spec compliance review first, then code quality review.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `subagent-dev`:
- run start / run end
- one step span for `dispatch-task`
- one step span for `spec-review`
- one step span for `quality-review`
- one step span for `final-review`

**Why subagents:** You delegate tasks to specialized agents with isolated context. By precisely crafting their instructions and context, you ensure they stay focused and succeed at their task. They should never inherit your session's context or history — you construct exactly what they need. This also preserves your own context for coordination work.

**Core principle:** Fresh subagent per task + two-stage review (spec then quality) = high quality, fast iteration

## When to Use

| Question | No | Yes |
|----------|----|-----|
| Have an implementation plan? | Brainstorm first or execute manually | Next question |
| Are tasks mostly independent? | Manual execution (tightly coupled) | Next question |
| Stay in this session? | Use executing-plans (parallel session) | Use subagent-driven-development |

**vs. Executing Plans (parallel session):**
- Same session (no context switch)
- Fresh subagent per task (no context pollution)
- Two-stage review after each task: spec compliance first, then code quality
- Faster iteration (no human-in-loop between tasks)

## The Process

**Setup:** Read plan, extract all tasks with full text, note context, create TodoWrite.

**Per task (repeat until all tasks complete):**

1. **Dispatch implementer** subagent with task spec (implementer-prompt.md)
2. If implementer asks questions → answer them, re-dispatch with context
3. Implementer **implements, tests, commits, self-reviews**
4. **Spec review** → dispatch spec reviewer subagent (subagent-spec-reviewer-prompt.md)
   - If spec gaps found → implementer fixes → re-review (loop until pass)
5. **Quality review** → dispatch code quality reviewer subagent (code-quality-reviewer-prompt.md)
   - If quality issues found → implementer fixes → re-review (loop until pass)
6. **Mark task complete** in TodoWrite

**After all tasks:** Dispatch final code reviewer for the entire implementation → dev orchestrator handles merge/PR.

## Layer-Aware Dispatch

Read layer constraints from the consuming project's AGENTS.md. Look for app directories, shared packages, and concurrency rules (e.g., shared test databases that prevent parallel access).

If AGENTS.md does not document layer constraints, assume all tasks must serialize (safe default).

**Rules:**
- Tasks touching the same layer MUST serialize
- Tasks on different layers CAN parallelize if AGENTS.md confirms independence
- Cross-layer tasks run alone unless AGENTS.md explicitly allows concurrency
- Every implementer prompt must include: explicit cwd, which app(s) to modify, test command for that app
- If AGENTS.md documents a contract sync command (e.g., codegen, type sync), it is required between backend and frontend tasks

**Implementer prompt additions:**
Always include in every implementer subagent prompt:
- `**CWD:** {worktree path}`
- `**Branch:** {feature branch name}`
- `**App:** {app path(s) from AGENTS.md or project structure}`
- `**Test command:** {app-specific test command from AGENTS.md}`
- `**Core rules:** {project-specific rules from AGENTS.md — e.g., token usage, codegen, locale requirements}`

**Git hygiene rules (include in every implementer prompt):**
```
Git rules — violations will break the pipeline:
- NEVER use `git add -A` or `git add .` — always stage specific files by name
- NEVER commit to main — you should be on branch {branch}. Verify: `git branch --show-current`
- NEVER commit without running tests first: {test command}
- Commit often, commit small — one logical change per commit
- If you see untracked files you didn't create, leave them alone
- Before your first commit, verify: `git rev-parse --show-toplevel` matches {worktree path}
```

## Model Selection

Use `model: "opus"` for all subagent dispatches. This is a project requirement.

## Handling Implementer Status

Implementer subagents report one of four statuses. Handle each appropriately:

**DONE:** Proceed to spec compliance review.

**DONE_WITH_CONCERNS:** The implementer completed the work but flagged doubts. Read the concerns before proceeding. If the concerns are about correctness or scope, address them before review. If they're observations (e.g., "this file is getting large"), note them and proceed to review.

**NEEDS_CONTEXT:** The implementer needs information that wasn't provided. Provide the missing context and re-dispatch.

**BLOCKED:** The implementer cannot complete the task. Assess the blocker:
1. If it's a context problem, provide more context and re-dispatch with the same model
2. If the task requires more reasoning, re-dispatch with a more capable model
3. If the task is too large, break it into smaller pieces
4. If the plan itself is wrong, escalate to the human

**Never** ignore an escalation or force the same model to retry without changes. If the implementer said it's stuck, something needs to change.

## Prompt Templates

- `implementer-prompt.md` (in this directory) - Dispatch implementer subagent
- `subagent-spec-reviewer-prompt.md` (in this directory) - Dispatch spec compliance reviewer subagent
- `code-quality-reviewer-prompt.md` (in this directory) - Dispatch code quality reviewer subagent

## Example Workflow

```
You: I'm using Subagent-Driven Development to execute this plan.

[Read RFC file once: {pm_dir}/backlog/rfcs/feature-plan.html]
[Extract all 5 tasks with full text and context]
[Create TodoWrite with all tasks]

Task 1: Hook installation script

[Get Task 1 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

Implementer: "Before I begin - should the hook be installed at user or system level?"

You: "User level (~/.config/superpowers/hooks/)"

Implementer: "Got it. Implementing now..."
[Later] Implementer:
  - Implemented install-hook command
  - Added tests, 5/5 passing
  - Self-review: Found I missed --force flag, added it
  - Committed

[Dispatch spec compliance reviewer]
Spec reviewer: ✅ Spec compliant - all requirements met, nothing extra

[Get git SHAs, dispatch code quality reviewer]
Code reviewer: Strengths: Good test coverage, clean. Issues: None. Approved.

[Mark Task 1 complete]

Task 2: Recovery modes

[Get Task 2 text and context (already extracted)]
[Dispatch implementation subagent with full task text + context]

Implementer: [No questions, proceeds]
Implementer:
  - Added verify/repair modes
  - 8/8 tests passing
  - Self-review: All good
  - Committed

[Dispatch spec compliance reviewer]
Spec reviewer: ❌ Issues:
  - Missing: Progress reporting (spec says "report every 100 items")
  - Extra: Added --json flag (not requested)

[Implementer fixes issues]
Implementer: Removed --json flag, added progress reporting

[Spec reviewer reviews again]
Spec reviewer: ✅ Spec compliant now

[Dispatch code quality reviewer]
Code reviewer: Strengths: Solid. Issues (Important): Magic number (100)

[Implementer fixes]
Implementer: Extracted PROGRESS_INTERVAL constant

[Code reviewer reviews again]
Code reviewer: ✅ Approved

[Mark Task 2 complete]

...

[After all tasks]
[Dispatch final code-reviewer]
Final reviewer: All requirements met, ready to merge

Done!
```

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)
- Subagent can ask questions (before AND during work)

**vs. Executing Plans:**
- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Efficiency gains:**
- No file reading overhead (controller provides full text)
- Controller curates exactly what context is needed
- Subagent gets complete information upfront
- Questions surfaced before work begins (not after)

**Quality gates:**
- Self-review catches issues before handoff
- Two-stage review: spec compliance, then code quality
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building
- Code quality ensures implementation is well-built

**Cost:**
- More subagent invocations (implementer + 2 reviewers per task)
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)

## Red Flags

**Never:**
- Start implementation on main/master branch without explicit user consent
- Skip reviews (spec compliance OR code quality)
- Proceed with unfixed issues
- Dispatch multiple implementation subagents in parallel (conflicts)
- Make subagent read plan file (provide full text instead)
- Skip scene-setting context (subagent needs to understand where task fits)
- Ignore subagent questions (answer before letting them proceed)
- Accept "close enough" on spec compliance (spec reviewer found issues = not done)
- Skip review loops (reviewer found issues = implementer fixes = review again)
- Let implementer self-review replace actual review (both are needed)
- **Start code quality review before spec compliance is ✅** (wrong order)
- Move to next task while either review has open issues
- Skip contract sync (if documented in AGENTS.md) after cross-layer changes
- Violate project-specific coding rules documented in AGENTS.md (token usage, codegen, etc.)

**If subagent asks questions:**
- Answer clearly and completely
- Provide additional context if needed
- Don't rush them into implementation

**If reviewer finds issues:**
- Implementer (same subagent) fixes them
- Reviewer reviews again
- Repeat until approved
- Don't skip the re-review

**If subagent fails task:**
- Dispatch fix subagent with specific instructions
- Don't try to fix manually (context pollution)

## Integration

**Required references (all bundled in dev plugin):**
- **writing-rfcs.md** (in this directory) - Creates the plan this skill executes
- **tdd.md** (in this directory) - Subagents follow TDD for each task

**Handled by dev orchestrator (not invoked separately):**
- Workspace setup (dev Stage 2)
- Code review (dev `/review` skill)
- Branch finishing / merge / PR (dev Stage 7+)
