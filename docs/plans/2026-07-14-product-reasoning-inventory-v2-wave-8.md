# Product Reasoning and Inventory v2 — Wave 8

Date: 2026-07-14
Branch: `codex/product-reasoning-v2`
Base: `origin/main` at `a21de8db6b14929e73dc0ca2b14ef8cb2f9ba565`

Status: implementation and local quality calibration complete; canonical review, cache certification, and release remain.

## Outcome

Make Think, Ideate, Strategy, and Features produce artifacts that remain pleasant to read and natural to create, while exposing enough provider-neutral structure for later workflows to consume decisions, rankings, promotions, and existing capabilities without reconstructing them from prose.

## Product principles

1. Markdown remains the primary reader experience.
2. JSON companions hold machine identity and transitions, not duplicate prose.
3. Conversation gathers judgment; runtime code validates shape, identity, ranking, and consistency.
4. Missing evidence lowers confidence or blocks promotion; it is never silently manufactured.
5. Stable identity survives reordering and ordinary renaming when source continuity is strong.
6. Promotion is a verified transition after the target artifact exists, not an enthusiastic status guess.

## Shared contracts

### Decision brief v1

One compact schema shared by Think, each saved Ideate candidate, and the canonical Strategy decision:

- stable `decision_id`, workflow `kind`, semantic `slug`, and title;
- problem statement and portable evidence references;
- two or more materially distinct alternatives when a decision is confirmed;
- explicit decision status, choice, and rationale;
- confidence level plus concrete confidence basis;
- non-goals;
- next trigger with lane, condition, and optional target;
- verified promotion state and target reference;
- timestamps and source artifact bindings.

The JSON companion is authoritative for these fields. Markdown may explain them but cannot contradict them.

### Idea ranking v1

Ranking is deterministic after the model supplies bounded categorical inputs:

1. strategic alignment;
2. evidence strength;
3. competitor gap;
4. fewer unmet dependencies;
5. smaller scope;
6. stable decision ID as the final tie-break.

The shared runtime emits the score components and final rank so two models cannot reorder identical inputs by prose preference.

### Feature inventory v2

`pm/product/features.md` stays the reader artifact. `pm/product/features.json` becomes its machine companion and contains:

- source project and frozen scan summary;
- 3–6 journey-oriented areas;
- 8–20 user-facing features;
- stable feature IDs and semantic keys;
- outcome, highlights, confidence, and `{source_dir}`-relative source references;
- generation timestamp and Markdown binding.

Reconciliation preserves an existing ID on exact key matches or strong source continuity. Ambiguous matches fail closed for user review instead of silently merging capabilities.

## Workflow changes

### Think

- Preserve the six conversational beats and one-page Markdown limit.
- Synthesis writes `{slug}.md` plus `{slug}.decision.json` after confirmation.
- Grounding paths become evidence references; missing evidence is explicit in confidence basis.
- Groom promotion is recorded only after the groom artifact exists and validates.

### Ideate

- Mine Evidence v2 IDs and portable artifact paths where available.
- Write one decision brief beside each user-approved backlog idea.
- Run deterministic ranking and strategy consistency checks before presentation and again before write.
- Treat `hypothesis` as weak confidence, never as permission for a missing source.

### Strategy

- Preserve the one-question-at-a-time interview.
- Write `strategy.md` plus `strategy.decision.json` with confirmed alternatives, evidence/assumptions, confidence, non-goals, and the next review trigger.
- Surgical updates preserve the decision ID and record what changed.
- Expose priority and non-goal tokens that Ideate and Groom can compare without section parsing.

### Features

- Preserve the user-facing scan and approval flow.
- Emit the v2 JSON inventory and render Markdown from the same in-memory record.
- Reconcile against the prior inventory before user review, surfacing new, retained, and ambiguous identities.
- Require `{source_dir}`-relative source refs, verify them at an exact Git commit or deterministic non-Git filesystem snapshot, and retain calibrated confidence without claiming behavior that source inspection did not establish.

## Validation and quality

- Closed schemas reject unknown fields, absolute/private paths, malformed IDs, dangling bindings, and contradictory promotion states.
- Normal project validation checks decision companions and the feature inventory when present, while leaving legacy Markdown valid.
- Strong and weak-but-schema-valid fixtures calibrate decision usefulness and inventory traceability.
- Regression tests cover identity stability, deterministic ranking, strategy conflicts, verified promotion, reconciliation ambiguity, Markdown binding, and legacy compatibility.

## Artifact policy

No new HTML is required for this wave. These are frequently edited reasoning artifacts whose primary use is reading, diffing, and downstream machine consumption. HTML remains appropriate for substantial comparative reports, RFCs, proposals, Review, and Design Critique. Quality here is measured through information architecture, traceability, consistency, and decision usefulness rather than decorative rendering.

## Delivery sequence

1. Implement shared schema, ranking, promotion, reconciliation, and CLI boundaries.
2. Add validators and regression fixtures before changing skill promises.
3. Update Think, Ideate, Strategy, Features, commands, schemas, and public docs together.
4. Run quality calibration and remediate until strong fixtures materially beat weak valid fixtures.
5. Sync and smoke-test Claude and Codex caches.
6. Prepare the release last, freeze the exact target, run canonical Review and verification, then push, PR, merge, and tag on `main`.

## Exit criteria

- Conversational workflows remain conversational.
- Every saved decision exposes the common brief fields without prose reconstruction.
- Identical idea inputs rank identically across runtimes.
- Strategy conflicts are explicit before an idea is saved or promoted.
- Feature IDs survive reordering and supported rename/refactor cases.
- Weak-but-valid reasoning fixtures score materially below strong fixtures.
- Full tests, plugin validation, canonical Review, CI, cache smoke, merge, and main-tag verification pass.
