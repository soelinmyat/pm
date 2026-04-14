# Architecture

How PM works at runtime — from user command to completed workflow.

## Runtime Flow

```
User types /pm:dev
        │
        ▼
┌─────────────┐
│  commands/   │  Thin entrypoint. Frontmatter (description, argument-hint).
│  dev.md      │  Delegates immediately to the matching skill.
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  skills/     │  SKILL.md is the orchestrator. Defines the workflow,
│  dev/        │  hard rules, gate routing, resume logic, and state
│  SKILL.md    │  file conventions. References shared and skill-scoped docs.
└──────┬──────┘
       │  step-loader reads steps/ directory
       ▼
┌─────────────┐
│  steps/      │  Numbered markdown files (01-intake.md, 02-workspace.md, ...).
│  01..N       │  Each step is self-contained: procedure, state updates,
│              │  gate checks, agent dispatch instructions.
└──────┬──────┘
       │  Steps load references on demand
       ▼
┌─────────────┐
│  references/ │  Two scopes:
│              │  • Skill-scoped: skills/{skill}/references/ (methodology, prompts)
│              │  • Shared: references/ (writing rules, schemas, merge loop)
└──────┬──────┘
       │  Steps dispatch agents with persona overlays
       ▼
┌─────────────┐
│  personas/   │  Role overlays (adversarial-engineer, product-manager, etc.).
│              │  Injected into agent prompts to shape review perspective.
└─────────────┘
```

## Key Concepts

### Skills

Each skill is a directory under `skills/` with:

```
skills/{name}/
  SKILL.md              # Orchestrator — frontmatter + workflow definition
  steps/                # Numbered procedure files
    01-intake.md
    02-workspace.md
    ...
  references/           # Skill-scoped reference docs and agent prompts
    tdd.md
    debugging.md
    ...
```

`SKILL.md` always has `name:` and `description:` frontmatter. Steps always have `name:`, `order:`, and `description:`.

### Step Loading

The step-loader (`scripts/step-loader.js`) reads `skills/{name}/steps/`, sorts by numeric prefix, and concatenates them into the workflow. It also:

- Resolves persona references (injects persona content into agent dispatch prompts)
- Substitutes `${CLAUDE_PLUGIN_ROOT}` with the actual plugin path
- Supports user overrides: files in `.pm/{skill}-sessions/{session}/steps/` can replace default steps

### State and Output Files

Skills persist state in `.pm/` session files. Think is different — it has no session state file; its only durable output is the thinking artifact in the KB.

| Skill | Type | Location |
|-------|------|----------|
| dev | session state | `.pm/dev-sessions/{slug}.md` |
| groom | session state | `.pm/groom-sessions/{slug}.md` |
| rfc | session state | `.pm/rfc-sessions/{slug}.md` |
| think | output artifact | `{pm_dir}/thinking/{slug}.md` |

Session state files use YAML-in-markdown. They're the single source of truth for resume — not conversation history. Think resumes by reopening the saved artifact and asking what changed.

### Agent Dispatch

Skills dispatch fresh `Agent()` calls at phase boundaries. Each agent gets:

- The relevant reference docs (methodology, constraints)
- Project context discovered at intake
- A persona overlay (for review agents)
- The RFC or proposal as the handoff contract

Agents are always fresh — no persistent workers. The RFC/state file is the contract between phases.

### References (Shared vs Skill-Scoped)

```
references/                    # Shared across all skills
  skill-runtime.md             # Path resolution, workflow loading, telemetry
  writing.md                   # Prose rules, document structure, frontmatter
  frontmatter-schemas.md       # All KB artifact schemas
  review-gate.md               # Dispatch-collect-fix pattern for reviews
  merge-loop.md                # Self-healing PR merge flow
  capability-gates.md          # Optional tool/skill classification
  context-discovery.md         # Project context extraction protocol
  insight-routing.md           # Evidence → insight synthesis
  insight-rewrite-template.md  # Template for insight rewrites
  kb-search.md                 # Knowledge base search patterns
  knowledge-writeback.md       # KB update conventions
  memory-cap.md                # 50-entry cap enforcement
  memory-recall.md             # Recency-with-diversity retrieval
  telemetry.md                 # Analytics contract
  design-system.md             # CSS tokens for HTML output
  component-catalog.md         # HTML components for generated pages
  templates/                   # HTML reference templates (RFC)

skills/{name}/references/      # Skill-scoped
  tdd.md                       # Dev: test-first discipline
  debugging.md                 # Dev: root cause investigation
  subagent-dev.md              # Dev: agent dispatch patterns
  ...
```

### Hooks

Shell scripts in `hooks/` run at lifecycle events. Configured in `hooks/hooks.json`:

| Event | Hooks | Purpose |
|-------|-------|---------|
| SessionStart | check-setup.sh, session-start.sh, reconcile-merged.sh, kb-pull.sh | Init check, skill loading, stale PR detection, KB sync |
| PreToolUse | agent-pre.sh, state-pre.sh | Timestamp capture, state snapshot |
| PostToolUse | analytics-log.sh, agent-step.sh, state-step.sh, kb-mark-dirty.sh | Telemetry, workflow transition detection, sync marking |
| SessionEnd | session-end.sh, kb-push.sh | Close analytics run, push KB changes |

All hooks exit 0 — they never block user operations.

### Templates

HTML reference templates live in `references/templates/`. Skills read these before generating HTML output (RFCs, proposals, strategy docs) to match structure and styling.

### Personas

Seven role overlays in `personas/`:

| Persona | Used by |
|---------|---------|
| adversarial-engineer | RFC review, architecture review |
| product-manager | Scope review, proposal review |
| staff-engineer | Code review, design review |
| designer | Design critique |
| developer | Implementation agents |
| strategist | Strategy review |
| tester | QA review |

### Knowledge Base (`pm/`)

User-facing product context committed to the repo:

```
pm/
  strategy.md                    # ICP, positioning, priorities
  evidence/
    research/                    # Market and topic research
    competitors/                 # Competitor profiles
    transcripts/                 # Ingested interviews
    user-feedback/               # Ingested customer evidence
  insights/                      # Synthesized product insights
  backlog/                       # Proposals, RFCs, wireframes
    proposals/
    rfcs/
    wireframes/
  thinking/                      # Pre-commitment exploration
  product/
    features.md                  # Feature inventory
```

### Platform Manifests

Three manifest files generated from `plugin.config.json`:

| File | Platform |
|------|----------|
| `.claude-plugin/plugin.json` | Claude Code |
| `.claude-plugin/marketplace.json` | Claude Code marketplace |
| `.codex-plugin/plugin.json` | Codex |

Generated by `scripts/generate-platform-files.js`. Never edit directly.

## Validation

- `scripts/validate.js` — validates KB artifact frontmatter against `references/frontmatter-schemas.md`
- `scripts/step-loader.js` — validates step file structure and ordering
- CI runs: ESLint, Prettier, ShellCheck, tests, manifest sync check, skill structure validation
