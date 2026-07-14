---
title: "Shared runtime primitives — Wave 4B"
created: 2026-07-14
updated: 2026-07-14
status: implementing
depends_on:
  - Wave 4A released as v1.13.17
---

# Shared runtime primitives — Wave 4B

## Outcome

Give Dev, RFC, Review, and Design Critique one small provider-neutral mechanics layer for safe project files, result envelopes, transition history, prompt packets, runtime profiles, authority, and effect receipts. Each skill keeps its own routing, approval, findings, artifact, and gate policy.

## Evidence for the change

The current tree has mature but parallel implementations:

- Dev and RFC each validate result identity, runtime records, attempts, blockers, history, authority logs, stable result hashes, slug normalization, and atomic state persistence.
- Dev and RFC prompt builders independently validate required fields, render bounded Markdown sections, and publish private prompt files; RFC still uses a direct non-atomic write.
- Dev runtime profiles and RFC runtime profiles resolve the same provider/model/effort choice through different code and differently shaped data.
- Review and Design Critique consume the same safe project-file boundary through uneven entry points.
- delivery gates and Dev archival evaluate current evidence through separate representations. Wave 4A passed the delivery gate, but retro initially rejected the same release HEAD because its recertification records lacked the phase-local evidence kind required by archival.

These are mechanics similarities, not permission to centralize domain policy.

## Non-goals

- No generic workflow engine or shared routing table.
- No common approval policy, finding schema, artifact schema, or gate verdict.
- No rewrite of RFC lifecycle semantics, Review synthesis, or Design Critique scoring.
- No provider-specific prompt prose in the shared layer.
- No compatibility break in existing CLI, JSON, prompt, migration, resume, or artifact bytes.
- No release-transaction redesign; the explicit prepare-release action remains Wave 6. Wave 4B may make current evidence evaluation consistent and expose the boundary cleanly.

## Primitive boundaries

### 1. Project files

Expose one module for descriptor-bound, byte-bounded project input and anchored atomic project output. Keep the hardened existing implementations, but stop making callers know which historical module owns each half.

### 2. Workflow records

Share only closed-shape validation and construction for:

- phase-result base fields;
- evidence records;
- runtime records;
- attempts and blockers;
- transition-history entries and stable result hashes;
- recertification field pairs.

Dev and RFC adapters add their own allowed statuses, evidence kinds, commit/artifact rules, and completion decisions.

### 3. Authority and effects

Share deterministic grant validation, immutable authority-log append, and exact action allowlists. Add a provider-neutral external-effect receipt shape for target identity, grant, attempt, observed receipt, and verification. Skills decide which effects exist and when they are legal.

### 4. Steps and prompt packets

Retain `step-loader.js` as the phase-local resolution authority. Extract a bounded section renderer and atomic private-file publisher used by Dev and RFC without changing their public prompt headings or bytes.

### 5. Runtime profiles and structured results

Share profile selection and override merging over injected profile data. Dev retains CLI capability probes and provider adapters. RFC consumes the same resolver for its simpler runtime record. Both preserve their current public return shapes.

## Implementation slices

### Slice 1 — Contract characterization

- Add byte fixtures for current Dev and RFC prompt outputs.
- Add cross-lifecycle fixtures for result, runtime, history, authority, and recertification shapes.
- Add a regression reproducing delivery/archive evidence disagreement at one HEAD.

### Slice 2 — Shared workflow records

- Add dependency-free modules beneath `scripts/lib/workflow-runtime/`.
- Move stable stringify/hash, common validators, history construction, authority grants, and recertification-pair checks behind explicit APIs.
- Migrate Dev and RFC through thin adapters while keeping their schemas and error paths stable.

### Slice 3 — Shared prompt and profile mechanics

- Add a configurable section renderer with byte ceilings and heading demotion.
- Publish Dev and RFC prompts atomically with mode `0600`.
- Add a data-injected profile resolver and migrate both lifecycle callers.

### Slice 4 — Unified project-file facade

- Add one project-file entry point over descriptor input and anchored output.
- Migrate Review publication/check/target and Design Critique artifact reads where applicable.
- Preserve the hardened lower-level modules as compatibility exports until all callers and tests use the facade.

### Slice 5 — Evidence consistency and effect receipts

- Make delivery checks and lifecycle completion consume the same current-evidence predicate.
- Reject recertification whose phase-local evidence cannot satisfy the required gate.
- Add the shared effect-receipt base and adapt the current delivery receipt without moving Ship policy.

### Slice 6 — Documentation and removal

- Remove duplicated implementations proven unused.
- Document ownership boundaries and migration rules in architecture and skill references.
- Keep legacy migrations/resume fixtures and public CLI examples green.

## Acceptance criteria

1. Dev and RFC share result/evidence/runtime/history/authority mechanics without sharing routing or approval policy.
2. Dev and RFC prompt bytes remain stable for existing fixtures, and both outputs are atomic private files.
3. Runtime profile selection is provider-neutral and preserves GPT-5.6 Sol High and Opus 4.8 xHigh defaults.
4. Review and Design Critique use one project-file facade for bounded reads and atomic writes.
5. Delivery and archival agree on whether required evidence is current at an exact HEAD.
6. Invalid recertification is rejected before ship rather than discovered during retro.
7. Existing schema, lifecycle, migration, resume, prompt, artifact, and gate suites remain green.
8. Shared modules contain no skill names, routing tables, approval decisions, finding rules, or artifact schemas.
9. Full plugin validation and both installed-cache smoke suites pass.

## Test strategy

- Characterization tests first for exact prompt bytes and error paths.
- Unit tests for every shared primitive with Dev- and RFC-shaped adapters.
- Differential tests that run old public fixtures through migrated callers.
- Adversarial project-file tests for traversal, symlink swaps, byte ceilings, and interrupted writes.
- Lifecycle integration tests for result retry, resume, migration, recertification, delivery, and archival.
- Full suite plus source and installed-cache plugin validation.

## Delivery sequence

1. Commit each slice separately.
2. Prepare the patch version only after implementation and remediation commits are complete.
3. Freeze the release HEAD before final Review so certification targets the bytes that ship.
4. Run one bounded Review lineage, both workhorse cache smokes, hosted CI, merge, and main-tag placement.

## Done-when

- Stable mechanics have one tested implementation and skill-owned policy remains local.
- Existing public bytes and lifecycle fixtures remain compatible.
- The Wave 4A delivery/archive disagreement cannot recur.
- v1.13.18 is merged, tagged on main, and synced to both workhorse caches.

**Advance:** proceed to Wave 5 (Groom v2 and proposal quality).
