# PM Plugin: Codex Installation

PM integrates with Codex as a set of skills across two domains: product management (`pm-*`) and development (`dev-*`). Codex discovers user-installed skills from `~/.agents/skills` and project-local skills from `<project>/.agents/skills`.

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
ln -sfn ~/.agents/vendor/pm/skills/setup ~/.agents/skills/pm-setup
ln -sfn ~/.agents/vendor/pm/skills/research ~/.agents/skills/pm-research
ln -sfn ~/.agents/vendor/pm/skills/strategy ~/.agents/skills/pm-strategy
ln -sfn ~/.agents/vendor/pm/skills/groom ~/.agents/skills/pm-groom
ln -sfn ~/.agents/vendor/pm/skills/ingest ~/.agents/skills/pm-ingest
ln -sfn ~/.agents/vendor/pm/skills/refresh ~/.agents/skills/pm-refresh
ln -sfn ~/.agents/vendor/pm/skills/view ~/.agents/skills/pm-view
```

#### Development skills (11)

```bash
ln -sfn ~/.agents/vendor/pm/skills/bug-fix ~/.agents/skills/dev-bug-fix
ln -sfn ~/.agents/vendor/pm/skills/debugging ~/.agents/skills/dev-debugging
ln -sfn ~/.agents/vendor/pm/skills/design-critique ~/.agents/skills/dev-design-critique
ln -sfn ~/.agents/vendor/pm/skills/dev ~/.agents/skills/dev-dev
ln -sfn ~/.agents/vendor/pm/skills/dev-epic ~/.agents/skills/dev-dev-epic
ln -sfn ~/.agents/vendor/pm/skills/ship ~/.agents/skills/dev-ship
ln -sfn ~/.agents/vendor/pm/skills/receiving-review ~/.agents/skills/dev-receiving-review
ln -sfn ~/.agents/vendor/pm/skills/review ~/.agents/skills/dev-review
ln -sfn ~/.agents/vendor/pm/skills/subagent-dev ~/.agents/skills/dev-subagent-dev
ln -sfn ~/.agents/vendor/pm/skills/tdd ~/.agents/skills/dev-tdd
ln -sfn ~/.agents/vendor/pm/skills/using-pm ~/.agents/skills/dev-using-pm
```

#### Shared (1)

```bash
ln -sfn ~/.agents/vendor/pm/skills/sync ~/.agents/skills/pm-sync
```

> **Note:** `dev-dev` and `dev-dev-epic` are correct — the `dev-` prefix plus the skill name `dev` / `dev-epic`.

### 3. Restart Codex

Restart Codex so it reloads the newly installed skills.

## Verification

Start a new Codex session and invoke one PM skill and one dev skill:

```text
$pm-groom
$dev-dev
```

If Codex does not find a skill:

1. Check that `~/.agents/skills/<skill-name>/SKILL.md` exists.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

### Quick check: all 19 skills

```bash
ls -d ~/.agents/skills/pm-* ~/.agents/skills/dev-*
# Should list 8 pm-* and 11 dev-* directories
```

## Updating

Pull the latest changes in the vendor clone, then restart Codex:

```bash
git -C ~/.agents/vendor/pm pull --ff-only
```

Your `~/.agents/skills/pm-*` and `~/.agents/skills/dev-*` symlinks do not need to be recreated unless you move the clone.

## Windows Notes

If you are installing on Windows, enable Developer Mode or use PowerShell as Administrator so the skill symlinks can be created successfully.
