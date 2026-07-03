---
name: Route
order: 1
description: Assess the loop situation and route the operator to the one action that fits
---

### Step 1: Route (runs when `/pm:loop` has no subcommand)

This is the single-command front door. Read the situation, show it in one glance, and offer only the next action(s) that fit — defaulting to the safe one. Do NOT run `wake`, `work`, `config`, or `install` yourself here; ROUTE to them (offer, and on agreement continue into that subcommand's step). The two hard gates still hold — the router never starts implementation.

**Assess.** Run from the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-situation.js --project-dir "$PWD" --json
```

It returns one object with `state` plus `configured`, `installed`, `paused`, `config` (engine, merge_pr, start_dev, interval, budgets), and `board` (ready card list, active leases, needs_rfc / needs_human counts). Never scan `.pm/` by hand to infer this — the classifier is the source of truth.

**Route on `state`:**

| `state` | Show | Ask / offer |
|---------|------|-------------|
| `unconfigured` | "The loop isn't set up here." (if the note says the config is present-but-unreadable, say that instead and point at the file) | "Want to configure it?" → on yes, continue into the `config` subcommand. |
| `no-work` | "Loop is configured, but nothing is queued for it." + a one-line backlog read (needs_rfc / needs_human counts). | Point to `/pm:groom` then `/pm:rfc` to queue an epic. Offer `/pm:board` to view everything. |
| `ready-not-run` | "N card(s) ready for the loop:" + the ready list (id — title). | "Run one supervised cycle now to watch it (wake → work), or install the scheduler for unattended runs?" Default: the supervised cycle. On "run one", continue into `wake` then `work`; on "install", continue into `install`. |
| `installed-idle` | The board summary + today's budget (`budget.runs_today`/`max_runs_per_day`, `budget.ship_cycles_today`/`max_ship_cycles_per_day`), and "Scheduled every {interval}m · engine {engine} · merge_pr {true/false}." | "Run a cycle now, pause the loop, or open the board (`/pm:board`)?" Default: nothing (it's already scheduled) — just report. |
| `in-progress` | "In progress: {card_id} at {stage}{ on {holder}}, claimed {claimed_at}, expires {expires_at}." If `cardExists` is false, flag it as a **stale lease** (the card is gone; the claim frees at TTL). | Report status; offer `/pm:board` for the live view. Don't dispatch — a wake is already holding the lease. |
| `paused` | "The loop is paused (kill switch set)." + the STOP path if known. | "Resume?" → on yes, `node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --resume`. |

**Always:** if the situation object carries a non-empty `note`, surface it first — it flags edge states (config unreadable, or a kill switch / active lease present without a config).


- Keep the summary short — one situation line + the fitting question. This is a router, not a report.
- Respect the gates: `ready-not-run` and `installed-idle` only offer to *run* a cycle; the actual `work` step still enforces `autonomy.start_dev: true` + per-card `implementation_approved`, and refuses otherwise.
- If the operator names a subcommand explicitly (`/pm:loop status|wake|work|config|install`), that subcommand's step runs directly — the router is only the no-subcommand default.
- `/pm:board` is the richer live view; point at it whenever the operator wants more than the one-glance summary.
