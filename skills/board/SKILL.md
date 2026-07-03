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
node "$PM_PLUGIN_ROOT/scripts/board-server.js" \
  --pm-dir "$(node "$PM_PLUGIN_ROOT/scripts/resolve-pm-dir.js" "$PWD")" \
  --port 4400
```

It binds `127.0.0.1` only and prints `http://127.0.0.1:4400`. Flags:
`--port` (default 4400), `--pm-dir` (default `./pm`), `--source-dir` (where
`.pm/` loop state lives; defaults to the parent of `--pm-dir`). The server runs
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

## Hard rules

- THE BOARD NEVER EDITS BACKLOG FRONTMATTER. It does not change card status,
  approvals, priorities, parents, or any field. All backlog changes flow through
  the `groom`/`dev`/`loop` workflows — the board only reflects them.
- The kill switch is the only write. Do not add card-editing or work-starting
  actions to the board; route those to the owning workflows.
- Bind `127.0.0.1` only — never `0.0.0.0`. The board exposes a loop mutation and
  must not be reachable off-host.
