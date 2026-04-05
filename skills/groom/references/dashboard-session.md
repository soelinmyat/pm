# Dashboard Session Canvas Guide

The dashboard session view is a **read-only artifact surface by default**.

Use it to show visual artifacts that are easier to scan in the browser than in the terminal. The terminal remains the source of truth for decisions, approvals, and workflow progression unless a project explicitly enables interactive dashboard input.

## Default Contract

By default:

- the browser displays generated artifacts
- the terminal remains the control surface
- no flow should depend on browser clicks or browser-originated input

Interactive dashboard input is opt-in. Do not assume it exists.

## When to Use

Use the browser when the content is inherently visual:

- UI mockups and before/after comparisons
- architecture or flow diagrams
- wireframes, proposals, and other review artifacts
- any case where spatial hierarchy matters more than prose

Stay in the terminal for:

- scope
- tradeoffs
- requirements
- approvals
- decisions

## How It Works

The dashboard watches `.pm/sessions/{canvas-id}/current.html` and serves it at a session route.

- write the latest browser state to `current.html`
- the dashboard reloads automatically when that file changes
- canvas state lives with the project, not in a separate transient server mode

## Starting the Dashboard

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/start-server.sh --project-dir "$PWD" --mode dashboard
```

Parse the returned JSON for `url`, then open the session route:

- Groom session: `{url}/session/{slug}` or `{url}/groom/{slug}`
- Dev session: `{url}/session/{slug}`

If the dashboard launch fails or returns no URL, continue in the terminal. The dashboard is an artifact viewer, not a gate.

## Canvas Directory

Use deterministic session directories:

- Groom: `.pm/sessions/groom-{slug}/`
- Dev: `.pm/sessions/dev-{slug}/`
- Other workflows: `.pm/sessions/{type}-{slug}/`

Each directory can contain:

- `current.html` — latest browser view
- `.state` — optional `active`, `idle`, or `completed`

Optional interactive mode files:

- `.events` — browser interaction log, only when interactive mode is explicitly enabled

## Writing HTML

Write a full HTML document to `current.html`.

Use a self-contained page or one of the repo templates:

- `skills/groom/references/dashboard-session-template.md` for groom phase canvases
- `skills/dev/references/canvas-template.md` for dev progress canvases

## Standard Loop

1. Ensure the dashboard is running if a browser view is helpful.
2. Write `.pm/sessions/{canvas-id}/current.html`.
3. Open or refresh `{url}/session/{slug}`.
4. Continue the workflow in the terminal.
5. Update `current.html` as artifacts evolve.

## Optional Interactive Mode

Only use this mode if the project explicitly enables dashboard input.

When interactive mode is enabled:

- clickable elements may write events to `.pm/sessions/{canvas-id}/.events`
- the terminal still owns the workflow unless the calling skill explicitly says otherwise

If interactive mode is not explicitly enabled, ignore `.events` entirely.

## Notes

- Prefer one stable `current.html` per active session over many timestamped files.
- Use `.state` to mark whether the canvas is active, idle, or completed.
- When a session is done, leave the canvas available for review or clean it up explicitly.
