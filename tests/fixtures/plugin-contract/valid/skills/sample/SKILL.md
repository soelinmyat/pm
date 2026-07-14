---
name: sample
description: "Use when validating a canonical sample workflow, fixture contract, or plugin authoring baseline."
skill-class: capture
---

# Sample

## Purpose

Capture one sample fixture record so the plugin-contract rule pack can verify a complete, executable authoring contract.

## Iron Law

**NEVER OVERWRITE AN EXISTING SAMPLE RECORD.**

## When NOT to use

Do not use this fixture workflow for production data or broad product decisions; route those requests to the appropriate real skill.

**Workflow:** `sample` | **Telemetry steps:** `intake`, `done`

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution, telemetry, and custom instructions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

Resolve workflow steps from `.pm/workflows/sample/` when an override exists; otherwise read and follow `skills/sample/steps/` in order.

The capture must choose a clear routing kind and use atomic creation with collision detection so an existing fixture is never overwritten.

## Red Flags — Self-Check

- **"This tiny fixture does not need routing."** Stop and capture the routing kind explicitly.
- **"Overwriting the old sample is harmless."** Instead, preserve it and use a collision-safe name.
- **"The step contract is obvious."** Check every required section before advancing.
- **"I can skip validation because this is test data."** Validate the saved artifact against the fixture contract.

## Escalation Paths

If the requested operation is not a bounded sample capture, stop and route to the skill that owns the real workflow.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "It is only a fixture." | Fixtures define the contract that production plugin validation enforces. |
| "A duplicate is fine." | Silent collisions make the validation baseline nondeterministic. |

## Before Marking Done

- [ ] The sample artifact was saved without overwriting an existing record.
- [ ] The user or calling test confirmed the requested sample behavior.
- [ ] The routing, collision, and validation gates passed.

Persona: @personas/tester.md.
