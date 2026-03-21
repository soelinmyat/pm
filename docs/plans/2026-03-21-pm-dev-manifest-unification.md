# PM-046: Manifest Unification Plan

**Date:** 2026-03-21
**Parent:** PM-044 (Merge PM and Dev plugins)
**Status:** Draft

---

## Overview

Unify all plugin manifests so the merged plugin installs on Claude Code, Cursor, Codex, and Gemini CLI with all 23 skills and 17 commands available on each platform.

### Current State

| Manifest | PM (this repo) | Dev (`/Projects/dev`) |
|---|---|---|
| `.claude-plugin/plugin.json` | v1.0.21, name "pm" | v0.3.2, name "dev" |
| `.cursor-plugin/plugin.json` | v1.0.21, name "pm" | Does not exist |
| `.claude-plugin/marketplace.json` | v1.0.21, name "pm" | **v0.1.1** (stale — should be v0.3.2) |
| `gemini-extension.json` | v1.0.21, name "pm" | Does not exist |
| `.codex/INSTALL.md` | 9 pm-* symlinks | Does not exist |

### Inventory

**Skills (23 total):**
- PM (9): setup, research, strategy, ideate, groom, dig, ingest, refresh, view
- Dev (14): dev, dev-epic, subagent-dev, using-dev, tdd, review, receiving-review, pr, merge-watch, bug-fix, debugging, brainstorming, design-critique, writing-plans

**Commands (17 total):**
- PM (9): setup.md, research.md, strategy.md, ideate.md, groom.md, dig.md, ingest.md, refresh.md, view.md
- Dev (8): dev.md, dev-epic.md, review.md, pr.md, merge-watch.md, bug-fix.md, merge.md, sync.md

**Agents (1):**
- PM: researcher.md
- Dev: none

**Hooks:**
- PM: SessionStart → `check-setup.sh`
- Dev: SessionStart → `check-setup.sh` + `session-start`

---

## Decisions

### 1. Plugin Name: `pm`

Keep `pm` as the plugin name. Rationale:
- PM is the established identity (v1.0.21 in marketplace, installed by users)
- The repo is `github.com/soelinmyat/pm` — renaming the repo would break existing installs
- Dev skills are additive capabilities under the same product umbrella
- Description will be updated to reflect the broader product engineer scope

### 2. Version: `v1.1.0`

Continue PM's version lineage. Use `v1.1.0` (minor bump) to signal the feature addition (dev skills merged in) without breaking the established version chain. Rationale:
- PM is at v1.0.21, dev at v0.3.2
- A minor bump signals "new capabilities added" per semver
- Avoids the confusion of v2.0.0 (implies breaking changes, which there are none for PM users)

### 3. Description Update

Old: "Product Memory — structured research, competitive intelligence, and feature grooming that compounds over time"

New: "Structured workflows for the product engineer — from discovery and strategy through implementation and merge"

This aligns with the PM-045 strategy rewrite targeting product engineers.

### 4. Repository: `github.com/soelinmyat/pm`

Target repo stays as-is. `check-setup.sh` line 71 already points to `https://github.com/soelinmyat/pm.git` — no change needed. Dev's git history will be handled by PM-047 (colocate skills), not this manifest task.

### 5. Dev's Stale marketplace.json

Dev's `marketplace.json` is at v0.1.1 while its `plugin.json` is at v0.3.2. Resolution: this inconsistency becomes irrelevant once dev is merged into PM. The dev repo's manifests will not be used post-merge. No action needed on the dev repo itself — the unified manifests in this repo supersede both.

---

## Manifest Changes

### A. `.claude-plugin/plugin.json`

```json
{
  "name": "pm",
  "description": "Structured workflows for the product engineer — from discovery and strategy through implementation and merge",
  "version": "1.1.0",
  "author": { "name": "Soe Lin Myat" },
  "homepage": "https://github.com/soelinmyat/pm",
  "repository": "https://github.com/soelinmyat/pm",
  "license": "MIT",
  "keywords": [
    "product-management", "competitive-intelligence", "grooming", "research", "discovery",
    "development", "lifecycle", "tdd", "code-review", "orchestration", "workflow"
  ],
  "skills": "./skills/",
  "commands": "./commands/"
}
```

Changes:
- `description` → updated to unified product engineer positioning
- `version` → `1.1.0`
- `keywords` → merged from both plugins (PM's 5 + dev's 6)
- `skills` and `commands` paths stay the same (PM-047 will colocate all skill/command files into these directories)

Note: Claude Code's plugin.json does not need explicit skill/command listings — the directory paths are sufficient. The 23 skills and 17 commands will be discovered from the directories after PM-047 colocates them.

### B. `.cursor-plugin/plugin.json`

```json
{
  "name": "pm",
  "displayName": "PM",
  "description": "Structured workflows for the product engineer — from discovery and strategy through implementation and merge",
  "version": "1.1.0",
  "author": { "name": "Soe Lin Myat" },
  "homepage": "https://github.com/soelinmyat/pm",
  "repository": "https://github.com/soelinmyat/pm",
  "license": "MIT",
  "keywords": [
    "product-management", "competitive-intelligence", "grooming", "research", "discovery",
    "development", "lifecycle", "tdd", "code-review", "orchestration", "workflow"
  ],
  "skills": "./skills/",
  "agents": "./agents/",
  "commands": "./commands/",
  "hooks": "./hooks/hooks.json"
}
```

Changes:
- `description` → updated to unified positioning
- `version` → `1.1.0`
- `keywords` → merged from both plugins

Cursor-specific fields (`displayName`, `agents`, `hooks`) remain. Dev had no Cursor manifest, so no fields to merge from dev.

### C. `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "pm",
  "owner": {
    "name": "Soe Lin Myat"
  },
  "plugins": [
    {
      "name": "pm",
      "description": "Structured workflows for the product engineer — from discovery and strategy through implementation and merge",
      "version": "1.1.0",
      "author": {
        "name": "Soe Lin Myat"
      },
      "source": "./",
      "category": "productivity",
      "homepage": "https://github.com/soelinmyat/pm"
    }
  ]
}
```

Changes:
- `description` → updated
- `version` → `1.1.0`
- `category` stays `productivity` (covers both PM and dev workflows)

### D. `gemini-extension.json`

```json
{
  "name": "pm",
  "contextFileName": "GEMINI.md",
  "version": "1.1.0"
}
```

Changes:
- `version` → `1.1.0`

### E. `GEMINI.md`

Updates needed:
1. **Title/intro** — update from "PM Plugin" to reflect unified product engineer identity
2. **Available Skills table** — add dev skills:

| Command | Description |
|---------|-------------|
| `/pm:setup` | First-time configuration: product context, market, integrations |
| `/pm:ingest <path>` | Import customer evidence from local files or folders |
| `/pm:strategy` | Generate and refine product positioning and strategic bets |
| `/pm:research <topic>` | Landscape mapping, competitor deep-dives, user signal analysis |
| `/pm:groom` | Convert strategy into groomed issues ready for sprint |
| `/pm:dig <question>` | Ad-hoc deep research on a specific question or topic |
| `/pm:refresh [scope]` | Audit research for staleness and patch without losing content |
| `/pm:view` | Browse and search accumulated research and strategy artifacts |
| `/dev:dev <issue>` | End-to-end feature implementation from issue to merge-ready PR |
| `/dev:dev-epic <epic>` | Multi-issue epic orchestration with teammate agents |
| `/dev:review` | Code review with structured critique |
| `/dev:pr` | Create pull request with summary and test plan |
| `/dev:merge-watch` | Monitor PR checks and merge when ready |
| `/dev:bug-fix` | Structured bug investigation and fix workflow |
| `/dev:sync` | Sync plugin source to cache for testing |

Note: Some dev skills (subagent-dev, using-dev, tdd, receiving-review, debugging, brainstorming, design-critique, writing-plans) are internal/sub-skills invoked by the main dev workflows, not user-facing commands. Only user-facing commands need to appear in GEMINI.md.

3. **Tool Mapping table** — no changes needed (Gemini tool equivalents are the same for dev skills)
4. **Subagent Limitation** — update to mention dev-epic also uses parallel agents (not just pm:research)

### F. `.codex/INSTALL.md`

Add 14 dev-* symlinks after the existing 9 pm-* symlinks:

```bash
# Existing PM skills (9)
ln -sfn ~/.agents/vendor/pm/skills/setup ~/.agents/skills/pm-setup
ln -sfn ~/.agents/vendor/pm/skills/research ~/.agents/skills/pm-research
ln -sfn ~/.agents/vendor/pm/skills/strategy ~/.agents/skills/pm-strategy
ln -sfn ~/.agents/vendor/pm/skills/ideate ~/.agents/skills/pm-ideate
ln -sfn ~/.agents/vendor/pm/skills/groom ~/.agents/skills/pm-groom
ln -sfn ~/.agents/vendor/pm/skills/dig ~/.agents/skills/pm-dig
ln -sfn ~/.agents/vendor/pm/skills/ingest ~/.agents/skills/pm-ingest
ln -sfn ~/.agents/vendor/pm/skills/refresh ~/.agents/skills/pm-refresh
ln -sfn ~/.agents/vendor/pm/skills/view ~/.agents/skills/pm-view

# Dev skills (14)
ln -sfn ~/.agents/vendor/pm/skills/dev ~/.agents/skills/dev-dev
ln -sfn ~/.agents/vendor/pm/skills/dev-epic ~/.agents/skills/dev-dev-epic
ln -sfn ~/.agents/vendor/pm/skills/subagent-dev ~/.agents/skills/dev-subagent-dev
ln -sfn ~/.agents/vendor/pm/skills/using-dev ~/.agents/skills/dev-using-dev
ln -sfn ~/.agents/vendor/pm/skills/tdd ~/.agents/skills/dev-tdd
ln -sfn ~/.agents/vendor/pm/skills/review ~/.agents/skills/dev-review
ln -sfn ~/.agents/vendor/pm/skills/receiving-review ~/.agents/skills/dev-receiving-review
ln -sfn ~/.agents/vendor/pm/skills/pr ~/.agents/skills/dev-pr
ln -sfn ~/.agents/vendor/pm/skills/merge-watch ~/.agents/skills/dev-merge-watch
ln -sfn ~/.agents/vendor/pm/skills/bug-fix ~/.agents/skills/dev-bug-fix
ln -sfn ~/.agents/vendor/pm/skills/debugging ~/.agents/skills/dev-debugging
ln -sfn ~/.agents/vendor/pm/skills/brainstorming ~/.agents/skills/dev-brainstorming
ln -sfn ~/.agents/vendor/pm/skills/design-critique ~/.agents/skills/dev-design-critique
ln -sfn ~/.agents/vendor/pm/skills/writing-plans ~/.agents/skills/dev-writing-plans
```

The vendor clone path stays `~/.agents/vendor/pm` (matches repo name). The `dev-` prefix prevents namespace collision (e.g., `dev-review` vs `pm-review` if PM ever adds a review skill).

Update the intro paragraph to mention both PM and dev capabilities. Update the verification section to show both `$pm-setup` and `$dev-dev` examples.

---

## Version Consistency Checklist

All 4 manifests must show `1.1.0` after this task:

- [ ] `.claude-plugin/plugin.json` → `1.1.0`
- [ ] `.cursor-plugin/plugin.json` → `1.1.0`
- [ ] `.claude-plugin/marketplace.json` → `1.1.0`
- [ ] `gemini-extension.json` → `1.1.0`
- [ ] `git tag v1.1.0` created

---

## Dependencies

- **PM-047 (Colocate skills/commands)** must complete first for the skill/command directories to contain all 23 skills and 17 commands. The manifest changes in this plan point to `./skills/` and `./commands/` — those directories need to be populated before the manifests are accurate.
- **PM-048 (Merge SessionStart hooks)** must complete for `hooks.json` to contain the merged hook configuration. The Cursor manifest points to `./hooks/hooks.json`.
- **PM-045 (Rewrite strategy.md)** informs the description wording but is not a blocker.

## Implementation Order

1. Wait for PM-047 (skills colocated) and PM-048 (hooks merged)
2. Update all 4 manifests with version, description, and keywords
3. Update `GEMINI.md` with dev skill routing
4. Update `.codex/INSTALL.md` with 14 new symlinks
5. Verify version consistency across all manifests
6. Run `node scripts/validate.js --dir pm` to confirm no regressions

## Tasks

1. Update `.claude-plugin/plugin.json` (description, version, keywords)
2. Update `.cursor-plugin/plugin.json` (description, version, keywords)
3. Update `.claude-plugin/marketplace.json` (description, version)
4. Update `gemini-extension.json` (version)
5. Update `GEMINI.md` (title, skills table, subagent note)
6. Update `.codex/INSTALL.md` (add 14 dev-* symlinks, update intro/verification)
7. Verify all 4 manifests share version `1.1.0`
8. Run validation
