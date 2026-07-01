---
name: Scope
order: 1
description: Determine whether design critique is required and identify the changed UI surface
---

## Goal

Decide whether the PM-native design critique gate must run, and capture the exact UI surface to review.

## How

1. Detect the default branch from the dev session state or git remote metadata.
2. Run `git diff {DEFAULT_BRANCH}...HEAD --name-only`.
3. Treat the gate as required when the diff includes `tsx`, `jsx`, `css`, `scss`, mobile view files, static HTML such as `public/index.html`, server-rendered templates such as `templates/base.html`, design-system files, UI config files such as `tailwind.config.*`, design-token/theme data such as `tokens/*.json`, page/layout files, or user-visible interaction changes.
4. Treat the gate as skipped only for backend-only, docs-only, non-UI config-only, generated-only, lockfile-only, or changes with an explicit no-visual-impact reason.
5. Identify affected routes, screens, components, and states from the diff, RFC, issue, or dev session state.
6. Derive `{slug}` from `.pm/dev-sessions/{slug}.md` if present, otherwise from the current branch name using the normalization rules in `${CLAUDE_PLUGIN_ROOT}/skills/dev/references/state-schema.md`.

If skipped, write both records:

```markdown
## Design Critique
- Status: skipped
- Reason: {specific no-visual-impact reason}
- Commit: {git rev-parse HEAD}
```

```json
{
  "schema_version": 1,
  "gates": [
    {
      "name": "design-critique",
      "status": "skipped",
      "commit": "<current-sha>",
      "artifact": "",
      "reason": "<specific no-visual-impact reason>",
      "checked_at": "<ISO timestamp>"
    }
  ]
}
```

Write or update the `design-critique` row inside `.pm/dev-sessions/{slug}.gates.json` using the schema from `skills/dev/references/state-schema.md`; do not delete any existing gate rows.

## Done-when

The gate is either explicitly skipped with a reason tied to the current commit, or the affected UI surfaces and states are listed for capture.

If skipped, return the skip outcome to the caller. Otherwise, **Advance:** proceed to Step 2 (Capture).
