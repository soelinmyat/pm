---
name: Install
order: 5
description: First-time scheduler setup — wire launchd/cron to the loop worker for this project
---

## Goal

Set up unattended wakes for a project: verify config and gates, generate the
scheduler asset (launchd on macOS, cron elsewhere), and install it only with
explicit user confirmation.

## How

1. Initialize loop config if missing, then show it:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")" --init
```

2. Walk the user through the pre-install checklist. Do not install until each
   item is confirmed:

- **Gates:** unattended implementation requires `autonomy.start_dev: true`
  (project-level) and `implementation_approved: true` + `approved_by` +
  `approved_at` on each card (per-item). Leaving `start_dev: false` means
  scheduled wakes stay observation-only — a valid first configuration.
- **Engine:** `worker.engine` (`codex` | `claude`) or `worker.engine_bin` must
  name a CLI that is installed, authenticated, and on PATH.
- **Engine permissions:** the claude engine defaults to
  `worker.claude_permission_mode: "acceptEdits"`, under which unattended shell
  commands are denied and runs fail loudly. Fully unattended implementation
  requires the operator to explicitly set it to `"bypassPermissions"` — treat
  that as granting the engine full control of the machine during runs; prefer
  a dedicated user account or container for the scheduler. Codex loop runs
  default to `worker.codex_sandbox: "workspace-write"` and can opt into
  `"danger-full-access"` only when local test dependencies require it. Add
  extra writable roots in `worker.codex_add_dirs`. `danger-full-access` is an
  explicit local grant of host authority, **not capability isolation**. The
  worker never automatically exposes PM content or state roots as writable
  engine directories: it copies the selected read context into the disposable
  worktree and exposes only a mode-0700 result directory (plus roots the local
  operator explicitly approved). The worker also refuses any card whose `command` is not a
  `/pm:dev|rfc|research <id>` shape, so git-synced card frontmatter cannot
  inject arbitrary instructions.
- **Worktree bootstrap:** list the project's gitignored-but-required files
  (env files, generated specs) in `worker.bootstrap_required_files`; use
  `worker.bootstrap_files` only for truly optional inputs, and use
  `worker.bootstrap_command` for install steps. Fresh-worktree test failures
  are the most common unattended-run failure.
- **Preflight checks:** put project-specific service health commands in
  `preflight.service_checks`. The loop runs bootstrap, service checks, and a
  bounded exact-engine auth/permission probe in a detached disposable
  worktree before it claims a lease. Failures stay machine-local in a
  fingerprint-keyed quarantine so later cards remain eligible.
- **Local approval:** after reviewing executable commands and broad
  permissions, run `scripts/loop-config.js --approve-host`. Any relevant
  config change produces a new execution hash and fails closed until that hash
  is approved on the machine again.
- **Merge autonomy:** `autonomy.merge_pr: false` (default) means every child
  stops at an open PR for your review. Setting it to `true` grants full
  epic autonomy: implement → test → merge to main → next child, with no human
  stop between children. Only the workflow's own gates (TDD, review,
  verification, green CI) stand between the engine and main — confirm the
  user wants that before enabling.
- **Budgets:** review `budgets.max_runs_per_day` and
  `max_runtime_seconds_per_run`. Every engine run costs real money.
- **Kill switch:** show how to halt everything:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --stop    # halt (commits + pushes)
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --resume  # resume
```

- **Supervised canary:** keep the scheduler paused/uninstalled and keep
  `autonomy.merge_pr: false` until these exact commands all pass:

  Set `CLEANLOG_ROOT` to the absolute consumer project root. Set `CANARY_CARD`
  to an eligible approved card that is expected to produce an OPEN PR, then run
  the exact commands from the installed PM plugin root:

```bash
cd "${CLAUDE_PLUGIN_ROOT}"
```

```bash
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case preflight-failure
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case blocked-result
node scripts/loop-canary.js --project-dir "$CLEANLOG_ROOT" --case verified-pr --card "$CANARY_CARD" --no-merge
```

  Records live at `.pm/loop-canary/<run_id>/<case>.json` and pin the plugin
  version, source commit, resolved config hash, exact plan, and engine binary/
  argv identity. The release gate accepts only three passing, fresh records
  with the same plugin/source/config/engine identity. Missing, stale, mixed,
  or failed evidence fails closed. The verified PR stays OPEN; the canary never
  merges it.

3. Generate the scheduler asset and show it to the user before installing:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD"
```

4. Only after the user confirms, install through the gate-checked command
   (macOS writes and loads the LaunchAgent; Linux updates crontab):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-install.js --project-dir "$PWD" --install
```

`--install` and `--resume` enforce the canary release gate before changing
scheduler state. Gate-owned scheduler entries pass `--scheduled`, and every scheduled
wake rechecks current same-identity evidence before claiming work. Generated assets are
previews only; they do not silently enable unattended scheduling.
Unmarked worker CLI invocations also default to scheduler-safe gating for legacy
scheduler entries; explicitly supervised one-off runs use `--manual`.

The interval comes from `scheduler_interval_minutes` (default 30) or
`--interval <minutes>`.

Close by telling the user the interval, the log path, and the kill-switch command — or, if they stopped at generate-only, exactly what remains to enable unattended wakes.

## Done-when

The scheduler is either left as a reviewed preview or installed after explicit confirmation with fresh same-identity canaries, host approval, and safe config; the user has its interval, log path, kill switch, and next action.
