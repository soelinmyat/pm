---
name: Groom Readiness
order: 4
description: Check for existing RFC, route ungroomed work to pm:groom or inline scoping
---

## RFC Check (all sizes)

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification.

## Goal

Decide whether this task can proceed directly, needs conversational scoping, should route through grooming, or must stop for RFC generation first.

<HARD-RULE>
Never ask an open-ended question here. XS/S routes through inline scoping with no user turn. M+ either proceeds on an approved RFC, or halts with a deterministic instruction telling the user exactly what to run next — not a menu, not a "should we?" question.

- XS/S without RFC → proceed with inline scoping.
- M+ with approved RFC → proceed to implementation.
- M+ without RFC → halt with: `"Blocked: M+ work without RFC. Run: /rfc {slug}. To skip the RFC and accept inline planning, re-invoke /pm:dev {slug} --skip-rfc."`
- M+ without proposal → halt with: `"Blocked: no groomed proposal. Run: /pm:groom {slug} (KB maturity: {level}, suggested tier: {tier}). To skip groom, re-invoke /pm:dev {slug} --skip-groom."`

Once the user re-invokes with `--skip-rfc` or `--skip-groom`, treat that as explicit consent — do not re-prompt.
</HARD-RULE>

Before proceeding, check whether an approved RFC exists for this work.

### Step 1: Check for existing proposal + RFC

Look for `{pm_dir}/backlog/{slug}.md`. If found, read frontmatter:

- **`status:` is not `proposed`, `planned`, or `in-progress`** → Groom started but didn't complete. Treat as ungroomed. Continue to Step 2.
- **`rfc:` is non-null** AND the referenced RFC file exists with `status: approved` → RFC is ready. **Re-discover tasks from the RFC** (the session file may have stale `task_count` from a prior intake that ran before the RFC existed): read the RFC HTML, parse `.issue-detail` elements (extract `.issue-detail-num`, `.issue-detail-title`, `.issue-detail-size` for each), set `task_count`, and rebuild the `## Tasks` table. If zero `.issue-detail` elements are found, hard-abort: "RFC found but no Issue sections parsed — check RFC HTML structure for `.issue-detail` cards." Then update the session file (`.pm/dev-sessions/{slug}.md`) with `Stage: implement`, the refreshed `task_count`, and the rebuilt `## Tasks` table. Skip to Implementation. Log: `RFC: approved (path: {rfc_path}, tasks: {task_count})`.
- **`rfc:` is non-null** but RFC file has `status: draft` AND size is M+ → RFC started but not approved. Treat same as null — continue to the RFC prompt below. Log: `RFC: draft (needs /rfc to complete)`.
- **`rfc:` is null** AND size is M+ → No RFC exists for M-sized work. Continue to the RFC prompt below.
- **`rfc:` is null** AND size is XS/S → No RFC needed. Continue to Step 2 for inline scoping.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### RFC halt (M+ without RFC)

If `rfc:` is null and size is M+, and `--skip-rfc` was NOT passed on the current invocation:

Print and **stop** — do not ask a question:

> `Blocked: M+ work without RFC. Run: /rfc {slug}.`
> `To skip the RFC and accept inline planning, re-invoke: /pm:dev {slug} --skip-rfc`

Log: `RFC: blocked-needs-rfc`.

If `--skip-rfc` IS set: proceed with conversational inline planning (same as S behavior in Step 2). Log: `RFC: skipped-by-flag`

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

Log in `.pm/dev-sessions/{slug}.md`: `kb_maturity: {level}, tier_cap: {tier}`

| Size | Action |
|------|--------|
| XS | No groom, no RFC. Confirm scope + ACs with the user inline, then skip to Implementation. |
| S | No RFC needed. Brief conversational plan with user (Cursor plan-mode style), then skip to Implementation. |
| M | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC prompt. |
| L/XL | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC prompt. |

**If `--skip-groom` was NOT passed:** Print and **stop**:

> `Blocked: no groomed proposal. Run: /pm:groom {slug} (KB maturity: {level}, suggested tier: {tier}, ~{time}).`
> `To build with available context, re-invoke: /pm:dev {slug} --skip-groom`

Log: `groom: blocked-needs-proposal`.

**If `--skip-groom` IS set:** Proceed with available context. Log: `groom: skipped-by-flag`.

Time estimates by tier:

| Tier | Estimate |
|------|----------|
| `quick` | ~5 min |
| `standard` | ~15 min |
| `full` | ~30 min |

Log the decision in `.pm/dev-sessions/{slug}.md`:
```
- RFC check: approved (path: {rfc_path}) | blocked-needs-rfc | blocked-needs-proposal | incomplete-groom (status not proposed/planned/in-progress) | skipped-xs | conversational-s | skipped-by-flag
```

## Done-when

- RFC status determined: `approved` (skip to implementation), `blocked-needs-rfc`, `blocked-needs-proposal`, `skipped-xs`, `conversational-s`, or `skipped-by-flag`
- Decision logged in `.pm/dev-sessions/{slug}.md`
