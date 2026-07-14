# Product Reasoning Artifacts

This reference is the shared machine contract for `pm:think`, `pm:ideate`, `pm:strategy`, and `pm:features`. Markdown remains the canonical human reader. JSON companions expose identity, decisions, ranking inputs, transitions, and feature provenance without asking downstream skills to parse prose.

## Paths

| Human artifact | Machine companion |
|---|---|
| `{pm_dir}/thinking/{slug}.md` | `{pm_dir}/thinking/{slug}.decision.json` |
| `{pm_dir}/backlog/{slug}.md` from Ideate | `{pm_dir}/backlog/{slug}.decision.json` |
| `{pm_dir}/strategy.md` | `{pm_dir}/strategy.decision.json` |
| `{pm_dir}/product/features.md` | `{pm_dir}/product/features.json` |

Decision evidence, source-artifact, proposal-lineage, promotion, trigger-target, and Markdown-binding paths are relative to `{pm_dir}` and therefore never include a leading `pm/`. Validation accepts an existing project-relative proposal-lineage prefix for compatibility, but new proposal lineage uses the canonical `{pm_dir}`-relative form. Feature `source_refs` are the exception: they identify code and are relative to `{source_dir}` at an exact Git commit or deterministic filesystem snapshot. This two-root contract works unchanged in same-repo, nested separate-repo, and flat separate-repo layouts. Never publish absolute paths, home-relative paths, raw prompts, private customer text, credentials, or local cache locations.

## Decision brief v1

Generate the stable ID with:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" decision-id --kind {think|idea|strategy} --slug {slug}
```

The companion uses this shape:

```json
{
  "schema_version": 1,
  "document_type": "decision-brief",
  "decision_id": "dec-...",
  "kind": "think",
  "slug": "semantic-slug",
  "title": "Reader title",
  "problem": "The confirmed problem or opportunity",
  "evidence_refs": [
    { "ref": "evidence/research/topic.md#finding-1", "evidence_id": "ev-...", "note": "What it supports" }
  ],
  "alternatives": [
    { "id": "focused", "title": "Focused path", "tradeoff": "What this gains and gives up" },
    { "id": "broad", "title": "Broad path", "tradeoff": "What this gains and gives up" }
  ],
  "decision": { "status": "confirmed", "choice": "focused", "rationale": "Why this path won" },
  "confidence": { "level": "medium", "basis": ["Specific support", "Specific uncertainty"] },
  "non_goals": ["Explicit exclusion"],
  "next_trigger": { "lane": "groom", "condition": "Observable condition for advancing", "target": null },
  "promotion": { "status": "not-offered", "target_kind": null, "target_ref": null, "confirmed_at": null, "approval_decision": null, "origin_decision_sha256": null },
  "source_artifacts": [
    { "path": "thinking/semantic-slug.md", "sha256": "sha256:..." }
  ],
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

`idea` adds `alignment`: `strength`, strategy `priority_ids`, `non_goal_conflicts`, `evidence_strength`, `competitor_gap`, `dependencies`, and `scope_signal`. `strategy` adds `strategy_context` with stable priority and non-goal tokens (`id`, `title`). Use semantic kebab-case tokens and preserve them across wording-only edits.

Rules:

- A confirmed decision has at least two materially distinct alternatives and chooses one by ID.
- No evidence means `confidence.level: low`. Hypothesis is an evidence-strength label, not a source.
- Confidence basis names both support and meaningful uncertainty; it is not a restatement of the enum.
- Promotion becomes `promoted` only after `backlog/proposals/{slug}.json`, its sibling approval audit, and the proposal's exact source-lineage row for the origin decision companion all validate against current bytes and the expected Groom decision. Persist `approval_decision` and the pre-promotion `origin_decision_sha256` in the promotion record so standalone and normal validation can replay those checks. The RFC3339 confirmation time must not precede either the origin's current `updated_at` or the approval timestamp.
- `not-offered` and `offered` record intent only: all target and confirmation fields remain `null` until promotion succeeds.
- Hash the final Markdown bytes before writing the JSON companion. Authentication is reciprocal: the companion hashes the reader, while the authenticated Markdown must declare `reasoning_version: 2` and the exact canonical `decision_brief` path. Promotion additionally authenticates the final lifecycle projection: Think must remain `status: promoted` with `promoted_to` equal to its canonical Groom slug; an approved Ideate projection starts at `status: proposed` and may advance only through `planned`, `in-progress`, and `done`. These invariants are replayed by normal validation and reader refresh, not only at the initial transition. A companion beside markerless legacy Markdown is invalid; a genuinely Markdown-only legacy workspace remains supported. Any later Markdown edit requires refreshing the binding. For promoted Ideate backlog lifecycle or PR-metadata edits, run `product-reasoning.js refresh-reader --root "{pm_dir}" --decision "backlog/{slug}.decision.json"`; it revalidates the reciprocal marker, durable promotion lineage, and downstream lifecycle before atomically refreshing the reader binding.
- Validate companions with `node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" validate --root "${pm_dir}" --input <path>`.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning-quality-check.js" <path>` after validation. A score below 7/10 is a quality failure. The gate checks lexical diversity, repeated n-grams, near-duplicate evidence and tradeoff prose, choice-specific rationale, and concrete non-duplicative outcomes/highlights in addition to length and counts; superficially varied padding cannot earn a substantive point.

After Groom has written and approved its canonical proposal, perform the origin transition atomically with a private request:

```json
{
  "decision_path": "backlog/example.decision.json",
  "target_ref": "backlog/proposals/example.json",
  "confirmed_at": "RFC3339",
  "approval_decision": {
    "id": "decision:...",
    "sha256": "sha256:..."
  },
  "binding_paths": [
    "backlog/proposals/example.json",
    "backlog/proposals/example.approval.json",
    "backlog/example.md"
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" promote --root "${pm_dir}" --request <private-request.json>
```

The canonical target, sibling `.approval.json` audit, and canonical origin Markdown derived from the decision kind/slug must be among at most 16 unique canonical binding paths with no more than 64 MiB in aggregate. Dot segments, duplicate separators, traversal, absolute paths, and path aliases are rejected before binding checks. `binding_paths` must not contain `decision_path`, because that companion is the mutable atomic output; the final attestation is its sole pre-promotion byte comparison. The command requires the exact current `approved` proposal bytes and a proposal lineage row binding the pre-promotion origin decision bytes, validates the audit against `approval_decision`, authenticates the reciprocal marker and final projected lifecycle from the captured Markdown bytes, and hashes only bytes returned by those validated reads. Its writer makes the temporary replacement durable, reattests immutable bindings, and compares the origin companion last immediately before rename. Update the bound Markdown projection before this single final command. This refresh is required for Ideate origins because Groom replaces the old idea Markdown with the generated proposal projection.

## Deterministic idea ranking

Write a private request containing only the candidate `ideas`. When Strategy exists, authenticate its canonical companion while ranking:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" rank-ideas --root "${pm_dir}" --strategy "${pm_dir}/strategy.decision.json" --request <private-request.json>
```

The runtime verifies Strategy's schema and current Markdown binding before it orders categorical inputs by strategic alignment, evidence strength, competitor gap, dependency efficiency, scope efficiency, then stable ID. Omit both `--root` and `--strategy` only when no Strategy companion exists. `strong` evidence requires at least three distinct cited signals; `moderate` requires one or two; `hypothesis` remains explicitly provisional. It also returns unknown priorities, confirmed non-goal conflicts, and stale/unknown non-goal tokens. Unknown tokens require correction. A confirmed non-goal conflict is shown to the user and blocks saving until they explicitly revise Strategy or drop/reshape the idea. Rerun this authenticated check over the final edited candidates immediately before saving.

## Feature inventory v2

`features.json` contains `schema_version: 2`, `document_type: feature-inventory`, generation time, source project, scan mode and identity, 3–6 areas, 8–20 features, and a hash binding to `features.md`. Git mode records `mode: git`, a full commit object ID, and `snapshot_sha256: null`. Non-Git mode records `mode: filesystem`, `commit: null`, and a deterministic source snapshot hash.

Decision collections are deliberately bounded for predictable validation: at most 128 evidence references, 16 alternatives, 32 confidence-basis entries, and 32 non-goals. Feature reconciliation only compares inventories with the same `source_project`; cross-project input is rejected rather than carrying another product's stable identities forward.

The Markdown projection carries the same generation date, source project, scan counts, ordered area names, feature keys, feature names, stable `feat-*` IDs, outcome prose, and ordered highlights. Area names, feature names, outcomes, and highlights are canonical single-line projection text with no surrounding whitespace or line breaks, so every schema-valid value is exactly representable. Normal validation checks those semantic fields from the same bounded byte snapshot as the hash, so a freshly rehashed but contradictory reader pair is invalid. One 64 MiB aggregate budget covers every unique product-reasoning JSON, Markdown reader, and bound artifact read during a normal validation run.

Each feature contains:

- `feature_id`: stable `feat-...` identity;
- `key`: preserved semantic kebab-case key;
- `name` and user-outcome description;
- 2–4 concrete highlights;
- `confidence`: `low`, `medium`, or `high`;
- one or more `{source_dir}`-relative source refs.

Generate IDs for new capabilities with `feature-id`. Before review, reconcile a proposed inventory against the prior companion:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" reconcile-features --request <private-request.json>
```

Exact keys preserve identity unless their expanded sources also plausibly contain another prior feature. Continuity considers Jaccard overlap plus old-in-new and new-in-old containment, so balanced merges and splits remain visible even when union overlap falls below 60%. Equal plausible matches, multiple contributor matches, and many-to-one collisions are returned as order-independent `ambiguous` records and require user resolution. Rerun with a closed `resolutions` object mapping each ambiguous feature key to one of its reported candidate IDs or the literal `"new"`; candidate identities may be claimed only once. This makes rename, merge, split, and genuinely-new choices explicit and deterministic. Do not silently merge, split, or retire an ambiguous feature.

For a non-Git project, calculate the deterministic snapshot after source refs are final and store the returned `snapshot_sha256`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" feature-snapshot --source-root "${source_dir}" --request <source-refs.json>
```

Render `features.md` from the reconciled in-memory record, hash it, bind it as `product/features.md` in `features.json`, then validate the companion and its source snapshot:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" validate --root "${pm_dir}" --input "${pm_dir}/product/features.json" --source-root "${source_dir}"
```

Validation proves every Git source ref exists at an exact commit object, or that every non-Git source ref still matches the bounded deterministic filesystem snapshot. Markdown feature headings should visibly include the stable ID, e.g. `### Turn ideas into specs <!-- feat-... -->`, so diffs and manual review retain identity without cluttering the rendered page.
