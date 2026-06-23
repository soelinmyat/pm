# PM Loop Engineering Proposal

Date: 2026-06-23
Status: research proposal
Scope: evolve the PM plugin toward loop-based AI-assisted product and development workflows.

## Executive Summary

Loop engineering is the shift from manually prompting an agent for each step to designing a durable system that periodically or eventfully prompts agents, observes outcomes, records state, and decides the next action. For PM, this should not mean replacing the current skills. It should mean adding a loop layer above them.

The PM plugin already has most of the right primitives:

- Durable backlog artifacts in `pm/backlog/`.
- Runtime session state in `.pm/*-sessions/`.
- Skill-level workflows for capture, research, groom, RFC, dev, simplify, review, ship, and sync.
- Subprocess dispatch for long-running implementation agents in `scripts/dispatch-issue.sh`.
- Resume and telemetry scripts such as `scripts/start-status.js`, `scripts/pm-log.js`, and `scripts/state-telemetry.js`.

The missing layer is a small, explicit loop runtime:

1. A Kanban-like board derived from existing PM artifacts.
2. A scheduler-friendly `wake` command that can claim one eligible card.
3. Worker contracts that map each stage to one PM skill or external agent.
4. Leases, retry budgets, run logs, cost limits, and human escalation rules.
5. Optional adapters for OpenClaw cron, launchd, GitHub Actions, Codex, Claude Code, and Linear/GitHub events.

Recommendation: build this incrementally. Start with `pm:loop status` and `pm:loop wake --dry-run`, then automate only low-risk loops: PR babysitting, stale-session recovery, and bug/task queue triage. Do not begin with full autonomous product grooming or merge-to-main behavior.

## Research Findings

### What "Loop Engineering" Means

The term is current and still settling. Across recent sources, the common definition is not "better prompts"; it is a recurring system around an agent:

- Addy Osmani describes loop engineering as designing the system that prompts the agent, with five practical building blocks: automations, worktrees, skills, plugins/connectors, and sub-agents.
- LangChain frames loop engineering as levels of agent harnessing: basic prompt loops, verification loops, event-driven loops, then hill-climbing loops that analyze traces and improve the harness.
- Kilo and MindStudio describe the operational loop as intent, context, action, observation, and adjustment until a task is complete or blocked.
- The ReAct and Reflexion research lines are older foundations: agents improve when reasoning/action is interleaved with environmental feedback, and when feedback is recorded as memory for later attempts.

For PM, the important takeaway is that a loop is a workflow control system. The model is only one component.

### Industry Direction

The mainstream direction is toward agent mission control, not single-shot chat:

- GitHub Agent HQ positions issues, PRs, branches, code review, CI, and agent identity as the native control plane for multiple agents.
- OpenAI Codex GitHub integration starts cloud tasks from PR comments and can act on review findings with PR context.
- Claude Code GitHub Actions supports issue/PR mentions and custom automation workflows on GitHub runners.
- LangGraph emphasizes long-running, stateful agent orchestration with persistence and human-in-the-loop interruption.
- Temporal emphasizes durable execution for long-running AI workflows, including replaying decisions after crashes instead of starting from scratch.

The PM plugin should not try to become Temporal or GitHub. It should provide product-development-specific loop semantics on top of the user's existing tools.

### Core Design Implications

1. State beats chat history. A loop must recover from process death, context compaction, and scheduler restarts.
2. Work must be leased. Periodic wake-ups can overlap; without leases, agents duplicate effort.
3. Progress in-flight work first. The OpenClaw bug agent prioritizes open PR babysitting before picking new Linear issues. PM should copy that.
4. One unit per run. A scheduled agent should usually claim one card or one small batch, then stop.
5. Verification is part of the loop, not a final courtesy. Tests, CI, review comments, screenshots, and product acceptance gates must feed the next run.
6. Human gates must be explicit. Ambiguous product decisions, risky merge behavior, credentials, destructive commands, and weak reproduction steps should park the card, not trigger retries.
7. Token and time budgets are first-class. Loops can become expensive because each wake-up rehydrates context and may spawn sub-agents.
8. Ledgers prevent drift. Review logs, area logs, run logs, and "last reviewed through commit" markers are more reliable than hoping the agent remembers.

## Local OpenClaw Prior Art

I inspected `/Users/soelinmyat/Projects/openclaw`, host LaunchAgents, the running OpenClaw VM at `192.168.64.2`, and the bug-agent workspace in `~/.openclaw/workspace-bug`.

### Host Infrastructure

The host has:

- `com.soelinmyat.openclaw.vm.plist`: launchd `KeepAlive` runner for `lume run openclaw --no-display`.
- `com.trycua.lume.openclaw.plist`: 30-second watchdog that checks Lume's API and starts the VM if stopped.
- `ai.openclaw.ssh-tunnel.plist`: persistent SSH tunnel for gateway ports `18789` and `18791`.
- `ai.openclaw.backup.plist`: daily backup of VM-side `~/.openclaw/` data.
- `/Users/soelinmyat/Projects/openclaw/rrqs_daily/`: a scheduled daily report flow with wrapper script, ledger, delayed grading, and Telegram delivery.

This is a pragmatic pattern: keep the runtime boring and external to the agent. The scheduler is dumb; the agent instructions and state are smart.

### OpenClaw Cron Shape

The VM has OpenClaw cron jobs stored under `~/.openclaw/cron/`, with job definitions, job state, and JSONL run logs. Current jobs include:

- Hourly `bug-linear-poll`.
- 4-hour `bug-code-review`.
- 4-hour `bug-ui-review`.
- 2-hour `bug-pr-babysitter`.
- Daily GTM/research/reporting jobs.
- Daily RRQS investment report.

Each job records:

- `agentId`
- `sessionKey`
- `sessionTarget`
- schedule
- payload message
- timeout
- delivery route
- `nextRunAtMs`
- `lastRunAtMs`
- `lastRunStatus`
- `lastDurationMs`
- `consecutiveErrors`
- run history with summaries and token usage

PM needs this same metadata, but in a portable form that can run under OpenClaw, cron, launchd, GitHub Actions, or a manual `pm:loop wake`.

### CleanLog Bug Agent Pattern

The bug agent is the strongest local example. It has five intake paths:

- Telegram reported bug.
- Hourly Linear bug poll.
- Scheduled proactive code review.
- Scheduled UI consistency review.
- Scheduled PR babysitter.

Important practices to copy:

- Progress existing PRs before new work.
- Pull one new Todo issue per poll.
- Move vague issues to Triage and ask humans instead of guessing.
- Use TDD for fixes.
- Keep fixes minimal.
- Require two merge gates: CI green and Codex review threads resolved.
- Use a dedicated babysitter loop for stuck PRs.
- Keep Telegram updates short and milestone-based.
- Keep fuller history in Linear comments.
- Use review logs to avoid scanning the same area every run.
- Apply queue pressure before filing proactive findings.

Practices not to copy as PM defaults:

- Hard-coded Linear, GitHub, Telegram, repo, and model assumptions.
- Self-merge as the default. PM should make self-merge an explicit per-project policy.
- Broad tool permissions without a project-level policy.
- Single product-specific manuals as global runtime behavior.

## Current PM Plugin Fit

### Existing Strengths

PM already models the development lifecycle well:

- `skills/bug` creates `kind: bug` backlog items that `pm:dev` can route directly to fix.
- `skills/dev` has a state file schema, stage model, worktree expectations, task status values, merge-watch state, and retry counters.
- `scripts/dispatch-issue.sh` can spawn long-running top-level agents and requires structured result JSON.
- `skills/list` plus `scripts/start-status.js` already create a terminal survey of active work.
- `scripts/pm-log.js` and hooks can record telemetry.

This means the loop layer should reuse PM's state and skills, not create a parallel workflow engine.

### Current Gaps

- No scheduler-facing entrypoint that can safely wake, scan, claim, act, and stop.
- No normalized "board" projection across backlog, RFCs, sessions, PRs, and blocked states.
- No lease/lock protocol for scheduled or parallel agents.
- No first-class WIP limits.
- No stage-specific agent contract outside the dev subprocess path.
- No persistent loop run log with per-card attempts, budget, status, and next wake time.
- No adapter that installs an OpenClaw cron job for a PM project.
- No policy model for what loops may do autonomously.

## Proposed Architecture

### Product Principle

PM Loop should be a thin orchestration layer over PM's existing workflows:

> The loop owns selection, leasing, scheduling, and escalation. The skills still own execution.

This avoids rewriting `pm:dev`, `pm:groom`, `pm:rfc`, `pm:review`, and `pm:ship`.

### New User Surface

Add a new command/skill:

- `/pm:loop status` - render the board and loop health.
- `/pm:loop wake` - scan eligible work, claim one card, run the next stage, and stop.
- `/pm:loop wake --dry-run` - explain what would be claimed and why.
- `/pm:loop install openclaw` - print or install OpenClaw cron job definitions for this project.
- `/pm:loop install launchd` - create local launchd wrapper for users not using OpenClaw.
- `/pm:loop config` - show/edit loop policy.

The first implementation can keep this as a script-oriented skill:

- `commands/loop.md`
- `skills/loop/SKILL.md`
- `skills/loop/steps/01-status.md`
- `skills/loop/steps/02-wake.md`
- `skills/loop/steps/03-install.md`
- `scripts/loop-board.js`
- `scripts/loop-runner.js`
- `scripts/loop-dispatch.js`

### Board Model

The board should be a derived view, not a second backlog.

Primary sources:

- `pm/backlog/*.md`
- `pm/backlog/rfcs/*.html`
- `.pm/groom-sessions/*.md`
- `.pm/rfc-sessions/*.md`
- `.pm/dev-sessions/*.md`
- GitHub PR metadata, when available
- Linear issue metadata, when available

Generated/local loop state:

- `.pm/loop/config.json`
- `.pm/loop/leases.json`
- `.pm/loop/events.jsonl`
- `.pm/loop/runs/{run-id}.json`
- `.pm/loop/cards/{card-id}.json` only for loop-specific metadata that cannot belong in the canonical artifact.

Board columns:

| Column | Meaning | Typical owner |
|---|---|---|
| `inbox` | New captured item with insufficient routing | triage |
| `needs-human` | Explicit question or approval needed | human |
| `needs-research` | Evidence missing or stale | research |
| `grooming` | Product proposal in progress | groom |
| `ready-for-rfc` | Proposal accepted, technical design needed | rfc |
| `rfc` | RFC in progress or awaiting approval | rfc |
| `ready-for-dev` | Implementable item | dev |
| `implementing` | Worktree/branch active | dev |
| `reviewing` | Simplify/review/QA active | review |
| `shipping` | PR, CI, review threads, merge | ship |
| `blocked` | Machine cannot proceed without external change | human |
| `done` | Completed and recorded | retro |

### Card Metadata

Minimum loop metadata:

```json
{
  "card_id": "PM-123",
  "source": "pm/backlog/example.md",
  "stage": "ready-for-dev",
  "owner": "dev",
  "priority": "high",
  "eligible_after": "2026-06-23T04:00:00Z",
  "lease": {
    "holder": "pm-loop:host:pid",
    "expires_at": "2026-06-23T04:30:00Z"
  },
  "attempts": {
    "dev": 1,
    "ship": 2
  },
  "last_result": "blocked",
  "last_reason": "needs product decision on acceptance criteria",
  "budget": {
    "max_runtime_seconds": 2400,
    "max_daily_runs": 3
  }
}
```

Do not require every canonical PM artifact to carry these fields immediately. Derive what can be derived; store only loop-specific metadata in `.pm/loop`.

### Wake Algorithm

`pm:loop wake` should:

1. Resolve project, PM dir, source dir, repo, and runtime.
2. Load loop config and policy.
3. Build board from canonical PM artifacts.
4. Merge loop leases and recent run history.
5. Drop expired leases.
6. Select one eligible card according to policy:
   - Continue in-flight work before new work.
   - Unblock PR/CI/review before starting implementation.
   - Prefer high priority and older cards.
   - Respect WIP limits per owner and per repo.
7. Claim card with a lease.
8. Dispatch the stage owner.
9. Require structured result JSON.
10. Update event log, release or extend lease, and set next stage.
11. Notify only on milestones, blockers, and failures.

### Worker Contracts

Each worker returns a structured result:

```json
{
  "status": "completed | blocked | skipped | failed",
  "stage": "ship",
  "card_id": "PM-123",
  "summary": "PR #456 is merged and backlog marked shipped.",
  "next_stage": "done",
  "next_wake_after": null,
  "human_question": null,
  "artifacts": {
    "branch": "fix/example",
    "pr": "https://github.com/org/repo/pull/456",
    "state_file": ".pm/dev-sessions/example.md"
  },
  "metrics": {
    "runtime_ms": 120000,
    "input_tokens": 10000,
    "output_tokens": 1000
  }
}
```

Worker mapping:

| Owner | Initial implementation |
|---|---|
| `triage` | Inline script + `pm:task` / `pm:bug` helpers |
| `research` | `pm:research` topic mode or direct scoped research |
| `groom` | existing `pm:groom` |
| `rfc` | existing `pm:rfc` |
| `dev` | existing `pm:dev` and `scripts/dispatch-issue.sh` |
| `review` | existing `pm:simplify` and `pm:review` |
| `ship` | existing `pm:ship` merge loop |
| `retro` | existing dev retro plus feature/memory updates |

### Policy Model

Loop autonomy must be project-configurable:

```json
{
  "enabled": true,
  "runtime": "codex",
  "wip_limits": {
    "dev": 1,
    "ship": 3,
    "research": 1
  },
  "autonomy": {
    "create_backlog": true,
    "start_dev": false,
    "push_branch": true,
    "open_pr": true,
    "merge_pr": false,
    "file_linear": false,
    "notify_humans": true
  },
  "budgets": {
    "max_runs_per_day": 12,
    "max_runtime_seconds_per_run": 2400,
    "max_attempts_per_stage": 3
  },
  "notifications": {
    "channel": "telegram",
    "target": null,
    "milestones_only": true
  }
}
```

Defaults should be conservative. In particular, `start_dev` and `merge_pr` should default to false until the user explicitly opts in.

## MVP Recommendation

### MVP 1: Read-Only Board

Goal: prove the board projection without autonomy.

Build:

- `scripts/loop-board.js --project-dir . --format json`
- `/pm:loop status`
- Board columns derived from existing backlog/session/RFC state.
- No file mutation except optional `.pm/loop/events.jsonl` telemetry if the user runs non-dry status with logging enabled.

Success criteria:

- Shows backlog, RFCs, active sessions, blocked work, PR watch items.
- Agrees with `/pm:list` where they overlap.
- Does not create duplicate source of truth.

### MVP 2: Dry-Run Wake and Selection

Goal: prove selection rules and policy.

Build:

- `/pm:loop wake --dry-run`
- Candidate ranking output with reason:
  - "Would claim PR #123 because shipping work takes priority over new dev."
  - "Would skip PM-45 because `start_dev=false`."
  - "Would park PM-77 because reproduction is pending."

Success criteria:

- No file mutation.
- Selection is understandable.
- Policy blocks are visible.

### MVP 3: PR Babysitter Loop

Goal: automate the safest useful loop first.

Build:

- Claim active dev/ship sessions and open PM-authored PRs.
- Run only `pm:ship`/review-comment/CI monitoring behavior.
- No new product work.
- No merge by default unless `merge_pr=true`.

Why first:

- It mirrors the OpenClaw bug-agent's most successful pattern.
- It closes work already started.
- It has clear external signals: CI, review threads, mergeability, comments.

### MVP 4: Bug/Task Intake Loop

Goal: make `kind: bug` and `kind: task` useful without manual prompting.

Build:

- Poll `pm/backlog/*.md` for `status: proposed`, `kind: bug|task`.
- Enforce reproduction/expected/observed checks for bugs.
- If complete and allowed, dispatch `pm:dev`.
- If incomplete, move to `needs-human` with a crisp question.

### MVP 5: Product Loop

Goal: help PM compound knowledge, not just code.

Build:

- Stale research refresh.
- Evidence-to-idea routing.
- Proposal/RFC readiness checks.
- Human approval before dev starts.

This should come after the operational loops because product intent is higher risk than CI babysitting.

## OpenClaw Adapter

Because the existing OpenClaw VM is already reliable, PM should support it without requiring it.

`/pm:loop install openclaw` should generate jobs like:

- `pm-loop-status-daily`: daily summary.
- `pm-loop-ship-watch`: every 30-60 minutes, only PR/CI/review work.
- `pm-loop-bug-poll`: every 1-4 hours, one bug/task max.
- `pm-loop-research-refresh`: daily or weekly, stale evidence only.

Each job payload should be short and point to PM's source instructions:

```text
Run PM loop wake for project /path/to/project.
Mode: ship-watch.
Read AGENTS.md, then run /pm:loop wake --mode ship-watch.
Respect .pm/loop/config.json. Stop after one claimed card.
```

The adapter should install or print OpenClaw cron JSON, not require manual natural-language job construction.

## Guardrails

### Prevent Infinite Loops

- Max attempts per stage.
- Signature-based retry counters, similar to existing merge-loop retry counters.
- `next_wake_after` backoff after failures.
- Move to `blocked` after repeated same-signature failure.

### Prevent Duplicate Work

- Atomic lease writes.
- One owner per card.
- Dedupe by backlog ID, branch, PR, Linear ID, and issue title.
- Progress in-flight cards before new intake.

### Prevent Noisy Backlogs

- Proactive agents must obey queue pressure.
- Cap findings per run.
- Prefer "nothing substantive" to low-confidence tickets.
- Require evidence and source paths for filed findings.

### Prevent Unsafe Autonomy

- Default no self-merge.
- Default no destructive commands.
- Default no new external issues unless configured.
- Escalate product/architecture decisions.
- Respect repository AGENTS.md and PM policy.

### Control Cost

- Max runs per day.
- Per-stage timeout.
- Dry-run selection.
- Lightweight context mode for status/selection.
- Token usage captured in loop run logs when available.

## Metrics

Track enough to improve the loop:

- Cards claimed, completed, blocked, failed, skipped.
- Mean time in column.
- Repeated blockers by signature.
- PR babysitter interventions.
- CI failures fixed by agent.
- Review findings fixed by agent.
- Token/runtime cost by stage.
- Human escalations by reason.
- False-positive proactive findings.

These metrics should eventually feed a "hill-climbing" loop: analyze run traces and propose changes to PM skills or loop policy. That should be a later phase, not the initial implementation.

## Proposed Implementation Phases

### Phase 1: Board and Policy

- Add `skills/loop` and `commands/loop.md`.
- Add `scripts/loop-board.js`.
- Add `.pm/loop/config.json` schema docs.
- Render board in terminal.
- Add tests for board projection.

### Phase 2: Wake and Lease Runtime

- Add `scripts/loop-runner.js`.
- Implement dry-run selection.
- Implement file leases and expired lease cleanup.
- Write `.pm/loop/events.jsonl`.
- Add tests for selection, leases, and policy blocks.

### Phase 3: Ship-Watch Worker

- Integrate with existing `pm:ship` behavior.
- Support GitHub PR metadata.
- No new dev work.
- No merge unless configured.

### Phase 4: Bug/Task Worker

- Route `kind: bug` and `kind: task`.
- Use existing capture schema and `pm:dev`.
- Add reproduction completeness checks.
- Add "needs-human" parking behavior.

### Phase 5: OpenClaw and GitHub Adapters

- Generate OpenClaw cron job definitions.
- Generate launchd wrappers.
- Optionally generate GitHub Actions workflows for cloud runners.
- Add docs for Codex/Claude GitHub mentions as event sources.

### Phase 6: Product Knowledge Loop

- Research refresh loop.
- Evidence routing loop.
- Proposal readiness loop.
- RFC readiness loop.
- Human approval gates before dev.

## Key Open Questions

1. Should PM loops be local-file-first only, or should Linear/GitHub be first-class board backends?
2. Should `merge_pr` ever be enabled by default for users with strong CI and review gates?
3. Should `pm:loop wake` invoke PM skills by spawning a new CLI process, or should it emit instructions for the current agent to execute inline?
4. How should PM represent a card that spans multiple repositories?
5. Should loop run logs live only in `.pm/loop`, or should summaries also update human-facing `pm/` artifacts?
6. How much OpenClaw-specific install logic belongs in PM versus documentation?

## Sources

Online sources accessed 2026-06-23:

- Addy Osmani, "Loop Engineering" - https://addyosmani.com/blog/loop-engineering/
- LangChain, "The Art of Loop Engineering" - https://www.langchain.com/blog/the-art-of-loop-engineering
- Business Insider, "Forget prompt engineering: 'Loop engineering' is all the rage now" - https://www.businessinsider.com/what-are-loops-ai-engineering-tips-2026-6
- MindStudio, "What Is Loop Engineering? The New Meta for AI Coding Agents" - https://www.mindstudio.ai/blog/what-is-loop-engineering-ai-coding-agents
- MindStudio, "What Is the Iterative Kanban Pattern for AI Agents?" - https://www.mindstudio.ai/blog/iterative-kanban-pattern-ai-agents-feedback-loop
- Kilo, "What Is Loop Engineering? AI Feedback Loops" - https://kilo.ai/articles/what-is-loop-engineering
- OpenClaw cron docs - https://docs.openclaw.ai/cli/cron
- OpenClaw product site - https://openclaw.ai/
- GitHub, "Introducing Agent HQ: Any agent, any way you work" - https://github.blog/news-insights/company-news/welcome-home-agents/
- OpenAI Codex GitHub integration docs - https://developers.openai.com/codex/integrations/github
- OpenAI Codex web docs - https://developers.openai.com/codex/cloud
- Claude Code GitHub Actions docs - https://code.claude.com/docs/en/github-actions
- LangGraph overview - https://docs.langchain.com/oss/python/langgraph/overview
- LangGraph interrupts docs - https://docs.langchain.com/oss/python/langgraph/interrupts
- Temporal, "Of course you can build dynamic AI agents with Temporal" - https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal
- ReAct paper - https://arxiv.org/abs/2210.03629
- Reflexion paper - https://arxiv.org/abs/2303.11366
- SWE-agent paper - https://arxiv.org/abs/2405.15793
- The Pragmatic Engineer, "The creator of Clawd: I ship code I don't read" - https://newsletter.pragmaticengineer.com/p/the-creator-of-clawd-i-ship-code

Local sources inspected 2026-06-23:

- `/Users/soelinmyat/Projects/openclaw/README.md`
- `/Users/soelinmyat/Projects/openclaw/rrqs_daily/README.md`
- `/Users/soelinmyat/Projects/openclaw/rrqs_daily/run_daily_rrqs.sh`
- `/Users/soelinmyat/.local/bin/openclaw-watchdog`
- `/Users/soelinmyat/.local/bin/openclaw-start`
- `/Users/soelinmyat/.local/bin/openclaw-backup`
- `/Users/soelinmyat/Library/LaunchAgents/com.soelinmyat.openclaw.vm.plist`
- `/Users/soelinmyat/Library/LaunchAgents/com.trycua.lume.openclaw.plist`
- `/Users/soelinmyat/Library/LaunchAgents/ai.openclaw.ssh-tunnel.plist`
- `/Users/soelinmyat/Library/LaunchAgents/ai.openclaw.backup.plist`
- OpenClaw VM `~/.openclaw/cron/jobs.json`, `jobs-state.json`, and run logs
- OpenClaw VM `~/.openclaw/workspace-bug/AGENTS.md`
- OpenClaw VM `~/.openclaw/workspace-bug/REVIEW.md`
- OpenClaw VM `~/.openclaw/workspace-bug/UI-REVIEW.md`
- PM plugin `skills/bug/SKILL.md`
- PM plugin `skills/dev/SKILL.md`
- PM plugin `skills/list/SKILL.md`
- PM plugin `scripts/dispatch-issue.sh`
- PM plugin `scripts/start-status.js`
- PM plugin `scripts/capture-backlog.js`
- PM plugin `skills/dev/references/state-schema.md`
