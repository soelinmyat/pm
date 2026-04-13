---
name: Groom Readiness
order: 4
description: Check for existing RFC, route ungroomed work to pm:groom or inline scoping
---

## RFC Check (all sizes)

Before proceeding, check whether an approved RFC exists for this work.

### Step 1: Check for existing proposal + RFC

Look for `{pm_dir}/backlog/{slug}.md`. If found, read frontmatter:

- **`status:` is not `proposed`, `planned`, or `in-progress`** → Groom started but didn't complete. Treat as ungroomed. Continue to Step 2.
- **`rfc:` is non-null** AND the referenced RFC file exists with `status: approved` → RFC is ready. Create a new session file (`.pm/dev-sessions/{slug}.md`) with `Stage: implement`. Read the RFC and skip to Implementation. Log: `RFC: approved (path: {rfc_path})`.
- **`rfc:` is non-null** but RFC file has `status: draft` AND size is M+ → RFC started but not approved. Treat same as null — continue to the RFC prompt below. Log: `RFC: draft (needs /rfc to complete)`.
- **`rfc:` is null** AND size is M+ → No RFC exists for M-sized work. Continue to the RFC prompt below.
- **`rfc:` is null** AND size is XS/S → No RFC needed. Continue to Step 2 for inline scoping.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### RFC prompt (M+ without RFC)

If `rfc:` is null and size is M+:

> "No RFC found for this M-sized work. Run /rfc first? (I can do inline planning if you prefer.)"

- **If user says yes** → Print "Run: /rfc {slug}" and **stop**. Do not proceed to implementation.
- **If user declines** → Proceed with conversational inline planning (same as S behavior in Step 2). Log: `RFC: skipped-by-user`

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

**Before invoking groom, ask:**

> No product proposal exists for this work. KB maturity: **{level}**.
> I can groom this first ({tier} tier, ~{time}) or just build it now. Which do you prefer?

Time estimates by tier:

| Tier | Estimate |
|------|----------|
| `quick` | ~5 min |
| `standard` | ~15 min |
| `full` | ~30 min |

If the user says to skip, proceed with available context. Log: `groom: skipped-by-user`

Log the decision in `.pm/dev-sessions/{slug}.md`:
```
- RFC check: approved (path: {rfc_path}) | needs-rfc (suggest /rfc) | incomplete-groom (status not proposed/planned/in-progress) | no-proposal (invoking groom) | skipped-xs | conversational-s | skipped-by-user
```

## Done-when

- RFC status determined: `approved` (skip to implementation), `needs-rfc` (user directed to /rfc), `skipped-xs`, `conversational-s`, or `skipped-by-user`
- Decision logged in `.pm/dev-sessions/{slug}.md`
