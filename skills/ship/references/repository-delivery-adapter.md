# Repository delivery adapter

## Goal

Discover and execute repository-owned delivery gates without changing the consumer repository or inventing authority.

## Discovery

- Read bounded regular files only. Hash applicable instructions, runtime declarations, lockfiles, hooks, workflows, commands, thresholds, and authenticated policy.
- Treat workflow runtime versions as CI-only unless authenticated policy maps them to local delivery.
- Resolve bypass and probe authority from exact bytes read with `git show` at an externally expected base commit that is verified as an ancestor of the authenticated remote default-branch commit, or from an authenticated artifact supplied by a trusted verifier. Bind the remote identity, push URL, exact default ref, and head commit. A caller-labeled directory or arbitrary repository commit is never protected authority. Candidate files may declare runtime needs but cannot authorize their own bypass or executable probe.
- Resolve `pre-push` through Git (`git rev-parse --git-path`) so worktrees and `core.hooksPath` are honored. Lefthook discovery requires a hash-bound authenticated receipt for the external manager realpath, bytes, version, and merged-dump digest. Revalidate all four live before execution. Never execute a consumer-controlled manager binary; only the authenticated external manager may produce its version and merged JSON.
- Any unknown or malformed Lefthook command field, glob, exclude, or stdin/interactive contract makes the adapter unsupported; do not retain a partial command set.
- Treat workflow `merge_group` detection as a hint only. Targeted optimization also requires an externally bound, authenticated read-only GitHub receipt with explicit branch-protection, required-check, and merge-queue facts. Missing or malformed GitHub facts select comprehensive delivery.
- Unknown, malformed, symlinked, oversized, remote-sensitive, or stdin-sensitive contracts fail to the existing comprehensive Ship route.

## Environment preflight

Before every expensive gate or push, intersect all applicable local runtime constraints using supported semver semantics and compare them with the executable realpath, version, manager/shim, `PATH`, and allowlisted environment identity. Recompute immediately before execution and run with that same verified environment. A mismatch blocks; an absent declaration is explicitly unverified and cannot use optimized targeted or complete execution.

Only built-in versioned service adapters are executable. `postgres-identity-v1` uses argv-only, no-shell execution with a fixed read-only query, minimal environment allowlist, bounded output/time, strict result fields, and redaction before diagnostics. Its identity binds the probe executable realpath/version and uses a machine-local secret of at least 32 bytes; there is no default key. Never execute repository-authored probe commands.

## Candidate publication

Targeted candidate publication requires both:

1. hash-bound machine-readable repository permission from protected/approved authority; and
2. exact adapter proof covering every skipped command plus destination, refs, ref-update stdin, current head, tool, environment, and configuration identity.

A generic escape hatch is not permission. If either condition is missing, select the existing comprehensive Ship route before publishing a draft and do not add a second final certification.

## Done when

The planner CLI requires nonempty destination remote name/URL plus hash-bound ref-update, verified preflight-environment, and discovery-receipt inputs; incomplete plans fail nonzero. The adapter returns a schema-v1 plan whose digest binds all meaningful inputs, or a precise comprehensive/blocking reason. Optimized execution requires an external expected plan digest and capability identity, re-discovers the live repository capabilities from the authenticated receipt, rehashes the hook realpath/bytes, and validates the remote plus exact four-field ref-update stdin immediately before invoking the hook. Comprehensive fallback succeeds only after a supplied executor actually runs. Every diagnostic and uncaught CLI error is bounded and redacts authorization, bearer, token, credential, and DSN values. No path writes consumer files.
