---
name: Intake
order: 1
description: Resume detection, proposal lookup, size gate, and RFC-needed determination
---

## Goal

Determine whether an RFC is needed and gather all product context for generation. By the end of this step, you either proceed to RFC generation with full context or stop early with a clear reason.

## How

### 1. Resume Detection

Glob `{pm_state_dir}/rfc-sessions/*.md`.

If a matching session file exists for the requested slug:
- Read it. Check the `Stage` field.
- If `Stage` is `approved`: print the message below and **stop**.

> "RFC already approved. Run `/pm:dev` to implement."

- If `Stage` is any other value: offer to resume or start fresh. If resuming, skip to the recorded stage. If starting fresh, delete the file and continue.

### 2. Handle Missing Slug

If no slug was provided and no session file matched:

> "Which feature? Provide a slug or describe the feature."

Wait for the user's answer. Derive the slug from their response.

### 3. Proposal Lookup

Look for `{pm_dir}/backlog/{slug}.md`. Three outcomes:

**A. Proposal found — check frontmatter:**

- Read `status:` and `rfc:` fields.
- If `rfc:` is non-null AND the referenced RFC file exists with `status: approved`:

> "RFC already approved for '{slug}'. Run `/pm:dev` to implement."

**Stop.** Do not re-generate.

- If `rfc:` is non-null but RFC file has `status: draft`: RFC was started but not completed. Log: `RFC: resuming draft`. Continue to size gate (Step 4) — the generation step will detect and resume the existing draft.

- If `status:` is `proposed`, `planned`, or `in-progress`: valid proposal. Continue to size gate (Step 4).
- If `status:` is anything else (draft, rejected, etc.): proposal isn't ready.

> "The proposal for '{slug}' isn't complete (status: {status}). Run `/pm:groom` to finish it first."

**Stop.**

**B. No proposal found — check Linear:**

If no `{pm_dir}/backlog/{slug}.md` exists, check whether a Linear issue is available:

- If Linear MCP tools are available, search for the slug or ticket ID.
- If a Linear issue is found with enough context (title, description, ACs):
  - Record `linear_readiness: dev-ready` in state.
  - Use the Linear issue as product context instead of a proposal.
  - Pass the Linear issue data to RFC generation:

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
  - Continue to size gate (Step 4).

- If no Linear issue found or Linear unavailable:

> "No product proposal found for '{slug}'. Run `/pm:groom {slug}` first to create one."

**Stop.**

### 4. Size Gate

Read the `size:` field from the proposal frontmatter (or infer from Linear labels).

| Size | Action |
|------|--------|
| XS | Print: "This is XS work — no RFC needed. Run `/pm:dev` directly." **Stop.** |
| S | Print: "This is S work — no RFC needed. Run `/pm:dev` directly." **Stop.** |
| M, L, XL | RFC needed. Continue to context discovery. |

If size is missing, propose one based on the proposal content:

1. Read the proposal body (scope, ACs, competitive context, technical feasibility).
2. Apply these heuristics:
   - **XS:** Single-line or config-only change. No new logic.
   - **S:** One concern, a few ACs, contained to one module. Straightforward.
   - **M:** Multiple ACs, touches 2-3 modules, some design decisions. A few days of work.
   - **L:** Cross-cutting, multiple issues/concerns, new patterns or abstractions. A week+.
   - **XL:** Major initiative, new subsystem, multiple parallel tracks. Multi-week.
3. Also factor in `scope_signal` if set (`small` → XS/S, `medium` → M, `large` → L/XL).
4. Present your recommendation:

> "No size set. Based on the scope ({one-sentence reason}), I'd call this **{SIZE}**. Sound right? (or tell me a different size)"

Wait for confirmation or override. Apply the gate above.

### 5. Context Discovery

Run context discovery per `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md`.

Extract and store in the session state file:
- Product context (from CLAUDE.md)
- Technical context (from AGENTS.md)
- Stack detection
- Issue tracker detection
- Strategy context (if `{pm_dir}/strategy.md` exists)

### 6. Write Session State

Create `{pm_state_dir}/rfc-sessions/{slug}.md` following the template in `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/state-schema.md`. Use the markdown table format (not YAML frontmatter).

Update `Stage` to `rfc-generation` when intake completes.

## Done-when

One of these is true:
- **Stopped early:** User told to run `/pm:dev` (XS/S) or `/pm:groom` (no proposal) or informed RFC is already approved.
- **Proceeding:** Session state file written with `Stage: rfc-generation`, product context extracted, proposal or Linear data loaded. Ready for RFC generation.
