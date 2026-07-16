---
name: using-pm
description: "Use when a session opens with a general PM request, the user asks which PM skill or workflow applies, or the runtime must route a concrete request into the correct plugin skill before acting. Do not use for subagents or to add ceremony to direct questions."
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill.
</SUBAGENT-STOP>

## Purpose

Route session-start behavior and teach the runtime how to use PM skills. `using-pm` selects a lane; it does not perform that lane’s work or grant its external effects.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `using-pm` | **Telemetry steps:** `classify-intent`, `route`, `handoff`

## Iron Law

**NEVER HIJACK A DIRECT REQUEST.**

## When NOT to use

- When dispatched as a subagent, obey `<SUBAGENT-STOP>` and execute the assigned lane.
- When a concrete PM skill is already active, stay in that skill unless its escalation contract calls for a switch.
- When the user asks a direct question that needs no PM workflow, answer it directly.

## Hard rules

- When work matches a skill below, invoke that skill so its gates and evidence apply. Do not reproduce its workflow inline.
- Never force PM state or ceremony onto a direct question or narrowly scoped instruction.
- Routing grants no downstream effect authority. Preserve every confirmation, retry, recovery, and external-effect gate in the selected skill.
- A request to push one commit or branch is a direct Git request unless the user clearly asks for the complete review, PR, CI, and merge lifecycle owned by `pm:ship`.

## Session Start

1. Classify the first message before inspecting workspace state.
2. **If it's a direct question or a concrete task** — answer or route directly. Do not invoke `pm:start` merely because PM is installed.
3. **If it's a general session-opening request** such as “start PM,” “open PM,” “show the project pulse,” or “what should I do next”:
   - run `node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js --json`;
   - if resolution fails, surface the exact configuration error and perform no write;
   - if resolution succeeds, invoke `pm:start`, which owns bootstrap, resume, and pulse detection.
4. Once a concrete lane is active, do not route through `using-pm` again.

## Public routing map

| User says | Skill | Boundary |
|---|---|---|
| “Should we add X?” / “What if we?” / “Help me decide” | `pm:think` | Uncertain product decisions and approach tradeoffs |
| “Research X” / “What is the market size?” / “Compare competitors” | `pm:research` | Factual investigation and saved research |
| “Write a PRD” / “Spec this idea” / “Break down the product scope” | `pm:groom` | Product discovery and an approved proposal |
| “Generate ideas” / “What should we build next?” | `pm:ideate` | Evidence-linked opportunity generation |
| “Define our strategy” / “Clarify ICP or positioning” | `pm:strategy` | Product strategy and explicit non-goals |
| “Feature inventory” / “What does this product do?” | `pm:features` | Source-bound user-facing capability inventory |
| “Capture this customer signal” / “Save this observation” | `pm:note` | One lightweight evidence record |
| “Import feedback files” / “Ingest interviews” | `pm:ingest` | Batch or file-based evidence import |
| “Refresh stale research” / “What is outdated?” | `pm:refresh` | Patch existing knowledge without losing content |
| “File a task” / “Add a chore or todo” | `pm:task` | Small tracked action without Groom or RFC |
| “File a bug” / “Track this regression” | `pm:bug` | Capture an observed defect; fixing it routes to Dev |
| “Write an RFC” / “Create the technical design” | `pm:rfc` | Architecture and executable work units for M+ work |
| “Build this” / “Fix this bug” / “Debug this” | `pm:dev` | Implementation from supplied task context or an approved RFC when required |
| “Review this diff or branch” | `pm:review` | Source review across logical bug, design, edge, reuse, quality, and efficiency lenses; worker count adapts to the runtime |
| “Review the rendered proposal HTML” / “Run visual QA” | `pm:design-critique` | Rendered UI or PM-artifact evidence, not product-content approval |
| “Ship this reviewed branch” / “Open the PR and take it through CI” | `pm:ship` | Full delivery lifecycle with separately authorized effects |
| “Initialize PM” / “Open PM” / “Show the project pulse” | `pm:start` | Workspace bootstrap, resume, and project pulse |
| “Enable Linear” / “Configure integrations” / “Set up separate-repo mode” | `pm:setup` | Integration and repository configuration, not workspace bootstrap |
| “List active PM work” / “What is in flight?” | `pm:list` | Read-only terminal projection |
| “Open the PM board” / “Show Kanban” | `pm:board` | Observational browser board with one explicit loop control |
| “Configure unattended workers” / “Reconcile stale loop cards” | `pm:loop` | Loop scheduling, leases, budgets, and recovery |
| “Sync the knowledge base” / “Pull or push PM memory” | `pm:sync` | Git-backed PM knowledge synchronization |

Quick factual questions stay direct instead of creating Research artifacts. A plain “push my current commit” stays a direct Git request. `pm:simplify` is a compatibility alias that redirects to `pm:review`, not a primary lane.

## Orchestrated references

These are loaded by their owning lifecycle rather than routed as primary skills:

| Reference or skill | Owner | Purpose |
|---|---|---|
| `dev/references/tdd.md` | Dev | Test-first implementation discipline |
| `dev/references/debugging.md` | Dev | Root-cause investigation after a failure |
| `dev/references/subagent-dev.md` | Dev | Dependency- and ownership-safe work-unit dispatch |
| `pm:review` | Dev, Ship | Required source-review gate with logical lens coverage independent of worker count |
| `pm:design-critique` | Dev | Required rendered-evidence gate for UI-impacting changes |
| `dev/references/qa.md` | Dev | Functional acceptance gate for UI-impacting changes |
| `ship/references/handling-feedback.md` | Dev, Ship | Verify review feedback before changing code |

## Instruction contract

Follow the host runtime’s instruction hierarchy. Within that hierarchy, explicit user intent may select, decline, or narrow a PM workflow. Routing never grants permission to bypass platform safety, repository instructions, a skill’s hard gates, or effect-specific confirmation.

## Red Flags — Self-Check

- **"PM is installed, so I should start it."** Stop and classify the actual request first.
- **"I know the workflow well enough to do it inline."** Use the owning skill so its contract applies.
- **"Setup can bootstrap the product workspace."** Use Start for bootstrap; Setup owns integrations and repository configuration.
- **"Should we means Research."** Use Think for a decision; use Research for factual investigation that informs it.
- **"Push means Ship."** Stop and require clear full-delivery intent before entering Ship.
- **"Six lenses means six agents."** Keep logical coverage while adapting worker shape to the runtime.

## Escalation Paths

- **General orientation:** “Want to open PM with `/pm:start`, or should I route you directly to the lane matching your task?”
- **Path configuration failure:** “PM path resolution failed: {error}. Fix the configured path with `/pm:setup separate-repo`; I will not fall back to a new local workspace.”
- **Concrete lane is clear:** “This is `{skill}` work. I’ll switch to that lane directly.”

## Common Rationalizations

| Excuse | Reality |
|---|---|
| “A little ceremony cannot hurt.” | Unrequested workflow state distracts from the user’s intent. |
| “Mentioning a skill is equivalent to invoking it.” | Gates and evidence attach to the actual invocation. |
| “The router can simplify downstream confirmation.” | Routing selects a contract; it cannot weaken it. |

## Before Marking Done

- [ ] No routing artifact was fabricated; the selected workflow owns its durable output.
- [ ] Direct questions and direct Git requests remained direct.
- [ ] Path failures stopped without fallback writes.
- [ ] Active-lane, subagent-stop, host-hierarchy, and downstream-authority gates were preserved.
