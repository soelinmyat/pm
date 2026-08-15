---
name: Setup
order: 2
description: Interactive setup — choose a backend (git or productmemory.io), then configure it
---

## Goal

Configure KB sync for the `pm/` directory: either git (full-file sync to a repo) or productmemory.io (record-level sync to the hosted dashboard).

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

If already configured (`"git"` or `"productmemory"`), describe the current setup and ask:

> Sync is already configured ({backend}). Want to reconfigure?

If the user says no, stop.

### 2. Ask: which backend

Ask the user ONE question (yes/no):

> **Do you want to sync to productmemory.io?** It gives you a hosted dashboard of your evidence, insights, and backlog. (If not, I'll set up git sync — full-file backup of everything in `pm/`.)

- **Yes** → follow the **productmemory backend** section below, then stop (skip the git sections).
- **No** → continue with the git flow (section 3).

### Productmemory backend

1. Ask for the project slug or key (ONE question). If `.pm/config.json` has a project name, suggest it as the default:

   > What's your productmemory project slug? (Create one at https://productmemory.io/settings if you haven't.)

2. Ask for an API token (ONE question):

   > Paste an API token from https://productmemory.io/settings (Tokens section).

3. Store the token in `~/.pm/credentials` (JSON, key `productmemory_token`, mode 0600). Preserve any other keys in that file. Never write the token into `.pm/config.json` or anywhere inside `pm/`.

4. Update `.pm/config.json`, preserving all other fields:

   ```javascript
   config.sync = config.sync || {};
   config.sync.backend = "productmemory";
   config.sync.enabled = true;
   config.sync.auto_pull = true;
   config.sync.auto_push = true;
   config.sync.project = "{slug}";
   // config.sync.url only if the user runs a self-hosted instance; defaults to https://productmemory.io
   ```

5. Verify the connection and run the first sync:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-pm.js" sync
   ```

   Read `{pm_state_dir}/sync-status.json`. On auth failure, surface the error and ask for a fresh token. On success:

   > Sync configured. Backend: productmemory.io, project `{slug}`.
   > Pushed {uploaded} records, pulled {downloaded}.
   >
   > Note: only record files (evidence, insights, backlog) sync to productmemory. `strategy.md`, `memory.md`, and HTML artifacts stay local — use the git backend if you need full-file backup too.
   >
   > Auto-sync is enabled: pull on session start, push on session end.

   Then stop — the git sections below don't apply.

### 3. Git: create new or connect existing

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

Repository ownership is a hard boundary. If the consumer project's parent Git
repository already tracks files under `pm/`, the helper refuses to turn that
directory into a nested repository. Report the refusal and offer
`/pm:setup separate-repo`; do not untrack files, move history, or create a
nested `.git` automatically. An already independent PM repository, including a
linked worktree, keeps its existing ownership.

Determine whether `pm/` already has content:

**If `pm/` has markdown files** (existing KB):

Run the setup helper to initialize Git, preserve its ignore contract, configure
the remote, create the initial commit when needed, and push:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" setup "{remote_url}"
```

**If `pm/` is empty or doesn't exist:**

Clone through the same helper so collision and path checks remain consistent:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kb-sync-git.js" clone "{remote_url}"
```

If the clone is empty (new repo), the `pm/` directory will be created with just `.git/`. That's fine — `/pm:start` will scaffold it later.

On either helper failure, report its structured error and stop. Do not fall back
to raw Git or repeat the effect blindly.

For an established repository, setup uses its attached current branch. Later
sync operations follow that branch's configured upstream, regardless of remote
or branch name. Detached HEAD or a missing upstream is a blocking configuration
error with repair guidance, not a reason to assume `origin/main`.

The explicit setup request is the action-specific `configure_sync` authority
grant. The helper journals it in `{pm_state_dir}/effects/`, observes an existing
matching remote before retrying, and reports `verified`, `blocked`, or
`ambiguous`. Only proceed on `verified`; for any other state show the returned
recovery action.

### 5. Write sync config

Apply the sync fields as one atomic, journaled config effect. Preserve all other
fields and require a verified receipt:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/config-effect.js" \
  --set-json sync.backend '"git"' \
  --set-json sync.enabled 'true' \
  --set-json sync.auto_pull 'true' \
  --set-json sync.auto_push 'true' \
  --authorize update_config
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

Setup either stops safely on declined/missing authority or leaves verified
receipts for the git remote/upstream effect and the preserved config update,
plus a readable confirmation.

**Advance:** proceed to Step 3 (Auth Check); it skips when setup was the terminal route.
