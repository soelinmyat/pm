# PM Plugin: Codex Installation

PM integrates with Codex as a set of skills. Codex discovers user-installed skills from `~/.agents/skills` and project-local skills from `<project>/.agents/skills`.

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

### 2. Expose the PM skills to Codex

```bash
ln -sfn ~/.agents/vendor/pm/skills/setup ~/.agents/skills/pm-setup
ln -sfn ~/.agents/vendor/pm/skills/research ~/.agents/skills/pm-research
ln -sfn ~/.agents/vendor/pm/skills/strategy ~/.agents/skills/pm-strategy
ln -sfn ~/.agents/vendor/pm/skills/ideate ~/.agents/skills/pm-ideate
ln -sfn ~/.agents/vendor/pm/skills/groom ~/.agents/skills/pm-groom
ln -sfn ~/.agents/vendor/pm/skills/dig ~/.agents/skills/pm-dig
ln -sfn ~/.agents/vendor/pm/skills/ingest ~/.agents/skills/pm-ingest
ln -sfn ~/.agents/vendor/pm/skills/refresh ~/.agents/skills/pm-refresh
```

The skill folders in this repo already include symlinks to the shared `agents/`, `commands/`, `hooks/`, `scripts/`, and `templates/` directories that Codex may read while following the workflows.

### 3. Restart Codex

Restart Codex so it reloads the newly installed skills.

## Verification

Start a new Codex session and invoke one of the skills explicitly, for example:

```text
$pm-setup
```

If Codex does not find the skill:

1. Check that `~/.agents/skills/pm-setup/SKILL.md` exists.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

```bash
git -C ~/.agents/vendor/pm pull --ff-only
```

Your `~/.agents/skills/pm-*` symlinks do not need to be recreated unless you move the clone.

## Windows Notes

If you are installing on Windows, enable Developer Mode or use PowerShell as Administrator so the skill symlinks can be created successfully.
