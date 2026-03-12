---
type: competitor-api
company: PM Skills Marketplace
slug: pm-skills-marketplace
profiled: 2026-03-13
api_available: false
sources:
  - url: https://github.com/phuryn/pm-skills
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/blob/main/.claude-plugin/marketplace.json
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/blob/main/pm-product-discovery/.claude-plugin/plugin.json
    accessed: 2026-03-13
  - url: https://github.com/phuryn/pm-skills/blob/main/CONTRIBUTING.md
    accessed: 2026-03-13
  - url: https://www.productcompass.pm/p/pm-skills-marketplace-claude
    accessed: 2026-03-13
---

# PM Skills Marketplace -- API & Architecture

## API Availability

**None (not applicable).** PM Skills Marketplace is a Claude Code plugin, not a SaaS product. It has no HTTP API, no hosted service, and no programmatic interface. All interaction occurs through the Claude Code/Cowork plugin system via slash commands and contextual skill loading.

This section documents the plugin architecture, skill format, and extensibility model instead.

## Plugin Architecture

### Three-Layer Model

PM Skills Marketplace uses a three-layer architecture:

1. **Marketplace layer** (`.claude-plugin/marketplace.json`): Top-level manifest listing all 8 plugins with names, descriptions, and source paths. Follows Anthropic's `claude-code/marketplace.schema.json` schema. Version: 1.0.1.

2. **Plugin layer** (per-plugin `.claude-plugin/plugin.json`): Individual plugin manifest with name, version, description, author metadata, keywords, and license. Each plugin is independently installable.

3. **Skill/Command layer** (SKILL.md and command .md files): The actual content. Skills live in `{plugin}/skills/{skill-name}/SKILL.md`. Commands live in `{plugin}/commands/{command-name}.md`.

### File Structure

```
pm-skills/
  .claude-plugin/
    marketplace.json          # Marketplace manifest (8 plugins)
  pm-product-discovery/
    .claude-plugin/
      plugin.json             # Plugin manifest
    skills/
      opportunity-solution-tree/
        SKILL.md              # Skill content (domain knowledge + instructions)
      brainstorm-ideas-existing/
        SKILL.md
      ...
    commands/
      discover.md             # Command (workflow chaining)
      brainstorm.md
      ...
    README.md
  pm-product-strategy/
    ...
  [6 more plugins]
  validate_plugins.py         # Structural validator
  CONTRIBUTING.md
```

## Auth Model

Not applicable. The plugin uses no authentication. It is distributed as a public GitHub repository and installed via:
- Claude Cowork: Add marketplace from GitHub (enter `phuryn/pm-skills`)
- Claude Code CLI: `claude plugin marketplace add phuryn/pm-skills`

No API keys, tokens, or OAuth flows involved.

## Core Entity Model (Skill Format)

### Skill Files (SKILL.md)

Each skill is a single markdown file with YAML frontmatter:

```yaml
---
name: opportunity-solution-tree
description: "Build an Opportunity Solution Tree (OST) to structure product discovery..."
---
```

The body contains:
- **Domain Context:** Authoritative knowledge about the framework (theory, structure, principles, attribution).
- **Instructions:** Step-by-step process Claude follows when the skill is activated.
- **Input Requirements:** What the user needs to provide.
- **Process Steps:** Sequential workflow (numbered steps).
- **Further Reading:** Optional references.

Key design decisions:
- Skills are loaded **automatically** when contextually relevant -- no explicit invocation required.
- Skills can also be **forced** via `/plugin-name:skill-name` or `/skill-name`.
- Naming convention: skills are nouns (domain knowledge), commands are verbs (workflows).

### Command Files (commands/*.md)

Each command is a markdown file with frontmatter:

```yaml
---
description: Run a full product discovery cycle...
argument-hint: "<product or feature idea>"
---
```

The body contains:
- **Invocation examples:** How to call the command with different arguments.
- **Workflow steps:** Sequential skill chaining logic.
- **Decision points:** Where the command asks the user for input or choices.
- **Follow-up suggestions:** What commands to run next (natural language, no cross-plugin references).

Example: `/discover` chains: brainstorm-ideas -> identify-assumptions -> prioritize-assumptions -> brainstorm-experiments.

## Endpoint Coverage

Not applicable (no HTTP endpoints). The "interface surface" is:

| Interface | Type | Count | Invocation |
|---|---|---|---|
| Skills | Contextual knowledge loading | 65 | Automatic or `/skill-name` |
| Commands | Workflow orchestration | 36 | `/command-name [args]` |
| Plugins | Installable packages | 8 | `claude plugin install {name}@pm-skills` |

## Webhooks

None. The plugin operates within the Claude conversation context only. No external event system, no callbacks, no notification mechanisms.

## Rate Limits

Not applicable (no hosted service). However, there are platform-imposed constraints:

- **Context window budget:** Claude Code allocates 2% of the context window (with a fallback of 16,000 characters) for skills. With 65 skills installed, there is a risk of exceeding this budget, which may cause skills to be deprioritized or ignored.
- **Skill selection heuristics:** Claude selects which skills to load based on conversation context. Users may need to explicitly invoke skills for reliable activation.

## SDKs and Integrations

### SDK Availability

No SDKs (not a SaaS product). Distribution is via git clone or the Claude plugin marketplace mechanism.

### Cross-Platform Compatibility

| Platform | Compatibility | What Works |
|---|---|---|
| Claude Code | Full | Skills + Commands + Plugins |
| Claude Cowork | Full | Skills + Commands + Plugins |
| Gemini CLI | Partial | Skills only (copy to `.gemini/skills/`) |
| OpenCode | Partial | Skills only (copy to `.opencode/skills/`) |
| Cursor | Partial | Skills only (copy to `.cursor/skills/`) |
| Codex CLI | Partial | Skills only (copy to `.codex/skills/`) |
| Kiro | Partial | Skills only (copy to `.kiro/skills/`) |

Commands (workflow chaining) are Claude-specific. The SKILL.md format is the portable unit.

### Native Integrations

None. PM Skills Marketplace does not integrate with any external PM tools (Jira, Linear, Notion, Confluence, Slack, etc.). It operates entirely within the AI assistant's conversation context.

## Extensibility

### Contributing New Skills

Per CONTRIBUTING.md:
- Bug fixes and small changes: open a PR directly.
- New skills, commands, or larger changes: open an issue first for discussion.
- Guidelines: one change per PR, follow naming conventions, include frontmatter, run `python3 validate_plugins.py` before submitting.
- All contributors listed publicly.
- MIT license applies to contributions.

### Plugin Validator

`validate_plugins.py` performs structural validation of plugin manifests, skill files, and command files. It checks for required frontmatter fields, naming consistency, and file structure compliance.

### Forking and Customization

The MIT license and markdown-only architecture make forking trivial. A team can clone the repo, modify skill content, add domain-specific skills, and use it as a private marketplace. No build step, no compilation, no dependencies beyond a Python validator script.

## Architectural Signals

Inference: The pure-markdown, stateless architecture is both the product's greatest strength and most significant limitation. It achieves near-zero installation friction and maximal portability -- any tool that reads markdown can consume the skills. But the absence of any runtime, state management, or integration layer means PM Skills Marketplace is fundamentally a knowledge injection system, not a PM operating system despite the marketing positioning.

Inference: The three-layer architecture (marketplace -> plugin -> skill/command) mirrors npm's registry/package/module model, suggesting Huryn anticipated ecosystem growth and multi-contributor distribution. The marketplace.json schema follows Anthropic's standard, indicating close alignment with the Claude plugin ecosystem roadmap.

Inference: The 65:36 skill-to-command ratio (roughly 2:1) suggests significant investment in workflow orchestration, not just individual skill authoring. The command chaining model -- where each command suggests follow-up commands -- creates a "guided rail" experience that differentiates this from flat prompt libraries.

Inference: The absence of lifecycle hooks (session-start, pre-commit, etc.) means PM Skills Marketplace cannot proactively inject PM context into developer workflows. It is reactive (user invokes a command) or passively loaded (contextual skill matching), never proactive.
