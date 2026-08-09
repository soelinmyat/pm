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
2. Resolve the stable RFC slug from the named proposal or resumable session. For existing JSON state, use `rfc-session next`; do not ask whether to resume when the slug unambiguously matches the user's request. If multiple sessions match, show phase, status, and age and ask which one.
3. Prefer `{pm_dir}/backlog/proposals/{slug}.json`. Canonical JSON is eligible only when its sibling approval audit verifies the approved semantic revision and Groom decision identity. `approved` requires exact current bytes; `planned`, `in-progress`, or `done` may differ only by monotonic lifecycle fields. If canonical JSON exists but trust fails, stop—never fall back to its generated Markdown twin. Use `{pm_dir}/backlog/{slug}.md` only as the named legacy compatibility path; its status is not trusted approval. A Linear issue may substitute only when it carries title, description, and explicit ACs; tracking metadata alone is not a proposal.
4. Reject an existing RFC only when durable state proves explicit approval for its current artifact hash. A draft or reviewed RFC resumes its canonical phase.
5. Apply the size gate. For canonical JSON, take size from the approved execution contract and reject contradictory caller input. XS/S routes to `pm:dev`; M/L/XL continues. For legacy Markdown or Linear input with no size, recommend one from module count, cross-cutting decisions, risk, and duration, then obtain the user's confirmation before persisting it.
6. Run context discovery. Record only relevant product/technical instructions and exact source paths; do not paste the repository or preload generation/review instructions.
7. Before initializing a fresh RFC session or writing any artifact, prepare its isolated Git workspace:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-worktree.js prepare \
     --pm-dir "{pm_dir}" --slug "{slug}" --kind rfc --json
   ```

   Keep the canonical RFC session under `source_dir`, but use the returned artifact worktree as `artifact_repo_root` and the returned `pm_dir` for every RFC artifact path and commit. The helper fetches the authoritative remote default branch without moving the shared checkout, creates `codex/{slug}-rfc` from that exact base, and reuses only a worktree it previously marked as owned. If it reports an existing unowned branch or path, stop with its recovery message; never switch, clean, commit, or attach an upstream in the shared KB checkout.
8. For fresh work, initialize the canonical session. Write a facts JSON file containing `source_kind`, the returned `artifact_repo_root`, and either `proposal_path` or `linear_id`. For canonical proposal JSON, omit duplicated `size` and `acceptance_criteria`; the runner derives both and records a compact trusted proposal identity. For legacy Markdown or Linear, include caller-confirmed size and acceptance criteria. Persist it with:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/rfc-session.js context \
     --session {session_path} --facts {facts_json} --json
   ```

9. Record a passing intake result. Do not create RFC artifacts, tracker issues, or approval state in intake.

## Done-when

- Product context is approved/dev-ready and traceable to a proposal or complete Linear issue.
- Size is confirmed as M/L/XL; XS/S has stopped with a `pm:dev` handoff.
- Acceptance criteria are non-empty, source-derived where canonical JSON exists, and saved with proposal identity plus the returned isolated artifact worktree in canonical RFC state.
- The intake result is recorded and `rfc-session next` returns generation.

**Advance:** proceed to Step 02 (RFC Generation).
