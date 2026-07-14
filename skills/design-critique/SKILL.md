---
name: design-critique
description: "Use after implemented UI, UX, frontend, mobile, CSS, layout, visual, component, page, interaction, proposal HTML, RFC HTML, or PM report changes. Use when the user asks for design critique, artifact critique, UI review, visual QA, visual review, design pass, polish review, layout review, frontend review, HTML report review, proposal review, RFC presentation review, responsive review, print review, or when pm:dev needs its mandatory PM-native design critique gate before QA, review, push, PR, or ship."
---

# pm:design-critique

## Purpose

Run a post-implementation evidence gate for either product UI or a rendered PM artifact. It produces a commit-bound route, hash-bound capture manifest, structured findings report, accessible HTML report, and a Dev gate row without duplicating QA or code-review ownership.

## Iron Law

**NEVER PASS WITHOUT COMPLETE, CURRENT, HASH-BOUND RENDERED EVIDENCE.**

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

## When NOT to use

- Before an interface or artifact can be rendered. Use `pm:shape`, `pm:groom`, or `pm:rfc` for pre-implementation design work.
- For functional acceptance behavior, data integrity, or workflow correctness. Keep those in Dev QA.
- For source correctness, security, reuse, maintainability, or runtime efficiency. Use `pm:review`.
- For backend-only, docs-only, generated-only, lockfile-only, or non-UI configuration changes with proven no visual impact. Record the routed Dev skip instead.
- For a Markdown-only product document with no rendered artifact. Review its content in the owning product skill.

## Modes and status

Subject mode is explicit and independent from execution context:

| Mode | Subject | Required evidence |
|---|---|---|
| `product-ui` | Running web or mobile interface | State/viewport captures, accessibility evidence, and DOM audit for web |
| `pm-artifact` | Proposal, RFC, report, or other rendered PM HTML | Structural manifest, desktop/tablet/narrow full renders, accessibility evidence, render manifest, and print PDF |

Report outcomes are `passed`, `failed`, `blocked`, or `deferred`. A deferred blocking decision maps to a blocked Dev gate; human authority can choose a direction but cannot turn unresolved P0/P1 evidence into a pass. `skipped` is a Dev routing result, not a critique report outcome.

## Workflow

**Workflow:** `design-critique` | **Telemetry steps:** `scope-route`, `capture`, `evaluate`, `resolve`, `publish`

Read all `.md` files from `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/steps/` in numeric filename order. If `.pm/workflows/design-critique/` exists, same-named files there override defaults. Execute each step in order and preserve its explicit transition criteria.

Read `${CLAUDE_PLUGIN_ROOT}/skills/design-critique/references/evidence-contract.md` before creating route, capture, report, or HTML artifacts. Use `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md` for the Dev gate sidecar.

## Resume

If `.pm/dev-sessions/{slug}/design-critique/` exists, validate the source commit and every upstream hash before resuming. Resume at the first missing or invalid artifact. A new commit invalidates the route; changed route bytes invalidate captures and report; changed capture bytes invalidate the report. Preserve earlier rounds as evidence rather than overwriting them.

## Red Flags — Self-Check

- **"The screenshots look current enough."** Check commit and SHA-256 bindings; paths and timestamps are not identity.
- **"One desktop happy path represents the feature."** Check state and viewport applicability explicitly, including empty, error, boundary, responsive, and print coverage.
- **"The reviewer said it looks good, so the gate passes."** Use deterministic coverage, accessibility, structural, and freshness checks.
- **"QA or code review will catch this."** Keep rendered craft here, behavior in QA, and source quality in Review; do not leave an ownership gap.
- **"The user approved deferring the P1, so I can mark passed."** Stop and record `deferred`; block the gate until the evidence is resolved or the design changes.
- **"I can update the report after a fix without recapturing."** Capture distinct hash-bound before and after evidence for resolved P0/P1 findings.

## Escalation Paths

- **Cannot render or sanitize:** “Design critique blocked: {exact environment or privacy failure}. I need {smallest recovery action} before current evidence can be captured.”
- **Blocking product decision:** “Design critique is deferred on {finding IDs}: {tradeoff}. Choose {bounded options}; the gate remains blocked until the selected direction is rendered and rechecked.”
- **Ownership conflict:** “This finding belongs to {QA/Review}, not Design Critique, because {boundary}. I will preserve the evidence reference and hand it to that gate.”
- **Coverage ambiguity:** “I cannot determine whether {state/viewport} applies from the diff and acceptance criteria. Confirm the intended behavior or update the route inventory.”

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| “It is only a small CSS change.” | Small changes can break narrow layouts, contrast, focus, and print; scope changes depth, not evidence freshness. |
| “The HTML validator already passed.” | Structural safety does not assess hierarchy, density, navigation quality, or visual craft. |
| “Fresh Eyes found nothing.” | Independent review complements, but does not replace, coverage and deterministic evidence. |
| “The artifact is in `/tmp`, so the path is enough.” | Passing evidence must be durable under the session directory and bound by hash. |
| “P2 means optional.” | P2 may be deferred only with a concrete reason and owner; it is still recorded. |
| “A new commit only changed tests.” | Recompute the route against current HEAD; the checker, not intuition, establishes freshness. |

## Before Marking Done

- [ ] Route, captures, structured report, and accessible HTML report are saved under `.pm/dev-sessions/{slug}/design-critique/`.
- [ ] `scripts/design-critique-check.js` passes against current HEAD.
- [ ] Applicable coverage is 100%, all P0/P1 findings are resolved with before/after evidence, and the bounded review loop is complete.
- [ ] The Dev gate row preserves other gates and points to the checked HTML report at the current commit.
- [ ] The user or calling Dev phase receives the outcome, remaining P2/P3 findings, and the exact next action.
- [ ] Key deterministic, artifact, and project-specific gates passed; the user confirmed any design choice that required authority.
