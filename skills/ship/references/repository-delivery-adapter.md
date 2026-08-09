# Repository delivery adapter

## Goal

Discover and execute repository-owned delivery gates without changing the consumer repository or inventing authority.

## Discovery

- Read bounded regular files only. Hash applicable instructions, runtime declarations, lockfiles, hooks, workflows, commands, thresholds, and authenticated policy.
- Treat workflow runtime versions as CI-only unless authenticated policy maps them to local delivery.
- Resolve bypass and probe authority from exact bytes read with `git show` at a verified base commit, or from an authenticated artifact supplied by a trusted verifier. A caller-labeled directory, including the candidate root, is never protected authority. Candidate files may declare runtime needs but cannot authorize their own bypass or executable probe.
- Resolve `pre-push` through Git (`git rev-parse --git-path`) so worktrees and `core.hooksPath` are honored. Discovery may consume an authenticated merged Lefthook dump only when its external expected digest matches, but never executes a consumer-controlled Lefthook binary.
- Any unknown or malformed Lefthook command field, glob, exclude, or stdin/interactive contract makes the adapter unsupported; do not retain a partial command set.
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

The adapter returns a schema-v1 plan whose digest binds all meaningful inputs, or a precise comprehensive/blocking reason. Execution requires an external expected plan digest and capability identity, rehashes the hook realpath/bytes, and validates the remote plus exact four-field ref-update stdin immediately before invoking the hook. Comprehensive fallback succeeds only after a supplied executor actually runs. All diagnostics are bounded and redact authorization, bearer, token, credential, and DSN values. No path writes consumer files.
