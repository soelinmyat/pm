---
name: Critique
order: 3
description: Review captured UI artifacts, fix blocking findings, and record the gate
---

## Goal

Review the captured UI, resolve blocking design issues, and leave a commit-scoped `design-critique` gate record.

## How

Read `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/design-critique.md`, then inspect the artifacts from Step 2 and the diff that produced them. Evaluate:

- Visual hierarchy and information density
- Alignment, spacing, typography, and responsive behavior
- Component reuse and design-system consistency
- Color, contrast, focus, keyboard, and screen-reader affordances
- Empty/loading/error states and long-content behavior
- Cross-route or cross-component consistency

Classify findings:

| Priority | Meaning | Required action |
|---|---|---|
| P0 | Unusable, inaccessible, data-loss, or severe layout break | Fix before passing |
| P1 | Likely user confusion, broken responsive state, major inconsistency | Fix before passing |
| P2 | Noticeable polish or edge issue | Fix if cheap, otherwise defer with reason |
| P3 | Taste or minor cleanup | Note only |

For every P0/P1:

1. Patch the UI.
2. Run relevant tests.
3. Recapture the affected state.
4. Re-review the new artifact.

Write a concise report to `.pm/dev-sessions/{slug}.design-critique.json` or `/tmp/design-review/{slug}/report.json`:

```json
{
  "status": "passed",
  "commit": "<current-sha>",
  "artifact": "/tmp/design-review/<slug>/manifest.json",
  "findings": {
    "p0": 0,
    "p1": 0,
    "p2": 0,
    "p3": 0
  },
  "fixed": [],
  "deferred": []
}
```

Then update `.pm/dev-sessions/{slug}.md`:

```markdown
## Design Critique
- Status: passed
- Commit: {git rev-parse HEAD}
- Artifact: {manifest-or-report-path}
- Findings: P0 0, P1 0, P2 {N}, P3 {N}
- Fixed: {summary}
- Deferred: {summary or none}
```

Finally update `.pm/dev-sessions/{slug}.gates.json` with:

```json
{
  "schema_version": 1,
  "gates": [
    {
      "name": "design-critique",
      "status": "passed",
      "commit": "<current-sha>",
      "artifact": "<manifest-or-report-path>",
      "reason": "",
      "checked_at": "<ISO timestamp>"
    }
  ]
}
```

Write or update only the `design-critique` row; preserve any existing `tdd`, `simplify`, `qa`, `review`, or `verification` rows.

Run before returning:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:?Set PM_PLUGIN_ROOT to the PM plugin root}}"
node "$PM_PLUGIN_ROOT/scripts/dev-gate-check.js" \
  --manifest .pm/dev-sessions/{slug}.gates.json \
  --commit "$(git rev-parse HEAD)" \
  --require design-critique
```

Return the critique outcome and any non-blocking deferred findings to the caller once the critique has no unresolved P0/P1 findings, the report is saved, the Markdown state and JSON gate sidecar are updated, and the gate checker passes for `design-critique`.
