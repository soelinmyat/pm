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

Label ahead/behind as **locally observed remote refs**. Status is strictly
effect-free: it never fetches, prompts for credentials, writes a journal, or
refreshes refs. When the user needs current remote truth, offer the returned
`refresh_action` (`/pm:sync`), which is an explicit mutation route.

If `uncommitted > 0`, add: "Run `/pm:sync` to pull remote changes first, then push local changes. Use `/pm:sync push` only when you intentionally want the push-only override."

If `behind > 0`, add: "Run `/pm:sync` to pull remote changes and then push any local changes. Use `/pm:sync pull` only when you intentionally want the pull-only override."

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

Say: "What would you like to do next?"

## Done-when

The user has a readable backend, remote, branch, locally observed divergence,
dirty-state, and last-sync/effect summary, including the safest next action for any non-zero state.

Offer `/pm:sync` for safe bidirectional recovery, an explicit one-way override when intentionally requested, or no action when everything is synced.
