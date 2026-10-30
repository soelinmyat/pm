---
title: MCP feature coverage
created: 2026-10-30
updated: 2026-10-30
---

# MCP feature coverage

A product that treats MCP as a first-class surface must finish its agent-facing
workflows before calling the feature done. This is feature parity by user outcome,
not one tool per screen or a quota of tools. Reuse existing tools and shared domain
services where they already satisfy the outcome.

## Project policy

Read repository instructions at intake. Projects opt into executable enforcement
by placing this exact standalone marker in their root `AGENTS.md`:

```html
<!-- mcp-feature-coverage: required -->
```

Never add or remove project policy without the user's authority. Projects without
this marker retain their existing delivery behavior. MCP servers used by PM itself
are unrelated to this product policy. Root policy applies to every task: a docs or
internal change records an explicit non-applicability assessment rather than
silently bypassing the check. Removing the marker in a branch does not waive the
policy present at the authoritative base.

## Carry coverage through the workflow

- **Groom:** for each user outcome, identify agent discovery, read/analysis and
  action workflows, existing coverage and missing contracts. Include applicable
  coverage in acceptance criteria. Pure visual/internal work can be non-applicable
  with a specific reason; deferred functionality remains an open scope gap.
- **RFC:** name tools/services, schemas, scope and tenant boundaries, pagination,
  errors, annotations, documentation and transport tests in the existing execution
  contract. Keep domain behavior shared. For writes, design authorization,
  confirmation, audit and idempotency/retry semantics explicitly. A parity policy
  never authorizes exposing mutations, personal data or wider privileges by itself.
- **Dev:** assess every acceptance criterion, implement its applicable workflows,
  run relevant MCP contract/transport tests, and retain actual command output. Test
  success plus denied/cross-tenant access, invalid inputs and relevant failures.
  Existing tools need current parity evidence. Transport/OAuth changes also need
  affected client verification; SDK coverage is not proof of a live Claude or
  ChatGPT connection. Record unavailable client checks honestly and resolve them
  according to the task's acceptance criteria.
- **Review:** compare the report with the complete diff and acceptance criteria.
  Challenge unsupported non-applicability, missing workflows, inaccurate tool
  annotations, weak authorization and tests that do not exercise MCP. Validate
  evidence and documentation. A structural pass cannot establish semantic parity;
  the source reviewer owns that judgment in the existing review round.

## Current evidence

Before final Review/verification, save `mcp-coverage.json` beside the canonical
Dev session's `gates.json`. Its closed v1 shape is:

```json
{
  "schema_version": 1,
  "run_id": "<Dev run_id>",
  "commit": "<full current HEAD>",
  "base_commit": "<full authoritative remote default-branch commit>",
  "entries": [
    {
      "criterion": "<exact acceptance criterion, in session order>",
      "status": "covered",
      "rationale": "<specific explanation of the workflow and its MCP implementation>",
      "tools": ["list_assets"],
      "check_ids": ["asset-transport"]
    }
  ],
  "checks": [
    {
      "id": "asset-transport",
      "command": "<actual command run against this commit>",
      "exit_code": 0,
      "artifact": ".pm/dev-sessions/<slug>/mcp-evidence/transport.log",
      "sha256": "<SHA-256 of the retained command output>"
    }
  ]
}
```

Include exactly one entry per session acceptance criterion, in the same order;
name all applicable tools/checks in that entry. A `covered` entry requires tool
names and passing check IDs. A `not_applicable` entry requires a concrete reason
(at least 40 characters), empty `tools` and `check_ids`; it must not conceal a
missing feature or deferred verification. A wholly non-applicable task has an
empty `checks` array. Empty criteria, unknown statuses/fields, missing output,
failed commands, altered hashes and stale run/base/head identities fail closed.

Command outputs live under the same session's `mcp-evidence/`, use paths relative
to the originating repository, and must be regular, nonempty files (at most 1 MiB
per file). Scrub credentials and private customer data before retaining output;
hash those final retained bytes. Report bytes also have a 1 MiB limit. Never
manufacture a passing receipt or client test. This is workflow-attested evidence,
not cryptographic proof that a command ran or that a model used tools correctly.

`dev-gate-check.js` checks this report as part of the existing `verification` gate,
including its gate writer and final delivery check. No separate gate or approval
round is added. Use the normal gate command; a missing report returns an MCP
coverage error. After source or base changes, reassess coverage and run affected
checks before refreshing the report; changing the SHA alone is not verification.
Keep the report available with the session's retained delivery evidence.
