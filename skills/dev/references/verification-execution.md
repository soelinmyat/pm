# Authenticated baseline execution receipts

The execution adapter currently requires POSIX process groups (Linux/macOS).
It force-terminates the owned process group on deadline/output overflow, including
descendants retaining output pipes, before recording failure and releasing its
store lock. Windows execution is unsupported and fails closed.

Use `scripts/verification-execution.js` for repeated baseline/focused Node suites
only after the repository owner has reviewed and authenticated the complete input
contract. The existing planner is advisory; its unsigned prior rows do not prove
that a command ran. This runner executes the exact argv directly, captures bounded
stdout/stderr, and authenticates actual outcomes. It does not certify a Dev gate.
Step 8's full final suite, the pre-push hook and independent CI still execute.

## Eligible contracts

`deterministic-workspace-only-v1` means the suite and all its dependencies read
only the declared workspace and the owning Node runtime. The suite must not spawn detached process groups or escape the owned process
session; such work is ineligible and requires separate external process cleanup.
Deadline failure closes owned pipes without waiting for escaped descendants.
The suite must not
consume mutable services, network, wall clock, randomness, machine home files,
external configuration, external executables or undeclared native addons. Signing
is the owner's reviewed assertion of that boundary; HMAC is not a sandbox or a
proof of hermeticity. Never infer this assertion from passing tests, generate a
key merely to sign an agent's guess, or enroll a suite with unknown inputs.
Unknown or external dependencies require normal fresh execution.

The owner/protected workflow supplies a machine-local key of at least 32 bytes
through `PM_VERIFICATION_RECEIPT_KEY`. Keep it separate from the child environment
and repository. Authenticate the following closed JSON object with the existing
`stableObjectHmac` helper, putting the result in `authentication`. Store contract
and receipt files privately outside the workspace. Neither keys, environment
values nor raw outputs belong in committed plugin source.

```json
{
  "schema_version": 1,
  "kind": "verification-execution-contract",
  "root": "/absolute/consumer/workspace",
  "executable": "/absolute/path/to/owning/node",
  "args": ["--test", "tests/deterministic.test.js"],
  "environment": {"NODE_ENV": "test"},
  "input_contract": "deterministic-workspace-only-v1",
  "timeout_ms": 600000,
  "max_age_ms": 3600000,
  "authentication": "hmac-sha256:owner-provided-authentication"
}
```

No ambient child environment is inherited. The executable must be the owning
Node executable. Command, explicit environment, runtime bytes/shared-library
bytes, runner source, host build and complete workspace identity bind reuse.
All workspace files, including ignored/generated files and actual installed
dependency bytes, are inventoried; callers cannot exclude paths. Symlinks,
worktree `.git` pointers, unreadable/large inputs, missing shared-library bytes,
and inventory budget exhaustion disable reuse. macOS system-cache-only libraries
currently force fresh execution. This first contract does not enroll Rails,
browser, database or external-process suites.

## Run and inspect

```bash
node "$PM_PLUGIN_ROOT/scripts/verification-execution.js" \
  --contract /private/owner-contract.json \
  --store /private/existing-receipt-directory \
  --stage baseline
```

Only an unexpired authenticated passing receipt with matching before/after
identities and intact retained output can be reused. Failures, timeout, oversized
output, missing/forged evidence and source drift cannot produce reusable success.
Every executed attempt is retained separately, including failures. The receipt
store is locked and writes use the existing safe atomic writer with private
permissions. Its path must be outside the workspace, with no overlap.

Use `--stage final` when executing through this runner at the mandatory final
boundary: that stage always executes. Do not use a baseline cache hit as fresh
final verification. Record evidence through `dev-session record` and `gate`;
never write gate JSON from a receipt or from an agent's prose claim.

## Consumer prerequisites

A protected authenticated `.pm/repository-delivery-policy.json` may declare
`required_environment: ["DEMO_PASSWORD"]` beside its existing `candidate_push`
policy. Candidate/untrusted declarations cannot add authority. Discovery binds
these names into the delivery plan, and the runner checks the live protected
configuration contract before optimized or comprehensive fallback execution.
Missing or whitespace-only settings block before runtime/service probes and full
suites. Values are never returned; a machine-local identity key authenticates
configuration identity and detects value drift. This validates presence, not
whether a credential works or a database has enough lock capacity. Existing
bounded database identity probes remain independent prerequisites; this release
never guesses settings or adjusts a consumer database.
