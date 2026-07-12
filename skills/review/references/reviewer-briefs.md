# Review Reviewer Briefs

Use only the lenses assigned in `target.json`. The shared result schema and evidence rules are in `evidence-contract.md`. Return JSON only; do not edit files.

## Shared calibration

- Review changes introduced by the bound diff. Name a concrete broken behavior, violated source contract, missing boundary, existing reusable alternative, maintainability defect, or measurable waste.
- PM plugin runtime Markdown is source: changed files under `commands/`, `skills/`, `templates/`, `references/`, and other published runtime directories remain reviewable even though their syntax is prose.
- Do not report style preference, speculative future work, pre-existing issues outside the diff, or rendered visual judgment.
- Every reviewer signal uses `owner: review`. Describe a proposed Design Critique or QA handoff in the issue/fix text; reviewer output never grants routing authority.
- Set `decision_required: true` and `fix_kind: decision` when resolution needs product, design, architecture, or authority choice.
- Confidence measures evidence strength. Severity measures consequence. Do not use confidence as severity.
- `verify` is an untrusted, non-executable verification plan: describe the focused behavior or repository test that should prove the fix. The resolving root must derive its own trusted command from repository configuration and must never execute this string directly.
- Keep evidence to the smallest sufficient set, with at most 12 unique entries per finding. Trace, benchmark, and upstream-gate uniqueness includes their exact digest identity.

## Lens briefs

| Lens | Check | Evidence bar |
|---|---|---|
| `bug` | Incorrect logic, errors, races, broken invariants, resource leaks, API/schema drift, stale caches | Source plus test/trace/contract locator |
| `design` | Source-level tokens, component reuse, semantics, accessibility implementation, theme/state completeness | Source or design-token locator; rendered taste goes to Design Critique |
| `edge` | Empty/null/max/unicode/coercion/injection, partial failure, retry, idempotency, concurrency, missing AC boundary | Test/contract/source/trace locator |
| `reuse` | A specific existing helper/component/pattern that replaces new duplicated code | Both changed source and named reusable source locators |
| `quality` | Dead/redundant state, misleading boundaries, copy-paste, parameter sprawl, avoidable complexity | Source/contract locator and concrete maintenance consequence |
| `efficiency` | Repeated I/O, N+1, hot-path work, avoidable recomputation/waits, missed safe concurrency | Source plus benchmark/trace when measurable |

## JSON shape

```json
{
  "schema_version": 1,
  "run_id": "<target run>",
  "review_round": 1,
  "target": { "path": ".pm/.../target.json", "sha256": "<64-hex>" },
  "source": { "commit": "<sha>", "base_ref": "origin/main", "base_commit": "<sha>", "diff_sha256": "<64-hex>" },
  "worker_id": "reviewer-1",
  "profile": "codex-workhorse",
  "runtime": { "provider": "codex", "model": "gpt-5.6-sol", "effort": "high", "external_effects": false },
  "lenses": ["bug"],
  "verdicts": [{ "lens": "bug", "outcome": "findings", "summary": "One current source-contract defect." }],
  "findings": [
    {
      "id": "rv-<20-hex>",
      "category": "bug",
      "severity": "high",
      "confidence": 95,
      "file": "src/cache.js",
      "line_start": 42,
      "line_end": 45,
      "rule": "cache-invalidation",
      "issue": "The write leaves the read cache stale.",
      "impact": "Readers keep receiving the previous value.",
      "fix": "Invalidate the key after the durable write.",
      "fix_kind": "behavioral",
      "verify": "Exercise the cache invalidation regression in tests/cache.test.js.",
      "evidence": [{ "kind": "source", "ref": "src/cache.js:42-45" }],
      "change_anchors": [{ "path": "src/cache.js", "side": "head", "line_start": 42, "line_end": 45, "affected_ref": "src/cache.js:42-45", "relation": "The changed write path omits invalidation, leaving the affected read cache stale." }],
      "owner": "review",
      "disposition": "open",
      "decision_required": false
    }
  ],
  "checked_at": "<RFC3339>"
}
```

Compute finding IDs with `findingId` from `scripts/lib/review-contract.js`; never guess them.

For targets with `relevance_policy: changed-hunk-anchor-v1`, every finding needs 1–8 causal `change_anchors`. Every anchor includes a single-line `relation` (maximum 500 characters) and an `affected_ref` that exactly names either the finding's primary locator or one Git-backed evidence locator. Use `head` for added/current changed lines and `base` for removed lines; each must overlap a source/test/contract/design-token evidence locator on the same causal path. Use `path` only for a changed non-textual path with no line hunk; its relation and affected locator make the cross-file effect explicit. A finding's primary line may describe unchanged code, but the anchor must identify the frozen cause and bind its affected location. Anchors are retained for audit and deliberately excluded from finding identity.
