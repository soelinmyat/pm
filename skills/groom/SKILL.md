---
name: groom
description: "Use when the user has a validated idea and wants a sprint-ready PRD — not for exploring whether to build something. Triggers on 'groom this', 'scope this', 'write a proposal', 'create a PRD', 'spec this out'. NOT for open-ended framing ('should we build X', 'what if we') — route to pm:think first. Use when pm:think produced an idea worth pursuing. Outputs a product proposal (PRD) — not engineering issues or implementation plans."
---

# pm:groom

## Purpose

Orchestrate the full product discovery lifecycle: from raw idea to an approved product proposal (PRD) ready for engineering.

Groom produces a **proposal** — the product-level artifact with scope, design, wireframes, research, and competitive context. It does NOT split into engineering issues or write implementation plans. That happens in `pm:rfc` (technical RFC) followed by `pm:dev` (implementation).

Research gates grooming — even quick tier requires an inline assessment. Strategy gates scoping for standard and full tiers.

## Iron Law

**NEVER DRAFT A PROPOSAL WITHOUT RESEARCH.** Even for quick tier, the inline assessment counts — but skipping research entirely produces proposals built on assumptions instead of evidence. If research yields "nothing relevant," that's a valid finding. Never looking is not.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, custom instructions, and interaction pacing.

References `capability-gates.md` and `writing.md` are loaded by the steps that need them — not here. Do not read them at skill load.

## Setup Detection

Before loading steps, verify `{pm_dir}` resolves to an existing directory (check `pm/` at cwd or `pm_dir` already in conversation context). A proposal without a workspace has nowhere to live.

If `{pm_dir}` does not exist:
> "No PM workspace found. Groom writes proposals into `{pm_dir}/backlog/` — run `/pm:start` first to set up the workspace, then re-invoke `/pm:groom`."

Stop. Do not create `.pm/` or `pm/` implicitly.

**Workflow:** `groom` | **Telemetry steps:** `intake`, `strategy-check`, `research`, `scope`, `scope-review`, `design`, `draft-proposal`, `team-review`, `bar-raiser`, `present`, `link`.

**When NOT to use:** Quick outlines or explanations ("what would X look like?"), when the user says "spec" but means "explain," or when they want a rough sketch — use `pm:think` instead. Groom produces a full PRD with reviews; think produces a lightweight artifact.

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/groom/steps/` in numeric filename order. If `.pm/workflows/groom/` exists, same-named files there override defaults. Execute each step in order — each contains its own instructions, HARD-GATEs, agent prompts, and state update schemas.

## Tier Gating

Three tiers control which steps execute. The matrix below is the source of truth for step coverage — each step's frontmatter `applies_to:` must match it.

| Tier | Intended use | Steps that run |
|------|--------------|----------------|
| `quick` | Fill in missing structure fast — usually a handoff into implementation or backlog capture | `intake → strategy-check → research → scope → draft-proposal → link` |
| `standard` | Solid product proposal without the full review stack | `intake → strategy-check → research → scope → scope-review → design → draft-proposal → link` |
| `full` | Full PM ceremony with review stack and presentation | every step (adds `team-review`, `bar-raiser`, `present`) |

**Research depth by tier:** `quick` = inline assessment only, no `pm:research` invocation. `standard` and `full` = full `pm:research` invocation (HARD-GATE applies).

**Selection priority:** (1) explicit tier from caller, (2) tier requested by `pm:dev`, (3) max tier allowed by KB maturity (capped by Step 1 intake detection).

For the full selection logic, KB-maturity cap nuances, and per-tier research routing, see `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/tier-gating.md`.

---

## Runtime

Record the current runtime in the groom session state:

```yaml
runtime: claude | codex
```

The workflow stays the same across runtimes. Dispatch mechanics come from the current runtime and capability gates, not from the groom lifecycle itself.

---

## Resume

Before doing anything else, glob `{source_dir}/.pm/groom-sessions/*.md`.

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
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/style-guide.md` | Groom-specific formatting supplement |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/team-reviewers.md` | Team review persona prompts (Step 8) |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/spec-reviewer.md` | Spec review agent template |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/scope-validation.md` | Scope validation methodology for Step 4 |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/state-schema.md` | Session state file YAML schema |
| `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md` | Proposal template, frontmatter schema, ID assignment, status lifecycle |

---

## State File

Each grooming session has its own state file under `{source_dir}/.pm/groom-sessions/{topic-slug}.md`. Session state is ephemeral and lives source-side (gitignored). The grooming artefact (the proposal) lives at `{pm_dir}/backlog/{topic-slug}.md` in the PM repo. Write session state using the schema defined in `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/state-schema.md`.

---

## Red Flags — Self-Check

If you catch yourself thinking any of these, you're drifting off-skill:

- **"The scope is obvious, I'll skip straight to drafting."** Obvious scope is unexamined scope. The 10x filter and impact/effort quadrant take 5 minutes and catch scope creep every time.
- **"Research found nothing, so there's nothing to cite."** "No prior art" is itself a finding worth documenting. It means the user is entering uncharted territory — flag that risk, don't erase it.
- **"The user seems impatient, I'll collapse the review steps."** Tier controls ceremony depth. If the user wants less, downgrade the tier — don't silently skip gates within a tier.
- **"This reviewer concern is minor, I'll fix it without re-running reviews."** Fixes can introduce new problems. If you changed scope to address a blocking issue, re-run all reviewers — not just the one that flagged it.
- **"The proposal is long enough, it must be complete."** Length is not quality. Check the 11-section template against what you actually wrote. Missing sections are invisible until someone reads the proposal expecting them.
- **"This is infrastructure, design step doesn't apply."** The design step says to skip for backend/infra. But if the infra has configuration UX, CLI output, or developer-facing APIs, those deserve design attention.

## Escalation Paths

- **Idea isn't ready for grooming:** "This needs more exploration first. Want to run `/pm:think` to challenge the framing before we scope it?"
- **KB too thin for requested tier:** "The KB only supports {max_tier} right now. Missing: {gaps}. Want to build prerequisites first with `/pm:strategy` or `/pm:research`?"
- **Research reveals the idea is already solved:** "Research shows {competitor} already handles this well. This might be parity, not differentiation. Want to rethink the angle or proceed as gap-fill?"
- **Scope keeps expanding across iterations:** "Scope has grown through {N} iterations. Consider splitting into two proposals — a focused first phase and a follow-on."
- **User wants engineering issues, not a PRD:** "Groom produces the product proposal. To get the technical RFC, run `/pm:rfc {slug}`. To implement, run `/pm:dev {slug}` after the RFC is approved."

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

**Missing research refs.** If a step needs research files that don't exist, stop and offer to re-run Step 3. Proceeding with empty research context means every downstream decision is ungrounded.

**Strategy drift.** After strategy-check, compare `{pm_dir}/strategy.md`'s `updated:` date against the recorded check. If strategy changed since you checked it, flag it — scope decisions built on stale strategy are scope decisions built on nothing.

**Parallel sessions.** If a state file already exists when starting, never overwrite it silently. Ask resume vs. fresh. Starting fresh requires explicit confirmation — the existing file might be someone else's in-progress work.

---

## Proposal Format (Backlog Entry)

See `${CLAUDE_PLUGIN_ROOT}/skills/groom/references/proposal-format.md` for the full proposal template, frontmatter schema, ID assignment rules, and status lifecycle.

## Before Marking Done

- [ ] Proposal written to `{pm_dir}/backlog/{slug}.md` with valid frontmatter
- [ ] All review gates passed per tier (scope review, team review, bar raiser)
- [ ] Research refs linked in proposal frontmatter (for standard/full tiers; quick tier uses inline assessment — `research_refs` may be empty)
- [ ] State file updated or cleaned up
- [ ] User confirmed the proposal captures their intent
