---
name: Setup
order: 2
description: Interactive setup — create or connect a git repo for KB sync
---

## Goal

Configure git-based sync for the `pm/` directory. Either create a new private GitHub repo or connect to an existing one.

## How

Only run this step when the selected route is `setup`. Otherwise skip it.

### 1. Check current state

Check if sync is already configured:

```bash
node -e "
  try {
    const c = JSON.parse(require('fs').readFileSync('.pm/config.json','utf8'));
    const b = (c.sync || {}).backend || 'none';
    process.stdout.write(b);
  } catch { process.stdout.write('none'); }
"
```

If already configured as `"git"`, show current remote and ask:

> Sync is already configured (git). Remote: `{remote_url}`. Want to reconfigure?

If the user says no, stop.

### 2. Ask: create new or connect existing

Ask the user ONE question:

> **How would you like to set up KB sync?**
> 1. **Create a new private repo** on GitHub (requires `gh` CLI)
> 2. **Connect to an existing repo** (provide the git URL)

### 3a. Create new repo

If the user chose "create new":

1. Ask for the repo name. Suggest `{project_name}-kb` as the default.
2. Verify `gh` CLI is available:
   ```bash
   gh --version
   ```
   If missing: "The `gh` CLI is required to create repos. Install it from https://cli.github.com/ or choose option 2 to connect manually." and stop.
3. Create the repo:
   ```bash
   gh repo create {repo_name} --private --confirm
   ```
4. Get the repo URL:
   ```bash
   gh repo view {repo_name} --json sshUrl --jq '.sshUrl'
   ```
   If SSH URL fails, fall back to HTTPS:
   ```bash
   gh repo view {repo_name} --json url --jq '.url'
   ```
5. Proceed to step 4 (initialize pm/).

### 3b. Connect to existing repo

If the user chose "connect existing":

1. Ask for the git URL (SSH or HTTPS).
2. Proceed to step 4.

### 4. Initialize pm/ with remote

Determine whether `pm/` already has content:

**If `pm/` has markdown files** (existing KB):

Run the setup script to init git and push:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" push 2>&1 || true
```

But first, manually set up the repo since the CLI script's push expects an existing git repo:

```bash
cd {pm_dir}
git init
git checkout -b main
git remote add origin {remote_url}
echo "*.local-conflict" > .gitignore
git add -A
git commit -m "Initial KB commit"
git push -u origin main
```

**If `pm/` is empty or doesn't exist:**

Clone the remote repo:

```bash
git clone {remote_url} {pm_dir}
```

If the clone is empty (new repo), the `pm/` directory will be created with just `.git/`. That's fine — `/pm:start` will scaffold it later.

### 5. Write sync config

Read `.pm/config.json`, set `sync.backend` to `"git"`, and write back. Preserve all other fields.

```javascript
// Conceptual — use actual file read/edit
config.sync = config.sync || {};
config.sync.backend = "git";
config.sync.enabled = true;
config.sync.auto_pull = true;
config.sync.auto_push = true;
```

### 6. Confirm

> Sync configured. Remote: `{remote_url}`
>
> - `/pm:sync push` — push changes
> - `/pm:sync pull` — pull changes
> - `/pm:sync status` — check sync state
>
> Auto-sync is enabled: pull on session start, push on session end.

## Done-when

The `pm/` directory is a git repo with a configured remote, the initial push succeeded (or clone succeeded), and `.pm/config.json` has `sync.backend: "git"`.

**Advance:** proceed to Step 3 (Auth Check) — which will skip since setup is the active route.
