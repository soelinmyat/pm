# Bug Fix Flow (Batch Cycle Triage)

This reference is loaded on-demand by the dev skill router when handling batch bug resolution from a cycle.

---

# /bug-fix [cycle-name]

Fetch all bugs from a cycle, investigate in parallel, get user approval, fix via sub-agents, update tracker.

**Context budget:** This skill handles 30+ bugs without overflowing. Investigation AND fixes both run in sub-agents. The main context only sees summaries.

---

## Step 1: Fetch Bugs

**If issue tracker detected** (see `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md`):
If `$ARGUMENTS` contains a cycle name, use that. Otherwise, fetch the current cycle. List all issues labeled "Bug". Extract: issue ID, title, description, assignee.

**If no issue tracker available:**
Accept a manual bug list from the user. Format: markdown with titles and descriptions.

If no bugs found, report "No bugs in this cycle" and stop.

---

## Step 2: Parallel Investigation

Build project context per `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md`. Build the `{PROJECT_CONTEXT}` block.

Spawn investigation agents in batches of 10 (or fewer if less than 10 bugs). Each agent: `subagent_type: general-purpose, model: opus`.

Wait for each batch to complete before spawning the next (avoids resource contention).

Each agent prompt:

```
You are investigating a bug report.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Issue:** {issue_id} - {title}
**Description:** {description}

**Instructions:**
1. Read the issue description carefully
2. Search the codebase (Grep/Read/Glob) for the relevant code
3. Determine: Is this a real bug, a misunderstanding, already fixed, or not reproducible?
4. If real: identify root cause, affected files, and proposed fix
5. If not a bug: explain why with evidence from the code

**Return ONLY this compact JSON (no prose, no explanation):**
{
  "id": "{ISSUE_ID}",
  "title": "...",
  "verdict": "real_bug | not_a_bug | already_fixed | needs_info",
  "confidence": "high | medium | low",
  "root_cause": "one sentence max",
  "files": ["path/to/file.ts"],
  "fix": "one sentence max"
}
```

**Important:** Instruct agents to return ONLY the JSON. No preamble, no explanation.

---

## Step 3: User Review (HARD GATE)

Collect all agent results. Present a formatted table:

```
## Bug Triage Results (N bugs)

| # | Issue | Verdict | Confidence | Root Cause | Proposed Action |
|---|-------|---------|------------|------------|-----------------|
| 1 | ISSUE-001: title | real_bug | high | ... | Fix: ... |
| 2 | ISSUE-002: title | not_a_bug | high | ... | Cancel |
| 3 | ISSUE-003: title | needs_info | low | ... | Skip |

Approve this triage? You can override any verdict before I proceed.
```

**Do NOT proceed until the user explicitly approves.**

---

## Step 4: Sequential Fix Agents

**Each approved bug gets its own sub-agent** (`subagent_type: general-purpose, model: opus`). Run them **sequentially** (one at a time) to prevent git conflicts.

For each approved bug:

```
You are fixing a bug.

## Project Context (pre-extracted by orchestrator)

{PROJECT_CONTEXT}

**Issue:** {issue_id} - {title}
**Root cause:** {root_cause from investigation}
**Affected files:** {files from investigation}
**Proposed fix:** {fix from investigation}

**Instructions:**
1. Read the affected files to understand the current code
2. Write a failing test that reproduces the bug
3. Implement the minimal fix
4. Run tests (use the test command from Project Context)
5. If tests fail, fix the regression
6. Stage ONLY the files you changed and commit:
   `git add [specific files] && git commit -m "fix({issue_id}): [description]"`

**Return ONLY this compact JSON:**
{
  "id": "{ISSUE_ID}",
  "status": "fixed | failed",
  "commit_sha": "abc1234 (or null if failed)",
  "files_changed": ["path/to/file.ts"],
  "test_command": "the test command you ran",
  "failure_reason": "null or why it failed"
}
```

After each fix agent completes: log the result (one line). If "failed", note for final report but continue.

---

## Step 5: Simplify

After all bugs are fixed and committed, invoke `/simplify` if:
- 3+ bugs were fixed AND
- `/simplify` is available (check existence, skip gracefully if not)

Fix findings, run tests, commit separately from bug fix commits.

---

## Step 6: Update Tracker

After all fixes are committed:

**If issue tracker available:**
1. **Real bugs that were fixed:** Update issue to "Done" with comment: "Fixed in [commit SHA]. Root cause: [brief]."
2. **Not-a-bug / already-fixed:** Update issue to "Canceled" with comment explaining why.
3. **needs_info:** Leave as-is, add comment with what information is needed.

**If no tracker:** Log results to console.

Push all commits: `git push` (use `timeout: 600000` — pre-push hooks can take 5-10 min)

---

## Step 7: Final Report

```
## Bug Fix Complete

**Cycle:** [name]
**Investigated:** N bugs
**Fixed:** X (list with commit SHAs)
**Failed:** F (list with reasons)
**Canceled:** Y (list with reasons)
**Skipped:** Z (needs info)
```

---

## Critical Rules

- NEVER fix bugs without user approval (Step 3 is a hard gate)
- NEVER mark issues as Done vs Canceled without user confirmation
- Respect the project's branch/PR policy: if the repo requires PRs (check CLAUDE.md, AGENTS.md, or branch protection), create a branch and PR. Otherwise fix on main directly.
- One sub-agent per bug fix, run sequentially to avoid git conflicts
- One commit per bug fix for clean git history
- ALWAYS run `/simplify` after fixes before pushing (Step 5), unless fewer than 3 fixes
- NEVER use `--no-verify` on push
- Keep main context lean: only store compact JSON results from agents

---

## State File

Bug-fix sessions create a lightweight state file for resume detection:

**Path:** `.pm/dev-sessions/bugfix-{cycle-slug}.md`

**Created at:** Step 1 (after fetching bugs)
**Deleted at:** After final report

```markdown
# Bug Fix Session State

| Field | Value |
|-------|-------|
| Stage | investigating / reviewing / fixing / updating-tracker |
| Cycle | {cycle-name} |
| Bugs | {total count} |
| Approved | {count or "pending"} |
| Fixed | {count} |
| Failed | {count} |

## Resume Instructions
- Next action: {next step}
- Bugs remaining: {list of IDs not yet fixed}
```
