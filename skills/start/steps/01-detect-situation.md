---
name: Detect Situation
order: 1
description: Check signals and route to bootstrap, resume, or pulse mode
---

## Detect The Situation

Check these signals using the resolved paths and the current user request:

- Does `pm_dir` exist? (i.e., was `pm_dir` resolved above, and does the directory exist on disk?)
- Does `.pm/config.json` exist at cwd?
- Is the user explicitly asking to view PM?
- Did the user pass a path argument after `/pm:start`?
- Is there active work? Check for session files in BOTH locations:
  - Groom sessions: `{pm_state_dir}/groom-sessions/*.md` (always in the PM repo's `.pm/`)
  - Dev sessions: depends on repo mode:
    - **Same-repo mode** (`pm_state_dir` == `{source_dir}/.pm`): `{pm_state_dir}/dev-sessions/*.md`
    - **Separate-repo mode** (`pm_state_dir` != `{source_dir}/.pm`): check BOTH `{pm_state_dir}/dev-sessions/*.md` AND `{source_dir}/.pm/dev-sessions/*.md` — dev sessions are written to the source repo, but a stale session from before the split may exist in the PM repo

Routing:

- If `pm_dir` does not exist or `.pm/config.json` is missing, use **Bootstrap Mode**
- If the project is initialized and active work exists, use **Resume Mode**
- Otherwise use **Pulse Mode**

If this skill was auto-invoked at session start and the project is not initialized:

- Do **not** launch into a full wizard immediately.
- Say briefly that PM is not initialized in this project yet.
- Ask: "Want to start PM in this repo now with `/pm:start`?"
- If the user says yes, continue into Bootstrap Mode.
- If the user says no, stop and let them continue with whatever they asked.

If the user explicitly invoked `/pm:start`, skip the permission prompt and continue with the routed mode directly.

## Optional Starting Context

`/pm:start [path-or-starting-context]`

Interpret the argument or surrounding user message as a routing hint:

- A file or folder path → import evidence
- "market", "landscape", "industry" → market research
- "competitor", "alternatives", "compare" → competitor research
- "research X", "look into X", "investigate X" → topic research
- "think", "brainstorm", "what if", "how should we" → `pm:think`
- "groom", "feature idea", "spec", "PRD", "break this down" → `pm:groom`
- "explore", "look around", "just show me", "skip" → show session brief and stop

If no clear hint exists, ask the user what they want to do first.
