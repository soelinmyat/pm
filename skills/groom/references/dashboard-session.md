# Dashboard Session Canvas Guide

Browser-based visual collaboration now runs through the dashboard session route rather than a separate legacy server.

## When to Use

Use the browser when the content is inherently visual:

- UI mockups and before/after comparisons
- Architecture or flow diagrams
- Layout alternatives or design direction reviews
- Any question where spatial hierarchy matters more than prose

Stay in the terminal for scope, tradeoffs, requirements, and other text-first decisions.

## How It Works

The dashboard watches `.pm/sessions/{canvas-id}/current.html` and serves it at `/session/{slug}`.

- Write the latest browser state to `current.html`
- The dashboard reloads automatically when that file changes
- Browser clicks are recorded to `.pm/sessions/{canvas-id}/.events`
- Canvas state lives with the project, not in a separate transient server mode

## Starting the Dashboard

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
```

Parse the returned JSON for `url`, then open the session route:

- Groom session: `{url}/session/{slug}` or `{url}/groom/{slug}`
- Dev session: `{url}/session/{slug}`

## Canvas Directory

Use deterministic session directories:

- Groom: `.pm/sessions/groom-{slug}/`
- Dev: `.pm/sessions/dev-{slug}/`
- Other workflows: `.pm/sessions/{type}-{slug}/`

Each directory can contain:

- `current.html` — latest browser view
- `.events` — browser interaction log
- `.state` — optional `active`, `idle`, or `completed`

## Writing HTML

Write a full HTML document to `current.html`. The dashboard injects the helper script for reload and click capture, but it does not wrap fragments in an extra legacy frame.

Use a self-contained page or one of the repo templates:

- `skills/groom/references/dashboard-session-template.md` for groom phase canvases
- `skills/dev/references/canvas-template.md` for dev progress canvases

If you need selectable options, add `data-choice` attributes to clickable elements. Browser clicks will be appended to `.events`.

## Loop

1. Ensure the dashboard is running.
2. Write `.pm/sessions/{canvas-id}/current.html`.
3. Open or refresh `{url}/session/{slug}`.
4. If the user makes selections in the browser, read `.pm/sessions/{canvas-id}/.events` on the next turn.
5. Update `current.html` as the conversation advances.

## Notes

- Prefer one stable `current.html` per active session over many timestamped files.
- Use `.state` to mark whether the canvas is active, idle, or completed.
- When a session is done, leave the canvas available for review or clean it up explicitly.
