# PM Plugin: OpenCode Installation

## Prerequisites

- [OpenCode](https://opencode.ai) installed and authenticated
- Node.js 18+
- Git

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/soelinmyat/pm ~/Projects/pm
```

### 2. Symlink the plugin

OpenCode loads plugins from `~/.config/opencode/plugins/`. Create a symlink so OpenCode picks up the PM plugin:

```bash
mkdir -p ~/.config/opencode/plugins
ln -s ~/Projects/pm/.opencode/plugins/pm.js ~/.config/opencode/plugins/pm.js
```

### 3. Symlink the skills

OpenCode loads skill files from `~/.config/opencode/skills/`. Symlink the PM skills directory:

```bash
mkdir -p ~/.config/opencode/skills
ln -s ~/Projects/pm/skills ~/.config/opencode/skills/pm
```

---

## Verification

Start an OpenCode session in your project directory and run:

```
Set up my project with PM
```

You should see the PM setup wizard. The plugin injects setup instructions or the available skills list into every system prompt depending on whether `.pm/config.json` exists in your project.

If the plugin does not load, verify:

```bash
ls -la ~/.config/opencode/plugins/pm.js    # should point to ~/Projects/pm/.opencode/plugins/pm.js
ls -la ~/.config/opencode/skills/pm        # should point to ~/Projects/pm/skills
node ~/.config/opencode/plugins/pm.js      # should exit without errors
```

---

## Windows Instructions

Windows does not support symlinks without Developer Mode enabled.

### Option A: Enable Developer Mode (recommended)

1. Open Settings > System > For developers
2. Enable Developer Mode
3. Proceed with the standard symlink instructions above (they will work in PowerShell or WSL)

### Option B: Directory junctions and file copies

In an elevated Command Prompt (Run as Administrator):

```cmd
# Create junction for skills directory
mklink /J "%APPDATA%\opencode\skills\pm" "C:\Projects\pm\skills"

# Copy the plugin file (junctions don't work for files)
copy "C:\Projects\pm\.opencode\plugins\pm.js" "%APPDATA%\opencode\plugins\pm.js"
```

Note: When using file copy instead of a symlink, you must re-copy `pm.js` after updates.

---

## Updating

```bash
cd ~/Projects/pm
git pull
```

Because the plugin and skills are symlinked, updates take effect on the next OpenCode session without any additional steps.
