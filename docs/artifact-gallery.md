# PM Artifact Gallery

PM's HTML is a checked reader, not an ornamental export. Each flagship artifact has a
canonical machine source, a generated or source-bound HTML reader, lifecycle state, and
validation evidence. Reference templates demonstrate the expected information hierarchy
and visual quality; consumer artifacts must replace fixture content and hashes.

`pm/` is the durable, commit-ready reader layer. `.pm/` is the private runtime and
evidence layer; it holds sessions, captures, manifests, and machine reports that should
not be committed by default.

Set the plugin root once when running the examples:

```bash
export PM_PLUGIN_ROOT=/absolute/path/to/installed/pm
```

Paths containing `<slug>` or `<session>` are placeholders for the consuming project.

## Proposal

The proposal is the product contract produced by `/pm:groom`.

| Layer | Contract |
|---|---|
| Canonical source | `pm/backlog/proposals/<slug>.json` |
| Human readers | Generated `pm/backlog/proposals/<slug>.html` and `.md` projections |
| Reference fixture | `references/templates/proposal-reference.html` |
| Private evidence | `.pm/groom-sessions/<slug>/` and approval audit bindings |
| Lifecycle | `draft -> reviewed -> approved -> planned -> in-progress -> done` |

Never patch the HTML or Markdown projection independently. Regenerate them from JSON,
then check schema, hashes, lifecycle, approval, and decision quality:

```bash
node "$PM_PLUGIN_ROOT/scripts/proposal-render.js" \
  --proposal "pm/backlog/proposals/<slug>.json"
node "$PM_PLUGIN_ROOT/scripts/proposal-check.js" \
  --proposal "pm/backlog/proposals/<slug>.json" \
  --slug "<slug>" --projections
node "$PM_PLUGIN_ROOT/scripts/proposal-quality-check.js" \
  --proposal "pm/backlog/proposals/<slug>.json"
node "$PM_PLUGIN_ROOT/scripts/artifact-check.js" \
  --html "pm/backlog/proposals/<slug>.html" --kind proposal \
  --manifest ".pm/artifacts/proposal-<slug>.manifest.json"
node "$PM_PLUGIN_ROOT/scripts/artifact-render-check.js" \
  --html "pm/backlog/proposals/<slug>.html" \
  --out-dir ".pm/artifacts/proposal-<slug>-renders" \
  --manifest ".pm/artifacts/proposal-<slug>-renders/manifest.json"
```

The quality checker complements structural validity: a syntactically valid proposal can
still be too vague to support a product or engineering decision.

## RFC

The RFC is the executable technical contract produced by `/pm:rfc` from an approved
proposal.

| Layer | Contract |
|---|---|
| Machine source | `pm/backlog/rfcs/<slug>.json` schema-v3 sidecar |
| Human reader | `pm/backlog/rfcs/<slug>.html` with the exact sidecar hash |
| Reference fixture | `references/templates/rfc-reference.html` |
| Private evidence | `.pm/rfc-sessions/<slug>/`, approval record, render manifest |
| Lifecycle | `draft -> reviewed -> approved`; Dev consumes only trusted approval |

The sidecar owns issue identity, dependencies, path ownership, acceptance criteria,
verification commands, hooks, and the five-part test strategy. Validate both directions:

```bash
node "$PM_PLUGIN_ROOT/scripts/rfc-sidecar-check.js" \
  --sidecar "pm/backlog/rfcs/<slug>.json" \
  --html "pm/backlog/rfcs/<slug>.html" --slug "<slug>"
node "$PM_PLUGIN_ROOT/scripts/artifact-check.js" \
  --html "pm/backlog/rfcs/<slug>.html" --kind rfc \
  --manifest ".pm/artifacts/rfc-<slug>.manifest.json"
node "$PM_PLUGIN_ROOT/scripts/artifact-render-check.js" \
  --html "pm/backlog/rfcs/<slug>.html" \
  --out-dir ".pm/artifacts/rfc-<slug>-renders" \
  --manifest ".pm/artifacts/rfc-<slug>-renders/manifest.json"
```

An attractive RFC with a missing, stale, or legacy non-executable sidecar is not ready
for autonomous implementation.

## Design Critique

The Design Critique report is commit-bound evidence for product UI or a PM HTML reader.

| Layer | Contract |
|---|---|
| Machine sources | `.pm/dev-sessions/<session>/design-critique/route.json`, `captures.json`, and `report.json` |
| Human reader | `.pm/dev-sessions/<session>/design-critique/report.html` |
| Reference fixture | `references/templates/design-critique-report.html` |
| Render evidence | Desktop, tablet, narrow, print, DOM, accessibility, and marker evidence under `renders/` |
| Lifecycle | `passed`, `failed`, or `blocked`; deferred findings cannot authorize delivery |

The checker binds the report to current commit/base identity and to retained captures.
The generic artifact tools separately verify the HTML contract and rendered behavior:

```bash
node "$PM_PLUGIN_ROOT/scripts/design-critique-check.js" \
  --root "$PWD" \
  --route ".pm/dev-sessions/<session>/design-critique/route.json" \
  --captures ".pm/dev-sessions/<session>/design-critique/captures.json" \
  --report ".pm/dev-sessions/<session>/design-critique/report.json" \
  --commit "$(git rev-parse HEAD)" --base origin/main \
  --base-commit "$(git rev-parse origin/main)"
node "$PM_PLUGIN_ROOT/scripts/artifact-check.js" \
  --html ".pm/dev-sessions/<session>/design-critique/report.html" --kind report
node "$PM_PLUGIN_ROOT/scripts/artifact-render-check.js" \
  --root "$PWD" --marker-prefix data-design-critique- \
  --html ".pm/dev-sessions/<session>/design-critique/report.html" \
  --out-dir ".pm/dev-sessions/<session>/design-critique/renders" \
  --manifest ".pm/dev-sessions/<session>/design-critique/renders/manifest.json"
```

A pass requires complete state coverage appropriate to the route—not merely one polished
screenshot of the primary state.

## Review

The Review report is the source-review decision produced by `/pm:review` and consumed by
Dev and Ship.

| Layer | Contract |
|---|---|
| Machine sources | Immutable target, lens results, decisions, and per-round reports under `.pm/dev-sessions/<session>/review/runs/` |
| Canonical machine projection | `.pm/dev-sessions/<session>/review/report.json` for the passing round |
| Human reader | `.pm/dev-sessions/<session>/review/report.html` |
| Reference fixture | `references/templates/review-report.html` |
| Render evidence | `.pm/dev-sessions/<session>/review/renders/manifest.json` plus retained viewport and print outputs |
| Lifecycle | `passed`, `failed`, or `blocked`, bound to target commit/base and completed lenses |

Validate the canonical report from its own bindings, then render and inspect it:

```bash
node "$PM_PLUGIN_ROOT/scripts/review-check.js" \
  --root "$PWD" \
  --report ".pm/dev-sessions/<session>/review/report.json" --from-report
node "$PM_PLUGIN_ROOT/scripts/artifact-check.js" \
  --html ".pm/dev-sessions/<session>/review/report.html" --kind report
node "$PM_PLUGIN_ROOT/scripts/artifact-render-check.js" \
  --root "$PWD" --marker-prefix data-review- \
  --html ".pm/dev-sessions/<session>/review/report.html" \
  --out-dir ".pm/dev-sessions/<session>/review/renders" \
  --manifest ".pm/dev-sessions/<session>/review/renders/manifest.json"
```

Dev's gate manifest must reference the canonical HTML and the exact render-manifest hash.
A prose verdict, an old report, or a report without retained render evidence cannot
authorize push or merge.

## What to inspect after the commands pass

Mechanical checks are necessary but not the whole quality bar. Inspect the desktop,
tablet, narrow, and print outputs for hierarchy, overflow, navigation, empty/error data,
long identifiers, dense findings, and accessibility. Confirm that the visible lifecycle
and verdict agree with the machine source, and that the most important decision appears
before methodology or ornamental detail.
