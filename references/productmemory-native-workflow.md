# ProductMemory native development

Use an already authorized host transport with an exact HTTPS origin and project slug. These modules do not discover credentials, read shell startup files, configure tokens, or retry stale writes. A persisted receipt or imported approval never opens live execution authority.

## Fresh remote-native sessions

`createNativeRuntime(transport)` from `scripts/productmemory-native-runtime.js` supports fresh development without a local shared `pm/` tree or legacy approval audits. The host must select this path explicitly for an enrolled ProductMemory feature. Run the Dev capability preflight first and use a fresh feature worktree. Ordinary local Dev remains available for unenrolled work.

Call `initialize({sourceDir, slug, recordId, executionPath})`. The current immutable bundle must contain one current structured proposal JSON, one schema-v3 RFC JSON, all their evidence/prototype files, and a supporting execution JSON. The execution file has exactly `schema_version: 1`, `kind`, `ui_platform`, and `risk` (all canonical risk dimensions plus `destructive_data`). The bundle needs a current named human approval, named owner and accepted dependencies. Plain Markdown, old unbound review contracts and unresolved proposal decisions require renewed structured grooming and review.

Initialization verifies proposal quality, acceptance requirements, evidence lineage, prototype identity, RFC ownership/dependency DAG and complete design/experience context before starting a remote session. It retains exact hash-checked bytes in a private `.pm/productmemory/<id>/pm/` snapshot; that is a disposable execution input, not a local shared-product store. Runtime mechanics and quality receipts remain private in `.pm/dev-sessions/<slug>/`. No historical runtime, lease or approval files are hydrated.

## Host operation mapping

Retain the existing Dev steps, bounded phase prompts, model/runtime capability checks, strict result envelopes, TDD, QA, design critique and independent current-HEAD source review. For a session with `task.native`, replace every mutating/advancing local `dev-session` CLI operation with the corresponding live host runtime method:

| Local operation | Native host method |
| --- | --- |
| next | `decision(sessionPath)` |
| record | `record(sessionPath, result)` |
| workspace | `workspace(sessionPath)` |
| grant | `grant(sessionPath, actions, reason)` |
| work-unit | `transitionWorkUnit(sessionPath, input)` |
| candidate transition | `transitionCandidate(sessionPath, input)` |

Every operation locks canonical session state and rechecks current service/project, review, scope, owner, dependencies, remote revisions, Git branch/base and all bound bytes. Ordinary synchronous `dev-session` advancement refuses native sessions. Do not route, rebind RFC, downgrade to a local session, or edit authority fields manually. A scope/ownership change needs a new bundle and current human review; existing runs require explicit reconciliation.

The decision also contains `native_contract`: the complete approved proposal execution contract. Include its outcome, constraints, explicit non-goals, acceptance criteria and risk rationale alongside each unit's exact RFC contract in the bounded worker packet. In readiness, use the bound RFC entry's absolute snapshot path as `rfc-readiness` evidence. The host runtime verifies it against the live bundle; do not manufacture a local RFC approval audit.

## Certification and recovery

After completed implementation units, QA, review and verification, `certify(sessionPath)` uses the actual canonical current-HEAD gate checker, including retained QA evidence and independently validated review evidence. Certification grants no push, merge, deploy or messaging authority. Those actions require an explicit host authorization and the normal final delivery checks.

A durable intent precedes each remote start/report. On an unknown response, stop automatic writes. `recoverInitialization({sourceDir, slug})` and `recoverCertification(sessionPath)` accept only an exact already-acknowledged remote transition, rechecking current source and evidence, and never replay start/report. If the service state or evidence differs, reconcile explicitly. Do not delete the intent to turn an uncertain request into a retry.

## Transitional binding

`createNativeDevAuthority` remains available for existing local canonical Dev sessions. It retains their original local proposal/RFC provenance and approval audits while independently binding a current ProductMemory review. It cannot turn imported history into approval or replace fresh native initialization.
