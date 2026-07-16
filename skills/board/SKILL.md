---
name: board
description: "Use when the user wants a visual Kanban board of loop/backlog progress — columns of cards, in-flight leases, recent loop runs, and budget usage — served locally in the browser. Read-only surveying; the only action it offers is the loop kill switch."
---

# pm:board

## Purpose

Serve a local, browser-based Kanban view of the git-backed loop board so the
user can *see* what `/pm:loop` and `/pm:list` report in text: columns of backlog
cards (with kind/size badges, epic parent chips, branch, PR links, and a
"running" badge for active leases), a status strip (loop paused/active, the last
~10 loop runs, today's run/ship-cycle budget usage), all auto-refreshing every
5s.

It is the visual companion to `/pm:list` (terminal survey) and `/pm:loop status`
(text board). Same durable model, rendered as a board.

Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md` for path resolution and
runtime conventions.
Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md` before generating any output.

**Workflow:** `board` | **Telemetry steps:** `resolve`, `serve`, `verify`

## Iron Law

**NEVER EXPOSE THE BOARD OFF HOST.**

## When to use

- The user asks to *see* issue/loop progress, "open the board", "show the
  Kanban", or wants an at-a-glance view of what the loop is doing.
- The user wants to watch in-flight work, leases, recent runs, or budget burn
  without reading text output.

## When NOT to use

- The user wants a one-shot terminal list — use `/pm:list`.
- The user wants to plan/execute a loop wake or inspect autonomy config — use
  `/pm:loop`.
- The user wants to start, groom, or ship a specific item — use `/pm:dev`,
  `/pm:groom`, `/pm:ship`, etc. The board never starts work.

## How to start

The board is a small Node HTTP server (stdlib only). Resolve the plugin root,
then launch it and point the user at the printed URL:

```bash
PM_PLUGIN_ROOT="${PM_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"
if [ -z "$PM_PLUGIN_ROOT" ]; then
  echo "Set PM_PLUGIN_ROOT to the PM plugin root." >&2
  exit 1
fi
PM_PATHS="$(node "$PM_PLUGIN_ROOT/scripts/resolve-pm-dir.js" --json "$PWD")" || exit 1
PM_DIR="$(node -e 'console.log(JSON.parse(process.argv[1]).pmDir)' "$PM_PATHS")"
SOURCE_DIR="$(node -e 'console.log(JSON.parse(process.argv[1]).sourceDir)' "$PM_PATHS")"
node "$PM_PLUGIN_ROOT/scripts/board-server.js" \
  --pm-dir "$PM_DIR" \
  --source-dir "$SOURCE_DIR" \
  --port 4400
```

It binds `127.0.0.1` only and prints `http://127.0.0.1:4400`. Flags:
`--port` (default 4400), `--pm-dir` (default `./pm`), `--source-dir` (where
`.pm/` loop state lives; always pass the resolver's `sourceDir`). The server runs
until stopped (Ctrl-C); tell the user the URL and that it refreshes itself.

Graceful degradation: with no `pm/` directory the page shows setup guidance
(`/pm:setup` or `/pm:start`); with no `pm/loop/config.json` the board still
renders in backlog-only mode and the strip reads "loop not installed".

## The contract

- **Read-only.** The board surveys durable state (`pm/backlog`, `pm/loop`
  leases/snapshots/config, and the local `.pm/loop-runs` ledger). It reuses the
  existing board model (`scripts/loop-board.js`) and never re-derives columns.
- **One action only: the loop kill switch.** `POST /api/loop/toggle` flips
  `pm/loop/STOP` via the same mechanism as `/pm:loop` install (commits + pushes
  when a git remote exists, so every machine halts). Nothing else mutates.
- **Effect authority and recovery.** Treat the kill-switch request as explicit
  permission for that one effect. If its commit or push fails, report the
  partial state and recovery command; never retry or widen authority silently.

## Hard rules

- THE BOARD NEVER EDITS BACKLOG FRONTMATTER. It does not change card status,
  approvals, priorities, parents, or any field. All backlog changes flow through
  the `groom`/`dev`/`loop` workflows — the board only reflects them.
- The kill switch is the only write. Do not add card-editing or work-starting
  actions to the board; route those to the owning workflows.
- Bind `127.0.0.1` only — never `0.0.0.0`. The board exposes a loop mutation and
  must not be reachable off-host.

## Red Flags — Self-Check

- **"Editing a card would be convenient."** Stop and keep backlog mutations in their owning workflows.
- **"The LAN is trusted."** Bind only to `127.0.0.1` and check the printed URL.
- **"I can rederive the columns."** Use the shared board model so empty and error states match other projections.
- **"The kill switch is just UI state."** Use its authorized commit-and-push mechanism and surface recovery failures.

## Escalation Paths

- If the user wants a terminal projection, switch to `pm:list`.
- If the user wants to mutate work, stop and route to `pm:loop`, `pm:dev`, or `pm:groom`.
- If the server cannot bind safely, stop and report the exact local error.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "One more board action saves time." | Extra mutations turn a projection into an unreviewed control plane. |
| "Binding broadly helps another device connect." | The board exposes operational state and a kill switch. |

## Before Marking Done

- [ ] The board artifact is served on `127.0.0.1` with the printed local URL.
- [ ] Backlog state remained read-only; only the explicit kill-switch effect is available.
- [ ] Missing PM data, empty backlog, and server errors produce useful recovery guidance.
