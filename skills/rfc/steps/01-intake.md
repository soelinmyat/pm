---
name: Intake
order: 1
description: Validate product context, size, acceptance criteria, and RFC eligibility
phase: intake
requires:
  - ../../../references/context-discovery.md
required_evidence:
allowed_modes:
  - inline
result_schema: rfc-phase-result-v1
---

## Goal

Establish whether an RFC is warranted and persist complete, source-backed product context for generation.

## How

1. Resolve `pm_dir`, `pm_state_dir`, and `source_dir` through the shared runtime contract. Read project instructions before producing output.
2. For fresh work, initialize the canonical session. For existing JSON state, use `rfc-session next`; do not ask whether to resume when the slug unambiguously matches the user's request. If multiple sessions match, show phase, status, and age and ask which one.
3. Find `{pm_dir}/backlog/{slug}.md`. Accept proposal states `proposed`, `planned`, or `in-progress` only when scope and acceptance criteria are substantive. A Linear issue may substitute only when it carries title, description, and explicit ACs; tracking metadata alone is not a proposal.
4. Reject an existing RFC only when durable state proves explicit approval for its current artifact hash. A draft or reviewed RFC resumes its canonical phase.
5. Apply the size gate. XS/S routes to `pm:dev`. M/L/XL continues. If size is absent, recommend one from module count, cross-cutting decisions, risk, and duration, then obtain the user's confirmation before persisting it.
6. Run context discovery. Record only relevant product/technical instructions and exact source paths; do not paste the repository or preload generation/review instructions.
7. Write a facts JSON file containing `source_kind`, `proposal_path` or `linear_id`, canonical size, and acceptance criteria. Persist it with:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js context \
     --session {session_path} --facts {facts_json} --json
   ```

8. Record a passing intake result. Do not create RFC artifacts, tracker issues, or approval state in intake.

## Done-when

- Product context is approved/dev-ready and traceable to a proposal or complete Linear issue.
- Size is confirmed as M/L/XL; XS/S has stopped with a `pm:dev` handoff.
- Acceptance criteria are non-empty and saved in canonical JSON state.
- The intake result is recorded and `rfc-session next` returns generation.

**Advance:** proceed to Step 02 (RFC Generation).
