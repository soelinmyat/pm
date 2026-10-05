# Context Discovery & Injection Contract

Reference document for all dev plugin skills and commands. Defines how project context is discovered and injected into agent prompts.

## Context Discovery (run at intake)

### 1. Product Context (task-relevant, sourced)

Start with the authorized task and applicable repository instructions, including root and nearest ancestor `AGENTS.md` files for the affected paths. Read relevant product/domain docs, README, CLAUDE.md when present, approved backlog/RFC, strategy, and existing behavior. CLAUDE.md is one possible source, not a required product manifest.

Extract the facts needed to judge this task: intended users and their problem, desired outcome, scope/non-goals, domain rules, expected scale, and applicable design principles. Cite each fact's file/section or task statement and distinguish approved intent from observed implementation and inference. Existing behavior can expose a constraint or defect; it does not automatically override approved intent.

Example: `Users: team managers approving leave — backlog/time-off.md § Problem (approved); date boundary uses workspace timezone — domain/time.md § Leave dates (approved); current form uses browser timezone — source inspection (observed discrepancy).`

For conflicting sources, identify the conflict, authority, and freshness. Do not silently combine incompatible rules or assume a newer informal note supersedes an approved requirement. Resolve from the task/instructions where possible; surface a decision only when the unresolved difference materially changes behavior. Mark unavailable facts `Unknown (sources examined: …)`, rather than `Not documented` merely because CLAUDE.md is absent. Missing task-irrelevant personas or scale documentation is not automatically a blocking gap.

### 2. Technical Context (from AGENTS.md)

Read AGENTS.md at the project root and applicable instructions along the ancestor paths of affected code, tests, and packages. Monorepos may place instructions under packages, services, or other directories, not only apps. Preserve source citations in the context packet.

| Field | Source | Fallback if missing |
|-------|--------|-------------------|
| Test command | "test" or "verification" section | Convention-based (see below) |
| Build command | "build" or "setup" section | None |
| Monorepo structure | "apps/" or "packages/" section | Auto-detect from directory listing |
| Conventions | Coding conventions section | None |
| App-specific AGENTS.md paths | Scan affected paths and their ancestors | None |

**Test command discovery** (when instructions omit it): confirm manifest scripts, installed runner, working directory and required fixtures. An inferred command remains a hypothesis until observed executing the intended tests; a command exiting zero with no tests is not verification.

| Detection | Inferred command |
|-----------|-----------------|
| `package.json` with `"test"` script | `npm test` (or `pnpm test` if pnpm-lock.yaml exists, `yarn test` if yarn.lock exists) |
| `Gemfile` present | Inspect dependencies, Rake tasks and documented test command; do not assume Rails or Minitest |
| `pyproject.toml` present | Inspect test dependencies and tool configuration; do not assume pytest is installed |
| `go.mod` present | `go test ./...` |
| None of above | Warn: "Could not detect test command. Specify in AGENTS.md." |

### 3. Stack Detection (from package manifests)

| File found | Stack |
|-----------|-------|
| `package.json` | Node (check deps for React/Vue/Next/Expo/etc.) |
| `Gemfile` / `Rakefile` | Ruby (confirm framework from dependencies) |
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

If `{pm_dir}/strategy.md` exists, extract:
- Strategic priorities (Section 6)
- Non-goals (Section 7)
- ICP (Section 2)

If `{pm_dir}/evidence/competitors/index.md` exists, extract top 3 competitors with positioning.

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

Include source/provenance and any material uncertainty beside each value. Reviewers assess whether an unknown matters for this task; they must not invent context or treat every undocumented field as a defect. Reviewers may inspect original sources and correct the packet with evidence.

---

## State File Storage

Persist the sourced context packet as an intake evidence artifact in the canonical session directory and record it through the current session runner's supported evidence contract. Reference that artifact in downstream dispatch inputs. Do not add an unsupported `context` field or Markdown headings to strict `session.json`; the state schema remains authoritative. Legacy Markdown context is a resume aid, not current canonical evidence.

The packet preserves citations, examined sources, unresolved material conflicts, and observed versus approved facts across compaction and resume. Refresh it when task scope or an authoritative source changes; do not overwrite previous evidence as if it had always been known.

---

## Usage by Downstream Commands

Every command that dispatches review/investigation agents MUST:

1. Read the recorded intake context evidence and its sources (or run discovery on first invocation); on legacy resume, migrate verified facts rather than trusting old headings
2. Build the context injection template above
3. Include it in every agent prompt as `{PROJECT_CONTEXT}`

This ensures all agents work from the same extracted facts, preserves shared facts while allowing independent verification and correction of misleading or stale context.
