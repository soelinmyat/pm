---
name: sync
description: "Sync plugin source to Claude Code cache for immediate testing"
---

# pm:sync

## Purpose

Copy the plugin source code to the Claude Code plugin cache so changes take effect immediately without waiting for a publish cycle.

## Flow

1. Detect the current cached version:

```bash
VERSION=$(cat ~/.claude/plugins/cache/pm/pm/*/plugin.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"//;s/".*//' || echo "1.0.0")
echo "Detected cache version: $VERSION"
```

2. Determine the source directory. Check in order:
   - If CWD is inside the plugin source (has `.claude-plugin/plugin.json` with `"name": "pm"`): use CWD
   - Otherwise try `~/Projects/pm`
   - If neither works, ask the user for the source path

3. Read the source version from the source `.claude-plugin/plugin.json` and compare with cache version. Warn if they differ.

4. Run the sync:

```bash
SOURCE_DIR="${SOURCE_DIR}"  # determined above
CACHE_DIR="$HOME/.claude/plugins/cache/pm/pm/${VERSION}"

rsync -av --delete \
  --exclude='.git' \
  --exclude='pm/' \
  --exclude='.pm/' \
  --exclude='node_modules/' \
  --exclude='.planning/' \
  "$SOURCE_DIR/" \
  "$CACHE_DIR/"
```

5. If the source version differs from the cache version, rename the cache directory:

```bash
NEW_VERSION=$(grep '"version"' "$SOURCE_DIR/.claude-plugin/plugin.json" | sed 's/.*"version": *"//;s/".*//')
if [ "$NEW_VERSION" != "$VERSION" ]; then
  NEW_CACHE="$HOME/.claude/plugins/cache/pm/pm/$NEW_VERSION"
  mv "$CACHE_DIR" "$NEW_CACHE"
  echo "Cache directory renamed: $VERSION → $NEW_VERSION"
fi
```

6. Report success: which files changed, new version if bumped, and remind the user to restart any active Claude Code sessions to pick up the changes.
