# Product Reasoning Artifacts

This reference is the shared machine contract for `pm:think`, `pm:ideate`, `pm:strategy`, and `pm:features`. Markdown remains the canonical human reader. JSON companions expose identity, decisions, ranking inputs, transitions, and feature provenance without asking downstream skills to parse prose.

## Paths

| Human artifact | Machine companion |
|---|---|
| `pm/thinking/{slug}.md` | `pm/thinking/{slug}.decision.json` |
| `pm/backlog/{slug}.md` from Ideate | `pm/backlog/{slug}.decision.json` |
| `pm/strategy.md` | `pm/strategy.decision.json` |
| `pm/product/features.md` | `pm/product/features.json` |

All stored paths are project-relative. Never publish absolute paths, home-relative paths, raw prompts, private customer text, credentials, or local cache locations.

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
    { "ref": "pm/evidence/research/topic.md#finding-1", "evidence_id": "ev-...", "note": "What it supports" }
  ],
  "alternatives": [
    { "id": "focused", "title": "Focused path", "tradeoff": "What this gains and gives up" },
    { "id": "broad", "title": "Broad path", "tradeoff": "What this gains and gives up" }
  ],
  "decision": { "status": "confirmed", "choice": "focused", "rationale": "Why this path won" },
  "confidence": { "level": "medium", "basis": ["Specific support", "Specific uncertainty"] },
  "non_goals": ["Explicit exclusion"],
  "next_trigger": { "lane": "groom", "condition": "Observable condition for advancing", "target": null },
  "promotion": { "status": "not-offered", "target_kind": null, "target_ref": null, "confirmed_at": null },
  "source_artifacts": [
    { "path": "pm/thinking/semantic-slug.md", "sha256": "sha256:..." }
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
- Promotion becomes `promoted` only after the target groom artifact exists. Then bind its project-relative path and RFC3339 confirmation time.
- `not-offered` and `offered` record intent only: all target and confirmation fields remain `null` until promotion succeeds.
- Hash the final Markdown bytes before writing the JSON companion. Any later Markdown edit requires refreshing the binding and `updated_at`.
- Validate companions with `node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" validate --input <path>`.
- Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning-quality-check.js" <path>` after validation. A score below 7/10 is a quality failure: improve the weakest dimensions with substantive evidence, alternatives, reasoning, or traceability rather than filler.

After Groom has written and approved its canonical proposal, perform the origin transition atomically with a private request:

```json
{
  "decision_path": "pm/backlog/example.decision.json",
  "target_ref": "pm/backlog/proposals/example.json",
  "confirmed_at": "RFC3339",
  "binding_paths": [
    "pm/backlog/proposals/example.json",
    "pm/backlog/example.md"
  ]
}
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" promote --project "${source_dir}" --request <private-request.json>
```

The target must be one of the binding paths. The command verifies every path without following symlinks, hashes the exact bytes, validates the complete transition, and atomically replaces the origin companion. This refresh is required for Ideate origins because Groom replaces the old idea Markdown with the generated proposal projection.

## Deterministic idea ranking

Write a private request containing `strategy` plus the candidate `ideas`, then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" rank-ideas --request <private-request.json>
```

The runtime orders categorical inputs by strategic alignment, evidence strength, competitor gap, dependency efficiency, scope efficiency, then stable ID. It also returns unknown priorities, confirmed non-goal conflicts, and stale/unknown non-goal tokens. Unknown tokens require correction. A confirmed non-goal conflict is shown to the user and blocks saving until they explicitly revise Strategy or drop/reshape the idea.

## Feature inventory v2

`features.json` contains `schema_version: 2`, `document_type: feature-inventory`, generation time, source project, scan counts/commit, 3–6 areas, 8–20 features, and a hash binding to `features.md`.

Each feature contains:

- `feature_id`: stable `feat-...` identity;
- `key`: preserved semantic kebab-case key;
- `name` and user-outcome description;
- 2–4 concrete highlights;
- `confidence`: `low`, `medium`, or `high`;
- one or more project-relative source refs.

Generate IDs for new capabilities with `feature-id`. Before review, reconcile a proposed inventory against the prior companion:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/product-reasoning.js" reconcile-features --request <private-request.json>
```

Exact keys preserve identity. A rename can preserve identity when source continuity is uniquely strong. Equal plausible matches are returned as `ambiguous` and require user resolution. Do not silently merge, split, or retire an ambiguous feature.

Render `features.md` from the reconciled in-memory record, hash it, bind it in `features.json`, then validate the companion. Markdown feature headings should visibly include the stable ID, e.g. `### Turn ideas into specs <!-- feat-... -->`, so diffs and manual review retain identity without cluttering the rendered page.
