---
name: groom
description: "Use when doing product discovery or feature grooming. Orchestrates strategy check, research, scoping, design, and proposal creation. Outputs a product proposal (PRD) — not engineering issues. Triggers on 'groom,' 'feature idea,' 'product discovery,' 'scope this,' 'write a PRD.'"
---

# pm:groom

## Purpose

Orchestrate the full product discovery lifecycle: from raw idea to an approved product proposal (PRD) ready for engineering.

Groom produces a **proposal** — the product-level artifact with scope, design, wireframes, research, and competitive context. It does NOT split into engineering issues or write implementation plans. That happens in `pm:dev` via the RFC.

Research gates grooming. Strategy gates scoping. Neither is optional.

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

## Path Resolution

If `pm_dir` is not in conversation context, check if `pm/` exists at cwd. If yes, use it (same-repo mode). If no, tell the user: 'Run pm:start first to configure paths.' Do not proceed without a valid path.

If `pm_state_dir` is not in conversation context, use `.pm` at the same location as `pm_dir`'s parent (i.e., if `pm_dir` = `{base}/pm`, then `pm_state_dir` = `{base}/.pm`). This ensures preference reads and session writes always resolve to the PM repo's `.pm/` directory.

## Telemetry (opt-in)

If analytics are enabled, read `${CLAUDE_PLUGIN_ROOT}/references/telemetry.md`. Steps: `intake`, `strategy-check`, `research`, `scope`, `scope-review`, `groom`, `team-review`, `bar-raiser`, `present`, `link`.

## Interaction Pacing

Ask ONE question at a time. Wait for the user's answer before asking the next. Do not bundle multiple questions in a single message. When you have follow-ups, ask the most important one first — the answer often makes the others unnecessary.

---

## Runtime

Record the current runtime in the groom session state:

```yaml
runtime: claude | codex
```

The workflow stays the same across runtimes. Dispatch mechanics come from the current runtime and capability gates, not from the groom lifecycle itself.

---

## Groom Tiers

`pm:groom` supports three tiers:

| Tier | Intended use | Phases |
|------|--------------|--------|
| `quick` | Fill in missing structure fast, usually as a handoff to implementation or backlog capture | `intake -> strategy-check -> research -> scope -> draft-proposal -> link` |
| `standard` | Solid product proposal without the full executive review stack | `intake -> strategy-check -> research -> scope -> scope-review -> design -> draft-proposal -> link` |
| `full` | Full PM ceremony with review stack and presentation | `intake -> strategy-check -> research -> scope -> scope-review -> design -> draft-proposal -> team-review -> bar-raiser -> present -> link` |

### Tier selection

Use this priority:

1. Explicit tier from the caller or user request
2. Tier requested by `pm:dev`
3. Default to the max tier allowed by KB maturity (detected in Phase 1 intake)

**KB maturity cap:** Phase 1 runs a KB maturity check and records the max available tier in the session state as `kb_maturity_tier`. The effective tier is `min(requested_or_default_tier, kb_maturity_tier)` unless the user explicitly overrides after being informed of the constraint.

If no maturity check has run yet (first invocation, before Phase 1 completes), treat the default as `quick` to avoid launching full ceremony on an unknown KB.

> Note: Phase 1 intake may adjust the effective tier based on KB maturity detection. The `groom_tier` in state after Phase 1 is authoritative.

Write the selected tier to the state file:

```yaml
groom_tier: quick | standard | full
```

### Phase loading rules

Only run phases that are active for the current tier.

- `quick` skips `scope-review`, `design`, `team-review`, `bar-raiser`, and `present`
- `standard` skips `team-review`, `bar-raiser`, and `present`
- `full` runs every phase

### Research by tier

<!-- Tier routing: keep in sync with phases/phase-3-research.md -->

Research depth scales with the tier. The HARD-GATE only applies to standard and full.

- `quick`: inline assessment only. Check existing research, write a 2-3 sentence competitive note in the groom output. Do NOT invoke `pm:research`. If the topic is complex, prompt the user to upgrade to standard tier.
- `standard`: full `pm:research` invocation (HARD-GATE applies)
- `full`: full `pm:research` invocation (HARD-GATE applies)

When `quick` performs an inline assessment without writing new files, `research_location` remains `null`. Log the inline finding as `research_note` in the session state.

---

## Resume Check

Before doing anything else, glob `{pm_state_dir}/groom-sessions/*.md`.

If exactly one session exists, read it and say:

> "Found an in-progress grooming session for '{topic}' (last updated: {updated}, current phase: {phase}).
> Resume from {phase}, or start fresh?"

If multiple sessions exist, list them with topic, phase, and updated timestamp. Ask which to resume.

Wait for the user's answer. If resuming: skip completed phases. If starting fresh: delete the selected state file, then begin Phase 1.

---

## Lifecycle: intake -> strategy check -> research -> scope -> scope review -> design -> draft proposal -> team review -> bar raiser -> present -> link

---


## Custom Instructions

Before starting work, check for user instructions:

1. If `{pm_dir}/instructions.md` exists, read it — these are shared team instructions (terminology, writing style, output format, competitors to track).
2. If `{pm_dir}/instructions.local.md` exists, read it — these are personal overrides that take precedence over shared instructions on conflict.
3. If neither file exists, proceed normally.

**Override hierarchy:** `{pm_dir}/strategy.md` wins for strategic decisions (ICP, priorities, non-goals). Instructions win for format preferences (terminology, writing style, output structure). Instructions never override skill hard gates.

---

## Codebase Detection

At the start of a grooming session (before Phase 1), determine whether the project has an accessible codebase:

1. List the top-level project directory. Look for source code indicators: `src/`, `lib/`, `app/`, `packages/`, `*.py`, `*.ts`, `*.go`, `*.rs`, `*.java`, `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, or similar.
2. If source code exists, set `codebase_available: true` in groom state. Note the primary language and entry points.
3. If the project is purely a product knowledge base (only `{pm_dir}/`, `.pm/`, docs), set `codebase_available: false`.

When `codebase_available: true`, multiple phases will incorporate codebase analysis — checking existing implementation, UI patterns, and overlapping code. Each phase file specifies what to check and when.

---

## Phases

When entering a phase, read its detailed instructions from the phase file. Each phase file contains the full instructions, HARD-GATEs, agent prompts, and state update schemas.

| Phase | File | Summary |
|-------|------|---------|
| 1. Intake | `phases/phase-1-intake.md` | Capture the idea, clarify, derive slug, write initial state |
| 2. Strategy Check | `phases/phase-2-strategy.md` | Validate against priorities, non-goals, ICP |
| 3. Research | `phases/phase-3-research.md` | Invoke pm:research for competitive and market intelligence |
| 4. Scope | `phases/phase-4-scope.md` | Define in-scope / out-of-scope, apply 10x filter |
| 4.5. Scope Review | `phases/phase-4.5-scope-review.md` | 3 parallel agents (PM, Competitive, EM) challenge the scope |
| 5. Design | `phases/phase-5-design.md` | Design exploration: mockups, user flows, wireframes. Skip for backend/infra. |
| 5.5. Draft Proposal | `phases/phase-5.5-draft-proposal.md` | Detect feature type, generate flows/wireframes, draft proposal content |
| 6. Team Review | `phases/phase-6-team-review.md` | 3-4 parallel agents review the proposal for quality (max 3 iterations) |
| 6.5. Bar Raiser | `phases/phase-6.5-bar-raiser.md` | Product Director holistic review with fresh eyes (max 2 iterations) |
| 7. Present | `phases/phase-7-present.md` | Generate HTML PRD, open in browser, get user approval |
| 8. Link | `phases/phase-8-link.md` | Create proposal entry in backlog (+ Linear if configured), clean up |

**How to use:** At the start of each phase, read the corresponding file with `Read ${CLAUDE_PLUGIN_ROOT}/skills/groom/phases/{filename}` and follow its instructions exactly.

---

## State File Schema ({pm_state_dir}/groom-sessions/{topic-slug}.md)

Each grooming session has its own state file under `{pm_state_dir}/groom-sessions/`.

**Repo location:** In separate-repo mode, `pm_state_dir` resolves to the PM repo's `.pm/` directory, so groom sessions are always stored in the PM repo — never in the source repo. This keeps product discovery artifacts co-located with the knowledge base. In same-repo mode, both groom and dev sessions live in the same `.pm/` directory (no change).

```yaml
---
topic: "{topic name}"
runtime: claude | codex
groom_tier: quick | standard | full
phase: intake | strategy-check | research | scope | scope-review | design | draft-proposal | team-review | bar-raiser | present | link
started: YYYY-MM-DD
updated: YYYY-MM-DD
run_id: "{PM_RUN_ID}"
started_at: YYYY-MM-DDTHH:MM:SSZ
phase_started_at: YYYY-MM-DDTHH:MM:SSZ
completed_at: null | YYYY-MM-DDTHH:MM:SSZ
effective_verdict: ready | ready-if | send-back | pause | null
linear_id: "{Linear ID}" | null
codebase_available: true | false
product_features_available: true | false
product_feature_count: 0
kb_maturity: fresh | developing | mature
kb_maturity_tier: quick | standard | full
kb_signals:
  strategy: true | false
  research: true | false
  competitors: true | false

strategy_check:
  status: passed | failed | override | skipped
  checked_against: {pm_dir}/strategy.md | null
  conflicts:
    - "{conflicting non-goal text}"
  supporting_priority: "{priority text}" | null

research_location: {pm_dir}/evidence/research/{topic-slug}.md | null
research_note: "{1-line summary of inline finding}" | null  # quick tier only

scope:
  in_scope:
    - "{item}"
  out_of_scope:
    - "{item}: {reason}"
  filter_result: 10x | gap-fill | table-stakes | parity | null

scope_review:
  pm_verdict: ship-it | rethink-scope | wrong-priority | null
  competitive_verdict: strengthens | neutral | weakens | null
  em_verdict: feasible | feasible-with-caveats | needs-rearchitecting | null
  blocking_issues_fixed: 0
  iterations: 1

team_review:
  pm_verdict: ready | needs-revision | significant-gaps | null
  competitive_verdict: sharp | adequate | undifferentiated | null
  em_verdict: ready | needs-restructuring | missing-prerequisites | null
  design_verdict: complete | gaps | inconsistencies | null
  blocking_issues_fixed: 0
  iterations: 1

bar_raiser:
  verdict: ready | send-back | pause | null
  iterations: 1
  blocking_issues_fixed: 0

proposal:
  slug: "{topic-slug}"
  backlog_path: {pm_dir}/backlog/{topic-slug}.md
  prd_path: {pm_dir}/backlog/proposals/{topic-slug}.html
  linear_id: "{Linear ID}" | null
---
```

---

## Error Handling

**Corrupted state file** (unparseable YAML, missing required fields):
> "The selected groom state file under {pm_state_dir}/groom-sessions/ appears corrupted. Options:
> (a) Show me the file so I can fix it manually
> (b) Start fresh (deletes the state file)"

**Missing research refs** (phase advances but research files not found):
Warn the user. Offer to re-run Phase 3 before continuing. Do not silently proceed with empty research context.

**Strategy drift** ({pm_dir}/strategy.md modified since strategy_check was recorded):
On every phase after strategy-check, compare the file's `updated:` date against the state's `strategy_check.checked_against`. If newer, flag:
> "{pm_dir}/strategy.md was updated after the strategy check. Re-run the check before scoping?"

**Parallel sessions** (state file already exists when starting):
Never silently overwrite an existing state file. Always ask resume vs. fresh. Starting fresh requires explicit user confirmation before deleting.

---

## Proposal Format (Backlog Entry)

Write the proposal entry to `{pm_dir}/backlog/{topic-slug}.md`. This is the parent backlog item — it links to the HTML PRD and (later) the RFC.

**ID assignment:** When an issue tracker is available (Linear) and a Linear issue is created or already exists for this proposal, use the Linear identifier as the local `id` (e.g., `PM-123`). Do NOT generate a separate local sequence — the Linear ID is the single source of truth. Only fall back to the local `PM-{NNN}` sequence (scan `{pm_dir}/backlog/*.md` for highest `id`, increment by 1, zero-pad to 3 digits, first entry `PM-001`) when no issue tracker is configured.

```markdown
---
id: "{linear_id or PM-NNN}"
title: "{Feature Title}"
outcome: "{One-sentence: what changes for the user when this ships}"
status: proposed | in-progress | done
prd: proposals/{topic-slug}.html
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
