---
type: research
topic: "Plugin invocation patterns — commands vs skills"
created: 2026-03-21
updated: 2026-03-21
sources:
  - "Claude Code plugin cache analysis (18 plugins)"
  - "Superpowers v5.0.5 architecture deep-dive"
---

# Remove Commands: Research Findings

## Key Finding

The mature plugin pattern is **skills-only with SessionStart hook bootstrap**. Commands are a legacy invocation layer that skills have superseded.

## Ecosystem Analysis (18 plugins)

| Pattern | Count | Examples |
|---------|-------|----------|
| Skills-dominant | 4 | Superpowers (14 skills), plugin-dev (7), claude-code-setup, frontend-design |
| Balanced (commands + skills) | 5 | PM (17+20), dev (8+6), stripe (2+1) |
| Commands-only | 2 | commit-commands (3), code-review (1) |
| Hooks-only | 1 | security-guidance |
| MCP-only | 3 | context7, linear, playwright |
| Server API | 1 | impeccable |

## Superpowers Reference Model (v5.0.5)

The most mature plugin in the ecosystem has:
- **Zero functional commands** — 3 deprecated stubs that say "use the skill instead"
- **14 skills** containing all workflow logic
- **SessionStart hook** that injects `using-superpowers` skill into context
- **Skill auto-activation** based on task type — users never type command names

### How It Works

1. SessionStart hook fires before any AI response
2. Hook injects `using-superpowers` skill content into session context
3. AI checks every user message against skill triggers
4. Matching skill is invoked via Skill tool automatically
5. User experiences seamless workflow activation

### Key Design Principle

Skills are mandatory, not optional: "If a skill applies to your task, you do not have a choice. You must use it."

## PM Plugin Current State

- 17 commands — all thin wrappers that delegate to corresponding skills
- 20+ skills — contain all actual logic
- SessionStart hook already preloads `using-pm` skill
- `using-pm` already contains the full skill routing table
- **Commands are functionally redundant**

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users who memorized `/pm:dev` syntax | Low | using-pm skill already handles natural language routing |
| Discoverability — users can't tab-complete commands | Medium | Skill descriptions in system prompt serve same role |
| Other plugins referencing `/pm:*` commands | Low | Skills remain invokable via `Skill` tool with same names |
| Documentation referencing commands | Low | Update docs to reference skills |

## Recommendation

Remove all 17 command files. The architecture is already command-free in practice — commands are just an extra layer of indirection. The Superpowers model proves this works at scale.
