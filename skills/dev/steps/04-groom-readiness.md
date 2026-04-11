---
name: Groom Readiness
order: 4
description: Check for existing RFC, route ungroomed work to pm:groom or inline scoping
---

## RFC Check (all sizes)

Before proceeding, check whether an approved RFC exists for this work.

### Step 0: Check for rfc-approved session resume

Read `.pm/dev-sessions/{slug}.md`. If `Stage` is `rfc-approved`:

- The RFC was already approved in a prior session. The user chose to stop and resume later.
- Read the RFC path from the session file. Verify the RFC file exists and has `status: approved`.
- **Skip RFC generation and RFC review entirely.** Log: `RFC: approved (resumed from prior session)`.
- If a worktree path is recorded in the session file, verify it still exists. If not, re-create it (Workspace step).
- Proceed directly to Implementation using the **resume path**.

### Step 0.5: Linear-sourced dev-ready shortcut

If `linear_readiness` is `dev-ready` in the session state AND no `{pm_dir}/backlog/{slug}.md` exists:
- This is a Linear issue that passed the readiness check. No local proposal needed.
- **RFC needed.** Proceed to RFC Generation.
- Pass the Linear issue data (title, description, labels, ID) as product context to the RFC generation prompt, in place of the proposal/PRD context block:

  ```
  **Product Context (from Linear issue):**
  - Linear ID: {linear_id}
  - Title: {linear_title}
  - Description: {linear_description}
  - Labels: {linear_labels}
  ```

  If sub-issues exist, also include:
  ```
  - Sub-issues:
    - {SUB_ID}: {SUB_TITLE} (size: {SIZE})
      Description: {SUB_DESCRIPTION}
      ACs: {SUB_ACS}
  ```

- Log: `RFC check: needs-rfc (Linear-sourced, dev-ready, no local proposal)`

### Step 1: Check for existing proposal + RFC

Look for `{pm_dir}/backlog/{slug}.md`. If found, read frontmatter:

- **`status:` is not `proposed`, `planned`, or `in-progress`** → Groom started but didn't complete. Treat as ungroomed. Continue to Step 2.
- **`rfc:` is non-null** AND the referenced RFC file exists with `status: approved` → RFC is ready. Create a new session file (`.pm/dev-sessions/{slug}.md`) with `Stage: implement`. Read the RFC and skip to Implementation. Log: `RFC: approved (path: {rfc_path})`. Note: for `planned` items resumed after a prior session, no old session file exists (it was deleted on stop). This is the expected fresh-session path.
- **`rfc:` is null** or RFC file has `status: draft` → RFC needed. Continue to RFC Generation.
- **No proposal `.md` found** → No product groom has run. Continue to Step 2.

### Step 2: Route ungroomed work

If no proposal exists, decide whether grooming is needed:

<!-- KB maturity criteria: keep in sync with skills/groom/phases/phase-1-intake.md -->

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
| M | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC generation. |
| L/XL | Offer skip prompt (see below). If grooming: invoke `pm:groom` with `groom_tier` set to the KB maturity tier. After groom, return here for RFC generation. |

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
- RFC check: approved (path: {rfc_path}) | needs-rfc | incomplete-groom (status not proposed/planned/in-progress) | no-proposal (invoking groom) | skipped-xs | conversational-s | skipped-by-user
```
