# PM-051: Update Codex install guide for all 23 skills

**Date:** 2026-03-21
**Parent issue:** PM-044 (Merge PM and Dev plugins)
**Depends on:** PM-047 (Skill colocation — skills must exist in pm/skills/ before symlinks can be documented)

## Current State

The `.codex/INSTALL.md` file documents symlink commands for 9 PM skills only:

```
pm-setup, pm-research, pm-strategy, pm-ideate, pm-groom, pm-dig, pm-ingest, pm-refresh, pm-view
```

After PM-047 colocates 14 dev skills into the pm repo, the install guide must cover all 23 skills. The 14 dev skills need:

1. Symlink commands in INSTALL.md using `dev-*` prefix (namespace collision avoidance)
2. Internal symlinks to shared `agents/`, `commands/`, `hooks/`, `scripts/`, `templates/` directories (matching PM convention)
3. Tool mapping verification in `codex-tools.md`
4. A unified verification section

## Dev Skills to Add (14)

| # | Skill directory | Codex symlink name | Notes |
|---|---|---|---|
| 1 | brainstorming | dev-brainstorming | Has real `scripts/` dir — skip scripts symlink |
| 2 | bug-fix | dev-bug-fix | SKILL.md only |
| 3 | debugging | dev-debugging | Extra reference files |
| 4 | design-critique | dev-design-critique | Has `references/` subdir |
| 5 | dev | dev-dev | Has `references/` + extra .md files |
| 6 | dev-epic | dev-dev-epic | Has `references/` subdir |
| 7 | merge-watch | dev-merge-watch | SKILL.md only |
| 8 | pr | dev-pr | SKILL.md only |
| 9 | receiving-review | dev-receiving-review | SKILL.md only |
| 10 | review | dev-review | SKILL.md only |
| 11 | subagent-dev | dev-subagent-dev | Extra prompt .md files |
| 12 | tdd | dev-tdd | Extra reference file |
| 13 | using-dev | dev-using-dev | SKILL.md only |
| 14 | writing-plans | dev-writing-plans | Extra prompt .md file |

## PM Symlink Convention (from PM-047)

Every skill directory needs 5 symlinks to shared plugin-root directories:

```
agents    -> ../../agents
commands  -> ../../commands
hooks     -> ../../hooks
scripts   -> ../../scripts
templates -> ../../templates
```

**Exception:** `brainstorming` has a real `scripts/` directory with its own server code — it gets only 4 symlinks (skip `scripts`).

## Implementation Steps

### Task 1: Verify internal symlinks in dev skill directories (VERIFICATION ONLY)

PM-047 creates internal symlinks for all 14 dev skill directories. This task **verifies** they exist — it does NOT create them. If any are missing, report to orchestrator rather than re-creating (PM-047 should have handled it).

```bash
cd /Users/soelinmyat/Projects/pm

# Verify 13 skills have 5 symlinks each
for skill in bug-fix debugging design-critique dev dev-epic \
  merge-watch pr receiving-review review subagent-dev tdd using-dev writing-plans; do
  for name in agents commands hooks scripts templates; do
    [ -L "skills/$skill/$name" ] || echo "MISSING: skills/$skill/$name"
  done
done

# Verify brainstorming has 4 symlinks (scripts/ is real content, not a symlink)
for name in agents commands hooks templates; do
  [ -L "skills/brainstorming/$name" ] || echo "MISSING: skills/brainstorming/$name"
done

# Verify brainstorming/scripts is NOT a symlink
[ ! -L "skills/brainstorming/scripts" ] || echo "ERROR: brainstorming/scripts should be real content, not a symlink"
```

### Task 2: Update INSTALL.md section 2 — add dev skill symlinks

Add 14 new `ln -sfn` commands to section "2. Expose the PM skills to Codex" using the `dev-*` prefix:

```bash
# Dev skills (14)
ln -sfn ~/.agents/vendor/pm/skills/brainstorming ~/.agents/skills/dev-brainstorming
ln -sfn ~/.agents/vendor/pm/skills/bug-fix ~/.agents/skills/dev-bug-fix
ln -sfn ~/.agents/vendor/pm/skills/debugging ~/.agents/skills/dev-debugging
ln -sfn ~/.agents/vendor/pm/skills/design-critique ~/.agents/skills/dev-design-critique
ln -sfn ~/.agents/vendor/pm/skills/dev ~/.agents/skills/dev-dev
ln -sfn ~/.agents/vendor/pm/skills/dev-epic ~/.agents/skills/dev-dev-epic
ln -sfn ~/.agents/vendor/pm/skills/merge-watch ~/.agents/skills/dev-merge-watch
ln -sfn ~/.agents/vendor/pm/skills/pr ~/.agents/skills/dev-pr
ln -sfn ~/.agents/vendor/pm/skills/receiving-review ~/.agents/skills/dev-receiving-review
ln -sfn ~/.agents/vendor/pm/skills/review ~/.agents/skills/dev-review
ln -sfn ~/.agents/vendor/pm/skills/subagent-dev ~/.agents/skills/dev-subagent-dev
ln -sfn ~/.agents/vendor/pm/skills/tdd ~/.agents/skills/dev-tdd
ln -sfn ~/.agents/vendor/pm/skills/using-dev ~/.agents/skills/dev-using-dev
ln -sfn ~/.agents/vendor/pm/skills/writing-plans ~/.agents/skills/dev-writing-plans
```

Group the PM and dev blocks under clear subheadings for readability.

### Task 3: Update INSTALL.md intro text

Update the intro paragraph to mention both PM and dev workflows (23 skills total). Mention that the `pm-*` prefix is for product management skills and `dev-*` for development skills.

### Task 4: Verify codex-tools.md tool mapping covers dev skills

Review `skills/setup/references/codex-tools.md`. The current tool mapping is generic (Read→read_file, Bash→shell, etc.) and applies to all skills equally. Confirm that:

1. No dev-specific tools are missing from the mapping table
2. The `spawn_agent` / `collab = true` note covers subagent-dev skill needs
3. No additional entries are needed for dev skill workflows

If the mapping is already complete (likely — it's tool-level, not skill-level), document this as verified with no changes needed.

### Task 5: Update INSTALL.md verification section

Replace the single-skill verification example with a section that tests both PM and dev skills:

```text
## Verification

Start a new Codex session and invoke one PM skill and one dev skill:

$pm-setup
$dev-dev

If Codex does not find a skill:

1. Check that `~/.agents/skills/<skill-name>/SKILL.md` exists.
2. Confirm the symlink points at your PM clone.
3. Restart Codex again.

### Quick check: all 23 skills

ls ~/.agents/skills/pm-* ~/.agents/skills/dev-*
# Should list 9 pm-* and 14 dev-* directories
```

### Task 6: Validate all symlinks resolve end-to-end

Run a verification script that checks:

```bash
cd /Users/soelinmyat/Projects/pm

echo "=== Internal symlinks (shared dirs) ==="
for d in skills/*/; do
  skill=$(basename "$d")
  for link in agents commands hooks scripts templates; do
    if [ -L "$d$link" ]; then
      [ -e "$d$link" ] && echo "OK: $skill/$link" || echo "BROKEN: $skill/$link"
    fi
  done
done

echo ""
echo "=== Codex install symlinks (simulated) ==="
for d in skills/*/; do
  skill=$(basename "$d")
  [ -f "$d/SKILL.md" ] && echo "OK: $skill has SKILL.md" || echo "MISSING: $skill/SKILL.md"
done

echo ""
echo "=== Counts ==="
echo "Total skills: $(ls -d skills/*/ | wc -l | tr -d ' ')"
```

Expected: 23 skills, all internal symlinks resolve, all have SKILL.md.

## Acceptance Criteria Mapping

| AC | Task | How verified |
|---|---|---|
| 1. INSTALL.md updated with symlink commands for 14 dev skills | Tasks 2, 3 | `dev-*` symlink commands present in INSTALL.md |
| 2. Dev skill directories get symlinks to shared dirs | Task 1 | `ls -la skills/{dev-skill}/` shows 5 symlinks (4 for brainstorming) |
| 3. codex-tools.md tool mapping verified for dev skills | Task 4 | Review confirms no missing entries |
| 4. Verification section tests both PM and dev skills | Task 5 | INSTALL.md verification section references both prefixes |
| 5. dev-* prefix avoids namespace collision | Task 2 | All dev symlinks use `dev-` prefix; no overlap with `pm-` |

## Risks

- **PM-047 dependency:** Dev skills must be colocated before this work can run. If PM-047 is incomplete, Tasks 1 and 6 will fail.
- **brainstorming/scripts/ overwrite:** Explicitly handled — brainstorming gets 4 symlinks, not 5.
- **Naming: dev-dev and dev-dev-epic:** These look redundant but are correct (`dev-` prefix + skill name `dev` / `dev-epic`). The INSTALL.md should include a brief note explaining this.

## Task Count: 6 tasks
