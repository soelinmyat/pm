# Custom Instructions Support

Projects can customize dev plugin behavior via instruction files without editing plugin source.

## Files

| File | Scope | Committed |
|------|-------|-----------|
| `dev/instructions.md` | Shared team instructions | Yes |
| `dev/instructions.local.md` | Personal overrides | No (gitignored) |

## Override Hierarchy

1. **CLAUDE.md/AGENTS.md** wins for project context (product identity, stack, test commands)
2. **dev/instructions.md** wins for plugin behavior (review agents, gate config, naming)
3. **dev/instructions.local.md** overrides shared instructions on conflict
4. **Hard gates** are never overridable (no PR without review, no merge without verification)

## Supported Overrides

```markdown
# dev/instructions.md

## Review Configuration
codex_review: true          # Enable Codex review gate in /merge-watch (default: false)
codex_bot_name: chatgpt-codex-connector[bot]  # Codex bot username (default)

## Review Agents
# Which agents to run in /review (all enabled by default)
code_fix_review: true
pm_review: true
design_review: true
input_edge_case_review: true

## Paths
learnings_path: learnings.md           # Path to learnings file (default: learnings.md)
plan_directory: docs/plans              # Where plans are saved (default)
adr_directory: docs/decisions           # Where ADRs are saved (default)

## Conventions
commit_prefix: feat|fix|chore|docs     # Commit message type prefixes
branch_prefix: feat/|fix/|chore/       # Branch naming convention
```

## Reading Instructions at Intake

At the start of every `/dev` or `/dev-epic` session, check for instruction files:

1. If `dev/instructions.md` exists, read it. Apply shared overrides.
2. If `dev/instructions.local.md` exists, read it. Apply personal overrides (takes precedence on conflict).
3. If neither exists, proceed with defaults. No error.

Store active overrides in the session state file (`.dev-state-{slug}.md`) under `## Custom Instructions`:

```markdown
## Custom Instructions
- codex_review: false (default)
- learnings_path: learnings.md (default)
- Source: defaults (no instruction files found)
```

## What Instructions CANNOT Override

- Hard gates: review before PR, verification before merge, code scan before auto-merge
- Phase ordering: brainstorm before plan, implement before review
- Safety rules: no --no-verify, no destructive git recovery, no force-merge
