# PM Plugin: Codex Installation

PM now ships a native Codex plugin manifest at `.codex-plugin/plugin.json`.

Until your Codex install loads this repository as a plugin directly, the generated skill-symlink flow below remains the compatible fallback. It uses the same canonical plugin metadata and current skill inventory as the other platform manifests.

When Codex loads PM as a native plugin, product skills appear under the plugin namespace as `pm:groom`, `pm:research`, `pm:strategy`, `pm:ingest`, and `pm:refresh`.

The fallback symlink flow below creates explicit aliases across two domains on disk: product management (`pm-*`) and development (`dev-*`). Codex discovers user-installed skills from `~/.agents/skills` and project-local skills from `<project>/.agents/skills`.

In current Codex builds, fresh sessions still surface the usable PM workflows under skill names such as `pm:groom` and `pm:dev`. Treat the alias directory names as an installation detail, not the public skill names.

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

#### Product management skills (7)

```bash
ln -sfn ~/.agents/vendor/pm/skills/start ~/.agents/skills/pm-start
ln -sfn ~/.agents/vendor/pm/skills/research ~/.agents/skills/pm-research
ln -sfn ~/.agents/vendor/pm/skills/strategy ~/.agents/skills/pm-strategy
ln -sfn ~/.agents/vendor/pm/skills/groom ~/.agents/skills/pm-groom
ln -sfn ~/.agents/vendor/pm/skills/think ~/.agents/skills/pm-think
ln -sfn ~/.agents/vendor/pm/skills/ingest ~/.agents/skills/pm-ingest
ln -sfn ~/.agents/vendor/pm/skills/refresh ~/.agents/skills/pm-refresh
```

#### Development skills (11)

```bash
ln -sfn ~/.agents/vendor/pm/skills/debugging ~/.agents/skills/dev-debugging
ln -sfn ~/.agents/vendor/pm/skills/design-critique ~/.agents/skills/dev-design-critique
ln -sfn ~/.agents/vendor/pm/skills/dev ~/.agents/skills/dev-dev
ln -sfn ~/.agents/vendor/pm/skills/qa ~/.agents/skills/dev-qa
ln -sfn ~/.agents/vendor/pm/skills/review ~/.agents/skills/dev-review
ln -sfn ~/.agents/vendor/pm/skills/ship ~/.agents/skills/dev-ship
ln -sfn ~/.agents/vendor/pm/skills/simplify ~/.agents/skills/dev-simplify
ln -sfn ~/.agents/vendor/pm/skills/subagent-dev ~/.agents/skills/dev-subagent-dev
ln -sfn ~/.agents/vendor/pm/skills/tdd ~/.agents/skills/dev-tdd
ln -sfn ~/.agents/vendor/pm/skills/using-pm ~/.agents/skills/dev-using-pm
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

1. Check that the fallback alias directories exist, for example `~/.agents/skills/pm-groom/SKILL.md` and `~/.agents/skills/dev-dev/SKILL.md`.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

### Quick check: all 18 skills

```bash
ls -d ~/.agents/skills/pm-* ~/.agents/skills/dev-*
# Should list 7 pm-* and 11 dev-* directories
```

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

```bash
git -C ~/.agents/vendor/pm pull --ff-only
```

Your `~/.agents/skills/pm-*` and `~/.agents/skills/dev-*` symlinks do not need to be recreated unless you move the clone.

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
