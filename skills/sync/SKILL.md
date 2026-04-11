---
name: sync
description: "Manually pull or push knowledge base changes. Triggers on 'sync', 'pull kb', 'push kb', 'sync knowledge base', 'kb sync', 'sync pm'."
runtime:
  requires: []
  agents: 0
  guarantee: "knowledge base changes pulled or pushed"
  degradation: none
---

# pm:sync

## Purpose

Manual control over knowledge base synchronization. Pull the latest pm/ changes from the remote, push local pm/ changes, or check sync status.

Sync hooks run automatically (pull on session start, push after each skill), but this skill lets users trigger sync manually — useful after disabling auto_sync, working offline, or recovering from a push failure.

## Subcommands

| Input | Action |
|-------|--------|
| `/sync` or `/sync status` | Show current sync status |
| `/sync pull` | Pull latest pm/ changes from remote |
| `/sync push` | Commit and push local pm/ changes |

## Steps

### 1. Parse the subcommand

Read the user's input after `/pm:sync`. Default to `status` if no argument.

### 2. Execute

#### Status (default)

Run the following via Bash and report the results:

```bash
cd "$CLAUDE_PROJECT_DIR"

# Last pm/ commit
git log -1 --format="%h %s (%cr)" -- pm/

# Remote tracking
git remote get-url origin 2>/dev/null && echo "Remote: configured" || echo "Remote: none"

# Pending pm/ changes
git status --porcelain pm/

# Push failure marker
if [ -f .pm/.sync-push-failed ]; then
  echo "WARNING: previous push failed — $(cat .pm/.sync-push-failed)"
fi

# Auto-sync preference
if [ -f .pm/config.json ]; then
  node -e "const c = require('./.pm/config.json'); console.log('Auto-sync:', c.preferences?.auto_sync !== false ? 'enabled' : 'disabled')"
fi
```

Report a clean summary to the user:
- Last sync commit (hash, message, relative time)
- Remote status (configured or not)
- Pending changes (count, or "none")
- Push failure warning (if marker exists)
- Auto-sync status (enabled/disabled)

#### Pull

Run the pull script with `--manual` flag (bypasses auto_sync check):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/hooks/kb-pull.sh" --manual
```

Report the result to the user. If the output contains `hookSpecificOutput`, parse the `additionalContext` value for the status message.

After pulling, if `pm/` files were updated, briefly note what changed.

#### Push

Run the push script with `--manual` and `--skill manual` flags:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/hooks/kb-push.sh" --manual --skill manual
```

Before running, check for pending pm/ changes:
```bash
git status --porcelain pm/
```

If no changes, tell the user "No pm/ changes to push."

After pushing, report success or failure. If the push failed, check for the `.pm/.sync-push-failed` marker and report the error.

If the push succeeded, remove the failure marker if it exists:
```bash
rm -f .pm/.sync-push-failed
```

## Error Handling

- **No remote configured:** Report "No remote configured. Changes are committed locally only."
- **Merge conflicts:** Report the conflicting files and suggest manual resolution.
- **Auth failures:** Report "Push failed (authentication). Check your git credentials."
- **Network issues:** Report "Fetch failed (network). Using local copy."

## Interaction Rules

- No questions — execute the requested action and report results.
- Keep output concise — one summary paragraph, not a wall of git output.
- If the user says "sync" without direction, show status.
