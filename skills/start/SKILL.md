---
name: start
description: "Session greeting, project dashboard, and onboarding. Shows project pulse (health, backlog shape, suggested next action), launches the dashboard server, and guides first-time setup if no knowledge base exists. Triggers on session start (auto-invoked by using-pm), 'start,' 'dashboard,' 'open dashboard,' 'show research,' 'show knowledge base,' 'open pm,' 'view pm,' 'view research.'"
---

# pm:start

## Purpose

Greet the user with project health, launch the dashboard, and onboard new projects.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`.

Minimum coverage for `pm:start`:
- run start / run end for every invocation
- one step span for `detect-situation`
- one step span for the selected path: `setup-handoff`, `dashboard-pulse`, or `explicit-open`

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next.

## Flow

### 1. Check for knowledge base

If `pm/` does not exist in the current project:
- Tell the user briefly: no PM knowledge base yet.
- Ask: "Want to set one up now? I'll run /pm:setup."
- If yes, invoke `pm:setup`. If no, move on to whatever the user asked.
- **Stop here** — skip steps 2-3.

### 2. Get project pulse

Run the auto-launch script to start the dashboard and compute project health:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/hooks/auto-launch.sh
```

This prints plain text: the dashboard URL on the first line, then 3 health lines (attention, backlog shape, suggested next action). Capture its full stdout.

### 3. Present greeting

Print the output from step 2 exactly as received — dashboard URL and pulse lines. No filler, no "welcome back", no explanation of what each line means. Just present the data, then continue with whatever the user asked.

If the script produces no output (dashboard disabled or failed), skip the greeting silently and continue.

## Output Format

```
Dashboard: {url}
{attention line}
{backlog shape line}
{suggested next line}
```

If the dashboard cannot be started, skip the URL line but still show available pulse lines. If nothing is available, skip the greeting entirely.

## When Invoked Explicitly

When the user says "open dashboard", "show pm", etc. (not auto-invoked at session start), still run the same flow but skip the onboarding check — just launch the dashboard and show the pulse.
