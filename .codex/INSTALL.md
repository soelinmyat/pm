# PM Plugin: Codex Installation

PM now ships a native Codex plugin manifest at `.codex-plugin/plugin.json`.

Until your Codex install loads this repository as a plugin directly, the generated skill-symlink flow below remains the compatible fallback. It uses the same canonical plugin metadata and current skill inventory as the other platform manifests.

When Codex loads PM as a native plugin, product skills appear under the plugin namespace, including `pm:think`, `pm:ideate`, `pm:strategy`, `pm:features`, `pm:groom`, `pm:research`, `pm:ingest`, and `pm:refresh`. Product-reasoning skills keep Markdown as the primary reader while writing small validated JSON companions for stable decisions, ranking, promotion, and feature identity.

The fallback symlink flow below creates explicit `pm-*` aliases on disk for every PM workflow, including build and ship flows. Codex discovers user-installed skills from `~/.agents/skills` and project-local skills from `<project>/.agents/skills`.

`pm:simplify` remains only as a compatibility alias and redirects to `pm:review`; it is not a separate workflow or delivery gate.

In current Codex builds, fresh sessions still surface the usable PM workflows under skill names such as `pm:groom` and `pm:dev`. Treat the alias directory names as an installation detail, not the public skill names.

Runtime note: PM skill text may still mention `${CLAUDE_PLUGIN_ROOT}` because the Claude command contract historically used that placeholder. In Codex, treat it as a legacy alias for the PM plugin root. For shell commands that run PM scripts, set `PM_PLUGIN_ROOT` to your PM clone or loaded plugin root, for example `export PM_PLUGIN_ROOT=~/.agents/vendor/pm`. PM subprocess dispatch exports both `PM_PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` automatically.

## Loop scheduler release gate

Do not install or resume unattended scheduling until one supervised run of each safety
case passes with the same plugin version, source commit, resolved configuration, and
engine identity:

Set `CLEANLOG_ROOT` to the absolute consumer project root. Set `CANARY_CARD` to an
eligible approved card that is expected to produce an OPEN PR, then run the exact
commands from the installed PM plugin root:

```bash
cd "$PM_PLUGIN_ROOT"
```

```bash
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case preflight-failure
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case blocked-result
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case verified-pr --card "$CANARY_CARD" --no-merge
```

The records live under `.pm/loop-canary/<run_id>/`. Missing, stale, mixed-identity, or
failed records keep the scheduler paused or uninstalled. The verified-PR case never
merges and requires `autonomy.merge_pr: false`. Broad engine permissions and merge
autonomy produce explicit exposure warnings. PM records `usage_available: false` when
an engine has no structured usage and does not support exact token cutoffs in that case.
Generated launchd/cron assets are previews only. `--install` owns activation and marks
unattended wakes with `--scheduled`; each scheduled wake rechecks the current evidence
identity before claiming work.
Unmarked worker CLI invocations also default to scheduler-safe gating for legacy
scheduler entries; an explicitly supervised one-off worker run uses `--manual`.

The instructions below install PM for your user account. If you prefer a repo-local install, replace `~/.agents` with `<project>/.agents`.

## Prerequisites

- Codex installed and authenticated
- Git

## Install

### 1. Clone PM into a stable vendor path

```bash
mkdir -p ~/.agents/vendor ~/.agents/skills
git clone https://github.com/soelinmyat/pm ~/.agents/vendor/pm
```

### 2. Expose the skills to Codex

#### PM skills (24)

```bash
ln -sfn ~/.agents/vendor/pm/skills/start ~/.agents/skills/pm-start
ln -sfn ~/.agents/vendor/pm/skills/setup ~/.agents/skills/pm-setup
ln -sfn ~/.agents/vendor/pm/skills/research ~/.agents/skills/pm-research
ln -sfn ~/.agents/vendor/pm/skills/strategy ~/.agents/skills/pm-strategy
ln -sfn ~/.agents/vendor/pm/skills/groom ~/.agents/skills/pm-groom
ln -sfn ~/.agents/vendor/pm/skills/ideate ~/.agents/skills/pm-ideate
ln -sfn ~/.agents/vendor/pm/skills/think ~/.agents/skills/pm-think
ln -sfn ~/.agents/vendor/pm/skills/ingest ~/.agents/skills/pm-ingest
ln -sfn ~/.agents/vendor/pm/skills/board ~/.agents/skills/pm-board
ln -sfn ~/.agents/vendor/pm/skills/list ~/.agents/skills/pm-list
ln -sfn ~/.agents/vendor/pm/skills/loop ~/.agents/skills/pm-loop
ln -sfn ~/.agents/vendor/pm/skills/note ~/.agents/skills/pm-note
ln -sfn ~/.agents/vendor/pm/skills/refresh ~/.agents/skills/pm-refresh
ln -sfn ~/.agents/vendor/pm/skills/features ~/.agents/skills/pm-features
ln -sfn ~/.agents/vendor/pm/skills/rfc ~/.agents/skills/pm-rfc
ln -sfn ~/.agents/vendor/pm/skills/sync ~/.agents/skills/pm-sync
ln -sfn ~/.agents/vendor/pm/skills/design-critique ~/.agents/skills/pm-design-critique
ln -sfn ~/.agents/vendor/pm/skills/dev ~/.agents/skills/pm-dev
ln -sfn ~/.agents/vendor/pm/skills/ship ~/.agents/skills/pm-ship
ln -sfn ~/.agents/vendor/pm/skills/simplify ~/.agents/skills/pm-simplify
ln -sfn ~/.agents/vendor/pm/skills/review ~/.agents/skills/pm-review
ln -sfn ~/.agents/vendor/pm/skills/task ~/.agents/skills/pm-task
ln -sfn ~/.agents/vendor/pm/skills/bug ~/.agents/skills/pm-bug
ln -sfn ~/.agents/vendor/pm/skills/using-pm ~/.agents/skills/pm-using-pm
```

### 3. Restart Codex

Restart Codex so it reloads the newly installed skills.

## Verification

Start a new Codex session and verify that Codex exposes one PM skill and one dev workflow skill:

```text
pm:groom
pm:dev
```

If Codex does not find a skill:

1. Check that the fallback alias directories exist, for example `~/.agents/skills/pm-groom/SKILL.md` and `~/.agents/skills/pm-dev/SKILL.md`.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

### Quick check: all 24 skills

```bash
ls -d ~/.agents/skills/pm-*
# Should list 24 pm-* directories
```

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

```bash
git -C ~/.agents/vendor/pm pull --ff-only
```

Your `~/.agents/skills/pm-*` symlinks do not need to be recreated unless you move the clone.

## Dogfooding Local Source

If you are developing PM from a local checkout and want Codex to use that checkout immediately, sync the local source into the vendor clone, then restart Codex and start a new session:

```bash
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  /absolute/path/to/pm_plugin/ \
  ~/.agents/vendor/pm/
```

Notes:

1. Codex reads PM from `~/.agents/vendor/pm` in a fresh session. Existing sessions do not hot-reload skills.
2. If you added or renamed skills, rerun the symlink commands from step 2 so `~/.agents/skills` stays in sync.

## Windows Notes

If you are installing on Windows, enable Developer Mode or use PowerShell as Administrator so the skill symlinks can be created successfully.
