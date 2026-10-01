# ProductMemory native workflow bridge

This is an additive integration for existing canonical PM Dev sessions. It does not enable automatic remote-only Dev initialization, replace the local CLI's execution authority, synthesize local approval audits, or change project configuration.

The host supplies an explicitly authorized transport to `createWorkflowClient` or `createNativeDevAuthority`. The transport identity contains the HTTPS service origin and exact project slug. No module discovers credentials, reads shell startup files, installs tokens, or retries stale requests.

A host that opts into the bridge must retain the existing canonical PM runtime and call `assertCurrent(sessionPath, receipt, currentPhase)` before each development decision. A receipt is only a binding to a remote execution session; it is not a local approval or a grant to push, merge, deploy, or send messages. Do not use it as `trusted_approval`.

`bind` requires current local proposal approval provenance, the exact RFC sidecar and its human approval audit backed by the completed RFC run, the canonical worktree/branch/base ancestry, and matching bytes for every bundle document. ProductMemory must independently accept the current named human bundle review, owner, dependencies and compare-and-swap revision.

`certify` retains PM's current commit-bound quality/review gates. It rechecks local state, all bundle bytes, current remote review/owner/session revisions, and Git HEAD before reporting the verified commit. A stale response, changed source, new review or changed owner stops the operation for explicit reconciliation; no automatic rebase occurs.

Imported historical approvals remain historical source material. A current human review in ProductMemory is required for a new native bundle. Existing canonical local approvals remain required by this transitional bridge. A full remote-only bootstrap needs a separately reviewed runtime schema and equivalent provenance/quality checks before local storage can be retired.

The current service exposes only recent bundle/review/session lists; explicit historical bundle revision reads are available. Pagination and native runtime bootstrap remain follow-up work.
