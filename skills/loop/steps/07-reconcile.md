---
name: Reconcile
order: 7
description: Classify and safely repair stale loop cards from durable and remote evidence
---

## Goal

Produce an evidence-backed stale-card repair plan, and apply it only when the operator explicitly requests mutation and every Git safety check passes.

## How

Reconciliation defaults to dry-run:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-reconcile.js --project-dir "$PWD"
```

Print the classifications and the exact `proposed_changes`. Classifications use the card revision, durable events/recovery records, repository-pinned PR identity, and remote merge evidence. A branch name or stale local worktree is never success evidence. Missing, `NONE`, or `UNKNOWN` GitHub evidence stays unchanged with remediation.

Only an explicit `/pm:loop reconcile --apply` request authorizes mutation:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/loop-reconcile.js --project-dir "$PWD" --apply
```

Apply mode must pass Git sync readiness first. Every card/event/lease change runs through the isolated PM transaction with its planned card revision; never edit the shared backlog checkout directly. Print both `proposed_changes` and the exact `applied_changes`.

The explicit apply request is the `reconcile_loop_state` authority grant. The
script journals the plan hash and PM head, then observes the resulting remote
head before any retry. Report success only from the verified receipt. If an
interrupted attempt changed the plan without a receipt, keep it `ambiguous`
and route to `/pm:loop reconcile --dry-run`; never infer success or reapply.

A recovery record always outranks an expired lease. `recovery-ready` resumes finalization for that same run through the existing recovery transaction and never executes the card again. Ambiguous recovery, protected-path evidence, and unverified remote identity remain non-mutating with their stored remediation.

## Done-when

The command has reported every stale classification, exact proposed/applied
changes, and remediation; apply mode has either produced a verified journal
receipt or stopped on the first failed/ambiguous Git, evidence, or CAS check.
Next, use `/pm:loop status` or `/pm:board` to verify the durable board state.
