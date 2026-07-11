# PM RFC v2 — Model-Adaptive, Approval-Safe Workflow

Created: 2026-07-11
Status: implementation approved

## Outcome

Make `/pm:rfc` reliable with GPT-5.6 Sol High and Claude Opus 4.8 xHigh by replacing narrative lifecycle control with a deterministic runner, loading one phase at a time, and binding review and human approval to the exact RFC artifact.

## Evidence from the current workflow

1. `SKILL.md` eagerly loads every RFC step, so intake, generation, review, external tracker writes, loop approval, and implementation handoff compete in one prompt.
2. Session state is a Markdown table whose values are recovered with loose text parsing. It has no schema, transition validator, attempt identity, or atomic result contract.
3. The review step sets the RFC to `approved` and the proposal to `planned` before asking the user to approve it. A literal model can therefore manufacture approval.
4. The sidecar deliberately excludes lifecycle state, while approval lives in human HTML/frontmatter. Downstream consumers cannot distinguish “technically reviewed” from “human approved” without parsing prose.
5. Standard reviewers return free-form prose. The orchestrator must infer severity, deduplicate findings, and decide whether every required lens passed.
6. Review parallelism is fixed by task count, not by dependency, context, or ownership. It can create unnecessary agent churn on small RFCs and context loss on complex ones.
7. The generation prompt repeats a large schema and future-phase instructions. Provider behavior, authority, artifact requirements, and workflow semantics are mixed together.
8. Approved sessions may be deleted, removing the durable approval audit and exact artifact identity used for the decision.

## Design

### Canonical lifecycle

Use a strict JSON session at `.pm/rfc-sessions/{slug}/session.json`:

```
intake -> generation -> review -> approval -> handoff -> complete
                                  |
                           awaiting_approval
```

- Review may only establish `review.status: passed` for one artifact hash.
- Entering approval sets session status to `awaiting_approval`; it does not alter RFC or proposal lifecycle fields.
- Only an explicit `approve` command records approver, timestamp, and reviewed artifact hash.
- Handoff revalidates that the artifact still matches the approved hash before updating proposal, Linear, loop, or dev-facing state.
- Completed sessions remain as durable audit records and are hidden from active-session views.

### Phase-local context

`rfc-session next` returns one instruction path, required capabilities, required evidence, and allowed execution modes. The model reads only that step and its declared references. Project overrides retain same-filename precedence.

Generation and review receive bounded packets with:

- objective and acceptance criteria;
- exact proposal/RFC paths;
- repository findings relevant to the phase;
- artifact and stable HTML contracts;
- allowed local/external authority;
- required evidence and strict result schema.

Model, effort, and runtime policy live in data. Defaults are GPT-5.6 Sol at `high` and Claude Opus 4.8 at `xhigh`.

### Structured review

Require three review lenses, not necessarily three processes:

- `architecture-risk`
- `test-strategy`
- `maintainability`

One capable model may return all three lenses for a small RFC. Independent agents are used when lenses benefit from isolation or the RFC has multiple substantial work units. Every lens returns a strict verdict with blocking/advisory findings. The runner advances only when all required lenses pass against the current artifact hash.

### Artifact integrity

The HTML remains the human artifact and the JSON sidecar remains the machine projection. Session state records:

- absolute HTML and sidecar paths;
- sidecar SHA-256;
- artifact repository root and commit;
- validation timestamp;
- reviewed hash;
- approved hash.

Generation, review, approval, and handoff all compare this identity. Any edit after review routes back to review. Any edit after approval invalidates approval.

### Authority

RFC approval authorizes the technical design only. It does not imply permission to create Linear issues, approve unattended loop pickup, open applications, or start implementation. Those effects are separate booleans in the session authority envelope and require an explicit grant or configured standing consent.

## Compatibility

- Legacy Markdown sessions are retained and migrated once.
- Because the old workflow could write `approved` before human confirmation, a migrated legacy `approved` session is routed through review/approval recertification instead of trusted as approved.
- Existing HTML without a sidecar remains eligible for the documented legacy parser. Present-but-invalid sidecars continue to fail closed.
- Existing loop result statuses remain unchanged; reviewed RFCs return `needs-approval`, never a synthetic approval.

## Verification

- State-machine and CLI unit tests for every transition and rejection path.
- Regression tests for phase-local loading and skill authoring contracts.
- Artifact mutation tests proving review and approval become stale.
- Prompt-shape tests proving future phases and provider coaching are absent.
- Live bounded canaries with GPT-5.6 Sol High and Opus 4.8 xHigh where local authentication permits.
- Full plugin contract, eval, formatting, lint, and repository test suite.

## Non-goals

- Redesigning the RFC visual template.
- Changing the current sidecar issue/test-strategy schema in this iteration.
- Reworking `/pm:groom`, `/pm:ship`, or `/pm:loop` beyond compatibility changes required by the RFC lifecycle.
- Publishing or merging the plugin release as part of implementation.
