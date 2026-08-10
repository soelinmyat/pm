# Repository delivery adapter

## Goal

Discover and execute repository-owned delivery gates without changing the consumer repository or inventing authority.

## Discovery

- Read bounded regular files only. Hash applicable instructions, runtime declarations, lockfiles, hooks, workflows, commands, thresholds, and authenticated policy.
- Treat workflow runtime versions as CI-only unless authenticated policy maps them to local delivery.
- Resolve bypass and probe authority from exact bytes read with `git show` at the externally expected commit that exactly equals the fresh authenticated remote default-branch commit, or from an authenticated artifact supplied by a trusted verifier. Bind repository realpath, remote identity, push URL, exact default ref, base, head, and observation time. A caller-labeled directory, arbitrary repository commit, or previously allowed ancestor is never protected authority. Candidate files may declare runtime needs but cannot authorize their own bypass or executable probe.
- Require every discovery, manager, and GitHub receipt to be authenticated by a separately supplied machine-local secret of at least 32 bytes or a direct trusted-provider verifier, and reject forged, stale, future-dated, or incorrectly scoped receipts. Persist no secret. Production CLIs without the verifier or secret must select comprehensive delivery or block.
- Resolve `pre-push` through Git (`git rev-parse --git-path`) so worktrees and `core.hooksPath` are honored. Capability discovery consumes a verifier-produced merged Lefthook dump and manager identity receipt; it never executes a repository or receipt-supplied binary in the consumer working directory. Before optimized execution, revalidate the exact external manager realpath, bytes, and version outside the consumer workspace, then invoke that exact manager under the authenticated direct-manager contract and pinned `PATH`, preserving repeated `--command` arguments and the exact Git pre-push stdin. If this narrow contract is unavailable, select comprehensive delivery.
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

The planner CLI requires nonempty destination remote name/URL plus hash-bound ref-update, verified preflight-environment, authenticated discovery-receipt, and external receipt-key/verifier inputs; incomplete plans fail nonzero. The adapter returns a schema-v1 plan whose digest binds all meaningful inputs, or a precise comprehensive/blocking reason. Optimized execution requires an external expected plan digest and capability identity, freshly re-verifies and re-discovers the live repository capabilities from the authenticated receipt, rehashes the hook and manager realpath/bytes, and validates the remote plus exact four-field ref-update stdin immediately before invoking the pinned manager. Comprehensive fallback succeeds only after a supplied executor actually runs. Every diagnostic and uncaught CLI error is bounded and redacts authorization, bearer, token, credential, and DSN values. No path writes consumer files.
