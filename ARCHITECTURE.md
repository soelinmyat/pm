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
│  agents/     │  Role overlays (adversarial-engineer, product-manager, etc.).
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
- Supports user overrides: same-named files in `.pm/workflows/{skill}/` can replace default steps

### State and Output Files

Skills persist state in `.pm/` session files. Think is different — it has no session state file; its only durable output is the thinking artifact in the KB.

| Skill | Type | Location |
|-------|------|----------|
| dev | canonical JSON session | `.pm/dev-sessions/{slug}/session.json` |
| groom | canonical JSON session | `.pm/groom-sessions/{slug}/session.json` |
| rfc | canonical JSON session | `.pm/rfc-sessions/{slug}/session.json` |
| think | output artifact | `{pm_dir}/thinking/{slug}.md` |

Dev, Groom, and RFC use strict JSON state written only by their lifecycle runners. Their phase results, transition history, evidence, recertification, runtime identity, and authority logs are the resume source of truth—not conversation history. Older Markdown sessions remain bounded migration inputs. Think resumes by reopening the saved artifact and asking what changed.

### Shared Runtime Primitives

`scripts/lib/workflow-runtime/` owns mechanics that must be identical across lifecycle skills:

- stable result hashing, transition construction, and current/recertified evidence selection;
- closed evidence/runtime record validation;
- allowlisted authority grants;
- bounded prompt-section rendering and atomic private publication;
- data-injected model-profile resolution;
- external-effect receipt binding to target, authority, attempt, result, and observation.

`scripts/lib/project-file.js` is the public project-file boundary. It combines descriptor-bound, byte-bounded input with anchored atomic output. The historical input/output modules remain compatibility implementations beneath that facade.

These modules are deliberately policy-free. Dev and RFC retain routing, statuses, approval, gates, and completion. Review and Design Critique retain findings, artifact schemas, remediation rules, and verdicts. Ship retains the policy for when a push, PR, merge, or tag is legal. A generic workflow engine is not part of the architecture.

### Agent Dispatch

Skills dispatch fresh `Agent()` calls at phase boundaries. Each agent gets:

- The relevant reference docs (methodology, constraints)
- Project context discovered at intake
- A persona overlay (for review agents)
- The RFC or proposal as the handoff contract

Workers receive phase-local packets. A CLI runtime may resume its provider session only for the same work unit and authority envelope; otherwise dispatch starts fresh. The canonical RFC/session state remains the contract between phases.

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
| SessionStart | check-setup, session-start, reconcile-merged, kb-pull | Init check, skill loading, stale PR detection, KB sync |
| PreToolUse | agent-pre, state-pre | Timestamp capture, state snapshot |
| PostToolUse | analytics-log, agent-step, state-step, kb-mark-dirty | Telemetry, workflow transition detection, sync marking |
| SessionEnd | session-end, kb-push | Close analytics run, push KB changes |

All hooks exit 0 — they never block user operations.

### Templates

HTML reference templates live in `references/templates/`. Skills read these before generating HTML output (RFCs, proposals, strategy docs) to match structure and styling.

### Personas

Seven role overlays in `agents/`:

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

- `scripts/validate.js` — validates KB artifact frontmatter and, in `--plugin` mode, enforces structural plus skill-authoring contracts
- `scripts/skill-audit.js` — presents the same authoring findings grouped by skill and class without modifying source files
- `scripts/step-loader.js` — validates step file structure and ordering
- CI runs: ESLint, Prettier, ShellCheck, tests, manifest sync check, and the authoritative plugin contract gate
