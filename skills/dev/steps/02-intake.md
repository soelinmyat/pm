---
name: Intake
order: 2
description: Resolve task context, acceptance criteria, size, risk, and executable routing
phase: intake
requires:
  - state-schema.md
  - risk-routing.md
gates: []
required_evidence:
  - intake
requires_commit: false
allowed_modes:
  - inline
result_schema: phase-result-v1
---

## Goal

Turn the request and available product context into confirmed scope plus a durable, executable risk route.

## How

1. Read repository instructions and run the project context discovery protocol. Recall at most five relevant entries from `{pm_dir}/memory.md`; absence is not a blocker.
2. Resolve the task locally before querying integrations: direct backlog slug, matching `id`/`linear_id`, approved RFC sidecar, then configured tracker. Conversation context is valid when no artifact exists.
3. Normalize `kind` to `proposal`, `task`, or `bug`. Kind affects readiness inputs, not safety gates. Never let `task` or `bug` erase high-risk review.
4. Extract or confirm testable acceptance criteria, explicit non-goals, and size (`XS`–`XL`). Ask for confirmation when these materially depend on user intent; otherwise use the supplied approved artifact.
5. Score every dimension in `risk-routing.md`: `behavioral`, `security`, `auth`, `data`, `external_contract`, `operational`, `ui`, `reversibility`, and `cross_module`; record `destructive_data` separately. Use observable facts and add a concrete `non_behavioral_reason` only when TDD is genuinely inapplicable.
6. **Layered RFC preference.** If an RFC exists, validate its JSON sidecar once with `scripts/rfc-sidecar-check.js`. For schema v3, pass its path to `dev-session route --rfc-sidecar <json-path>`; that command uses `scripts/lib/rfc-work-units.js` so RFC issue `num: N` becomes Dev `id: "rfc-N"`, every numeric `depends_on` entry uses the same mapping, and ownership is copied under the shared validator. Carry acceptance criteria, approach, verification commands, and test hooks into the bounded implementation packet. Read the HTML `id="execution-contract"` only for human rationale or legacy fallback—not to rediscover machine fields. A present invalid sidecar blocks and routes to `pm:rfc`. A valid schema-v2 sidecar is legacy evidence: use the documented HTML fallback or recertify it, because it cannot safely supply ownership. For a pre-rollout RFC with no sidecar, use the Legacy fallback: parse `.issue-detail` cards (`.issue-detail-num`, `.issue-detail-title`, and `.issue-detail-size`) and apply the Test Strategy grandfather rule. No `data-schema-version="2"` and no `test-strategy` is warn-only; a schema-v2 RFC missing or empty Test Strategy is a halt and must be regenerated with `/pm:rfc`.
7. Write an intake facts JSON file containing `reference`, `kind`, `size`, `risk`, `acceptance_criteria`, `work_units`, and optional `non_behavioral_reason`. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/dev-session.js" route \
     --session .pm/dev-sessions/{slug}/session.json \
     --facts .pm/dev-sessions/{slug}/intake-facts.json \
     --json
   ```

8. Read back the route. M/L/XL proposals include readiness; tasks/bugs with adequate supplied scope may skip readiness. High-risk work uses full review regardless of kind or size. UI impact adds design critique and QA. Review and verification remain mandatory.
9. Record a passing intake phase result with no fabricated test evidence. The runner, not prose, selects the next routed phase.

## Done-when

- Scope, acceptance criteria, size, and non-goals are confirmed or sourced from an approved artifact.
- Every risk dimension is recorded and `dev-session route` succeeds.
- The canonical session contains the derived tier, review mode, ordered phases/gates, reasons, and validated work units.
- Any required RFC/sidecar problem is a structured blocker rather than an implementation guess.

**Advance:** record the intake result and proceed to Step 03 (Workspace), as selected by the runner.
