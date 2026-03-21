# Context Discovery & Injection Contract

Reference document for all dev plugin skills and commands. Defines how project context is discovered and injected into agent prompts.

## Context Discovery (run at intake)

### 1. Product Context (from CLAUDE.md)

Read CLAUDE.md at the project root. Extract:

| Field | Source | Fallback if missing |
|-------|--------|-------------------|
| Product name | First heading or explicit "Product:" line | Repository directory name |
| Product description | First paragraph or "Description:" section | "Not documented" |
| User personas | "Users" or "Personas" section | "Not documented" |
| Scale expectations | "Scale" or numbers in context | "Not documented" |
| Design principles | "Design" or "Principles" section | "Not documented" |
| Domain concerns | Business-critical operations mentioned | "Not documented" |

If CLAUDE.md is absent: log warning, use directory name as product name, all other fields "Not documented."

### 2. Technical Context (from AGENTS.md)

Read AGENTS.md at the project root. For monorepos, also read `apps/*/AGENTS.md`.

| Field | Source | Fallback if missing |
|-------|--------|-------------------|
| Test command | "test" or "verification" section | Convention-based (see below) |
| Build command | "build" or "setup" section | None |
| Monorepo structure | "apps/" or "packages/" section | Auto-detect from directory listing |
| Conventions | Coding conventions section | None |
| App-specific AGENTS.md paths | Scan `apps/*/AGENTS.md` | None |

**Convention-based test command inference** (when AGENTS.md absent):

| Detection | Inferred command |
|-----------|-----------------|
| `package.json` with `"test"` script | `npm test` (or `pnpm test` if pnpm-lock.yaml exists, `yarn test` if yarn.lock exists) |
| `Gemfile` present | `bundle exec rails test` |
| `pyproject.toml` present | `pytest` |
| `go.mod` present | `go test ./...` |
| None of above | Warn: "Could not detect test command. Specify in AGENTS.md." |

### 3. Stack Detection (from package manifests)

| File found | Stack |
|-----------|-------|
| `package.json` | Node (check deps for React/Vue/Next/Expo/etc.) |
| `Gemfile` / `Rakefile` | Ruby/Rails |
| `pyproject.toml` / `requirements.txt` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `apps/` or `packages/` dirs | Monorepo (list app names) |

### 4. Issue Tracker Detection (from MCP tools)

Check available MCP tools at session start:
- Tools matching `linear` → Linear
- Tools matching `jira` → Jira
- Tools matching `github.*issues` → GitHub Issues
- None → skip issue tracker integration

### 5. Strategy Context (from pm plugin, optional)

If `pm/strategy.md` exists, extract:
- Strategic priorities (Section 6)
- Non-goals (Section 7)
- ICP (Section 2)

If `pm/competitors/index.md` exists, extract top 3 competitors with positioning.

---

## Context Injection Template

After discovery, build this block for injection into agent prompts:

```
## Project Context (pre-extracted by orchestrator)

**Product:** {product_name} — {product_description}
**Users:** {user_personas}
**Scale:** {scale_expectations}
**Design principles:** {design_principles}
**Domain concerns:** {domain_concerns}
**Stack:** {detected_stack}
**Test command:** {test_command}
**Monorepo apps:** {app_list or "single-app"}
**Issue tracker:** {tracker_type or "none"}
**Strategic pillars:** {priorities or "Not documented"}
**Competitors:** {top_3 or "Not documented"}
**Non-goals:** {non_goals or "Not documented"}
```

Fields marked "Not documented" are intentionally kept — review agents will flag undocumented fields as context gaps.

---

## State File Storage

Store the full context block in the session state file (`.dev-state-{slug}.md`) under `## Project Context`:

```markdown
## Project Context
- Product: {product_name} — {description}
- Stack: {stack}
- Test command: {command}
- Issue tracker: {type or "none"}
- Monorepo: {yes/no, app list}
- CLAUDE.md: {present/absent/minimal}
- AGENTS.md: {present/absent}
- Strategy: {present/absent}
```

This survives compaction and session resume.

---

## Usage by Downstream Commands

Every command that dispatches review/investigation agents MUST:

1. Read the session state file's `## Project Context` section (or run discovery if first invocation)
2. Build the context injection template above
3. Include it in every agent prompt as `{PROJECT_CONTEXT}`

This ensures all agents work from the same extracted facts, avoids each agent independently parsing files, and makes agent prompts project-agnostic.
