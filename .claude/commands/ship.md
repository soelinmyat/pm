# Ship plugin changes

Commit, bump version, push, and sync to cache in one step. This is the standard release flow for the pm plugin.

## Arguments

- No args: auto-generate commit message from staged/unstaged changes
- Any text: use as the commit message

## Flow

### 1. Check for changes

```bash
git status --short
```

If no changes, say "Nothing to ship" and stop.

### 2. Stage and commit

- Stage all modified and deleted tracked files relevant to the plugin (skills/, commands/, hooks/, scripts/, agents/, references/, tools/, .claude-plugin/, .codex-plugin/, .cursor-plugin/, .claude/)
- Do NOT stage: pm/, .pm/, .planning/, node_modules/, .playwright-mcp/, unrelated untracked files
- If argument was provided, use it as the commit message
- If no argument, generate a concise commit message from the diff

### 3. Bump version

Read current version from `.claude-plugin/plugin.json`. Increment the patch number (e.g., 1.0.24 → 1.0.25).

Update all 4 manifests:
- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `.claude-plugin/marketplace.json`

Commit: `chore: bump version to {new_version}`

### 4. Push

```bash
git push origin main
```

### 5. Sync to cache

```bash
rsync -av --delete \
  --exclude='.git' \
  --exclude='pm/' \
  --exclude='.pm/' \
  --exclude='node_modules/' \
  --exclude='.planning/' \
  "$(git rev-parse --show-toplevel)/" \
  "$HOME/.claude/plugins/cache/pm/pm/"
```

### 6. Report

```
Shipped v{version} ({commit_hash})
- {N} files changed
- Pushed to origin/main
- Synced to plugin cache
- Restart active sessions to pick up changes
```
