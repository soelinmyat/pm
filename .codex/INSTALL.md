# PM Plugin: Codex CLI Installation

## Prerequisites

- [Codex CLI](https://github.com/openai/codex) installed and authenticated
- Node.js 18+
- Git

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/soelinmyat/pm ~/Projects/pm
```

### 2. Register with Codex

Codex discovers plugins via its `.codex/` directory convention. Add the plugin path to your Codex configuration:

```yaml
# ~/.codex/config.yml
plugins:
  - path: ~/Projects/pm
```

Or, if your project uses a local Codex config, add it there:

```yaml
# <project-root>/.codex/config.yml
plugins:
  - path: ~/Projects/pm
```

### 3. Enable parallel researcher agents (optional)

The `/pm:research` skill uses the `spawn_agent` tool to dispatch parallel researcher agents. This requires `collab = true` in your Codex config:

```yaml
# ~/.codex/config.yml
collab: true
plugins:
  - path: ~/Projects/pm
```

Without `collab: true`, research tasks run sequentially. All other skills work without this flag.

---

## Verification

Start a Codex session and run:

```
/pm:setup
```

You should see the PM setup wizard. If you see "command not found", check that the plugin path is correct in your config and that the `commands/` directory exists at `~/Projects/pm/commands/`.

---

## Windows Instructions

Windows does not support symlinks without Developer Mode. Use directory junctions instead.

### Option A: Enable Developer Mode (recommended)

1. Open Settings > System > For developers
2. Enable Developer Mode
3. Proceed with the standard installation above (symlinks will work)

### Option B: Directory junctions

```cmd
# In an elevated Command Prompt (Run as Administrator):
mklink /J C:\Users\<you>\.codex\plugins\pm C:\Projects\pm
```

Replace paths to match your actual install locations.

---

## Updating

```bash
cd ~/Projects/pm
git pull
```

No rebuild step required. Changes take effect on the next Codex session.
