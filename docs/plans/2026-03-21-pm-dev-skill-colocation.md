# PM-047: Colocate all 23 skills and 17 commands into a single plugin tree

**Date:** 2026-03-21
**Parent issue:** PM-044 (Merge PM and Dev plugins)
**Dev plugin source:** /Users/soelinmyat/Projects/dev

## Current State

| | PM | Dev | Combined target |
|---|---|---|---|
| Skills | 9 (dig, groom, ideate, ingest, refresh, research, setup, strategy, view) | 14 (brainstorming, bug-fix, debugging, design-critique, dev, dev-epic, merge-watch, pr, receiving-review, review, subagent-dev, tdd, using-dev, writing-plans) | 23 |
| Commands | 9 (dig, groom, ideate, ingest, refresh, research, setup, strategy, view) | 8 (bug-fix, dev-epic, dev, merge-watch, merge, pr, review, sync) | 17 |

No name collisions exist between the two sets.

## PM Symlink Convention

Every PM skill directory contains 5 symlinks pointing to shared plugin-root directories:

```
agents    -> ../../agents
commands  -> ../../commands
hooks     -> ../../hooks
scripts   -> ../../scripts
templates -> ../../templates
```

These give each skill access to the full plugin tree via relative paths within the skill directory, which is important for Codex (which lacks `CLAUDE_PLUGIN_ROOT` and needs filesystem-relative references).

## Dev Skill Inventory (what comes with each)

| Skill | Subdirectories/Extra files | Symlink infra needed? |
|---|---|---|
| brainstorming | `scripts/` (real content: server.cjs, start-server.sh, stop-server.sh, helper.js, frame-template.html), spec-reviewer.md, visual-companion.md | Yes, EXCEPT `scripts/` — do NOT overwrite with symlink |
| bug-fix | SKILL.md only | Yes (all 5 symlinks) |
| debugging | condition-based-waiting.md, defense-in-depth.md, find-polluter.sh, root-cause-tracing.md | Yes (all 5 symlinks) |
| design-critique | `references/` (capture-guide.md, designer-prompts.md, fresh-eyes-prompt.md, pm-prompts.md, seed-conventions.md) | Yes (all 5 symlinks) |
| dev | context-discovery.md, `references/` (custom-instructions.md), test-layers.md | Yes (all 5 symlinks) |
| dev-epic | `references/` (epic-review-prompts.md, implementation-flow.md, rfc-reviewer-prompts.md, state-template.md) | Yes (all 5 symlinks) |
| merge-watch | SKILL.md only | Yes (all 5 symlinks) |
| pr | SKILL.md only | Yes (all 5 symlinks) |
| receiving-review | SKILL.md only | Yes (all 5 symlinks) |
| review | SKILL.md only | Yes (all 5 symlinks) |
| subagent-dev | code-quality-reviewer.md, implementer.md, subagent-spec-reviewer.md | Yes (all 5 symlinks) |
| tdd | testing-anti-patterns.md | Yes (all 5 symlinks) |
| using-dev | SKILL.md only | Yes (all 5 symlinks) |
| writing-plans | plan-reviewer.md | Yes (all 5 symlinks) |

## Implementation Steps

### Step 1: Copy all 14 dev skills into PM's skills/ directory

```bash
cd /Users/soelinmyat/Projects/pm

for skill in brainstorming bug-fix debugging design-critique dev dev-epic \
  merge-watch pr receiving-review review subagent-dev tdd using-dev writing-plans; do
  cp -R /Users/soelinmyat/Projects/dev/skills/$skill skills/
done
```

### Step 2: Add symlink infrastructure to dev skills

For each newly-copied dev skill, create the 5 standard symlinks. **Exception:** `brainstorming` already has a real `scripts/` directory — skip the `scripts` symlink for it.

```bash
cd /Users/soelinmyat/Projects/pm

SYMLINKS="agents:../../agents commands:../../commands hooks:../../hooks scripts:../../scripts templates:../../templates"

for skill in bug-fix debugging design-critique dev dev-epic \
  merge-watch pr receiving-review review subagent-dev tdd using-dev writing-plans; do
  for pair in $SYMLINKS; do
    name="${pair%%:*}"
    target="${pair##*:}"
    ln -s "$target" "skills/$skill/$name"
  done
done

# brainstorming: all symlinks EXCEPT scripts (real content lives there)
for pair in agents:../../agents commands:../../commands hooks:../../hooks templates:../../templates; do
  name="${pair%%:*}"
  target="${pair##*:}"
  ln -s "$target" "skills/brainstorming/$name"
done
```

### Step 3: Copy all 8 dev commands into PM's commands/ directory

```bash
cp /Users/soelinmyat/Projects/dev/commands/*.md /Users/soelinmyat/Projects/pm/commands/
```

This copies: bug-fix.md, dev-epic.md, dev.md, merge-watch.md, merge.md, pr.md, review.md, sync.md.

### Step 4: Verify `${CLAUDE_PLUGIN_ROOT}/skills/{name}/SKILL.md` references resolve

All dev commands use the pattern `${CLAUDE_PLUGIN_ROOT}/skills/{name}/SKILL.md`. Since we're copying skills into the same `skills/` directory, these references will resolve correctly without modification — `CLAUDE_PLUGIN_ROOT` points to the PM plugin root at runtime.

**Verification:**

```bash
# Extract all skill references from dev commands and check they exist
grep -h 'CLAUDE_PLUGIN_ROOT.*skills/' commands/{bug-fix,dev-epic,dev,merge-watch,merge,pr,review,sync}.md | \
  sed 's/.*skills\//skills\//' | sed 's/\/.*//' | sort -u | \
  while read dir; do [ -d "$dir" ] && echo "OK: $dir" || echo "MISSING: $dir"; done
```

### Step 5: Verify cross-plugin CLAUDE_PLUGIN_ROOT references

Two cross-plugin references exist:

1. **dev-epic SKILL.md** references `${CLAUDE_PLUGIN_ROOT}/skills/dev/context-discovery.md` — resolves because both `dev-epic/` and `dev/` are now in `skills/`.
2. **dev SKILL.md** references `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/seed-conventions.md` and `capture-guide.md` — resolves because `design-critique/` is now in `skills/`.

**Verification:**

```bash
# Check that all CLAUDE_PLUGIN_ROOT paths in dev skill files resolve
grep -rh 'CLAUDE_PLUGIN_ROOT' skills/{dev,dev-epic,brainstorming,debugging,design-critique,subagent-dev,tdd,writing-plans,merge-watch,pr,receiving-review,review,bug-fix,using-dev}/SKILL.md 2>/dev/null | \
  grep -oP 'skills/[^ )`"]+' | sort -u | \
  while read path; do
    resolved="${path}"
    [ -e "$resolved" ] && echo "OK: $resolved" || echo "MISSING: $resolved"
  done
```

### Step 6: Verify PM skills with internal symlinks continue to work

```bash
# Test that existing PM skill symlinks are intact
for skill in dig groom ideate ingest refresh research setup strategy view; do
  for link in agents commands hooks scripts templates; do
    target=$(readlink "skills/$skill/$link" 2>/dev/null)
    if [ -n "$target" ]; then
      [ -e "skills/$skill/$link" ] && echo "OK: $skill/$link -> $target" || echo "BROKEN: $skill/$link -> $target"
    fi
  done
done
```

### Step 7: Update sync command

The copied `commands/sync.md` references the dev plugin cache path. This command needs to be updated to reference the PM plugin cache instead, or removed since PM already has its own sync workflow (described in AGENTS.md).

**Decision:** Remove `commands/sync.md` from the copied set — PM's sync workflow is documented in AGENTS.md and is project-specific. The sync command was dev-plugin specific.

Wait — actually, the sync command could be useful as a general "sync source to cache" command. However, it hardcodes `dev` paths. For now, **exclude sync.md** from the copy (making it 7 dev commands, 16 total). If a unified sync command is needed, it should be written fresh as part of a later issue.

**Revised count:** 9 PM commands + 7 dev commands = 16 commands. But the AC says 17. Let me recount:
- PM: dig, groom, ideate, ingest, refresh, research, setup, strategy, view = 9
- Dev: bug-fix, dev-epic, dev, merge-watch, merge, pr, review, sync = 8
- Total = 17

So sync.md must be included. **Update sync.md** to use PM plugin paths instead of dev-specific paths. The command is a convenience utility and should reference `${CLAUDE_PLUGIN_ROOT}` generically.

### Step 8: Fix sync.md for PM context

The sync command references `dev/dev` in cache paths. Update to reference `pm/pm` and detect plugin name from the plugin manifest.

### Step 9: Final count verification

```bash
echo "Skills: $(ls -d skills/*/ | wc -l | tr -d ' ')"
echo "Commands: $(ls commands/*.md | wc -l | tr -d ' ')"
# Expected: Skills: 23, Commands: 17
```

### Step 10: Handle dev's docs/ directory

Dev has a `docs/` directory with:
- `docs/decisions/` — 3 ADRs (ADR-0001 superseded, ADR-0002 accepted x2)
- `docs/superpowers/plans/` — 2 planning docs
- `docs/superpowers/specs/` — 1 spec

**Decision:** Exclude `docs/` from colocation. These are dev-plugin planning artifacts (ADRs about superpowers absorption, design-critique redesign plans). They are historical context for the dev plugin's evolution, not runtime behavior. PM already has its own `docs/plans/` for planning artifacts. If any ADR content is still load-bearing, it should be written as a new ADR in PM's `docs/` directory as part of the merge narrative (separate issue).

### Step 11: End-to-end smoke test

Verify that a cross-plugin skill chain resolves:

```bash
cd /Users/soelinmyat/Projects/pm

# 1. Verify all 23 skill directories exist with SKILL.md
for d in skills/*/; do
  skill=$(basename "$d")
  [ -f "$d/SKILL.md" ] && echo "OK: $skill" || echo "MISSING SKILL.md: $skill"
done

# 2. Verify all 17 command files exist
for f in commands/*.md; do
  echo "OK: $(basename $f)"
done

# 3. Verify cross-reference chain: dev-epic → dev/context-discovery.md
[ -f skills/dev/context-discovery.md ] && echo "OK: dev-epic → dev/context-discovery.md" || echo "FAIL"

# 4. Verify cross-reference chain: dev → design-critique/references/seed-conventions.md
[ -f skills/design-critique/references/seed-conventions.md ] && echo "OK: dev → design-critique references" || echo "FAIL"

# 5. Verify brainstorming/scripts/ has real content (not a symlink)
[ -d skills/brainstorming/scripts ] && [ ! -L skills/brainstorming/scripts ] && echo "OK: brainstorming/scripts is real dir" || echo "FAIL: brainstorming/scripts"

# 6. Verify new symlinks resolve
for skill in bug-fix debugging dev dev-epic; do
  [ -e skills/$skill/agents ] && echo "OK: $skill/agents symlink" || echo "BROKEN: $skill/agents"
done
```

## Summary of Operations

| # | Operation | Details |
|---|---|---|
| 1 | Copy 14 dev skills | `cp -R` from dev/skills/ to pm/skills/ |
| 2 | Add symlink infra | 5 symlinks per skill (4 for brainstorming — skip scripts/) |
| 3 | Copy 8 dev commands | `cp` from dev/commands/ to pm/commands/ |
| 4 | Fix sync.md | Update dev-specific cache paths to be generic/PM-compatible |
| 5 | Verify references | All `CLAUDE_PLUGIN_ROOT` paths resolve |
| 6 | Verify symlinks | PM originals intact, new ones resolve |
| 7 | Exclude dev docs/ | Historical ADRs, not runtime — exclude from colocation |
| 8 | Smoke test | 23 skills, 17 commands, cross-references chain |

## Risks

- **brainstorming/scripts/ overwrite**: Mitigated by explicitly skipping the scripts symlink for brainstorming.
- **sync.md dev-specific paths**: Mitigated by updating the command to use generic plugin detection.
- **Stale cross-references**: All verified at copy time; CI validation (`node scripts/validate.js --dir pm`) should catch regressions.

## Task Count: 8 tasks
