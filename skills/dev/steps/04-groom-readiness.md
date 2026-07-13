---
name: Groom Readiness
order: 4
description: Check for existing RFC, route ungroomed work to pm:groom or inline scoping
phase: readiness
requires:
  - risk-routing.md
gates: []
required_evidence:
  - rfc-readiness
requires_commit: false
allowed_modes:
  - inline
result_schema: phase-result-v1
---

## RFC Check (all sizes)

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

## Goal

Decide whether this task can proceed directly, needs conversational scoping, should route through grooming, or must stop for RFC generation first.

## How

<HARD-RULE>
Never ask an open-ended question here. XS/S routes through inline scoping with no user turn. M+ either proceeds on an approved RFC, or halts with a deterministic instruction telling the user exactly what to run next — not a menu, not a "should we?" question.

- XS/S without RFC → proceed with inline scoping.
- M+ with approved RFC → proceed to implementation.
- M+ without RFC → halt with: `"Blocked: M+ work without RFC. Run: /rfc {slug}."`
- M+ without proposal → halt with: `"Blocked: no groomed proposal. Run: /pm:groom {slug} (KB maturity: {level}, suggested tier: {tier})."`

No bypass flags. If the groom or RFC cost feels disproportionate to the work, the task is probably smaller than classified — downscope first, then proceed with inline scoping.
</HARD-RULE>

Before proceeding, check whether an approved RFC exists for this work.

### Step 0: Kind short-circuit (runs first)

If session state has `kind: task` or `kind: bug`, this is lightweight capture — groom and RFC are explicitly out of scope.

- Log: `RFC check: skipped-kind-{kind}`
- Skip both the RFC halt and the groom halt below
- Do NOT hard-abort on missing RFC or missing proposal (the capture skill already created the backlog file)
- Jump straight to Implementation (Step 05)

For `kind: proposal` (or absent/null via `resolveKind`), continue to Step 1.

### Step 1: Check for existing proposal + RFC

Look for `{pm_dir}/backlog/{slug}.md`. If found, read frontmatter:

- **`status:` is not `proposed`, `planned`, or `in-progress`** → Groom started but didn't complete. Treat as ungroomed. Continue to Step 2.
- **`rfc:` is non-null** AND the referenced RFC exists → RFC is ready only when `{slug}.approval.json` follows `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/rfc-approval.schema.json`, records explicit human approval, and its HTML/sidecar SHA-256 values match the exact adjacent files. HTML `status: approved` is a projection, not approval authority. **Re-discover tasks from the RFC** (the session file may have stale task data from a prior intake that ran before the RFC existed), following the canonical rule in `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/writing-rfcs.md` § JSON Sidecar Contract. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-sidecar-check.js --sidecar {pm_dir}/backlog/rfcs/{slug}.json --html {pm_dir}/backlog/rfcs/{slug}.html --slug {slug}`:
  - **valid schema v3** → rebuild the `## Tasks` table and work-unit DAG from executable `issues[]`; map `num: N` to `id: "rfc-N"` and numeric dependencies through the same mapping, then copy ownership and the bounded execution fields — no HTML parse.
  - **valid schema v2** → treat as legacy approval evidence and use the documented HTML fallback or recertify through `/pm:rfc`; never infer ownership or dependencies.
  - **present but invalid** (non-zero exit) → **hard-abort**: "Schema-v2 sidecar present but failed rfc-sidecar-check — route to /pm:rfc." Do NOT fall back to the HTML.
  - **sidecar or approval audit absent** → hard-abort and route to `/pm:rfc` to refresh and obtain approval for an exact artifact. Do not infer approval from editable HTML metadata or a remembered conversation.

  If zero issues are found, hard-abort: "RFC found but no Issue sections parsed — check the JSON sidecar." Return a passed readiness result whose `rfc-readiness` evidence artifact is the absolute sidecar path; `dev-session record` independently verifies the sidecar↔HTML binding and human approval hashes before advancing. Never edit the canonical phase directly. Log: `RFC: approved (path: {rfc_path}, tasks: {task_count})`.
- **`rfc:` is non-null** but RFC file has `status: draft` AND size is M+ → RFC started but not approved. Treat same as null — continue to the RFC prompt below. Log: `RFC: draft (needs /rfc to complete)`.
- **`rfc:` is null** AND size is M+ → No RFC exists for M-sized work. Continue to the RFC prompt below.
- **`rfc:` is null** AND size is XS/S → No RFC needed. Continue to Step 2 for inline scoping.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### RFC halt (M+ without RFC)

If `rfc:` is null and size is M+:

Print and **stop** — do not ask a question:

> `Blocked: M+ work without RFC. Run: /rfc {slug}.`

Log: `RFC: blocked-needs-rfc`.

### Step 1.5: Linear-sourced dev-ready shortcut

If `linear_readiness` is `dev-ready` in the session state AND no `{pm_dir}/backlog/{slug}.md` exists:
- This is a Linear issue that passed the readiness check. No local proposal needed.
- If size is M+, apply the RFC prompt above (suggest /rfc).
- If size is XS/S, proceed with inline scoping.
- Log: `RFC check: linear-sourced-dev-ready`

### Step 2: Route ungroomed work

If no proposal exists, decide whether grooming is needed:

<!-- KB maturity criteria: keep in sync with skills/groom/steps/01-intake.md -->

**For M/L/XL: detect KB maturity first.** Check the knowledge base before choosing a groom tier:

| Signal | Check |
|--------|-------|
| Strategy | `{pm_dir}/strategy.md` exists |
| Research | Any file in `{pm_dir}/evidence/research/` |
| Competitors | Any `{pm_dir}/evidence/competitors/*/profile.md` |

Classify:
- **Fresh** (none of the three signals) → max tier: `quick`
- **Developing** (strategy OR research present) → max tier: `standard`
- **Mature** (strategy AND research AND competitors) → max tier: `full`

Log in `.pm/dev-sessions/{slug}/session.json`: `kb_maturity: {level}, tier_cap: {tier}`

| Size | Action |
|------|--------|
| XS | No groom, no RFC. Confirm scope + ACs with the user inline, then skip to Implementation. |
| S | No RFC needed. Brief conversational plan with user (Cursor plan-mode style), then skip to Implementation. |
| M | Halt with the groom prompt (see below). When the user runs groom, invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for the RFC prompt. |
| L/XL | Halt with the groom prompt (see below). When the user runs groom, invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for the RFC prompt. |

Print and **stop** — do not ask a question:

> `Blocked: no groomed proposal. Run: /pm:groom {slug} (KB maturity: {level}, suggested tier: {tier}, ~{time}).`

Log: `groom: blocked-needs-proposal`.

Time estimates by tier:

| Tier | Estimate |
|------|----------|
| `quick` | ~5 min |
| `standard` | ~15 min |
| `full` | ~30 min |

Log the decision in `.pm/dev-sessions/{slug}/session.json`:
```
- RFC check: approved (path: {rfc_path}) | blocked-needs-rfc | blocked-needs-proposal | incomplete-groom (status not proposed/planned/in-progress) | skipped-xs | conversational-s
```

## Done-when

The routed product/readiness prerequisites are satisfied, or the session contains a direct `pm:groom`/`pm:rfc` blocker with its missing artifact.

**Advance:** proceed to Step 05 (Implementation).
