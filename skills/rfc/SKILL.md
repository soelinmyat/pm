---
name: rfc
description: "Use when generating or reviewing an RFC (Request for Comments) for a groomed feature. Use when the user says 'write an RFC', 'generate RFC', 'create an RFC', 'RFC for this feature', 'technical design', or when pm:dev routes M/L/XL work that needs an RFC. Takes a groomed proposal as input and produces a technical RFC ready for review."
---

# pm:rfc

## Purpose

Generate a technical RFC from a groomed product proposal. The RFC translates product intent into an engineering plan with tasks, contracts, and review gates.

RFC is the bridge between product (proposal) and engineering (implementation). No proposal means no product context means a garbage RFC.

Read `${CLAUDE_PLUGIN_ROOT}/references/capability-gates.md` for shared capability classification, and `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions. Output follows `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` with `PM_LOOP_STAGE=rfc`, preserve RFC research, technical review, and human approval gates; human approval is mandatory and the worker must never self-approve. Do not write or update backlog/card state in loop mode—the loop worker is the only canonical durable card-state writer.

Atomically write the version-1 envelope to `PM_LOOP_RESULT_FILE`. Exact statuses: artifact-ready, needs-approval, blocked, failed, noop. Artifact terminals include one `document` payload (`kind: rfc`, run-relative path, SHA-256, media type); create that document with restrictive mode `0600`. `blocked` includes bounded code, reason, and remediation. The worker verifies and copies the document into the allowlisted PM destination.

**Workflow:** `rfc`

**Steps:** Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/rfc/steps/` in numeric filename order. If `.pm/workflows/rfc/` exists, same-named files there override defaults.

## Hard rules

- **Never generate an RFC without a proposal or equivalent Linear context.** The input is a groomed proposal, or a dev-ready Linear issue with title, description, and ACs. No product context = garbage RFC — if none exists, stop and tell the user to run `/pm:groom` first. Inference is invention: a thin proposal (missing scope, ACs, or design) produces a thin RFC, so send it back to groom rather than filling gaps yourself.
- **XS/S needs no RFC.** Route to `pm:dev` directly — over-ceremony kills velocity. "Too complex for XS" means re-size it, not add ceremony.
- **Never re-generate an approved RFC.** If invoked again once the RFC is approved, say so and point the user to `pm:dev`.
- **Never skip review.** It's the last human gate before implementation and catches blind spots (~30% of issues) every time.
- **Linear is not a proposal.** Linear carries tracking data; the proposal carries scope, design, research, and competitive context. Use a Linear issue as context only when it genuinely holds title, description, and ACs.

## When NOT to use

XS/S work that doesn't need an RFC. Quick fixes, typo corrections, or config changes. When the user wants product discovery or scoping, use `pm:groom`. When the user wants to jump straight to implementation, use `pm:dev`.

## Resume

Before doing anything else, glob `{source_dir}/.pm/rfc-sessions/*.md`.

- If exactly one session exists, read it and ask: "Found an in-progress RFC session for '{slug}' (last updated: {updated}, current stage: {stage}). Resume from {stage}, or start fresh?"
- If multiple sessions exist, list them with slug, stage, and updated timestamp, and ask which to resume.

Wait for the user's answer. If resuming: skip completed stages. If starting fresh: delete the selected state file, then begin Step 1.

## References

| Reference | Purpose |
|-----------|---------|
| `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/state-schema.md` | Session state file schema |
| `${CLAUDE_PLUGIN_ROOT}/references/context-discovery.md` | Project context discovery contract |

## State File

Each RFC session has its own state file under `{source_dir}/.pm/rfc-sessions/{slug}.md`. Session state is ephemeral and lives source-side (gitignored). The RFC artefact itself lives at `{pm_dir}/backlog/rfcs/{slug}.html` in the PM repo. Write session state using the schema defined in `${CLAUDE_PLUGIN_ROOT}/skills/rfc/references/state-schema.md`.

## Escalation Paths

- **No proposal exists:** "No product proposal found for '{slug}'. Run `/pm:groom {slug}` first to create one."
- **Proposal is draft/incomplete:** "The proposal for '{slug}' hasn't been approved yet (status: {status}). Run `/pm:groom` to complete it first."
- **RFC already approved:** "RFC already approved for '{slug}'. Run `/pm:dev` to implement."
- **XS/S size detected:** "This is {size} work — no RFC needed. Run `/pm:dev` directly."
- **User wants product scoping, not technical design:** "Sounds like you want product discovery. Run `/pm:groom` for that — RFC handles the technical plan."
