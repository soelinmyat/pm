---
name: rfc
description: "Technical RFC lifecycle for a groomed M/L/XL feature. Use when the user says 'write an RFC', 'generate RFC', 'create an RFC', 'technical design', 'review this RFC', or when pm:dev routes substantial work that needs an approved engineering design. Produces a reviewed, explicitly approved RFC and machine-readable implementation handoff."
---

# RFC — Technical Design Lifecycle

## Purpose

Turn an approved product proposal or genuinely dev-ready Linear issue into a technically reviewed RFC, then stop at an explicit human approval boundary before creating downstream implementation state.

## Iron Law

**NEVER MARK AN RFC APPROVED WITHOUT EXPLICIT HUMAN APPROVAL OF THE CURRENT REVIEWED ARTIFACT.**

## When NOT to use

- For XS/S work, route directly to `pm:dev`.
- For product discovery, unclear scope, or missing acceptance criteria, use `pm:groom`.
- For implementing an already approved RFC, use `pm:dev`.
- For a quick read-only technical answer, answer directly.

**Workflow:** `rfc` | **Telemetry steps:** `intake`, `rfc-generation`, `rfc-review`, `rfc-approval`, `rfc-handoff`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## Workflow

1. **Resume before intake.** Look for `.pm/rfc-sessions/*/session.json`. Resume the one matching the requested slug with `scripts/rfc-session.js next --session <path> --json`. If only a legacy `.md` session exists, migrate and recertify it; never trust legacy `approved` as proof because the old workflow wrote that state before human confirmation.
2. **Create canonical state for fresh work.** Run `scripts/rfc-session.js init --slug <slug> --source-dir <absolute-source-dir> --json`. During intake, save proposal/Linear source, M/L/XL size, acceptance criteria, and the canonical artifact repository root with the `context` command. `session.json` is authoritative and moves to an immutable run-ID archive; the committed sibling `.approval.json` is the exact approval contract consumed by Dev.
3. **Load one phase at a time.** Run `scripts/rfc-session.js next`. Read only its `instruction_path` and the references declared by that step. A same-named file in `.pm/workflows/rfc/` overrides the bundled step. Do not preload future phases.
4. **Build bounded execution packets.** Use `scripts/rfc-prompt.js` for generation or delegated review. Include only the active objective, ACs, relevant repository findings, exact input/artifact paths, constraints, authority, evidence, and result contract.
5. **Keep runtime policy in data.** Model and effort defaults live in `references/model-profiles.json`. A provider switch changes the profile, not workflow semantics or reviewer criteria.
6. **Advance through the runner.** Every non-approval phase returns the strict phase-result envelope in `references/rfc-session.schema.json` and records it with `scripts/rfc-session.js record`. Only the runner advances phases, validates artifact identity, enforces retries, and recognizes completion.
7. **Separate review from approval.** Passing review records three lens verdicts against the current sidecar hash and enters `status: awaiting_approval`. It does not change RFC/proposal lifecycle status. After the user explicitly approves, record `scripts/rfc-session.js approve --approved-by <identity>`; edits after review force another review.
8. **Gate external effects independently.** RFC approval approves the design, not Linear creation, unattended loop pickup, opening applications, or starting implementation. Execute those actions only when the corresponding authority boolean is true or after a separate explicit confirmation recorded with `authorize`.
9. **Recover explicitly.** If reviewed content changes or the user requests a redesign, run `revise --reason <reason>` and review the new hash. If a recorded blocker is resolved, run `unblock --resolution <resolution>` to resume the same phase with an auditable resolution.

## Loop Worker Mode (headless)

When `PM_LOOP_WORKER=1` with `PM_LOOP_STAGE=rfc`, preserve proposal, generation, artifact validation, technical review, and human approval gates; never self-approve. The loop worker is the only canonical durable card-state writer, so do not write or update backlog/card state. Never invoke `approve`, infer approval, update proposal/card lifecycle, or perform external effects. Return `needs-approval` with the verified document after review. Exact statuses: artifact-ready, needs-approval, blocked, failed, noop. Write the document beneath `PM_LOOP_RESULT_DIR` with mode `0600` and the result atomically to `PM_LOOP_RESULT_FILE` with mode `0600`.

## Steps directive

Steps live in `${CLAUDE_PLUGIN_ROOT}/skills/rfc/steps/`. Resolve the one path returned by `rfc-session next`, applying a same-filename `.pm/workflows/rfc/` override first. Then read only the references in that step's `requires` frontmatter. Execute its Goal/How/Done-when contract and record its result before selecting another phase.

## Red Flags — Self-Check

- **"The reviewers passed, so the RFC is approved."** Technical review only enters `awaiting_approval`; wait for an explicit human decision.
- **"The old session says approved."** Legacy state lacks trustworthy approval provenance; recertify review and approval.
- **"A stronger model can keep the whole workflow straight."** Future-phase instructions still create authority and lifecycle confusion; load one phase.
- **"Three reviewers means three agents."** Lenses are mandatory, process count is not; use the smallest independent review shape that preserves judgment quality.
- **"The HTML looks unchanged."** Compare the sidecar hash and binding; prose confidence is not artifact identity.
- **"Approval probably includes Linear and loop pickup."** Those are separate external authorities and require their own grant.

## Escalation Paths

- No complete proposal: "No approved product context exists for `{slug}`. Run `pm:groom` and resume this RFC afterward."
- XS/S scope: "This is `{size}` work, so an RFC adds ceremony without safety. Continue with `pm:dev`."
- Artifact validation fails twice: "RFC generation is blocked by `{validator output}`. The draft and session are preserved at `{paths}`."
- Reviewer disagreement remains after two fix rounds: "Technical review still has blocking findings. Preserved the exact verdicts and artifact hash; resolve `{decision}` before continuing."
- Human approval absent: "Technical review passed. The RFC is awaiting your approval; no downstream state has been changed."

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Review approval is close enough." | Review validates engineering quality; only the human owns the product/design decision. |
| "The status is just metadata." | Downstream dev and loop automation treat it as authority. |
| "More agents are always safer." | Duplicate context and inconsistent schemas increase synthesis errors; dispatch by lens and independence need. |
| "We can repair the sidecar later." | A present-but-invalid sidecar is a hard downstream halt. |
| "Starting implementation saves a turn." | RFC approval does not authorize implementation or external delivery actions. |

## Before Marking Done

- [ ] RFC HTML and JSON sidecar are saved, hash-bound, validator-clean, and committed together.
- [ ] All required review lenses passed against the current artifact hash.
- [ ] The user explicitly approved that same reviewed hash, or the workflow clearly remains `awaiting_approval`.
- [ ] Proposal, Linear, loop, and implementation effects respected their separate authority grants.
- [ ] Canonical `session.json` is saved and valid; completed approval audit was not deleted.
- [ ] The user received the artifact path and the single correct next action.
