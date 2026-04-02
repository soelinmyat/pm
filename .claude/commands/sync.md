# Sync plugin source to cache

Copy the plugin source code to the Claude Code plugin cache so changes take effect immediately.

## Flow

1. Source directory is the repo root (has `.claude-plugin/plugin.json` with `"name": "pm"`)

2. Read the source version from `.claude-plugin/plugin.json`.

3. Run the sync:

```bash
SOURCE_DIR="$(git rev-parse --show-toplevel)"
CACHE_DIR="$HOME/.claude/plugins/cache/pm/pm"

rsync -av --delete \
  --exclude='.git' \
  --exclude='pm/' \
  --exclude='.pm/' \
  --exclude='node_modules/' \
  --exclude='.planning/' \
  "$SOURCE_DIR/" \
  "$CACHE_DIR/"
```

**Important:** The cache target is `~/.claude/plugins/cache/pm/pm/` — the root, not a versioned subdirectory.

4. Report success: version synced and remind the user to restart any active Claude Code sessions to pick up the changes.
