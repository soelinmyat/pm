---
name: sync
description: "Sync plugin source to Claude Code cache for immediate testing"
---

# pm:sync

## Purpose

Copy the plugin source code to the Claude Code plugin cache so changes take effect immediately without waiting for a publish cycle.

## Flow

1. Determine the source directory. Check in order:
   - If CWD is inside the plugin source (has `.claude-plugin/plugin.json` with `"name": "pm"`): use CWD
   - Otherwise try `~/Projects/pm`
   - If neither works, ask the user for the source path

2. Read the source version from `.claude-plugin/plugin.json`.

3. Run the sync to the **cache root** (not a versioned subdirectory):

```bash
SOURCE_DIR="${SOURCE_DIR}"  # determined above
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

**Important:** The cache target is `~/.claude/plugins/cache/pm/pm/` — the root, not a versioned subdirectory. Claude Code loads the plugin from this root path. Syncing to a subdirectory like `pm/pm/1.0.1/` will not be picked up.

4. Report success: version synced and remind the user to restart any active Claude Code sessions to pick up the changes.
