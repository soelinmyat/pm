---
name: groom
description: "Use when doing product discovery or feature grooming. Outputs a product proposal (PRD) — not engineering issues."
---

# pm:groom

## Purpose

Orchestrate the full product discovery lifecycle: from raw idea to an approved product proposal (PRD) ready for engineering.

Groom produces a **proposal** — the product-level artifact with scope, design, wireframes, research, and competitive context. It does NOT split into engineering issues or write implementation plans. That happens in `pm:dev` via the RFC.

Research gates grooming. Strategy gates scoping. Neither is optional.

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

**Workflow:** `groom` | **Telemetry steps:** `intake`, `strategy-check`, `research`, `scope`, `scope-review`, `design`, `draft-proposal`, `team-review`, `bar-raiser`, `present`, `link`.

**When NOT to use:** Quick outlines or explanations ("what would X look like?"), when the user says "spec" but means "explain," or when they want a rough sketch — use `pm:think` instead. Groom produces a full PRD with reviews; think produces a lightweight artifact.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/groom/steps/` in numeric filename order. If `.pm/workflows/groom/` exists, same-named files there override defaults. Execute each step in order — each contains its own instructions, HARD-GATEs, agent prompts, and state update schemas.

## Tier Gating

Read `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/tier-gating.md` for tier selection logic, step-skipping rules, and research routing by tier.

---

## Runtime

Record the current runtime in the groom session state:

```yaml
runtime: claude | codex
```

The workflow stays the same across runtimes. Dispatch mechanics come from the current runtime and capability gates, not from the groom lifecycle itself.

---

## Resume

Before doing anything else, glob `{pm_state_dir}/groom-sessions/*.md`.

If exactly one session exists, read it and say:

> "Found an in-progress grooming session for '{topic}' (last updated: {updated}, current phase: {phase}).
> Resume from {phase}, or start fresh?"

If multiple sessions exist, list them with topic, phase, and updated timestamp. Ask which to resume.

Wait for the user's answer. If resuming: skip completed phases. If starting fresh: delete the selected state file, then begin Step 1.

---

## Codebase Detection

At the start of a grooming session (before Step 1), determine whether the project has an accessible codebase:

1. List the top-level project directory. Look for source code indicators: `src/`, `lib/`, `app/`, `packages/`, `*.py`, `*.ts`, `*.go`, `*.rs`, `*.java`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, or similar.
2. If source code exists, set `codebase_available: true` in groom state. Note the primary language and entry points.
3. If the project is purely a product knowledge base (only `{pm_dir}/`, `.pm/`, docs), set `codebase_available: false`.

When `codebase_available: true`, multiple steps will incorporate codebase analysis — checking existing implementation, UI patterns, and overlapping code. Each step file specifies what to check and when.

---

## References

The following reference files provide detailed guidance for specific groom capabilities:

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/tier-gating.md` | Tier selection, step-skipping rules, research routing |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/ideate.md` | Standalone ideation mode — surface what to build next |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/style-guide.md` | Groom-specific formatting supplement |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/spec-reviewer.md` | Spec review agent template |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/scope-validation.md` | Scope validation methodology for Step 4 |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/state-schema.md` | Session state file YAML schema |

---

## State File

Each grooming session has its own state file under `{pm_state_dir}/groom-sessions/{topic-slug}.md`. Write session state using the schema defined in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/state-schema.md`.

---

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Scope is obvious, skip strategy check" | Strategy check catches 30% of scope creep. Fast for obvious features — that's different from skipping. |
| "Feature is small, quick tier is enough" | Tier is set by uncertainty, not size. Small features with unclear competitive context need standard tier. |
| "Research exists, no need to check it" | Stale research is worse than no research. Always verify dates. |
| "User seems decided, skip scope review" | Users commit to scope after review, not before. Decided users still benefit from competitive pressure-test. |
| "Design is obvious, skip mockups" | "Obvious" means unexamined. Mockups take 5 minutes and catch layout issues every time. |

---

## Error Handling

Things go wrong. Here's how to recover without making it worse.

**Corrupted state file.** If the YAML won't parse or required fields are missing, ask the user: "Show me the file so I can fix it, or start fresh?" Don't guess at repairs — corrupted state produces corrupted output.

**Missing research refs.** If a phase needs research files that don't exist, stop and offer to re-run Step 3. Proceeding with empty research context means every downstream decision is ungrounded.

**Strategy drift.** After strategy-check, compare `{pm_dir}/strategy.md`'s `updated:` date against the recorded check. If strategy changed since you checked it, flag it — scope decisions built on stale strategy are scope decisions built on nothing.

**Parallel sessions.** If a state file already exists when starting, never overwrite it silently. Ask resume vs. fresh. Starting fresh requires explicit confirmation — the existing file might be someone else's in-progress work.

---

## Proposal Format (Backlog Entry)

Write the proposal entry to `{pm_dir}/backlog/{topic-slug}.md`. This is the parent backlog item — the PRD content is inline, and it links to the RFC when one exists.

**ID assignment:** When an issue tracker is available (Linear) and a Linear issue is created or already exists for this proposal, use the Linear identifier as the local `id` (e.g., `PM-123`). Do NOT generate a separate local sequence — the Linear ID is the single source of truth. Only fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1, zero-pad to 3 digits, first entry `PM-001`) when no issue tracker is configured.

```markdown
---
id: "{linear_id or PM-NNN}"
title: "{Feature Title}"
outcome: "{One-sentence: what changes for the user when this ships}"
status: proposed | in-progress | done
prd: null
rfc: rfcs/{topic-slug}.html | null
linear_id: "{Linear ID}" | null
thinking: thinking/{topic-slug}.md | null
priority: critical | high | medium | low
labels:
  - "{label}"
research_refs:
  - {pm_dir}/evidence/research/{topic-slug}.md
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## Outcome

{Expand on the outcome statement. What does the user experience after this ships?
What were they unable to do before?}

## Scope

In-scope:
- {item}

Out-of-scope:
- {item}: {reason}

## Competitor Context

{How do competitors handle this? Where do they fall short?
Reference specific profiles from {pm_dir}/evidence/competitors/ if applicable.}

## Technical Feasibility

{Engineering Manager assessment from scope review.
Verdict: feasible | feasible-with-caveats | needs-rearchitecting.}

## Research Links

- [{Finding title}]({pm_dir}/evidence/research/{topic-slug}.md)

## Notes

{Deferred scope items. Resolved questions from review (if any remain as decisions needed, list them here with recommended answers).}
```

**Status lifecycle:**
- `proposed` — PRD exists, no RFC yet. Product-approved, awaiting engineering planning.
- `planned` — RFC exists and approved. Ready to build.
- `in-progress` — Dev is implementing from the RFC.
- `done` — All RFC issues shipped.

**Verdict** is set by groom and never changed by dev. **Status** is updated by dev as implementation progresses.
