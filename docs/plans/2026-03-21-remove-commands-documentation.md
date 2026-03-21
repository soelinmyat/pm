# Update Documentation for Skill-Only Invocation Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dev:subagent-dev to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all project documentation to reflect the skill-only architecture. Remove all `/pm:*` and `/dev:*` slash command syntax from user-facing docs, rewrite contributor guidance to prevent AI agents from recreating the deleted commands layer, and position PM's auto-activation model as a first-class product claim.

**Architecture:** PM-058 deleted all 17 command files and the `commands/` directory. Documentation still references commands as if they exist. This issue rewrites README.md (user-facing), GEMINI.md (Gemini CLI guide), AGENTS.md (contributor guide), .codex/INSTALL.md (Codex install guide), and marketplace.json (marketplace description) to match the skill-only reality.

**Tech Stack:** Markdown (docs), JSON (marketplace.json)

**PM-055 absorption:** PM-055 (groom-centric-messaging) called for positioning groom and research as hero entry points. Its command-based ACs (update `commands/groom.md`, `commands/research.md`, `commands/setup.md`) are obsolete after PM-058. The positioning intent — groom-first README, research as secondary entry point, setup as optional — is absorbed into the README rewrite (Task 1).

---

## Upstream Context

> From backlog issue PM-059 (`pm/backlog/remove-commands-documentation.md`).
> Depends on PM-058 (`docs/plans/2026-03-21-remove-commands-infrastructure.md`) — commands/ already deleted.

### Key Findings

- README.md has 2 sections with `/pm:*` syntax: "Get Started" (6 commands) and "All Commands" (16 command rows across 2 tables)
- GEMINI.md has `/pm:*` and `/dev:*` references in: Bootstrap (lines 14, 26-32), Available Skills tables (lines 43-64), Subagent Limitation (line 88), Knowledge Base Layout comments (lines 110-120)
- AGENTS.md references `commands/` in: directory table (line 21), Source of Truth (line 139), Change Rules (lines 155, 159), Development Flow heading (line 100), Editing dogfooded data (line 125)
- `.codex/INSTALL.md` line 58 lists `commands/` in the symlink reference sentence
- `.opencode/INSTALL.md` line 44 uses `/pm:setup` — in scope since it's in the repo root tree
- `learnings.md` line 11 has `/pm:groom` and `/dev-epic` references — in scope (repo root .md file)
- `marketplace.json` description field needs the auto-activation claim added
- PM-055 intent: groom and research as hero entry points, setup as optional

### Groom Conditions

- No `/pm:*` or `/dev:*` slash command syntax in README.md, GEMINI.md, AGENTS.md, .codex/INSTALL.md, or any repo root .md file
- No `commands/` references in AGENTS.md source-of-truth or change rules
- "PM activates the right workflow automatically — no commands to memorize" in README.md and marketplace description
- Groom-first positioning in README "Get Started" section (PM-055 absorption)

---

### Task 1: Rewrite README.md for skill-only model

**Files:**
- Modify: `README.md`

This is the largest task. The README needs a complete content rewrite of 3 sections: intro claim, "Get Started", and "All Commands" → replaced with natural-language descriptions.

- [ ] **Step 1: Add auto-activation claim before Install section**

After the "Works with Claude Code, Cursor, Codex, and Gemini CLI." line and before "---", add:

```
PM activates the right workflow automatically — no commands to memorize.
```

This satisfies AC6 for README.md.

- [ ] **Step 2: Rewrite "Get Started" section**

Replace the current "Get Started" section (lines 37-48, the 6-line code block with `/pm:setup`, `/pm:research landscape`, etc.) with a natural-language description that positions groom and research as hero entry points (PM-055 intent). No slash command syntax.

New content:

```markdown
## Get Started

**Start with what you want to build.** Tell PM your feature idea and it will research the market, scope the work, and produce ready-to-build issues — all in one conversation.

**Or start with what you want to learn.** Ask PM to research a topic, map competitors, or analyze your market. The research accumulates in your knowledge base and informs future planning.

Everything else — setup, strategy, ideation, ingestion — happens on-demand when the workflow needs it. You don't need to memorize anything.
```

- [ ] **Step 3: Replace "All Commands" section with "What You Can Do"**

Replace the entire "All Commands" section (lines 52-78, two command tables with `/pm:*` syntax) with a natural-language capability list. No slash command syntax anywhere.

New content:

```markdown
## What You Can Do

### Think

- **Research** a topic, competitor, or market trend
- **Build a strategy** with product positioning and strategic bets
- **Generate ideas** based on your research and strategy
- **Groom** an idea through research, scoping, and review into ready-to-build issues
- **Dig** into a specific question for quick answers
- **Import** customer feedback, interviews, or support data
- **Refresh** stale research without losing existing content
- **Browse** your knowledge base in a local dashboard

### Build

- **Develop** a feature end-to-end: plan, test, code, review, PR
- **Run an epic** with multiple related issues in parallel
- **Review** code from multiple perspectives
- **Create a PR** with summary and test plan
- **Fix bugs** in batch with structured triage
- **Watch a PR** and auto-merge when checks pass
```

- [ ] **Step 4: Update "How the Handoff Works" section**

Replace the two `/pm:groom`, `/pm:dev`, `/pm:dev-epic` references (lines 84-86) with natural-language equivalents:

Current:
```
When you use `/pm:groom` to plan a feature, it goes through research, scoping, and review.
When you then use `/pm:dev` or `/pm:dev-epic` on that same feature, the dev workflow sees the grooming work
```

New:
```
When you groom a feature, PM takes it through research, scoping, and review. The output includes detailed acceptance criteria and competitive context.

When you then build that same feature, the dev workflow sees the grooming work and skips straight to implementation — no redundant brainstorming or spec review. The research context flows into the implementation plan automatically.
```

- [ ] **Step 5: Update "The `pm/` Directory" section**

Replace the `/pm:setup` reference (line 94):

Current: `When you install PM in your project, you'll get your own fresh pm/ folder via /pm:setup.`

New: `When you install PM in your project, you'll get your own fresh pm/ folder the first time you start a workflow.`

- [ ] **Step 6: Verify no `/pm:*` or `/dev:*` references remain in README.md**

Search the file for any remaining slash command syntax. There should be zero matches.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for skill-only invocation model"
```

---

### Task 2: Rewrite GEMINI.md for skill-only model

**Files:**
- Modify: `GEMINI.md`

GEMINI.md has `/pm:*` and `/dev:*` references throughout: Bootstrap section, Available Skills tables, Subagent Limitation, and Knowledge Base Layout.

- [ ] **Step 1: Update the intro paragraph**

No changes needed — the intro paragraph (line 3) doesn't contain slash command syntax.

- [ ] **Step 2: Rewrite "Bootstrap Instructions" section**

Replace the "First-time setup" subsection (lines 9-22). Remove the `/pm:setup` code block. Replace with:

```markdown
### First-time setup

Tell PM about your project and it will configure your product context, integrations, and knowledge base folder structure automatically.

Setup configures:
- Product context and target market
- Linear integration (or markdown backlog fallback if unavailable)
- SEO provider: Ahrefs MCP (recommended) or web search only
- Knowledge base folders: `pm/` (committed) and `.pm/` (gitignored runtime/config)
```

- [ ] **Step 3: Rewrite "Recommended workflow" subsection**

Replace the code block (lines 25-33) with a natural-language description. Position groom first (PM-055 intent):

```markdown
### Recommended workflow

Start by grooming a feature idea — PM will research the market, scope the work, and produce ready-to-build issues. Or start with research if you want to explore first.

A typical progression:
1. Set up your project context
2. Import any existing customer evidence (optional)
3. Research your market landscape
4. Define your product strategy
5. Research specific competitors
6. Groom ideas into sprint-ready issues
7. Implement groomed issues end-to-end
```

- [ ] **Step 4: Rewrite "Available Skills" tables**

Replace both tables (Product Discovery lines 43-51, Development Lifecycle lines 57-64) with natural-language capability descriptions. Remove all `/pm:*` and `/dev:*` syntax.

New content:

```markdown
## Available Skills

### Product Discovery

| Capability | Description |
|-----------|-------------|
| Setup | First-time configuration: product context, market, integrations |
| Ingest | Import customer evidence from local files or folders and update shared research artifacts |
| Strategy | Generate and refine product positioning and strategic bets |
| Research | Landscape mapping, competitor deep-dives, user signal analysis |
| Groom | Convert strategy into groomed issues ready for sprint |
| Dig | Ad-hoc deep research on a specific question or topic |
| Refresh | Audit research for staleness and missing data, then patch without losing existing content |
| View | Browse and search accumulated research and strategy artifacts |
| Ideate | Brainstorm feature ideas from research and strategy |

### Development Lifecycle

| Capability | Description |
|-----------|-------------|
| Dev | End-to-end feature implementation from issue to merge-ready PR |
| Dev-epic | Multi-issue epic orchestration with teammate agents |
| Review | Code review with structured critique |
| PR | Create pull request with summary and test plan |
| Merge-watch | Monitor PR checks and merge when ready |
| Bug-fix | Structured bug investigation and fix workflow |
| Merge | Merge a PR after checks pass |
| Sync | Sync plugin source to cache for testing |
```

- [ ] **Step 5: Update "Subagent Limitation" section**

Replace the `/pm:research` and `/dev:dev-epic` references (line 88) with skill names without slash syntax:

Current: `The PM plugin uses parallel agents in /pm:research and /dev:dev-epic on Claude Code.`

New: `The PM plugin uses parallel agents in research and dev-epic workflows on Claude Code.`

Also update the "All other skills" sentence (line 102) to remove parenthetical `/pm:*` references:

Current: `All other skills (setup, strategy, groom, dig, view, dev, review, pr, bug-fix) work identically`

This line is already fine — it uses skill names without slash syntax. Keep as-is.

- [ ] **Step 6: Update "Knowledge Base Layout" comments**

Replace the inline comments that reference `/pm:*` syntax (lines 110-120):

Current:
```
  competitors/        # Competitor profiles written by /pm:research competitors
  research/           # Shared topic research written by /pm:research and /pm:ingest
  imports/            # Import manifest for /pm:ingest
```

New:
```
  competitors/        # Competitor profiles from research
  research/           # Shared topic research from research and ingest workflows
  imports/            # Import manifest for ingest workflow
```

Also update the final sentence (line 120):

Current: `Skills read from and write to this layout. /pm:view browses accumulated artifacts. /pm:strategy synthesizes whatever research exists in pm/.`

New: `Skills read from and write to this layout. The view skill browses accumulated artifacts. The strategy skill synthesizes whatever research exists in pm/.`

- [ ] **Step 7: Verify no `/pm:*` or `/dev:*` references remain in GEMINI.md**

Search the file for any remaining slash command syntax. There should be zero matches.

- [ ] **Step 8: Commit**

```bash
git add GEMINI.md
git commit -m "docs: rewrite GEMINI.md for skill-only invocation model"
```

---

### Task 3: Update AGENTS.md for skill-only architecture

**Files:**
- Modify: `AGENTS.md`

AGENTS.md has 4 areas referencing commands: directory table (line 21), Source of Truth (line 139), Change Rules (lines 155, 159), and Development Flow heading (line 100). Also needs new contributor guidance explaining why commands must not be recreated.

- [ ] **Step 1: Remove `commands/` from the Plugin Source Code directory table**

Delete the row (line 21):
```
| `commands/` | User-facing command surface |
```

- [ ] **Step 2: Update Development Flow heading**

Line 100 currently says:
```
### Editing source code (skills, scripts, commands, agents)
```

Change to:
```
### Editing source code (skills, scripts, agents)
```

- [ ] **Step 3: Remove `commands/` from Source of Truth section**

Lines 138-142 currently list:
```
Runtime behavior lives in:
- `commands/`
- `skills/`
- `agents/`
- `scripts/`
```

Remove the `- \`commands/\`` line entirely.

- [ ] **Step 4: Rewrite Change Rules to remove command references**

Line 155: `If command behavior changes, update the corresponding file in \`commands/\`.`
— Delete this line entirely.

Line 159: `Keep command names and examples aligned across \`README.md\`, \`commands/\`, and \`skills/\`.`
— Replace with: `Keep skill descriptions aligned across \`README.md\` and \`skills/\`.`

- [ ] **Step 5: Update "Editing dogfooded data" subsection**

Line 125 references `/pm:groom`, `/pm:research`, `/pm:ideate`:
```
When using `/pm:groom`, `/pm:research`, `/pm:ideate`, etc., the plugin writes to `pm/` in this repo.
```

Replace with:
```
When using PM workflows (groom, research, ideate, etc.), the plugin writes to `pm/` in this repo.
```

- [ ] **Step 6: Add skill-only architecture guidance**

After the existing Change Rules section (after line 160), add a new section:

```markdown
## Skill-Only Architecture

This plugin uses skills as the sole runtime surface. There is no `commands/` directory — it was intentionally removed.

**Do not recreate command files.** Commands were thin wrappers around skills that only worked on Claude Code. Skills are the universal cross-platform format — they work on Claude Code, Cursor, Codex, and Gemini CLI. Recreating commands would break cross-platform compatibility.

Users invoke workflows through natural language. The `using-pm` skill (preloaded at session start) routes user intent to the correct skill automatically.
```

- [ ] **Step 7: Verify no `commands/` runtime references remain in AGENTS.md**

Search for `commands/` — the only remaining reference should be in the "How changes flow" example (line 62-63, which describes the git workflow, not runtime behavior) and possibly in the sync command example. None should present `commands/` as a runtime surface or source of truth.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for skill-only architecture"
```

---

### Task 4: Update .codex/INSTALL.md

**Files:**
- Modify: `.codex/INSTALL.md`

Line 58 references `commands/` in the symlink sentence.

- [ ] **Step 1: Remove `commands/` from the symlink reference sentence**

Line 58 currently reads:
```
The skill folders in this repo already include symlinks to the shared `agents/`, `commands/`, `hooks/`, `scripts/`, and `templates/` directories that Codex may read while following the workflows.
```

Replace with:
```
The skill folders in this repo already include symlinks to the shared `agents/`, `hooks/`, `scripts/`, and `templates/` directories that Codex may read while following the workflows.
```

- [ ] **Step 2: Commit**

```bash
git add .codex/INSTALL.md
git commit -m "docs: remove commands/ from Codex INSTALL.md symlink reference"
```

---

### Task 5: Update marketplace.json description

**Files:**
- Modify: `.claude-plugin/marketplace.json`

AC6 requires the auto-activation claim in the marketplace description.

- [ ] **Step 1: Update the description field**

Current (line 11):
```json
"description": "Structured workflows for the product engineer — from discovery and strategy through implementation and merge",
```

New:
```json
"description": "Structured workflows for the product engineer — PM activates the right workflow automatically, no commands to memorize. From discovery and strategy through implementation and merge.",
```

- [ ] **Step 2: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json', 'utf8')); console.log('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "docs: add auto-activation claim to marketplace description"
```

---

### Task 6: Clean remaining `/pm:*` and `/dev:*` references in root and docs/ .md files

**Files:**
- Modify: `learnings.md` (line 11)
- Modify: `.opencode/INSTALL.md` (line 44)
- Scan: all `docs/**/*.md` files

AC8 requires no orphaned `/pm:*` or `/dev:*` command references in any `.md` file in the repository root or `docs/` directory.

- [ ] **Step 1: Update learnings.md**

Line 11 contains:
```
Full cycle from /pm:groom (research, scope, 3 review rounds, bar raiser) through /dev-epic (4 sequential S-sized issues)
```

Replace with:
```
Full cycle from groom (research, scope, 3 review rounds, bar raiser) through dev-epic (4 sequential S-sized issues)
```

Also check line 23 which has `pm:groom` (no slash — this is fine as a skill name reference, not command syntax).

- [ ] **Step 2: Update .opencode/INSTALL.md**

Line 44 has `/pm:setup` in the verification section. Replace with natural language:

Current:
```
/pm:setup
```

New:
```
Set up my project with PM
```

This tests that the plugin is loaded and the setup skill activates from natural language.

- [ ] **Step 3: Scan docs/ directory for remaining references**

Search all `docs/**/*.md` files for `/pm:` and `/dev:` patterns. Files found:

- `docs/plans/2026-03-21-groom-auto-bootstrap.md` — plan file, may contain `/pm:*` references
- `docs/plans/2026-03-21-groom-quick-strategy.md` — plan file
- `docs/plans/2026-03-21-pm-dev-*.md` — plan files
- `docs/plans/2026-03-20-retro-prompt.md` — plan file
- `docs/superpowers/plans/2026-03-18-proposal-gallery-page.md` — superpowers plan

Plan files in `docs/plans/` are historical records of implemented work. The AC says "no orphaned command references" — but these are not user-facing docs, they are implementation artifacts. The key question: do they describe current behavior or historical decisions?

**Decision:** Plan files are historical artifacts documenting what was implemented at the time. They are not user-facing documentation and do not describe current behavior. Leave them as-is to preserve historical accuracy. The AC targets files that could mislead users or AI contributors about current behavior — plan files don't meet that threshold.

However, `docs/superpowers/` plans reference `/pm:groom` in UI empty state strings (HTML that may still be in the running dashboard). These are references to UI copy, not command documentation. They are tracked as follow-on with skill-internal references per AC8 note.

- [ ] **Step 4: Final verification sweep**

Run a comprehensive search for `/pm:` and `/dev:` across all root-level `.md` files and `docs/` directory:

```bash
grep -rn '/pm:\|/dev:' /Users/soelinmyat/Projects/pm/*.md /Users/soelinmyat/Projects/pm/docs/ --include='*.md'
```

Expected: zero matches in README.md, GEMINI.md, AGENTS.md, learnings.md, .opencode/INSTALL.md. Plan files in `docs/plans/` and `docs/superpowers/` may still have historical references — these are acceptable per the scope decision above.

- [ ] **Step 5: Commit**

```bash
git add learnings.md .opencode/INSTALL.md
git commit -m "docs: clean remaining command references from root .md files"
```

---

### Task 7: Run validation and pre-commit hook

- [ ] **Step 1: Run pre-commit hook**

```bash
bash /Users/soelinmyat/Projects/pm/.githooks/pre-commit
```

Expected: passes — JSON valid, versions consistent.

- [ ] **Step 2: Final AC verification**

| AC | Task | Verification |
|----|------|-------------|
| 1. README "Get Started" is natural-language | Task 1 Step 2 | No code blocks with slash commands, groom-first positioning |
| 2. README has no `/pm:*` or `/dev:*` | Task 1 Step 6 | `grep '/pm:\|/dev:' README.md` returns empty |
| 3. GEMINI.md fully updated | Task 2 Step 7 | `grep '/pm:\|/dev:' GEMINI.md` returns empty |
| 4. AGENTS.md no `commands/` runtime references | Task 3 Step 7 | `commands/` not in Source of Truth or Change Rules |
| 5. AGENTS.md skill-only contributor guidance | Task 3 Step 6 | New "Skill-Only Architecture" section with rationale |
| 6. Auto-activation claim in README + marketplace | Task 1 Step 1, Task 5 Step 1 | Claim appears before install in README, in marketplace description |
| 7. .codex/INSTALL.md no `commands/` | Task 4 Step 1 | Symlink sentence lists 4 dirs, not 5 |
| 8. No orphaned references in root or docs/ | Task 6 Step 4 | Verification sweep returns zero for target files |

No commit needed — this is a verification task.

---

## Scope Exclusions

Per the backlog issue notes and AC8 clarification:

- **Skill-internal references** (skills/setup/SKILL.md, skills/strategy/SKILL.md, skills/groom/SKILL.md, etc.) that use `/pm:*` syntax in user-facing output strings are explicitly excluded from this scope. These are tracked separately as follow-on.
- **Plan files** in `docs/plans/` and `docs/superpowers/plans/` are historical implementation records, not user-facing documentation. They preserve accuracy of what was implemented at the time.
- **Dogfooded data** in `pm/backlog/` and `pm/research/` contains command references in issue descriptions and research findings. These are product data, not source code documentation.
- **Planning notes** in `.planning/` are not runtime documentation.
