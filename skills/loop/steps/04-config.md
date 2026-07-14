---
name: Config
order: 4
description: Inspect or initialize conservative loop configuration
---

## Goal

Show the current loop config, or initialize the default conservative config when the user asks for setup.

## How

For read-only config inspection:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")"
```

For explicit initialization:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")" --init
```

Highlight these fields when explaining the output:

- `version: 2` enables exact-plan preflight and trusted host configuration.
- `sync_required_for_mutation` must remain true for cross-machine safety.
- `autonomy.start_dev` defaults false and gates implementation pickup.
- `autonomy.merge_pr` defaults false and gates auto-merge.
- `budgets.lease_ttl_seconds` controls lease expiry. The default is 7,200
  seconds; legacy `lease_ttl_minutes` values migrate to seconds before
  validation.
- `claim_envelope` bounds branch promotion, bootstrap recheck, shutdown grace,
  artifact verification, PM finalization, workspace cleanup, CAS attempts, and
  the scheduler overlap margin.
- `claim_envelope.remote_stop_poll_seconds` sets the bounded remote STOP ref
  check cadence (default 30 seconds); same-machine STOP polling remains fast.
- `budgets.max_identical_no_progress` defaults to one. A durable terminal event
  records the exact card revision, stage, and blocker signature; the next
  identical execution is suppressed and finalized at `needs-human` with its
  first and last run IDs.
- `canary.evidence_ttl_seconds` bounds release-gate evidence freshness.
- `worker.bootstrap_required_files` fails preflight when a required local file
  is missing; `worker.bootstrap_files` remains optional and skips missing files.
- `preflight.service_checks` runs bounded project-specific health commands in
  the disposable worktree before a lease is claimed.

The lease must be strictly longer than the complete claim-to-final-push
envelope plus the scheduler overlap margin. Unsafe configurations fail before
selection with the computed envelope and required remediation; the former
45-minute default is intentionally rejected because it is shorter than the
default dev runtime alone.

Executable commands and broad permissions are inert until the resolved
execution hash is approved on this machine. After inspecting the exact config,
record that approval locally (never in git):

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-config.js \
  --pm-dir "$(node ${CLAUDE_PLUGIN_ROOT}/scripts/resolve-pm-dir.js "$PWD")" \
  --approve-host
```

Changing an engine binary/argument, bootstrap command, service check,
`codex_add_dirs`, Claude bypass mode, or Codex `danger-full-access` changes the
hash and requires a new explicit approval.

Config and install output show the dev and ship claim envelopes, the maximum
daily claim-envelope exposure, the minimum safe TTL and remaining TTL margin.
They also warn explicitly when merge autonomy, Codex `danger-full-access`,
Claude permission bypass, or extra writable directories broaden exposure.

Do not modify `implementation_approved`, `approved_by`, or `approved_at` on backlog cards from this step.

## Done-when

The current or initialized config is validated, calculated exposure and TTL margins are visible, broad permissions have explicit local approval, and backlog approvals remain untouched.

Offer host approval, supervised canaries, or scheduler installation as the next action only when its prerequisites are satisfied.
