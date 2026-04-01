---
type: thinking
topic: "Agent Watchdog Timer for Epic Flow"
slug: "agent-watchdog"
created: 2026-04-01
status: promoted
promoted_to: implemented directly (no issue needed)
---

# Agent Watchdog Timer for Epic Flow

## Problem
Agent teammates dispatched during epic `/dev` flows die silently from API errors (529/429/5xx). The orchestrator waits indefinitely for a terminal message that never arrives, wasting unbounded time.

## Direction
Hybrid approach — two complementary rules:

1. **Agent-side progress reports.** Require teammate agents to SendMessage a brief progress update after each commit or meaningful milestone. This gives the orchestrator visibility AND makes silence a reliable death signal.

2. **Orchestrator-side watchdog (5 min).** After dispatching a teammate or sending "go implement," the orchestrator must check in via SendMessage if no message has been received within 5 minutes. If the ping gets no response, the agent is dead — trigger existing retry logic (fresh teammate with plan path + git state).

### What changes
- **`epic-flow.md` section 4.5** — Replace the current exponential backoff (30s/60s/120s) with a simpler 5-minute watchdog. After dispatch, if no message within 5 min → ping. No response → spawn fresh teammate. Max 3 retries before marking failed.
- **`implementer-prompt.md`** — Add rule: "Send a progress update to team-lead after each commit or every 5 minutes, whichever comes first. Format: `Progress: {what you just did}. Next: {what you're doing next}.`"
- **No changes to single-issue flow** — subagent dispatches block the orchestrator anyway, and single-issue deaths are rare enough to not warrant this.

### Detection flow
```
Orchestrator dispatches teammate
  └─ Teammate works, sends progress updates every commit/5min
      ├─ Normal: orchestrator sees updates, knows agent is alive
      └─ Silence for 5 min:
          ├─ Orchestrator pings: "Status check: {ISSUE_ID}?"
          │   ├─ Response → agent alive, continue waiting
          │   └─ No response → agent dead
          │       ├─ Retry 1: fresh teammate with plan + git state
          │       ├─ Retry 2: fresh teammate
          │       └─ Retry 3: mark failed, continue epic
          └─ (worst-case idle: ~5 min, not unbounded)
```

## Key tradeoffs
- Adds ~2 sentences to implementer prompt (agent-side reports)
- Adds a behavioral rule to epic-flow.md (orchestrator watchdog)
- 5-min granularity means some idle time after death, but caps it
- Simpler than exponential backoff — one fixed interval, not escalating waits

## Open questions
- None significant — scope is clear, mechanism is well-understood

## Next step
Groom into an issue and implement. Changes touch 2 files: `epic-flow.md` and `implementer-prompt.md`.
