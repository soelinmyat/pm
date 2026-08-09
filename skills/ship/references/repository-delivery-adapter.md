# Repository delivery adapter

## Goal

Discover and execute repository-owned delivery gates without changing the consumer repository or inventing authority.

## Discovery

- Read bounded regular files only. Hash applicable instructions, runtime declarations, lockfiles, hooks, workflows, commands, thresholds, and authenticated policy.
- Treat workflow runtime versions as CI-only unless authenticated policy maps them to local delivery.
- Resolve bypass and probe authority from the protected base or an already approved/authenticated policy artifact. Candidate files may declare runtime needs but cannot authorize their own bypass or executable probe.
- Unknown, malformed, symlinked, oversized, remote-sensitive, or stdin-sensitive contracts fail to the existing comprehensive Ship route.

## Environment preflight

Before every expensive gate or push, intersect all applicable local runtime constraints and compare them with the executable realpath, version, manager/shim, `PATH`, and allowlisted environment identity. Recompute immediately before execution and run with that same verified environment. A mismatch blocks; an absent declaration is explicitly unverified.

Only built-in versioned service adapters are executable. `postgres-identity-v1` uses argv-only, no-shell execution with a fixed read-only query, minimal environment allowlist, bounded output/time, strict result fields, and redaction before diagnostics. Never execute repository-authored probe commands.

## Candidate publication

Targeted candidate publication requires both:

1. hash-bound machine-readable repository permission from protected/approved authority; and
2. exact adapter proof covering every skipped command plus destination, refs, ref-update stdin, current head, tool, environment, and configuration identity.

A generic escape hatch is not permission. If either condition is missing, select the existing comprehensive Ship route before publishing a draft and do not add a second final certification.

## Done when

The adapter returns a schema-v1 plan whose digest binds all meaningful inputs, or a precise comprehensive/blocking reason. Execution uses the installed hook with faithful Git protocol inputs and no consumer write.
