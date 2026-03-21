# Remove Commands Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all 17 command files, preserve sync/view inline logic as skills, update manifests and routing table so the codebase matches the skill-only architecture that is already the runtime reality.

**Architecture:** Commands are thin wrappers that delegate to skills. Two commands (`sync.md`, `view.md`) contain inline logic not yet captured in skills. We create a sync skill, verify the view skill, update the using-pm routing table to cover all workflows, strip the `"commands"` key from both plugin.json manifests, then delete the commands/ directory.

**Tech Stack:** Markdown (skills), JSON (manifests), Bash (validation)

---

## Upstream Context

> From backlog issue PM-058 (`pm/backlog/remove-commands-infrastructure.md`).

### Key Findings
- 15 of 17 commands are one-line wrappers that just say "read SKILL.md and follow it" — zero logic to preserve
- `sync.md` has a complete rsync workflow (version detection, source resolution, sync execution, version rename) with no corresponding skill
- `view.md` invokes `node ${CLAUDE_PLUGIN_ROOT}/scripts/server.js --mode dashboard --dir` directly, while `skills/view/SKILL.md` uses `scripts/start-server.sh --project-dir "$PWD" --mode dashboard` — different invocation paths
- `commands/merge.md` points to the `# /merge` section of `skills/merge-watch/SKILL.md` — this workflow needs a distinct using-pm routing entry
- The SessionStart hook already preloads using-pm, making commands truly redundant

### Groom Conditions
- No dead command references may remain in manifests or directory structure
- All 23 skills remain invokable after removal
- Version bump across all 4 manifests as final commit

---

### Task 1: Create `skills/sync/SKILL.md`

**Files:**
- Create: `skills/sync/SKILL.md`
- Reference: `commands/sync.md` (source of inline logic)

- [ ] **Step 1: Create the sync skill directory**

```bash
mkdir -p /Users/soelinmyat/Projects/pm/skills/sync
```

- [ ] **Step 2: Write `skills/sync/SKILL.md`**

Create the skill file with frontmatter and the rsync workflow logic from `commands/sync.md`. The skill must:
- Have proper frontmatter (`name: sync`, `description: "Sync plugin source to Claude Code cache for immediate testing"`)
- Include all 6 steps from `commands/sync.md`: version detection, source directory resolution, version comparison, rsync execution, optional cache rename, success report
- Preserve the exact rsync flags and exclude patterns: `--exclude='.git' --exclude='pm/' --exclude='.pm/' --exclude='node_modules/' --exclude='.planning/'`
- Use `${CLAUDE_PLUGIN_ROOT}` references where appropriate for the skill context (the skill runs from the installed plugin, but the source directory is what the user wants to sync FROM)

Content to write:

```markdown
---
name: sync
description: "Sync plugin source to Claude Code cache for immediate testing"
---

# pm:sync

## Purpose

Copy the plugin source code to the Claude Code plugin cache so changes take effect immediately without waiting for a publish cycle.

## Flow

1. Detect the current cached version:

```bash
VERSION=$(cat ~/.claude/plugins/cache/pm/pm/*/plugin.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"//;s/".*//' || echo "1.0.0")
echo "Detected cache version: $VERSION"
```

2. Determine the source directory. Check in order:
   - If CWD is inside the plugin source (has `.claude-plugin/plugin.json` with `"name": "pm"`): use CWD
   - Otherwise try `~/Projects/pm`
   - If neither works, ask the user for the source path

3. Read the source version from the source `.claude-plugin/plugin.json` and compare with cache version. Warn if they differ.

4. Run the sync:

```bash
SOURCE_DIR="${SOURCE_DIR}"  # determined above
CACHE_DIR="$HOME/.claude/plugins/cache/pm/pm/${VERSION}"

rsync -av --delete \
  --exclude='.git' \
  --exclude='pm/' \
  --exclude='.pm/' \
  --exclude='node_modules/' \
  --exclude='.planning/' \
  "$SOURCE_DIR/" \
  "$CACHE_DIR/"
```

5. If the source version differs from the cache version, rename the cache directory:

```bash
NEW_VERSION=$(grep '"version"' "$SOURCE_DIR/.claude-plugin/plugin.json" | sed 's/.*"version": *"//;s/".*//')
if [ "$NEW_VERSION" != "$VERSION" ]; then
  NEW_CACHE="$HOME/.claude/plugins/cache/pm/pm/$NEW_VERSION"
  mv "$CACHE_DIR" "$NEW_CACHE"
  echo "Cache directory renamed: $VERSION → $NEW_VERSION"
fi
```

6. Report success: which files changed, new version if bumped, and remind the user to restart any active Claude Code sessions to pick up the changes.
```

- [ ] **Step 3: Verify the skill file is well-formed**

Read back `skills/sync/SKILL.md` and confirm:
- Frontmatter has `name` and `description`
- All 6 steps from `commands/sync.md` are present
- rsync exclude list matches: `.git`, `pm/`, `.pm/`, `node_modules/`, `.planning/`

- [ ] **Step 4: Commit**

```bash
git add skills/sync/SKILL.md
git commit -m "feat: create sync skill from command inline logic"
```

---

### Task 2: Verify view skill matches command behavior

**Files:**
- Read: `commands/view.md`
- Read: `skills/view/SKILL.md`
- Read: `scripts/start-server.sh` (lines 1-50)
- Modify (if needed): `skills/view/SKILL.md`

The command invokes `node ${CLAUDE_PLUGIN_ROOT}/scripts/server.js --mode dashboard --dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"` directly. The skill invokes `bash <resolved-skill-dir>/scripts/start-server.sh --project-dir "$PWD" --mode dashboard`. These are different invocation paths.

- [ ] **Step 1: Trace the `start-server.sh` invocation path**

Read `scripts/start-server.sh` and verify:
- It accepts `--mode dashboard` and passes it to `server.js` — confirmed (line 3 shows `--mode <companion|dashboard>`)
- It accepts `--project-dir` and resolves the pm data directory — confirmed (line 9 shows `--project-dir <path>`)
- The `--project-dir` flag in `start-server.sh` results in the server reading from `<project-dir>/pm/` — same as `--dir "${CLAUDE_PROJECT_DIR:-$PWD}/pm"` in the command

Key behavioral difference: the command passes `--dir` pointing directly to the `pm/` subdirectory, while `start-server.sh` accepts `--project-dir` (the parent) and internally appends `/pm`. Verify this is functionally equivalent by reading `start-server.sh` lines around PROJECT_DIR usage and `server.js` startup.

- [ ] **Step 2: Confirm the view skill resolves `scripts/start-server.sh` correctly**

The skill says `<resolved-skill-dir>/scripts/start-server.sh`. The skill lives at `skills/view/SKILL.md`. There is NO `skills/view/scripts/start-server.sh` — the actual script is at `scripts/start-server.sh` (repo root scripts dir).

The AI agent resolving `<resolved-skill-dir>` will look for the script relative to the skill directory. If this fails at runtime, the skill needs to reference the correct path. Check whether the AI resolves this correctly by examining how other skills reference `start-server.sh` (e.g., `skills/brainstorming/scripts/start-server.sh` exists as a copy).

If the view skill cannot resolve to the correct script, update the SKILL.md to reference `${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh` explicitly.

- [ ] **Step 3: Update view skill if divergence found**

If Step 1 or Step 2 reveals a behavioral divergence, update `skills/view/SKILL.md` to match the command behavior:
- Ensure `--mode dashboard` is passed
- Ensure the data directory resolves to `<project-root>/pm`
- Ensure the server is accessible at the returned localhost URL

If no divergence: no changes needed, document the verification.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add skills/view/SKILL.md
git commit -m "fix: align view skill server invocation with command behavior"
```

---

### Task 3: Update using-pm routing table

**Files:**
- Modify: `skills/using-pm/SKILL.md`

Three workflows need explicit entries in the routing table: `sync`, `merge`, and `view`.

Current state:
- `view` exists as `pm:view` in the Product Skills table — but verify description includes a natural-language trigger
- `sync` is missing entirely — no routing entry
- `merge` is missing as a distinct entry — `merge-watch` exists but `merge` (manual merge without polling) does not

- [ ] **Step 1: Add `sync` to the Product Skills table**

Add a row to the Product Skills table:

```
| Sync source to cache for testing | `pm:sync` | Immediate dev loop without publish |
```

- [ ] **Step 2: Add `merge` as a distinct Development Skills entry**

Add a row to the Development Skills table, with a description that distinguishes it from `merge-watch`:

```
| Manual merge — merge a PR, delete remote branch, clean up local branch and worktree | `dev:merge` | Manual merge without polling loop — merge a PR, delete remote branch, clean up local branch and worktree |
```

The `merge` entry must be distinct from `merge-watch`. The description must convey "manual merge without polling" so the AI selects `dev:merge-watch` (the skill that contains the `# /merge` section) and follows the `# /merge` section, not the polling loop.

**Important design note from AC6:** The `merge` entry in the routing table triggers `dev:merge-watch` as the Skill tool invocation (since the `/merge` section lives inside `skills/merge-watch/SKILL.md`). The description text is what guides the AI to follow the correct section. No "section flag" parameter exists.

Update the table entry to be:

```
| Merge a PR manually (no polling) | `dev:merge-watch` | Manual merge without polling loop — merge a PR, delete remote branch, clean up local branch and worktree. Follow the `# /merge` section. |
```

- [ ] **Step 3: Verify `view` entry has natural-language trigger**

Check the existing `pm:view` row. It currently says:

```
| Browse accumulated artifacts | `pm:view` | Search and navigate research/strategy |
```

Update the trigger to be more natural-language friendly:

```
| Open dashboard / browse accumulated artifacts | `pm:view` | Launch the PM knowledge base dashboard to browse landscape, strategy, competitors, and backlog |
```

- [ ] **Step 4: Verify all 17 previously command-accessible workflows have trigger entries**

Cross-reference the 17 commands against the routing table:

| Command | Expected Skill Entry | Status |
|---------|---------------------|--------|
| bug-fix.md | `dev:bug-fix` | Already exists |
| dev-epic.md | `dev:dev-epic` | Already exists |
| dev.md | `dev:dev` | Already exists |
| dig.md | `pm:dig` | Already exists |
| groom.md | `pm:groom` | Already exists |
| ideate.md | `pm:ideate` | Already exists |
| ingest.md | `pm:ingest` | Already exists |
| merge-watch.md | `dev:merge-watch` | Already exists |
| merge.md | `dev:merge-watch` (# /merge section) | **Adding in Step 2** |
| pr.md | `dev:pr` | Already exists |
| refresh.md | `pm:refresh` | Already exists |
| research.md | `pm:research` | Already exists |
| review.md | `dev:review` | Already exists |
| setup.md | `pm:setup` | Already exists |
| strategy.md | `pm:strategy` | Already exists |
| sync.md | `pm:sync` | **Adding in Step 1** |
| view.md | `pm:view` | Already exists (updating trigger in Step 3) |

Verify each trigger description includes at least one natural-language phrase that would match a reasonable user request (AC8).

- [ ] **Step 5: Commit**

```bash
git add skills/using-pm/SKILL.md
git commit -m "feat: add sync, merge, view entries to using-pm routing table"
```

---

### Task 4: Delete all command files and remove commands/ directory

**Files:**
- Delete: all 17 files in `commands/`
- Delete: `commands/` directory

- [ ] **Step 1: Delete all 17 command files**

```bash
rm /Users/soelinmyat/Projects/pm/commands/bug-fix.md
rm /Users/soelinmyat/Projects/pm/commands/dev-epic.md
rm /Users/soelinmyat/Projects/pm/commands/dev.md
rm /Users/soelinmyat/Projects/pm/commands/dig.md
rm /Users/soelinmyat/Projects/pm/commands/groom.md
rm /Users/soelinmyat/Projects/pm/commands/ideate.md
rm /Users/soelinmyat/Projects/pm/commands/ingest.md
rm /Users/soelinmyat/Projects/pm/commands/merge-watch.md
rm /Users/soelinmyat/Projects/pm/commands/merge.md
rm /Users/soelinmyat/Projects/pm/commands/pr.md
rm /Users/soelinmyat/Projects/pm/commands/refresh.md
rm /Users/soelinmyat/Projects/pm/commands/research.md
rm /Users/soelinmyat/Projects/pm/commands/review.md
rm /Users/soelinmyat/Projects/pm/commands/setup.md
rm /Users/soelinmyat/Projects/pm/commands/strategy.md
rm /Users/soelinmyat/Projects/pm/commands/sync.md
rm /Users/soelinmyat/Projects/pm/commands/view.md
```

- [ ] **Step 2: Remove the commands/ directory**

```bash
rmdir /Users/soelinmyat/Projects/pm/commands
```

- [ ] **Step 3: Verify deletion**

```bash
ls /Users/soelinmyat/Projects/pm/commands 2>&1
# Expected: "No such file or directory"
```

- [ ] **Step 4: Commit**

```bash
git add -u commands/
git commit -m "refactor: delete all 17 command files and commands/ directory"
```

---

### Task 5: Remove `"commands"` key from both plugin.json manifests

**Files:**
- Modify: `.claude-plugin/plugin.json` (line 14: `"commands": "./commands/"`)
- Modify: `.cursor-plugin/plugin.json` (line 16: `"commands": "./commands/"`)

- [ ] **Step 1: Remove `"commands"` key from `.claude-plugin/plugin.json`**

Current content (line 14):
```json
  "commands": "./commands/"
```

Remove this entire line. Also fix the trailing comma on the preceding line (`"skills": "./skills/"`) if it becomes the last entry.

Current `.claude-plugin/plugin.json` structure:
```json
{
  "name": "pm",
  "description": "...",
  "version": "1.1.0",
  "author": { "name": "Soe Lin Myat" },
  "homepage": "...",
  "repository": "...",
  "license": "MIT",
  "keywords": [...],
  "skills": "./skills/",
  "commands": "./commands/"   <-- DELETE THIS LINE
}
```

- [ ] **Step 2: Remove `"commands"` key from `.cursor-plugin/plugin.json`**

Current content (line 16):
```json
  "commands": "./commands/",
```

Remove this entire line. The preceding line is `"skills": "./skills/"` and the following line is `"hooks": "./hooks/hooks.json"`. After removal, ensure `"skills"` has a trailing comma (it needs one because `"hooks"` follows).

Current `.cursor-plugin/plugin.json` structure:
```json
{
  "name": "pm",
  "displayName": "PM",
  "description": "...",
  "version": "1.1.0",
  "author": { "name": "Soe Lin Myat" },
  "homepage": "...",
  "repository": "...",
  "license": "MIT",
  "keywords": [...],
  "skills": "./skills/",
  "agents": "./agents/",
  "commands": "./commands/",   <-- DELETE THIS LINE
  "hooks": "./hooks/hooks.json"
}
```

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json', 'utf8')); console.log('claude OK')"
node -e "JSON.parse(require('fs').readFileSync('.cursor-plugin/plugin.json', 'utf8')); console.log('cursor OK')"
```

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json .cursor-plugin/plugin.json
git commit -m "refactor: remove commands key from plugin manifests"
```

---

### Task 6: Verify all 23 skills remain invokable

**Files:**
- Read: all `skills/*/SKILL.md` files (24 total after adding sync)

- [ ] **Step 1: List all skill directories and verify SKILL.md exists**

```bash
for dir in /Users/soelinmyat/Projects/pm/skills/*/; do
  skill=$(basename "$dir")
  if [ -f "$dir/SKILL.md" ]; then
    echo "OK: $skill"
  else
    echo "MISSING: $skill/SKILL.md"
  fi
done
```

Expected: 24 skills (23 original + 1 new sync skill), all with SKILL.md present.

The 24 skills should be:
1. brainstorming
2. bug-fix
3. debugging
4. design-critique
5. dev
6. dev-epic
7. dig
8. groom
9. ideate
10. ingest
11. merge-watch
12. pr
13. receiving-review
14. refresh
15. research
16. review
17. setup
18. strategy
19. subagent-dev
20. sync (NEW)
21. tdd
22. using-pm
23. view
24. writing-plans

- [ ] **Step 2: Verify each skill has valid frontmatter**

```bash
for dir in /Users/soelinmyat/Projects/pm/skills/*/; do
  skill=$(basename "$dir")
  head -5 "$dir/SKILL.md" | grep -q "^---" && echo "OK: $skill" || echo "NO FRONTMATTER: $skill"
done
```

- [ ] **Step 3: Verify `"skills": "./skills/"` is still present in both manifests**

```bash
grep '"skills"' /Users/soelinmyat/Projects/pm/.claude-plugin/plugin.json
grep '"skills"' /Users/soelinmyat/Projects/pm/.cursor-plugin/plugin.json
```

Both should show `"skills": "./skills/"`.

No commit needed — this is a verification task.

---

### Task 7: Validate using-pm trigger coverage (AC8)

**Files:**
- Read: `skills/using-pm/SKILL.md` (after Task 3 edits)

- [ ] **Step 1: Map each of the 17 previously command-accessible workflows to a trigger phrase**

For each workflow, verify the routing table trigger description includes at least one natural-language phrase that would match a reasonable user request:

| Workflow | Example User Request | Trigger Phrase in Table |
|----------|---------------------|------------------------|
| bug-fix | "fix these cycle bugs" | "Any new feature, bug fix..." or "Batch bug resolution" |
| dev-epic | "implement this epic" | "Multiple related issues / epic" |
| dev | "build this feature" | "Any new feature, bug fix, refactor..." |
| dig | "research this question" | "Ad-hoc deep research question" |
| groom | "groom this feature" | "Groom backlog issues" |
| ideate | "generate feature ideas" | "Generate feature ideas" |
| ingest | "import this feedback" | "Import customer evidence" |
| merge-watch | "watch this PR" | "PR readiness monitoring" |
| merge | "merge this PR" | "Merge a PR manually" |
| pr | "create a PR" | "Ready to push / create PR" |
| refresh | "check for stale research" | "Audit research freshness" |
| research | "research competitors" | "Research a topic or competitor" |
| review | "review this code" | "Multi-perspective code review" |
| setup | "set up the project" | "First-time project configuration" |
| strategy | "work on strategy" | "Product strategy work" |
| sync | "sync to cache" | "Sync source to cache" |
| view | "open the dashboard" | "Open dashboard / browse artifacts" |

- [ ] **Step 2: Fix any gaps found**

If any workflow lacks a natural-language trigger phrase, update the routing table entry.

- [ ] **Step 3: Commit (only if changes were made)**

```bash
git add skills/using-pm/SKILL.md
git commit -m "fix: improve trigger descriptions for full workflow coverage"
```

---

### Task 8: Run smoke test and validation

- [ ] **Step 1: Run the validation script**

```bash
node /Users/soelinmyat/Projects/pm/scripts/validate.js --dir pm
```

Expected: passes without command-related errors.

- [ ] **Step 2: Run test suite if available**

```bash
node /Users/soelinmyat/Projects/pm/tests/run-tests.js 2>/dev/null || echo "No test runner found"
```

- [ ] **Step 3: Run pre-commit hook validation**

```bash
bash /Users/soelinmyat/Projects/pm/.githooks/pre-commit
```

Expected: passes — JSON valid, versions consistent across all 4 manifests (version bump hasn't happened yet, so all should still be 1.1.0).

- [ ] **Step 4: Verify no stale `commands/` references remain in manifests**

```bash
grep -r '"commands"' /Users/soelinmyat/Projects/pm/.claude-plugin/plugin.json /Users/soelinmyat/Projects/pm/.cursor-plugin/plugin.json
```

Expected: no matches.

No commit needed — this is a verification task.

---

### Task 9: Version bump all 4 manifests + git tag (FINAL COMMIT)

**Files:**
- Modify: `.claude-plugin/plugin.json` (version field)
- Modify: `.cursor-plugin/plugin.json` (version field)
- Modify: `.claude-plugin/marketplace.json` (version field)
- Modify: `gemini-extension.json` (version field)

Current version: `1.1.0`. Bump to: `1.1.1` (patch — infrastructure cleanup, no new user-facing features).

- [ ] **Step 1: Read current version to confirm**

```bash
grep '"version"' /Users/soelinmyat/Projects/pm/.claude-plugin/plugin.json
```

- [ ] **Step 2: Update all 4 manifests**

Update `"version": "1.1.0"` to `"version": "1.1.1"` in:
1. `.claude-plugin/plugin.json`
2. `.cursor-plugin/plugin.json`
3. `.claude-plugin/marketplace.json`
4. `gemini-extension.json`

- [ ] **Step 3: Validate JSON and version consistency**

```bash
bash /Users/soelinmyat/Projects/pm/.githooks/pre-commit
```

Expected: passes — all 4 manifests show `1.1.1`.

- [ ] **Step 4: Commit the version bump**

```bash
git add .claude-plugin/plugin.json .cursor-plugin/plugin.json .claude-plugin/marketplace.json gemini-extension.json
git commit -m "chore: bump version to 1.1.1"
```

- [ ] **Step 5: Create git tag**

```bash
git tag v1.1.1
```

- [ ] **Step 6: Verify tag**

```bash
git tag -l "v1.1.1"
```

Expected: `v1.1.1`

---

## AC Verification Matrix

| AC | Task | Verification |
|----|------|-------------|
| 1. All 17 command files deleted, directory removed | Task 4 | `ls commands/` returns "No such file or directory" |
| 2. sync.md inline logic in skills/sync/SKILL.md | Task 1 | File exists with all 6 rsync steps |
| 3. view skill matches command behavior | Task 2 | `--mode dashboard` + correct dir resolution verified |
| 4. .claude-plugin/plugin.json no commands key | Task 5 | `grep '"commands"'` returns empty |
| 5. .cursor-plugin/plugin.json no commands key | Task 5 | `grep '"commands"'` returns empty |
| 6. using-pm has sync, merge, view entries | Task 3 | Routing table has all 3 rows, merge is distinct |
| 7. All 23+ skills invokable | Task 6 | 24 skill dirs with SKILL.md, manifests point to skills/ |
| 8. Natural-language triggers per workflow | Task 7 | All 17 workflows mapped to trigger phrases |
| 9. Smoke test passes | Task 8 | Validation + pre-commit hook pass |
| 10. Version bump in all 4 manifests + tag | Task 9 | All show 1.1.1, `git tag` shows v1.1.1 |
