---
title: "Skill authoring contract — Wave 4A"
created: 2026-07-13
updated: 2026-07-14
status: implemented
depends_on:
  - Wave 3B released on main
---

# Skill authoring contract — Wave 4A

## Outcome

Make PM's documented skill and step authoring rules executable, then use the resulting audit to improve every plugin skill in bounded clusters. The validator must reject structurally thin instructions without encouraging large, repetitive SKILL files.

## Evidence for the change

The v1.13.14 plugin validator runs 13 rules covering frontmatter, step filenames/order, command resolution, persona refs, tool names, JSON, and version parity. It does not validate the stronger contracts already required by `AGENTS.md`.

A local inventory of the v1.13.14 tree found:

- 21 of 24 skill entry points miss at least one required contract element or directive;
- most pre-v2 procedural step families lack explicit Goal, How, Done-when, or Advance structure;
- complex core workflows and tiny aliases currently receive the same absence-of-validation;
- presence-only tests can be satisfied with boilerplate and therefore do not prove useful instructions.

Wave 3B already modernizes Review into a phase-local five-step skill. Wave 4A starts after that branch lands so the audit baseline includes it.

## Non-goals

- Do not rewrite domain behavior while adding authoring contracts.
- Do not migrate Groom, Ship, Research, or operational state machines in this wave.
- Do not require HTML, agents, a state runner, or a full quality-eval matrix for every skill.
- Do not enforce arbitrary word counts as a proxy for quality.
- Do not add a generic exception file that can silence any rule without review.

## Contract model

### Skill entry point

Every `skills/*/SKILL.md` must provide:

1. trigger-rich `name` and `description` frontmatter;
2. Purpose;
3. one bright-line Iron Law;
4. When NOT to use, including the correct alternative lane;
5. Workflow/telemetry declaration;
6. runtime and writing directives, except the documented output-free Setup writing exemption;
7. step-loading directive for step-based skills;
8. four to six metacognitive Red Flags;
9. named Escalation Paths;
10. a Common Rationalizations table;
11. a Before Marking Done checklist.

The rule checks useful shape, not exact prose:

- Iron Law contains one bold, imperative, all-caps rule rather than a list.
- Red Flags are thought-pattern bullets with a quoted thought and corrective action.
- Escalation Paths name a destination skill or a concrete stop/ask action.
- Rationalizations have at least two excuse/reality rows.
- Done criteria include saved output when the skill writes one, user confirmation when the workflow requires a decision, and passed gates when gates exist.

### Step contract

Every step file must expose:

- Goal: the decision or artifact produced;
- How: procedure and decision criteria, or an explicit reference delegation plus entry context;
- Done-when: observable exit criteria;
- Advance: an explicit next step for non-final steps, and a summary/next-action contract for final steps.

The validator rejects empty headings, template-only How sections, and circular advancement. It does not require long prose. A five-line capture step may pass when its action and exit condition are unambiguous.

### Skill classes

The audit classifies skills before applying conditional checks:

| Class | Examples | Additional checks |
|---|---|---|
| Lifecycle | Dev, RFC, Groom, Ship | phase metadata, evidence, transitions, resume and authority boundaries |
| Evidence pipeline | Ingest, Research, Refresh | source/provenance, writeback, privacy, staleness |
| Reviewer/gate | Review, Design Critique | target identity, bounded remediation, report and gate publication |
| Operational effect | Setup, Sync, Loop, Start, Board | effect authority, idempotency, recovery |
| Read-only projection | List | no mutation path, shared source classification, useful empty/error state |
| Conversational | Think, Ideate, Strategy | forcing question/decision criteria, confirmation, promotion path |
| Capture | Task, Bug, Note | atomic write, minimal required fields, correct routing |
| Redirect | Simplify | exact destination, deprecation semantics, no duplicated workflow |

Classification is committed data or a deterministic map owned by the validator. It is not inferred from prose on every run.

## Validator architecture

Add plugin rules with stable IDs and focused issue paths:

| Rule | Responsibility |
|---|---|
| `D2-SKILL-001-contract-sections` | required entry-point sections and meaningful non-empty bodies |
| `D2-SKILL-002-reference-directives` | runtime/writing/step-loading references and narrow Setup exemption |
| `D2-SKILL-003-iron-law` | one actionable bright-line rule |
| `D2-SKILL-004-self-checks` | Red Flag, escalation, rationalization, and done shapes |
| `D2-SKILL-005-class-contract` | class-specific authority, artifact, or projection requirements |
| `D2-STEP-001-execution-contract` | Goal/How/Done-when substance |
| `D2-STEP-002-transition` | ordered Advance/final transition correctness |
| `D2-CMD-001-surface-parity` | command/skill name, trigger, deprecation, and destination parity |

Keep rules dependency-free and deterministic. Use Markdown structure parsing sufficient for PM's controlled files; do not introduce a general Markdown parser dependency.

## Anti-boilerplate checks

Section presence alone is insufficient. Add negative fixtures proving rejection of:

- `## How` followed only by “Do the thing”;
- an Iron Law containing multiple unrelated rules or hedging language;
- Red Flags written as outcome descriptions rather than thoughts;
- a Done checklist that never mentions the produced artifact;
- a capture step with no overwrite/atomicity exit condition;
- a read-only skill containing a mutation command;
- a redirect that restates a stale copy of its destination workflow;
- an Advance target that does not exist or skips order without an explicit branch condition.

Do not implement fuzzy quality scoring inside the deterministic validator. Model-level instruction quality remains a separate fixture/evaluation layer.

## Machine and human audit output

`node scripts/validate.js --plugin` remains the authoritative CI command and emits structured rule issues. Add `node scripts/skill-audit.js` as a read-only presentation command that groups the same results by:

- skill;
- class;
- severity;
- missing contract;
- likely remediation cluster.

Support `--json` for planning automation and concise terminal output for contributors. The audit must not rewrite files.

## Remediation slices

Each slice is a separate commit with focused regression tests. Do not combine unrelated domain rewrites.

### Slice 1 — Validator and fixtures

- Add classification data and D2 rules.
- Add valid/invalid fixture skills outside the runtime skill tree.
- Add tests for anti-boilerplate and conditional-class behavior.
- Run the new audit against the plugin but do not enable D2 failures in CI until the first remediation slice is ready.

### Slice 2 — Redirect, capture, and read-only skills

Remediate `simplify`, `task`, `bug`, `note`, `start`, `list`, and `board`.

Preserve their low ceremony. Extract step files only where a real decision or failure boundary exists. Test that read-only surfaces remain mutation-free and capture aliases preserve their distinct defaults.

### Slice 3 — Operational skills

Remediate `setup`, `sync`, `loop`, and `using-pm`.

Make authority and effect boundaries explicit, but defer runtime/effect-journal migration to later waves. Test escalation and recovery language against current commands.

### Slice 4 — Evidence skills

Remediate `ingest`, `research`, and `refresh`.

Preserve domain frameworks and current outputs. Make privacy, provenance, staleness, and writeback gates visible in the entry contracts. Defer shared evidence-schema work to Wave 7.

### Slice 5 — Product reasoning skills

Remediate `think`, `ideate`, `strategy`, and `features`.

Keep conversation natural. Add explicit decision/confirmation/promotion criteria without forcing procedural step files when the single-file form is clearer.

### Slice 6 — Core legacy skills

Remediate `groom` and `ship` against the contract without implementing their v2 migrations. Reconcile already-modern `dev`, `rfc`, `design-critique`, and `review` only where the validator exposes a real gap.

### Slice 7 — Enforcement and public parity

- Enable D2 rules in `validate:plugin` and CI.
- Update README and platform install examples only where behavior or triggering changed.
- Generate the final audit and retain it as release evidence.

## Acceptance criteria

1. Every runtime skill is classified exactly once.
2. Every required contract section and directive has a deterministic validation rule.
3. Thin boilerplate fixtures fail even when all headings are present.
4. Concise valid capture, redirect, conversational, and read-only fixtures pass.
5. Every procedural step has a substantive Goal/How/Done/transition contract.
6. Command and skill deprecation/routing promises cannot diverge silently.
7. The audit is read-only, deterministic, and byte-stable for the same tree.
8. Existing user step overrides remain valid when they satisfy the same execution contract.
9. Core workflow behavior and quality scenario results do not regress.
10. Full plugin validation, formatting, lint, tests, and both installed-cache smoke suites pass.

## Test strategy

### Unit and fixture tests

- one test file per rule family;
- positive minimal fixtures for each skill class;
- negative anti-boilerplate fixtures;
- transition graph fixtures for straight-line, branched, delegated, and final steps;
- parity fixtures for commands, redirects, and deprecated skills;
- deterministic audit ordering and JSON shape.

### Integration tests

- run the audit over the actual plugin tree;
- run `validate:plugin` from source and both installed caches;
- run existing step-loader, command resolution, prompt-shape, quality-scenario, and plugin-contract suites;
- confirm no runtime path consumes fixture-only data.

### Quality checks

Use representative prompts for one conversational skill, one capture skill, one evidence skill, and one operational skill. Evaluate whether the revised entry contract improves correct routing, stops at the right boundary, and produces a useful artifact. Do not create a full seven-case matrix for each supporting skill.

## Delivery plan

1. Land and release Wave 3B.
2. Rebase this plan onto the new main.
3. Implement Slice 1 behind non-blocking audit output.
4. Remediate Slices 2–6, enabling each rule family only when the affected runtime tree is clean.
5. Complete Slice 7, prepare the patch version, then freeze final review evidence.
6. Sync and test both workhorse caches.
7. Ship through PR, hosted CI, merge, and main-tag placement.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Validator rewards boilerplate | Anti-boilerplate negative fixtures; keep model quality separate from structure |
| Large mechanical rewrite changes behavior | Clustered commits, domain-preserving edits, existing behavioral scenarios |
| Rules make tiny skills verbose | Class-specific minimal valid fixtures; no arbitrary word counts |
| Exemptions become escape hatches | Only coded narrow exemptions with dedicated tests; no free-form ignore file |
| Step overrides break | Validate override contract through the same loader and fixtures |
| Review churn returns | One final lineage, maximum three rounds, no new run-ID reset |

## Done-when

- D2 rules are enforced in plugin validation.
- The complete runtime skill tree passes without generic suppressions.
- The machine and human audits are clean and deterministic.
- Supporting-skill quality probes show correct routing and boundary behavior.
- The released tag is on the main merge commit.

**Advance:** proceed to Wave 4B (shared runtime primitives).

## Implementation evidence

Implemented in seven bounded slices on `codex/skill-authoring-contract`:

- all 24 runtime skills have exactly one deterministic class;
- all eight D2 rules are enforced by `validate:plugin`, bringing the authoritative pack to 21 rules;
- the canonical valid fixture demonstrates the complete authoring contract, while thin, drifting, mutating, and invalid-transition fixtures fail with stable D2 rule IDs;
- `skill-audit --json` reports `enforcement: enforced`, 24 clean skills, and zero issues;
- operational, evidence, conversational, capture, projection, redirect, reviewer, and lifecycle contracts were remediated without generic suppressions.
- Review round 1 exposed seven concrete enforcement and Sync boundaries; the remediation adds fence-aware parsing, monotonic transition checks, full telemetry/completion semantics, argv-safe Git execution, and same-repo PM destination protection with regressions.
- Review round 2 exposed three boundary variants: inherited Git object stores, CommonMark fence-length semantics, and raw-text D2 scans. The remediation clears the remaining repository-shaping Git environment, makes one operative-Markdown view authoritative across D2 rules, and covers nested fences plus fenced telemetry, directives, and transitions.

Release status remains pending until the patch release is merged and its version tag is moved to the main merge commit.
