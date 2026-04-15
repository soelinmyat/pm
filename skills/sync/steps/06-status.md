---
name: Status
order: 6
description: Show sync state — backend, remote, uncommitted changes, ahead/behind
---

## Goal

Show the user the current sync configuration and state in plain language.

## How

Only run this step when the selected route is `status`. Otherwise skip it.

### Git backend

Run the status script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" status
```

Parse the JSON output and display a formatted summary:

```text
Backend: git
Remote:  {remote}
Branch:  {branch}
Uncommitted changes: {uncommitted}
Ahead:   {ahead} commit(s)
Behind:  {behind} commit(s)
```

If `uncommitted > 0`, add: "Run `/pm:sync push` to push local changes."

If `behind > 0`, add: "Run `/pm:sync pull` to pull remote changes."

If everything is zero: "All synced."

### No backend configured

If the status script returns `ok: false` with an error about no git repo:

> No sync configured. Run `/pm:sync setup` to get started.

### Last sync info

Also read `{pm_state_dir}/sync-status.json` if it exists and append:

```text
Last sync: {lastSync, formatted as readable date/time}
Mode:      {mode}
Status:    {ok ? "OK" : "Failed"}
```

Never show raw JSON to the user.

## Done-when

The user has a readable sync status report, or a clear instruction to run setup.

Say: "What would you like to do next?"
